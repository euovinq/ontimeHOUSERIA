// Teste rápido do serviço Windows
import http from 'http';

const SERVER_URL = 'http://localhost:4001';

console.log('🧪 Testando Serviço Windows PowerPoint\n');

async function testStatus() {
  return new Promise((resolve) => {
    const url = new URL(`${SERVER_URL}/data/powerpoint/windows/status`);
    
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ error: data });
        }
      });
    }).on('error', (err) => {
      resolve({ error: err.message });
    });
  });
}

async function startService() {
  return new Promise((resolve) => {
    const url = new URL(`${SERVER_URL}/data/powerpoint/windows/start`);
    
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ error: data });
        }
      });
    });
    
    req.on('error', (err) => resolve({ error: err.message }));
    req.end();
  });
}

async function test() {
  console.log('1️⃣ Verificando status atual...');
  let status = await testStatus();
  console.log('Status:', JSON.stringify(status, null, 2));
  
  if (!status.connected) {
    console.log('\n2️⃣ Iniciando serviço...');
    const startResult = await startService();
    console.log('Resultado:', JSON.stringify(startResult, null, 2));
    
    console.log('\n3️⃣ Aguardando 3 segundos...');
    await new Promise(r => setTimeout(r, 3000));
    
    console.log('\n4️⃣ Verificando status novamente...');
    status = await testStatus();
    console.log('Status:', JSON.stringify(status, null, 2));
    
    if (status.status && status.status.isAvailable) {
      console.log('\n✅ Serviço funcionando! Dados recebidos:');
      console.log(`   Slide: ${status.status.currentSlide}/${status.status.slideCount}`);
      if (status.status.video?.hasVideo) {
        console.log(`   Vídeo: ${status.status.video.time || 'N/A'}`);
      }
    } else {
      console.log('\n⚠️  Serviço iniciado mas ainda sem dados');
      console.log('   Mude os slides no PowerPoint para testar');
    }
  } else {
    console.log('\n✅ Serviço já está conectado!');
    if (status.status && status.status.isAvailable) {
      console.log(`   Slide: ${status.status.currentSlide}/${status.status.slideCount}`);
    }
  }
}

test().then(() => {
  console.log('\n✅ Teste concluído!');
  process.exit(0);
}).catch((err) => {
  console.error('❌ Erro:', err);
  process.exit(1);
});













