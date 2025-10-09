#!/usr/bin/env node

/**
 * Script para desabilitar temporariamente o Supabase
 * Use este script se os custos estiverem muito altos
 */

const fs = require('fs');
const path = require('path');

const supabaseEnvPath = path.join(__dirname, 'supabase.env');

console.log('🔄 Desabilitando Supabase temporariamente...');

try {
  // Ler arquivo atual
  let content = fs.readFileSync(supabaseEnvPath, 'utf8');
  
  // Desabilitar Supabase
  content = content.replace('SUPABASE_ENABLED=true', 'SUPABASE_ENABLED=false');
  
  // Salvar arquivo
  fs.writeFileSync(supabaseEnvPath, content);
  
  console.log('✅ Supabase desabilitado com sucesso!');
  console.log('📝 Para reabilitar, altere SUPABASE_ENABLED=false para true no arquivo supabase.env');
  console.log('🔄 Reinicie o servidor para aplicar as mudanças');
  
} catch (error) {
  console.error('❌ Erro ao desabilitar Supabase:', error.message);
  process.exit(1);
}
