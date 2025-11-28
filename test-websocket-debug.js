// Script de debug para testar conexão WebSocket do PowerPoint
import WebSocket from 'ws';
import dgram from 'node:dgram';

// Configuração - ajuste conforme necessário
const WS_URL = process.env.WS_URL || null; // Se não fornecido, tenta descobrir via UDP
const DISCOVERY_PORT = 7899;

let ws = null;

/**
 * Descobre servidor via UDP Broadcast
 */
function discoverServer(timeout = 5000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const discoveredServers = new Map();
    let found = false;
    
    socket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.service === 'houseria-ppt-control') {
          const serverKey = `${data.ip}:${data.port}`;
          if (!discoveredServers.has(serverKey)) {
            discoveredServers.set(serverKey, data);
            console.log(`✅ Servidor descoberto: ${data.device_name} em ${data.ip}:${data.port}`);
            if (!found) {
              found = true;
              socket.close();
              resolve({ ip: data.ip, port: data.port });
            }
          }
        }
      } catch (error) {
        // Ignora mensagens inválidas
      }
    });

    socket.on('error', (error) => {
      console.error('❌ Erro no socket UDP:', error.message);
      if (!found) {
        reject(error);
      }
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      
      // Envia request de descoberta
      const request = JSON.stringify({
        service: 'houseria-ppt-control',
        version: '1.0',
      });
      
      socket.send(request, DISCOVERY_PORT, '255.255.255.255', (err) => {
        if (err) {
          console.error('❌ Erro ao enviar broadcast:', err.message);
        } else {
          console.log('📡 Broadcast UDP enviado, aguardando resposta...');
        }
      });
    });

    setTimeout(() => {
      if (!found) {
        socket.close();
        reject(new Error('Nenhum servidor encontrado após 5 segundos'));
      }
    }, timeout);
  });
}

/**
 * Conecta ao WebSocket e monitora mensagens
 */
function connectWebSocket(url) {
  console.log(`\n🔌 Conectando ao WebSocket: ${url}`);
  console.log('📋 Aguardando mensagens...\n');

  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('✅ Conectado ao WebSocket!\n');
  });

  ws.on('message', (data) => {
    try {
      const rawMessage = data.toString();
      const message = JSON.parse(rawMessage);
      
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📨 Mensagem recebida (tipo: ${message.type})`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📄 RAW MESSAGE:');
      console.log(rawMessage);
      console.log('\n📦 PARSED MESSAGE:');
      console.log(JSON.stringify(message, null, 2));
      console.log('\n🔍 Análise detalhada:');
      
      if (message.type === 'current_slide') {
        console.log(`   slide_index: ${message.slide_index} (tipo: ${typeof message.slide_index})`);
        console.log(`   slide_title: "${message.slide_title}" (tipo: ${typeof message.slide_title})`);
        console.log(`   slide_notes: "${message.slide_notes}" (tipo: ${typeof message.slide_notes})`);
        console.log(`   slide_notes existe?: ${message.slide_notes !== undefined}`);
        console.log(`   slide_notes é null?: ${message.slide_notes === null}`);
        console.log(`   slide_notes é string vazia?: ${message.slide_notes === ''}`);
        console.log(`   slide_notes tem valor?: ${message.slide_notes ? 'SIM' : 'NÃO'}`);
      }
      
      console.log(`\n📋 Todas as chaves: ${Object.keys(message).join(', ')}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    } catch (error) {
      console.error('❌ Erro ao processar mensagem:', error.message);
      console.log('📄 Mensagem RAW:', data.toString());
    }
  });

  ws.on('error', (error) => {
    console.error('❌ Erro no WebSocket:', error.message);
  });

  ws.on('close', (code, reason) => {
    console.log(`\n🔌 Conexão fechada (código: ${code}, motivo: ${reason.toString() || 'sem motivo'})`);
    process.exit(0);
  });
}

// Função principal
async function main() {
  try {
    let wsUrl = WS_URL;
    
    // Se não forneceu URL, tenta descobrir
    if (!wsUrl) {
      console.log('🔍 Tentando descobrir servidor via UDP Broadcast...');
      try {
        const server = await discoverServer(5000);
        wsUrl = `ws://${server.ip}:${server.port}`;
        console.log(`\n✅ Usando servidor descoberto: ${wsUrl}`);
      } catch (error) {
        console.error(`\n❌ Erro ao descobrir servidor: ${error.message}`);
        console.log('\n💡 Dica: Execute o script com WS_URL=ws://IP:PORTA');
        console.log('   Exemplo: WS_URL=ws://192.168.0.102:7800 node test-websocket-debug.js');
        console.log('\n⏳ Tente avançar um slide no PowerPoint para ver se o servidor aparece...');
        process.exit(1);
      }
    }
    
    connectWebSocket(wsUrl);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
}

// Mantém o processo rodando
process.on('SIGINT', () => {
  console.log('\n\n👋 Encerrando conexão...');
  if (ws) {
    ws.close();
  }
  process.exit(0);
});

// Inicia
main();
