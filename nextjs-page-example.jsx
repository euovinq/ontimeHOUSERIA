// Exemplo de página completa para Next.js
// Salve como: pages/cuesheet.js ou app/cuesheet/page.jsx

import { createClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

const supabaseUrl = 'https://gxcgwhscnroiizjwswqv.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4Y2d3aHNjbnJvaWl6andzd3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4MDMwNjMsImV4cCI6MjA3NTM3OTA2M30.suNBGtPXUr0YY8BaJEHcSja2m-vdxuCrA2CdOPip5fg'

const supabase = createClient(supabaseUrl, supabaseKey)

export default function CuesheetPage() {
  const [ontimeData, setOntimeData] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(new Date())

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
        setLastUpdate(new Date())
      }
    }

    fetchInitialData()

    // Escutar mudanças em tempo real
    const subscription = supabase
      .channel('cuesheet-page')
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'ontime_realtime',
          filter: 'id=eq.current'
        }, 
        (payload) => {
          setOntimeData(payload.new.data)
          setLastUpdate(new Date())
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

  const formatDuration = (ms) => {
    if (!ms) return '--:--'
    const hours = Math.floor(ms / 3600000)
    const minutes = Math.floor((ms % 3600000) / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const getEventStatus = (event) => {
    if (!ontimeData) return 'upcoming'
    
    if (ontimeData.currentEvent?.id === event.id) return 'current'
    if (ontimeData.nextEvent?.id === event.id) return 'next'
    return 'upcoming'
  }

  if (!ontimeData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Carregando Cuesheet</h2>
          <p className="text-gray-600">Conectando ao Ontime...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <h1 className="text-2xl font-bold text-gray-900">🎬 Cuesheet</h1>
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="text-sm text-gray-600">
                  {isConnected ? 'Conectado' : 'Desconectado'}
                </span>
              </div>
            </div>
            
            {/* Timer atual */}
            <div className="text-right">
              <div className="text-sm text-gray-600">Timer Atual</div>
              <div className="text-3xl font-mono font-bold text-blue-600">
                {formatTime(ontimeData.timer?.current)}
              </div>
              <div className="text-xs text-gray-500">
                {ontimeData.timer?.playback?.toUpperCase() || 'STOP'}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Lista de Eventos */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      Rundown ({ontimeData.cuesheet?.totalEvents || 0} eventos)
                    </h2>
                    <p className="text-sm text-gray-600">
                      Duração total: {formatDuration(ontimeData.cuesheet?.totalDuration || 0)}
                    </p>
                  </div>
                  <div className="text-right text-sm text-gray-500">
                    Última atualização:<br />
                    {lastUpdate.toLocaleTimeString()}
                  </div>
                </div>
              </div>
              
              <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
                {ontimeData.cuesheet?.rundown?.map((event, index) => {
                  const status = getEventStatus(event)
                  return (
                    <div
                      key={event.id}
                      className={`p-6 hover:bg-gray-50 transition-colors border-l-4 ${
                        status === 'current' ? 'bg-blue-50 border-l-blue-500' :
                        status === 'next' ? 'bg-green-50 border-l-green-500' :
                        'border-l-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-4">
                            <div className="flex-shrink-0">
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${
                                status === 'current' ? 'bg-blue-500 text-white' :
                                status === 'next' ? 'bg-green-500 text-white' :
                                'bg-gray-200 text-gray-700'
                              }`}>
                                {event.cue}
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-lg font-medium text-gray-900 truncate">
                                {event.title}
                              </h3>
                              {event.note && (
                                <p className="text-sm text-gray-600 mt-1">{event.note}</p>
                              )}
                              <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500">
                                <span>Duração: {formatDuration(event.duration)}</span>
                                <span>Início: {formatTime(event.timeStart)}</span>
                                <span>Fim: {formatTime(event.timeEnd)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          {status === 'current' && (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                              ATUAL
                            </span>
                          )}
                          {status === 'next' && (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                              PRÓXIMO
                            </span>
                          )}
                          {event.isPublic && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                              PÚBLICO
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Painel de Detalhes */}
          <div className="space-y-6">
            
            {/* Evento Atual */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Evento Atual</h3>
              </div>
              <div className="p-6">
                {ontimeData.currentEvent ? (
                  <div className="space-y-4">
                    <div>
                      <div className="text-sm text-gray-600">Cue</div>
                      <div className="text-2xl font-bold text-blue-600">
                        {ontimeData.currentEvent.cue}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Título</div>
                      <div className="text-lg font-medium text-gray-900">
                        {ontimeData.currentEvent.title}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Tempo Restante</div>
                      <div className="text-3xl font-mono font-bold text-red-600">
                        {formatTime(ontimeData.timer?.current)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Status</div>
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                        ontimeData.timer?.playback === 'play' ? 'bg-green-100 text-green-800' :
                        ontimeData.timer?.playback === 'pause' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {ontimeData.timer?.playback?.toUpperCase() || 'STOP'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-500 italic">Nenhum evento carregado</p>
                )}
              </div>
            </div>

            {/* Próximo Evento */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Próximo Evento</h3>
              </div>
              <div className="p-6">
                {ontimeData.nextEvent ? (
                  <div className="space-y-4">
                    <div>
                      <div className="text-sm text-gray-600">Cue</div>
                      <div className="text-2xl font-bold text-green-600">
                        {ontimeData.nextEvent.cue}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Título</div>
                      <div className="text-lg font-medium text-gray-900">
                        {ontimeData.nextEvent.title}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Duração</div>
                      <div className="text-lg font-mono text-gray-800">
                        {formatDuration(ontimeData.nextEvent.duration)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-500 italic">Nenhum próximo evento</p>
                )}
              </div>
            </div>

            {/* Delay */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Delay</h3>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  <div>
                    <div className="text-sm text-gray-600">Offset</div>
                    <div className={`text-2xl font-mono font-bold ${
                      ontimeData.delay?.offset > 0 ? 'text-green-600' :
                      ontimeData.delay?.offset < 0 ? 'text-red-600' :
                      'text-gray-600'
                    }`}>
                      {ontimeData.delay?.offset > 0 ? '+' : ''}{formatTime(ontimeData.delay?.offset)}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Status</div>
                    <p className={`text-sm font-medium ${
                      ontimeData.delay?.offset > 0 ? 'text-green-600' : 
                      ontimeData.delay?.offset < 0 ? 'text-red-600' : 'text-gray-600'
                    }`}>
                      {ontimeData.delay?.offset > 0 ? 'Adiantado' : 
                       ontimeData.delay?.offset < 0 ? 'Atrasado' : 'No horário'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Custom Fields */}
            {ontimeData.cuesheet?.customFields && Object.keys(ontimeData.cuesheet.customFields).length > 0 && (
              <div className="bg-white rounded-lg shadow">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Campos Customizados</h3>
                </div>
                <div className="p-6">
                  <div className="space-y-3">
                    {Object.entries(ontimeData.cuesheet.customFields).map(([key, field]) => (
                      <div key={key} className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{field.label}</div>
                          <div className="text-xs text-gray-500">{field.type}</div>
                        </div>
                        <div 
                          className="w-4 h-4 rounded-full border-2 border-gray-300"
                          style={{ backgroundColor: field.colour }}
                        ></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <p className="text-gray-600">
              Dados em tempo real do Ontime
            </p>
            <div className="text-sm text-gray-500">
              Atualizado em: {lastUpdate.toLocaleString()}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
















