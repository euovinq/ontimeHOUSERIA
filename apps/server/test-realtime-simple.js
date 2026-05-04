// Teste simples do Realtime

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gxcgwhscnroiizjwswqv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4Y2d3aHNjbnJvaWl6andzd3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4MDMwNjMsImV4cCI6MjA3NTM3OTA2M30.suNBGtPXUr0YY8BaJEHcSja2m-vdxuCrA2CdOPip5fg';

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



