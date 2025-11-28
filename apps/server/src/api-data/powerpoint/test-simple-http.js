// Teste simples com diferentes variações de requisição HTTP
import net from 'net';

const HOST = '192.168.0.240';
const PORT = 7800;

function sendRequest(path = '/', query = '') {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let response = Buffer.alloc(0);
    let headersReceived = false;
    
    const url = query ? `${path}?${query}` : path;
    
    client.connect(PORT, HOST, () => {
      console.log(`\n✅ Conectado! Enviando GET ${url}`);
      
      const request = `GET ${url} HTTP/1.1\r\n` +
                     `Host: ${HOST}:${PORT}\r\n` +
                     'Connection: close\r\n' +
                     '\r\n';
      
      client.write(request);
    });
    
    client.on('data', (data) => {
      response = Buffer.concat([response, data]);
      
      // Procura pelo fim do header HTTP
      const responseStr = response.toString();
      const headerEnd = responseStr.indexOf('\r\n\r\n');
      
      if (headerEnd >= 0 && !headersReceived) {
        headersReceived = true;
        const headers = responseStr.substring(0, headerEnd);
        const body = responseStr.substring(headerEnd + 4);
        
        console.log('\n📋 Headers HTTP:');
        console.log(headers);
        console.log('\n📄 Body:');
        console.log(body.substring(0, 1000));
        if (body.length > 1000) {
          console.log(`\n... (${body.length} bytes totais)`);
        }
        
        // Para após receber headers + um pouco do body
        setTimeout(() => {
          client.destroy();
          resolve(responseStr);
        }, 100);
      }
    });
    
    client.on('close', () => {
      if (!headersReceived) {
        const responseStr = response.toString();
        console.log('\n📄 Resposta (sem headers claros):');
        console.log(responseStr.substring(0, 1000));
        if (responseStr.length > 1000) {
          console.log(`\n... (${responseStr.length} bytes totais)`);
        }
      }
    });
    
    client.on('error', reject);
    
    setTimeout(() => {
      if (!client.destroyed) {
        client.destroy();
        const responseStr = response.toString();
        console.log(`\n⏰ Timeout - dados recebidos (${response.length} bytes):`);
        console.log(responseStr || '(vazio)');
        resolve(responseStr);
      }
    }, 3000);
  });
}

async function testAll() {
  console.log('🔍 Testando diferentes endpoints...\n');
  
  const tests = [
    { path: '/', query: '' },
    { path: '/', query: 'slide_info' },
    { path: '/slide_info', query: '' },
  ];
  
  for (const test of tests) {
    try {
      await sendRequest(test.path, test.query);
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`❌ Erro: ${err.message}`);
    }
  }
}

testAll().catch(console.error);













