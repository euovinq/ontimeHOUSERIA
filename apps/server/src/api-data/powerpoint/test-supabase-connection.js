// Script para testar conexão direta com Supabase e verificar tabela
import { createClient } from '@supabase/supabase-js';

// Substitua com suas credenciais do Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gxcgwhscnroiizjwswqv.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';

console.log('🧪 TESTE DE CONEXÃO SUPABASE - PowerPoint\n');
console.log('='.repeat(70));
console.log(`📍 URL: ${SUPABASE_URL}`);
console.log(`🔑 Key: ${SUPABASE_KEY ? SUPABASE_KEY.substring(0, 20) + '...' : 'NÃO CONFIGURADA'}`);
console.log('='.repeat(70));

if (!SUPABASE_KEY) {
  console.error('\n❌ SUPABASE_ANON_KEY não configurada!');
  console.log('\nConfigure a variável de ambiente SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Teste 1: Verificar se tabela existe
async function test1_CheckTable() {
  console.log('\n📋 TESTE 1: Verificando se tabela powerpoint_realtime existe...');
  
  try {
    const { data, error } = await supabase
      .from('powerpoint_realtime')
      .select('*')
      .limit(1);
    
    if (error) {
      if (error.code === '42P01' || error.message.includes('does not exist')) {
        console.log('❌ Tabela powerpoint_realtime NÃO existe!');
        console.log('   Execute o SQL em supabase-migrations/001_create_powerpoint_realtime.sql');
        return false;
      } else {
        console.log('❌ Erro ao acessar tabela:', error.message);
        console.log('   Code:', error.code);
        return false;
      }
    } else {
      console.log('✅ Tabela powerpoint_realtime existe!');
      console.log(`   Registros encontrados: ${data?.length || 0}`);
      return true;
    }
  } catch (err) {
    console.log('❌ Erro:', err.message);
    return false;
  }
}

// Teste 2: Testar inserção
async function test2_TestInsert() {
  console.log('\n📤 TESTE 2: Testando inserção de dados...');
  
  const testData = {
    id: 'powerpoint_test',
    data: {
      currentSlide: 1,
      slideCount: 10,
      isInSlideShow: true,
      timestamp: Date.now(),
    },
    updated_at: new Date().toISOString(),
  };
  
  try {
    const { data, error } = await supabase
      .from('powerpoint_realtime')
      .upsert(testData, {
        onConflict: 'id',
      })
      .select();
    
    if (error) {
      console.log('❌ Erro ao inserir:', error.message);
      console.log('   Code:', error.code);
      console.log('   Details:', JSON.stringify(error, null, 2));
      return false;
    } else {
      console.log('✅ Dados inseridos com sucesso!');
      console.log('   Data:', JSON.stringify(data, null, 2));
      return true;
    }
  } catch (err) {
    console.log('❌ Erro:', err.message);
    return false;
  }
}

// Teste 3: Testar leitura
async function test3_TestRead() {
  console.log('\n📥 TESTE 3: Testando leitura de dados...');
  
  try {
    const { data, error } = await supabase
      .from('powerpoint_realtime')
      .select('*')
      .eq('id', 'powerpoint_test')
      .single();
    
    if (error) {
      console.log('❌ Erro ao ler:', error.message);
      return false;
    } else {
      console.log('✅ Dados lidos com sucesso!');
      console.log('   Data:', JSON.stringify(data, null, 2));
      return true;
    }
  } catch (err) {
    console.log('❌ Erro:', err.message);
    return false;
  }
}

// Teste 4: Limpar dados de teste
async function test4_Cleanup() {
  console.log('\n🧹 TESTE 4: Limpando dados de teste...');
  
  try {
    const { error } = await supabase
      .from('powerpoint_realtime')
      .delete()
      .eq('id', 'powerpoint_test');
    
    if (error) {
      console.log('⚠️  Erro ao limpar:', error.message);
      return false;
    } else {
      console.log('✅ Dados de teste removidos!');
      return true;
    }
  } catch (err) {
    console.log('⚠️  Erro:', err.message);
    return false;
  }
}

// Executa testes
async function runTests() {
  const results = {
    tableExists: false,
    canInsert: false,
    canRead: false,
    canCleanup: false,
  };
  
  results.tableExists = await test1_CheckTable();
  
  if (results.tableExists) {
    results.canInsert = await test2_TestInsert();
    
    if (results.canInsert) {
      results.canRead = await test3_TestRead();
      results.canCleanup = await test4_Cleanup();
    }
  }
  
  // Resumo
  console.log('\n' + '='.repeat(70));
  console.log('📊 RESUMO DOS TESTES');
  console.log('='.repeat(70));
  
  const total = Object.keys(results).length;
  const passed = Object.values(results).filter(Boolean).length;
  
  console.log(`\n✅ Passou: ${passed}/${total}`);
  console.log(`❌ Falhou: ${total - passed}/${total}\n`);
  
  Object.entries(results).forEach(([test, passed]) => {
    console.log(`  ${passed ? '✅' : '❌'} ${test}`);
  });
  
  console.log('\n' + '='.repeat(70));
  
  if (passed === total) {
    console.log('🎉 Todos os testes passaram!');
    console.log('   A tabela está pronta para receber dados do PowerPoint.');
    process.exit(0);
  } else {
    console.log('⚠️  Alguns testes falharam.');
    if (!results.tableExists) {
      console.log('\n💡 SOLUÇÃO:');
      console.log('   1. Execute o SQL em supabase-migrations/001_create_powerpoint_realtime.sql');
      console.log('   2. Certifique-se que o Realtime está habilitado na tabela');
      console.log('   3. Verifique as políticas RLS (Row Level Security)');
    }
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error('\n❌ Erro fatal:', error);
  process.exit(1);
});













