// Teste direto - conecta uma vez e mostra o que recebe
import net from 'net';

const HOST = '192.168.0.240';
const PORT = 7800;

console.log('🔴 TESTE DIRETO - App Windows PowerPoint\n');
console.log(`📍 Conectando em ${HOST}:${PORT}...\n`);

const client = new net.Socket();

client.setTimeout(10000);

client.connect(PORT, HOST, () => {
  console.log('✅ Conectado!');
  console.log('📤 Enviando requisição...\n');
  
  const request = `GET /?slide_info HTTP/1.0\r\n` +
                 `Host: ${HOST}:${PORT}\r\n` +
                 `\r\n`;
  
  client.write(request);
});

let data = '';

client.on('data', (chunk) => {
  data += chunk.toString();
  console.log('📥 Recebendo dados...');
  console.log('Raw:', chunk.toString('hex').substring(0, 100) + '...');
});

client.on('end', () => {
  console.log('\n✅ Conexão fechada pelo servidor');
  console.log('\n📋 DADOS RECEBIDOS:');
  console.log('─'.repeat(70));
  console.log(data);
  console.log('─'.repeat(70));
  console.log('\n📊 ANÁLISE:');
  console.log(`- Tamanho: ${data.length} bytes`);
  console.log(`- Tem "slide_info": ${data.includes('slide_info')}`);
  console.log(`- Tem "Slide": ${data.includes('Slide')}`);
  
  // Tenta parsear
  if (data.includes('slide_info')) {
    const match = data.match(/slide_info=([^&\s]+)/i);
    if (match) {
      console.log(`- slide_info encontrado: ${decodeURIComponent(match[1])}`);
    }
  }
  
  process.exit(0);
});

client.on('timeout', () => {
  console.log('\n⏱️  Timeout (10s)');
  console.log('📋 DADOS RECEBIDOS ATÉ AGORA:');
  console.log('─'.repeat(70));
  console.log(data || '(nenhum dado)');
  console.log('─'.repeat(70));
  client.destroy();
  process.exit(0);
});

client.on('error', (err) => {
  console.error('\n❌ Erro:', err.message);
  process.exit(1);
});













