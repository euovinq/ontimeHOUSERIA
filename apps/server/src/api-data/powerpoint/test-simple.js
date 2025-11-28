// Teste simples e rápido do serviço Windows
import net from 'net';

const WINDOWS_APP_URL = process.env.POWERPOINT_WINDOWS_URL || 'http://192.168.0.240:7800';

console.log('🧪 Teste Simples - App Windows PowerPoint\n');
console.log(`📍 URL: ${WINDOWS_APP_URL}\n`);

async function testConnection() {
  return new Promise((resolve) => {
    const url = new URL(WINDOWS_APP_URL);
    const client = new net.Socket();
    let data = '';
    let finished = false;
    
    client.connect(parseInt(url.port), url.hostname, () => {
      console.log('✅ Conectado!');
      console.log('📤 Enviando requisição...\n');
      
      const request = `GET /?slide_info HTTP/1.1\r\n` +
                     `Host: ${url.host}\r\n` +
                     `Connection: close\r\n\r\n`;
      
      client.write(request);
    });
    
    client.on('data', (chunk) => {
      if (!finished) {
        data += chunk.toString();
        
        // Para após receber dados
        if (data.length > 50) {
          finished = true;
          setTimeout(() => {
            client.end();
            resolve(data);
          }, 100);
        }
      }
    });
    
    client.on('end', () => {
      if (!finished) {
        finished = true;
        resolve(data);
      }
    });
    
    client.on('error', (err) => {
      if (!finished) {
        finished = true;
        resolve(`ERROR: ${err.message}`);
      }
    });
    
    setTimeout(() => {
      if (!finished) {
        finished = true;
        client.destroy();
        resolve(data || 'TIMEOUT - Nenhum dado recebido');
      }
    }, 3000);
  });
}

testConnection().then((result) => {
  console.log('📥 Resposta recebida:');
  console.log('─'.repeat(60));
  console.log(result);
  console.log('─'.repeat(60));
  
  if (result && result.length > 0 && !result.startsWith('ERROR') && result !== 'TIMEOUT - Nenhum dado recebido') {
    console.log('\n✅ Teste OK! Dados recebidos do app Windows.');
    
    // Tenta parsear
    try {
      const params = new URLSearchParams(result.trim());
      console.log('\n📊 Dados parseados:');
      for (const [key, value] of params.entries()) {
        console.log(`   ${key}: ${value}`);
      }
    } catch (e) {
      console.log('\n⚠️  Não foi possível parsear como query string');
    }
  } else {
    console.log('\n❌ Teste falhou!');
  }
  
  process.exit(0);
});













