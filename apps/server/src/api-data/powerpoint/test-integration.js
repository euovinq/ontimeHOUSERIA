// Script de teste completo da integração PowerPoint Windows
import http from 'http';
import net from 'net';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:4001';
const POWERPOINT_WINDOWS_URL = process.env.POWERPOINT_WINDOWS_URL || 'http://192.168.0.240:7800';

console.log('🧪 TESTE DE INTEGRAÇÃO - PowerPoint Windows\n');
console.log('='.repeat(60));

// Função auxiliar para fazer requisições HTTP
function httpRequest(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

// Teste 1: Conectividade com app Windows
async function test1_WindowsAppConnection() {
  console.log('\n📡 TESTE 1: Conectividade com App Windows');
  console.log('-'.repeat(60));
  
  try {
    const url = new URL(POWERPOINT_WINDOWS_URL);
    const client = new net.Socket();
    let connected = false;
    
    await new Promise((resolve) => {
      client.connect(parseInt(url.port), url.hostname, () => {
        connected = true;
        client.end();
        resolve();
      });
      
      client.on('error', () => {
        connected = false;
        resolve();
      });
      
      setTimeout(() => {
        if (!connected) {
          client.destroy();
          resolve();
        }
      }, 3000);
    });
    
    if (connected) {
      console.log('✅ Conexão com app Windows: OK');
      console.log(`   URL: ${POWERPOINT_WINDOWS_URL}`);
    } else {
      console.log('❌ Conexão com app Windows: FALHOU');
      console.log(`   URL: ${POWERPOINT_WINDOWS_URL}`);
      console.log('   ⚠️  Verifique se o app está rodando');
    }
    
    return connected;
  } catch (error) {
    console.log('❌ Erro ao testar conexão:', error.message);
    return false;
  }
}

// Teste 2: Dados do app Windows
async function test2_WindowsAppData() {
  console.log('\n📊 TESTE 2: Dados do App Windows');
  console.log('-'.repeat(60));
  
  try {
    const url = new URL(`${POWERPOINT_WINDOWS_URL}/?slide_info`);
    const client = new net.Socket();
    let data = '';
    
    await new Promise((resolve) => {
      client.connect(parseInt(url.port), url.hostname, () => {
        const request = `GET ${url.pathname}${url.search} HTTP/1.1\r\n` +
                       `Host: ${url.host}\r\n` +
                       `Connection: close\r\n\r\n`;
        client.write(request);
      });
      
      client.on('data', (chunk) => {
        data += chunk.toString();
        // Para após receber dados
        if (data.length > 0) {
          setTimeout(() => {
            client.end();
            resolve();
          }, 100);
        }
      });
      
      client.on('end', resolve);
      client.on('error', resolve);
      
      setTimeout(() => {
        if (data.length === 0) {
          client.destroy();
          resolve();
        }
      }, 2000);
    });
    
    if (data.length > 0) {
      console.log('✅ Dados recebidos do app Windows');
      console.log(`   Tamanho: ${data.length} bytes`);
      console.log(`   Dados: ${data.substring(0, 200)}${data.length > 200 ? '...' : ''}`);
      
      // Tenta parsear
      try {
        const params = new URLSearchParams(data.trim());
        const parsed = {};
        for (const [key, value] of params.entries()) {
          parsed[key] = value;
        }
        console.log('   Parseado:', JSON.stringify(parsed, null, 2));
      } catch (e) {
        console.log('   ⚠️  Não foi possível parsear como query string');
      }
      
      return true;
    } else {
      console.log('❌ Nenhum dado recebido do app Windows');
      return false;
    }
  } catch (error) {
    console.log('❌ Erro ao obter dados:', error.message);
    return false;
  }
}

// Teste 3: Status da API
async function test3_APIStatus() {
  console.log('\n🔌 TESTE 3: Status da API');
  console.log('-'.repeat(60));
  
  try {
    const url = new URL(`${SERVER_URL}/data/powerpoint/status`);
    const result = await httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
    });
    
    if (result.status === 200) {
      console.log('✅ API respondendo');
      console.log('   Status:', result.status);
      console.log('   Dados:', JSON.stringify(result.body, null, 2));
      
      if (result.body.isAvailable) {
        console.log('   ✅ PowerPoint disponível');
        if (result.body.video?.hasVideo) {
          console.log('   ✅ Vídeo detectado');
          console.log(`      Tempo: ${result.body.video.time || 'N/A'}`);
          console.log(`      Tocando: ${result.body.video.isPlaying}`);
        }
      } else {
        console.log('   ⚠️  PowerPoint não disponível');
      }
      
      return true;
    } else {
      console.log('❌ API retornou erro:', result.status);
      console.log('   Resposta:', result.body);
      return false;
    }
  } catch (error) {
    console.log('❌ Erro ao acessar API:', error.message);
    console.log('   ⚠️  Verifique se o servidor está rodando em', SERVER_URL);
    return false;
  }
}

