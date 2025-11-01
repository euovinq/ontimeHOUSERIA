// Script para testar com socket raw (para debug)
import net from 'net';

const HOST = '192.168.0.240';
const PORT = 7800;

function testRawConnection() {
  return new Promise((resolve, reject) => {
    console.log(`\n🔌 Tentando conexão TCP raw para ${HOST}:${PORT}...`);
    
    const client = new net.Socket();
    let dataReceived = '';
    
    client.setTimeout(3000);
    
    client.connect(PORT, HOST, () => {
      console.log('✅ Conectado! Enviando requisição HTTP...');
      
      // Envia requisição HTTP GET básica
      const request = 'GET /?slide_info HTTP/1.1\r\n' +
                     `Host: ${HOST}:${PORT}\r\n` +
                     'User-Agent: Node.js Test Client\r\n' +
                     'Accept: */*\r\n' +
                     'Connection: close\r\n' +
                     '\r\n';
      
      client.write(request);
    });
    
    let bytesReceived = 0;
    const maxBytes = 10000; // Limita a 10KB
    
    client.on('data', (data) => {
      bytesReceived += data.length;
      dataReceived += data.toString();
      
      // Se recebeu dados suficientes ou encontrou fim de linha duplo (fim de HTTP response)
      if (dataReceived.includes('\r\n\r\n') || bytesReceived >= maxBytes) {
        console.log(`📥 Total recebido: ${bytesReceived} bytes`);
        setTimeout(() => {
          client.end();
        }, 100);
      }
    });
    
    client.on('end', () => {
      console.log('\n📄 Resposta completa:');
      console.log('─'.repeat(80));
      console.log(dataReceived);
      console.log('─'.repeat(80));
      resolve(dataReceived);
    });
    
    // Timeout de segurança - para após 2 segundos se não terminar
    setTimeout(() => {
      if (!client.destroyed) {
        console.log('\n⏰ Timeout - mostrando dados recebidos até agora:');
        console.log('─'.repeat(80));
        console.log(dataReceived);
        console.log('─'.repeat(80));
        client.end();
        resolve(dataReceived);
      }
    }, 2000);
    
    client.on('error', (err) => {
      console.error(`❌ Erro: ${err.message}`);
      reject(err);
    });
    
    client.on('timeout', () => {
      console.error('⏰ Timeout na conexão');
      client.destroy();
      reject(new Error('Timeout'));
    });
  });
}

// Testa conexão
testRawConnection().catch(console.error);

