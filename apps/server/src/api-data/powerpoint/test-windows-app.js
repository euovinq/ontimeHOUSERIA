// Script para testar e analisar o app Windows do PowerPoint
import http from 'http';
import https from 'https';

const WINDOWS_APP_URL = 'http://192.168.0.240:7800';

function testEndpoint(url, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n🔍 Testando: ${url}`);
    
    const protocol = url.startsWith('https') ? https : http;
    const timeout = 5000; // 5 segundos
    
    const req = protocol.get(url, { timeout }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log(`✅ Status: ${res.statusCode}`);
        console.log(`📋 Content-Type: ${res.headers['content-type'] || 'N/A'}`);
        console.log(`📊 Tamanho: ${data.length} bytes`);
        console.log(`\n📄 Resposta:`);
        console.log('─'.repeat(80));
        
        // Tenta formatar como JSON se possível
        try {
          const json = JSON.parse(data);
          console.log(JSON.stringify(json, null, 2));
        } catch (e) {
          // Se não for JSON, mostra como está
          const preview = data.substring(0, 2000);
          console.log(preview);
          if (data.length > 2000) {
            console.log(`\n... (truncado, total: ${data.length} bytes)`);
          }
        }
        
        console.log('─'.repeat(80));
        resolve({ statusCode: res.statusCode, headers: res.headers, data });
      });
    });
    
    req.on('error', (err) => {
      console.error(`❌ Erro: ${err.message}`);
      if (err.code === 'ETIMEDOUT') {
        console.error(`   Timeout após ${timeout}ms`);
      } else if (err.code === 'ECONNREFUSED') {
        console.error(`   Conexão recusada - verifique se o app está rodando`);
      } else if (err.code === 'ENOTFOUND') {
        console.error(`   Host não encontrado`);
      }
      reject(err);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    
    req.setTimeout(timeout);
  });
}

async function testWithFetch(url) {
  try {
    console.log(`\n🌐 Testando com fetch: ${url}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json, text/plain, */*',
      }
    });
    
    clearTimeout(timeoutId);
    
    console.log(`✅ Status: ${response.status} ${response.statusText}`);
    console.log(`📋 Content-Type: ${response.headers.get('content-type') || 'N/A'}`);
    
    const text = await response.text();
    console.log(`📊 Tamanho: ${text.length} bytes`);
    console.log(`\n📄 Resposta:`);
    console.log('─'.repeat(80));
    
    try {
      const json = JSON.parse(text);
      console.log(JSON.stringify(json, null, 2));
    } catch (e) {
      const preview = text.substring(0, 2000);
      console.log(preview);
      if (text.length > 2000) {
        console.log(`\n... (truncado, total: ${text.length} bytes)`);
      }
    }
    
    console.log('─'.repeat(80));
    return { status: response.status, data: text };
  } catch (err) {
    console.error(`❌ Erro com fetch: ${err.message}`);
    throw err;
  }
}

async function discoverEndpoints() {
  console.log('🔍 Descobrindo endpoints do app Windows...\n');
  console.log('📍 URL base:', WINDOWS_APP_URL);
  
  const endpoints = [
    '/',
    '/?slide_info',
    '?slide_info',
    '/slide_info',
  ];
  
  // Tenta primeiro com fetch (mais simples)
  for (const endpoint of endpoints) {
    try {
      await testWithFetch(`${WINDOWS_APP_URL}${endpoint}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      // Continua tentando outros endpoints
    }
  }
  
  // Se fetch falhou, tenta com http/https nativo
  console.log('\n\n🔄 Tentando com módulo http nativo...\n');
  
  for (const endpoint of endpoints) {
    try {
      await testEndpoint(`${WINDOWS_APP_URL}${endpoint}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      // Continua tentando outros endpoints
    }
  }
}

// Executa
discoverEndpoints().catch(console.error);
