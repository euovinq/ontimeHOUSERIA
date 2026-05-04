// Script para configurar automaticamente o Supabase quando o servidor iniciar
// Execute este script após o servidor estar rodando

const SUPABASE_CONFIG = {
  url: process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY,
  tableName: process.env.SUPABASE_TABLE_NAME || 'ontime_realtime',
  enabled: true
}

if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) {
  console.error('Erro: SUPABASE_URL e SUPABASE_ANON_KEY devem estar definidas como variáveis de ambiente.')
  process.exit(1)
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







































































