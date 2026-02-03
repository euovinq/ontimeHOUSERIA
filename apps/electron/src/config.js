/**
 * Configuração de variáveis de ambiente para o app Electron
 * 
 * Você pode configurar as variáveis de ambiente de 3 formas:
 * 
 * 1. ARQUIVO .env (recomendado para desenvolvimento)
 *    Crie um arquivo .env na raiz de apps/electron/ com:
 *    API_URL=https://seu-servidor.vercel.app
 *    REMOTE_API_URL=https://seu-servidor.vercel.app
 * 
 * 2. VARIÁVEIS DE AMBIENTE DO SISTEMA
 *    export API_URL=https://seu-servidor.vercel.app
 *    pnpm dev
 * 
 * 3. NO SCRIPT DO PACKAGE.JSON
 *    "dev": "cross-env API_URL=https://seu-servidor.vercel.app electron ."
 */

// Carrega variáveis de ambiente do arquivo .env se existir
// (requer instalar dotenv: pnpm add -D dotenv)
try {
  // Tenta carregar dotenv se estiver disponível
  const dotenv = require('dotenv');
  const path = require('path');
  const envPath = path.join(__dirname, '../.env');
  dotenv.config({ path: envPath });
  console.log('📝 Arquivo .env carregado (se existir)');
} catch (error) {
  // dotenv não instalado, ignora
  // console.log('💡 Dica: Instale dotenv para usar arquivo .env');
}

/**
 * Configurações da API
 */
const config = {
  // URL da API (prioridade máxima - funciona em qualquer ambiente)
  // Deve incluir o protocolo e domínio, sem o path do endpoint
  // Exemplo: https://www.houseria.art.br
  apiUrl: process.env.API_URL || null,
  
  // URL da API remota (apenas para desenvolvimento)
  // Deve incluir o protocolo e domínio, sem o path do endpoint
  // Exemplo: https://www.houseria.art.br
  remoteApiUrl: process.env.REMOTE_API_URL || null,
  
  // URL padrão do servidor remoto (fallback para dev)
  // A API está em: https://www.houseria.art.br/auth/login (ou /api/auth/login se houver prefixo)
  defaultRemoteApiUrl: process.env.DEFAULT_REMOTE_API_URL || 'https://www.houseria.art.br',
  
  // Prefixo da API (padrão: 'api')
  // Se a API estiver em /api/auth/login, defina como 'api' ou '/api'
  // Para remover o prefixo, defina API_PREFIX= (vazio)
  // Exemplos:
  //   - API_PREFIX=api → https://www.houseria.art.br/api/auth/login
  //   - API_PREFIX=/api → https://www.houseria.art.br/api/auth/login
  //   - API_PREFIX= (vazio) → https://www.houseria.art.br/auth/login
  apiPrefix: process.env.API_PREFIX !== undefined ? process.env.API_PREFIX : 'api',
};

// Log das configurações em desenvolvimento
if (process.env.NODE_ENV !== 'production') {
  console.log('🔧 Configurações carregadas:');
  console.log('  - API_URL:', config.apiUrl || '(não definida)');
  console.log('  - REMOTE_API_URL:', config.remoteApiUrl || '(não definida)');
  console.log('  - DEFAULT_REMOTE_API_URL:', config.defaultRemoteApiUrl);
  console.log('  - API_PREFIX:', config.apiPrefix || '(vazio - sem prefixo)');
}

module.exports = config;
