// Script para debugar problemas com Supabase Realtime

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://YOUR_PROJECT.supabase.co';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugSupabase() {
  console.log('🔍 Iniciando debug do Supabase...');
  
  try {
    // 1. Testar conexão básica
    console.log('\n1️⃣ Testando conexão básica...');
    const { data, error } = await supabase
      .from('ontime_realtime')
      .select('*')
      .eq('id', 'current')
      .single();
    
    if (error) {
      console.error('❌ Erro na conexão:', error);
      return;
    }
    
    console.log('✅ Conexão OK!');
    console.log('📊 Dados atuais:', JSON.stringify(data, null, 2));
    
    // 2. Testar Realtime
    console.log('\n2️⃣ Testando Realtime...');
    
    const subscription = supabase
      .channel('debug-ontime')
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'ontime_realtime',
          filter: 'id=eq.current'
        }, 
        (payload) => {
          console.log('🔄 MUDANÇA DETECTADA!');
          console.log('Evento:', payload.eventType);
          console.log('Dados antigos:', payload.old);
          console.log('Dados novos:', payload.new);
          console.log('Timestamp:', new Date().toISOString());
        }
      )
      .subscribe((status) => {
        console.log('📡 Status da inscrição:', status);
        if (status === 'SUBSCRIBED') {
          console.log('✅ Inscrito com sucesso!');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Erro no canal!');
        } else if (status === 'TIMED_OUT') {
          console.error('❌ Timeout na conexão!');
        } else if (status === 'CLOSED') {
          console.error('❌ Canal fechado!');
        }
      });
    
    // 3. Verificar políticas RLS
    console.log('\n3️⃣ Verificando políticas RLS...');
    const { data: policies, error: policyError } = await supabase
      .from('ontime_realtime')
      .select('*')
      .limit(1);
    
    if (policyError) {
      console.error('❌ Erro de política RLS:', policyError);
    } else {
      console.log('✅ Políticas RLS OK!');
    }
    
    // 4. Aguardar mudanças
    console.log('\n4️⃣ Aguardando mudanças...');
    console.log('💡 Faça alguma mudança no Ontime para testar!');
    console.log('⏰ Aguardando por 30 segundos...');
    
    setTimeout(() => {
      console.log('\n⏰ Tempo esgotado!');
      subscription.unsubscribe();
      process.exit(0);
    }, 30000);
    
  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

debugSupabase();



