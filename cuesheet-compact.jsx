// Cuesheet Compacto para Next.js - Versão mais simples

import { createClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

const supabaseUrl = 'https://gxcgwhscnroiizjwswqv.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4Y2d3aHNjbnJvaWl6andzd3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4MDMwNjMsImV4cCI6MjA3NTM3OTA2M30.suNBGtPXUr0YY8BaJEHcSja2m-vdxuCrA2CdOPip5fg'

const supabase = createClient(supabaseUrl, supabaseKey)

export default function CuesheetCompact() {
  const [ontimeData, setOntimeData] = useState(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
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

    const subscription = supabase
      .channel('cuesheet-compact')
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'ontime_realtime',
          filter: 'id=eq.current'
        }, 
        (payload) => {
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

  const getEventStatus = (event) => {
    if (!ontimeData) return 'upcoming'
    
    if (ontimeData.currentEvent?.id === event.id) return 'current'
    if (ontimeData.nextEvent?.id === event.id) return 'next'
    return 'upcoming'
  }

  if (!ontimeData) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
          <p className="text-sm text-gray-600">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gray-800 text-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Cuesheet</h2>
            <p className="text-sm text-gray-300">
              {ontimeData.cuesheet?.totalEvents || 0} eventos
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-300">Timer</div>
            <div className="text-2xl font-mono font-bold">
              {formatTime(ontimeData.timer?.current)}
            </div>
            <div className="text-xs text-gray-400">
              {ontimeData.timer?.playback?.toUpperCase() || 'STOP'}
            </div>
          </div>
        </div>
      </div>

      {/* Eventos */}
      <div className="max-h-96 overflow-y-auto">
        {ontimeData.cuesheet?.rundown?.map((event, index) => {
          const status = getEventStatus(event)
          return (
            <div
              key={event.id}
              className={`p-4 border-b border-gray-200 ${
                status === 'current' ? 'bg-blue-50 border-l-4 border-l-blue-500' :
                status === 'next' ? 'bg-green-50 border-l-4 border-l-green-500' :
                'hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                    status === 'current' ? 'bg-blue-500 text-white' :
                    status === 'next' ? 'bg-green-500 text-white' :
                    'bg-gray-200 text-gray-700'
                  }`}>
                    {event.cue}
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900">{event.title}</h3>
                    <p className="text-sm text-gray-600">
                      {formatTime(event.timeStart)} - {formatTime(event.timeEnd)}
                    </p>
                  </div>
                </div>
                
                <div className="text-right">
                  <div className="text-sm font-mono text-gray-600">
                    {formatTime(event.duration)}
                  </div>
                  {status === 'current' && (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      ATUAL
                    </span>
                  )}
                  {status === 'next' && (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      PRÓXIMO
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="bg-gray-50 px-6 py-3">
        <div className="flex items-center justify-between text-sm text-gray-600">
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span>{isConnected ? 'Conectado' : 'Desconectado'}</span>
          </div>
          <div>
            Delay: {ontimeData.delay?.offset > 0 ? '+' : ''}{formatTime(ontimeData.delay?.offset)}
          </div>
        </div>
      </div>
    </div>
  )
}
















