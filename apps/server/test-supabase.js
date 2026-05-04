import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gxcgwhscnroiizjwswqv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4Y2d3aHNjbnJvaWl6andzd3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4MDMwNjMsImV4cCI6MjA3NTM3OTA2M30.suNBGtPXUr0YY8BaJEHcSja2m-vdxuCrA2CdOPip5fg';

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
