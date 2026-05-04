// Exemplo para Next.js - Página que mostra dados do Ontime em tempo real

import { createClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

const supabaseUrl = 'https://gxcgwhscnroiizjwswqv.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4Y2d3aHNjbnJvaWl6andzd3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4MDMwNjMsImV4cCI6MjA3NTM3OTA2M30.suNBGtPXUr0YY8BaJEHcSja2m-vdxuCrA2CdOPip5fg'

const supabase = createClient(supabaseUrl, supabaseKey)

export default function OntimeDashboard() {
  const [ontimeData, setOntimeData] = useState(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    // Buscar dados iniciais
    const fetchInitialData = async () => {
      const { data, error } = await supabase
        .from('ontime_realtime')
        .select('*')
        .eq('id', 'current')
        .single()

      if (data) {
        setOntimeData(data.data)
      }
    }

    fetchInitialData()

    // Escutar mudanças em tempo real
    const subscription = supabase
      .channel('ontime-updates')
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'ontime_realtime',
          filter: 'id=eq.current'
        }, 
        (payload) => {
          console.log('🔄 Dados atualizados:', payload.new.data)
          setOntimeData(payload.new.data)
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED')
      })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const formatTime = (ms) => {
    if (!ms) return '--:--'
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  if (!ontimeData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p>Carregando dados do Ontime...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold text-gray-800">Ontime Dashboard</h1>
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm text-gray-600">
                {isConnected ? 'Conectado' : 'Desconectado'}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Timer */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">Timer</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600">Tempo Atual</label>
                <p className="text-2xl font-mono font-bold text-blue-600">
                  {formatTime(ontimeData.timer?.current)}
                </p>
              </div>
              <div>
                <label className="text-sm text-gray-600">Duração</label>
                <p className="text-lg font-mono text-gray-800">
                  {formatTime(ontimeData.timer?.duration)}
                </p>
              </div>
              <div>
                <label className="text-sm text-gray-600">Status</label>
                <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                  ontimeData.timer?.playback === 'play' ? 'bg-green-100 text-green-800' :
                  ontimeData.timer?.playback === 'pause' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {ontimeData.timer?.playback?.toUpperCase() || 'STOP'}
                </span>
              </div>
            </div>
          </div>

          {/* Evento Atual */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">Evento Atual</h2>
            {ontimeData.currentEvent ? (
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-gray-600">Cue</label>
                  <p className="text-lg font-semibold text-blue-600">
                    {ontimeData.currentEvent.cue}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-gray-600">Título</label>
                  <p className="text-lg font-medium text-gray-800">
                    {ontimeData.currentEvent.title}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-gray-600">Nota</label>
                  <p className="text-sm text-gray-600">
                    {ontimeData.currentEvent.note || 'Sem nota'}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-gray-500 italic">Nenhum evento carregado</p>
            )}
          </div>

          {/* Próximo Evento */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">Próximo Evento</h2>
            {ontimeData.nextEvent ? (
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-gray-600">Cue</label>
                  <p className="text-lg font-semibold text-green-600">
                    {ontimeData.nextEvent.cue}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-gray-600">Título</label>
                  <p className="text-lg font-medium text-gray-800">
                    {ontimeData.nextEvent.title}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-gray-600">Duração</label>
                  <p className="text-sm font-mono text-gray-600">
                    {formatTime(ontimeData.nextEvent.duration)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-gray-500 italic">Nenhum próximo evento</p>
            )}
          </div>

          {/* Delay */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">Delay</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600">Offset</label>
                <p className={`text-lg font-mono font-semibold ${
                  ontimeData.delay?.offset > 0 ? 'text-green-600' :
                  ontimeData.delay?.offset < 0 ? 'text-red-600' :
                  'text-gray-600'
                }`}>
                  {ontimeData.delay?.offset > 0 ? '+' : ''}{formatTime(ontimeData.delay?.offset)}
                </p>
              </div>
              <div>
                <label className="text-sm text-gray-600">Status</label>
                <p className={`text-sm font-medium ${
                  ontimeData.delay?.offset > 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {ontimeData.delay?.offset > 0 ? 'Adiantado' : 
                   ontimeData.delay?.offset < 0 ? 'Atrasado' : 'No horário'}
                </p>
              </div>
            </div>
          </div>

          {/* Status Geral */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">Status</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600">No Ar</label>
                <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                  ontimeData.onAir ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  {ontimeData.onAir ? 'SIM' : 'NÃO'}
                </span>
              </div>
              <div>
                <label className="text-sm text-gray-600">Última Atualização</label>
                <p className="text-sm text-gray-600">
                  {new Date().toLocaleTimeString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
