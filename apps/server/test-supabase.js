import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://YOUR_PROJECT.supabase.co';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testSupabase() {
  console.log('🔍 Testando conexão com Supabase...');
  
  try {
    // Testar conexão
    const { data, error } = await supabase
      .from('ontime_realtime')
      .select('*')
      .limit(1);
    
    if (error) {
      console.error('❌ Erro ao conectar:', error.message);
      return;
    }
    
    console.log('✅ Conexão com Supabase OK!');
    console.log('📊 Dados encontrados:', data);
    
    // Escutar mudanças em tempo real
    console.log('👂 Escutando mudanças em tempo real...');
    
    const subscription = supabase
      .channel('ontime-updates')
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'ontime_realtime' 
        }, 
        (payload) => {
          console.log('🔄 Dados atualizados:', JSON.stringify(payload.new.data, null, 2));
        }
      )
      .subscribe();
    
    console.log('✅ Inscrito para receber atualizações em tempo real!');
    console.log('⏰ Aguardando dados do Ontime...');
    
  } catch (error) {
    console.error('❌ Erro:', error);
  }
}

testSupabase();
