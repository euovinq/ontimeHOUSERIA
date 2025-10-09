// Teste simples do Realtime

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://YOUR_PROJECT.supabase.co';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testRealtime() {
  console.log('🔍 Testando Realtime simples...');
  
  // Teste 1: Conexão básica
  console.log('\n1️⃣ Testando conexão...');
  const { data, error } = await supabase
    .from('ontime_realtime')
    .select('*')
    .eq('id', 'current')
    .single();
  
  if (error) {
    console.error('❌ Erro:', error);
    return;
  }
  
  console.log('✅ Conexão OK!');
  console.log('📊 Dados:', data.data.timer.playback);
  
  // Teste 2: Realtime com timeout menor
  console.log('\n2️⃣ Testando Realtime...');
  
  const channel = supabase
    .channel('simple-test')
    .on('postgres_changes', 
      { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'ontime_realtime'
      }, 
      (payload) => {
        console.log('🔄 MUDANÇA!', payload.new.data.timer.playback);
      }
    )
    .subscribe((status) => {
      console.log('📡 Status:', status);
    });
  
  // Aguardar 10 segundos
  setTimeout(() => {
    console.log('\n⏰ Teste finalizado!');
    channel.unsubscribe();
    process.exit(0);
  }, 10000);
}

testRealtime();



