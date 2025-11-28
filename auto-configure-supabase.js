// Script para configurar automaticamente o Supabase quando o servidor iniciar
// Execute este script após o servidor estar rodando

const SUPABASE_CONFIG = {
  url: 'https://gxcgwhscnroiizjwswqv.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4Y2d3aHNjbnJvaWl6andzd3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4MDMwNjMsImV4cCI6MjA3NTM3OTA2M30.suNBGtPXUr0YY8BaJEHcSja2m-vdxuCrA2CdOPip5fg',
  tableName: 'ontime_realtime',
  enabled: true
}

async function configureSupabase() {
  try {
    console.log('🔧 Configurando Supabase...')
    
    const response = await fetch('http://localhost:4001/data/supabase/configure', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(SUPABASE_CONFIG)
    })
    
    const result = await response.json()
    
    if (result.connected) {
      console.log('✅ Supabase configurado com sucesso!')
      console.log('📊 Tabela:', result.tableName)
    } else {
      console.log('❌ Erro ao configurar Supabase:', result.error)
    }
  } catch (error) {
    console.log('❌ Erro de conexão:', error.message)
  }
}

// Executar após 5 segundos (tempo para o servidor inicializar)
setTimeout(configureSupabase, 5000)







































































