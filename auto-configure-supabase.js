// Script para configurar automaticamente o Supabase quando o servidor iniciar
// Execute este script após o servidor estar rodando

const SUPABASE_CONFIG = {
  url: 'https://YOUR_PROJECT.supabase.co',
  anonKey: 'YOUR_SUPABASE_ANON_KEY',
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











































