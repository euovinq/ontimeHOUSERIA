// Teste em tempo real - monitora dados do app Windows enquanto você interage com PowerPoint
import net from 'net';

const WINDOWS_APP_URL = process.env.POWERPOINT_WINDOWS_URL || 'http://192.168.0.240:7800';
const POLL_INTERVAL = 500; // Polling a cada 500ms

console.log('🔴 MONITOR AO VIVO - App Windows PowerPoint\n');
console.log('='.repeat(70));
console.log(`📍 URL: ${WINDOWS_APP_URL}`);
console.log(`⏱️  Polling a cada ${POLL_INTERVAL}ms`);
console.log('='.repeat(70));
console.log('\n💡 INSTRUÇÕES:');
console.log('   1. Abra o PowerPoint no Windows');
console.log('   2. Inicie uma apresentação (F5)');
console.log('   3. Se tiver vídeo, inicie a reprodução');
console.log('   4. Mude slides e observe os dados chegando aqui\n');
console.log('⏸️  Pressione Ctrl+C para parar\n');
console.log('─'.repeat(70));

let lastData = '';
let requestCount = 0;
let successCount = 0;
let startTime = Date.now();

async function pollData() {
  return new Promise((resolve) => {
    const url = new URL(`${WINDOWS_APP_URL}/?slide_info`);
    const client = new net.Socket();
    let data = '';
    let finished = false;
    
    requestCount++;
    
    client.setTimeout(2000);
    
    client.connect(parseInt(url.port), url.hostname, () => {
      const request = `GET ${url.pathname}${url.search} HTTP/1.1\r\n` +
                     `Host: ${url.host}\r\n` +
                     `Connection: close\r\n\r\n`;
      client.write(request);
    });
    
    client.on('data', (chunk) => {
      data += chunk.toString();
      
      // Para após receber dados suficientes
      if (data.length > 20) {
        finished = true;
        setTimeout(() => {
          client.end();
          resolve(data.trim());
        }, 50);
      }
    });
    
    client.on('end', () => {
      if (!finished) {
        finished = true;
        resolve(data.trim() || null);
      }
    });
    
    client.on('error', () => {
      if (!finished) {
        finished = true;
        resolve(null);
      }
    });
    
    client.on('timeout', () => {
      if (!finished) {
        finished = true;
        client.destroy();
        resolve(null);
      }
    });
  });
}

function parseData(data) {
  if (!data || data.length === 0) {
    return null;
  }
  
  try {
    const params = new URLSearchParams(data);
    const parsed = {};
    for (const [key, value] of params.entries()) {
      parsed[key] = value;
    }
    return parsed;
  } catch (e) {
    return { raw: data };
  }
}

function formatData(parsed) {
  if (!parsed) return null;
  
  const info = {
    slide: null,
    video: null,
  };
  
  // Parse slide_info
  if (parsed.slide_info) {
    const match = parsed.slide_info.match(/Slide\s+(\d+)\s*\/\s*(\d+)/i);
    if (match) {
      info.slide = {
        current: parseInt(match[1], 10),
        total: parseInt(match[2], 10),
      };
    }
  }
  
  // Parse vídeo
  if (parsed.hours !== undefined || parsed.minutes !== undefined || parsed.seconds !== undefined || parsed.time) {
    const hours = parseInt(parsed.hours || '0', 10);
    const minutes = parseInt(parsed.minutes || '0', 10);
    const seconds = parseInt(parsed.seconds || '0', 10);
    const time = parsed.time || `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    
    info.video = {
      time,
      hours,
      minutes,
      seconds,
      totalSeconds,
    };
  }
  
  return info;
}

async function monitor() {
  const data = await pollData();
  
  if (data) {
    successCount++;
    const parsed = parseData(data);
    const formatted = formatData(parsed);
    
    // Só mostra se os dados mudaram
    if (data !== lastData) {
      const now = new Date().toLocaleTimeString('pt-BR');
      console.log(`\n[${now}] 📊 DADOS RECEBIDOS:`);
      console.log('─'.repeat(70));
      
      if (formatted) {
        if (formatted.slide) {
          console.log(`   📄 Slide: ${formatted.slide.current} / ${formatted.slide.total}`);
        }
        
        if (formatted.video) {
          console.log(`   🎬 Vídeo: ${formatted.video.time} (${formatted.video.totalSeconds}s)`);
          console.log(`      Horas: ${formatted.video.hours}, Minutos: ${formatted.video.minutes}, Segundos: ${formatted.video.seconds}`);
        } else {
          console.log(`   ⚠️  Sem dados de vídeo`);
        }
      } else {
        console.log(`   📦 Dados brutos: ${data.substring(0, 150)}`);
      }
      
      console.log('─'.repeat(70));
      
      lastData = data;
    } else {
      // Mostra ponto para indicar que está monitorando
      process.stdout.write('.');
    }
  } else {
    process.stdout.write('x'); // 'x' indica falha na conexão
  }
  
  // Estatísticas a cada 10 requisições
  if (requestCount % 10 === 0) {
    const elapsed = (Date.now() - startTime) / 1000;
    const successRate = ((successCount / requestCount) * 100).toFixed(1);
    console.log(`\n📈 Estatísticas: ${successCount}/${requestCount} sucessos (${successRate}%) | ${elapsed.toFixed(1)}s decorridos`);
  }
  
  // Continua monitorando
  setTimeout(monitor, POLL_INTERVAL);
}

// Captura Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n⏹️  Monitoramento encerrado.');
  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n📊 Resumo Final:`);
  console.log(`   Total de requisições: ${requestCount}`);
  console.log(`   Sucessos: ${successCount}`);
  console.log(`   Taxa de sucesso: ${((successCount / requestCount) * 100).toFixed(1)}%`);
  console.log(`   Tempo total: ${elapsed.toFixed(1)}s`);
  process.exit(0);
});

// Inicia monitoramento
console.log('\n▶️  Iniciando monitoramento...\n');
monitor();