// Teste 4: Status do serviço Windows
async function test4_WindowsServiceStatus() {
  console.log('\n⚙️  TESTE 4: Status do Serviço Windows');
  console.log('-'.repeat(60));
  
  try {
    const url = new URL(`${SERVER_URL}/data/powerpoint/windows/status`);
    const result = await httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
    });
    
    if (result.status === 200) {
      console.log('✅ Serviço Windows respondendo');
      console.log('   Status:', JSON.stringify(result.body, null, 2));
      
      if (result.body.connected) {
        console.log('   ✅ Serviço conectado');
        console.log(`      URL: ${result.body.url}`);
        console.log(`      Última atualização: ${result.body.lastUpdate ? new Date(result.body.lastUpdate).toLocaleString() : 'N/A'}`);
      } else {
        console.log('   ⚠️  Serviço não conectado');
      }
      
      return true;
    } else {
      console.log('❌ Serviço retornou erro:', result.status);
      return false;
    }
  } catch (error) {
    console.log('❌ Erro ao acessar serviço:', error.message);
    return false;
  }
}

// Teste 5: Configuração do serviço
async function test5_ConfigureService() {
  console.log('\n🔧 TESTE 5: Configuração do Serviço');
  console.log('-'.repeat(60));
  
  try {
    const url = new URL(`${SERVER_URL}/data/powerpoint/windows/config`);
    const result = await httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        url: POWERPOINT_WINDOWS_URL,
        pollInterval: 500,
      },
    });
    
    if (result.status === 200 && result.body.success) {
      console.log('✅ Configuração aplicada com sucesso');
      console.log('   Resposta:', JSON.stringify(result.body, null, 2));
      return true;
    } else {
      console.log('⚠️  Configuração:', result.body);
      return false;
    }
  } catch (error) {
    console.log('❌ Erro ao configurar:', error.message);
    return false;
  }
}

// Executa todos os testes
async function runAllTests() {
  const results = {
    windowsConnection: false,
    windowsData: false,
    apiStatus: false,
    serviceStatus: false,
    configuration: false,
  };
  
  results.windowsConnection = await test1_WindowsAppConnection();
  results.windowsData = await test2_WindowsAppData();
  results.apiStatus = await test3_APIStatus();
  results.serviceStatus = await test4_WindowsServiceStatus();
  
  // Só testa configuração se os outros passaram
  if (results.windowsConnection || results.serviceStatus) {
    results.configuration = await test5_ConfigureService();
  }
  
  // Resumo
  console.log('\n' + '='.repeat(60));
  console.log('📋 RESUMO DOS TESTES');
  console.log('='.repeat(60));
  
  const total = Object.keys(results).length;
  const passed = Object.values(results).filter(Boolean).length;
  
  console.log(`\n✅ Passou: ${passed}/${total}`);
  console.log(`❌ Falhou: ${total - passed}/${total}\n`);
  
  Object.entries(results).forEach(([test, passed]) => {
    console.log(`  ${passed ? '✅' : '❌'} ${test}`);
  });
  
  console.log('\n' + '='.repeat(60));
  
  if (passed === total) {
    console.log('🎉 Todos os testes passaram!');
    process.exit(0);
  } else {
    console.log('⚠️  Alguns testes falharam. Verifique os logs acima.');
    process.exit(1);
  }
}

// Executa
runAllTests().catch((error) => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});

