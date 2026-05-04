#!/usr/bin/env node

// Script para configurar o Supabase automaticamente
// Uso: node setup-supabase.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_CONFIG = {
  url: process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY,
  tableName: process.env.SUPABASE_TABLE_NAME || 'ontime_realtime',
  enabled: process.env.SUPABASE_ENABLED || 'true',
};

if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) {
  console.error('Erro: SUPABASE_URL e SUPABASE_ANON_KEY devem estar definidas como variáveis de ambiente.');
  console.error('Exemplo: SUPABASE_URL=https://xyz.supabase.co SUPABASE_ANON_KEY=eyJ... node setup-supabase.js');
  process.exit(1);
}

function createEnvFile() {
  const envContent = `# Supabase Configuration
SUPABASE_URL=${SUPABASE_CONFIG.url}
SUPABASE_ANON_KEY=${SUPABASE_CONFIG.anonKey}
SUPABASE_TABLE_NAME=${SUPABASE_CONFIG.tableName}
SUPABASE_ENABLED=${SUPABASE_CONFIG.enabled}
`;

  const envPath = path.join(__dirname, 'apps/server/supabase.env');
  
  try {
    fs.writeFileSync(envPath, envContent);
    console.log('✅ Arquivo supabase.env criado com sucesso!');
    console.log('📁 Localização:', envPath);
    return true;
  } catch (error) {
    console.error('❌ Erro ao criar arquivo supabase.env:', error.message);
    return false;
  }
}

function createExampleFile() {
  const exampleContent = `# Supabase Configuration - Exemplo
# Copie este arquivo para supabase.env e configure suas credenciais

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_TABLE_NAME=ontime_realtime
SUPABASE_ENABLED=true
`;

  const examplePath = path.join(__dirname, 'apps/server/supabase.env.example');
  
  try {
    fs.writeFileSync(examplePath, exampleContent);
    console.log('✅ Arquivo supabase.env.example criado!');
    return true;
  } catch (error) {
    console.error('❌ Erro ao criar arquivo de exemplo:', error.message);
    return false;
  }
}

function main() {
  console.log('🔧 Configurando Supabase para Ontime...\n');
  
  const envCreated = createEnvFile();
  const exampleCreated = createExampleFile();
  
  if (envCreated && exampleCreated) {
    console.log('\n🎉 Configuração concluída!');
    console.log('\n📋 Próximos passos:');
    console.log('1. Reinicie o servidor Ontime');
    console.log('2. O Supabase será configurado automaticamente');
    console.log('3. Não será mais necessário digitar as credenciais!');
    console.log('\n💡 Para usar em produção, edite o arquivo supabase.env com suas credenciais');
  } else {
    console.log('\n❌ Erro na configuração. Verifique as permissões de arquivo.');
  }
}

main();
