// Script de teste para descoberta UDP de servidores PowerPoint
import * as dgram from 'node:dgram';
import { hostname } from 'os';

const DISCOVERY_PORT = 7899;
const SERVICE_NAME = 'houseria-ppt-control';

// Opções de teste
const args = process.argv.slice(2);
const mode = args[0] || 'client'; // 'client' ou 'server'

if (mode === 'server') {
  // Modo servidor: faz broadcast anunciando este servidor
  console.log('📢 Modo SERVIDOR - Fazendo broadcast...\n');
  
  const broadcastSocket = dgram.createSocket('udp4');
  const serverPort = parseInt(args[1]) || 7800;
  const serverHost = args[2] || '192.168.0.102';
  
  broadcastSocket.on('error', (error) => {
    console.error('❌ Erro no socket:', error.message);
  });
  
  const sendBroadcast = () => {
    const message = {
      service: SERVICE_NAME,
      version: '1.0',
      ip: serverHost,
      port: serverPort,
      device_name: hostname(),
      timestamp: Date.now(),
    };
    
    const buffer = Buffer.from(JSON.stringify(message));
    const broadcastAddress = '255.255.255.255';
    
    broadcastSocket.send(
      buffer,
      0,
      buffer.length,
      DISCOVERY_PORT,
      broadcastAddress,
      (error) => {
        if (error) {
          console.error('❌ Erro ao enviar broadcast:', error.message);
        } else {
          console.log(`📤 Broadcast enviado: ${message.device_name} em ${message.ip}:${message.port}`);
        }
      }
    );
  };
  
  // Envia imediatamente
  sendBroadcast();
  
  // Envia a cada 5 segundos
  const interval = setInterval(() => {
    sendBroadcast();
  }, 5000);
  
  console.log(`✅ Enviando broadcasts a cada 5 segundos`);
  console.log(`   Servidor: ${serverHost}:${serverPort}`);
  console.log(`   Pressione Ctrl+C para parar\n`);
  
  process.on('SIGINT', () => {
    clearInterval(interval);
    broadcastSocket.close();
    console.log('\n✅ Servidor de broadcast parado');
    process.exit(0);
  });
  
} else {
  // Modo cliente: escuta broadcasts
  console.log('🔍 Modo CLIENTE - Escutando broadcasts...\n');
  
  const udpSocket = dgram.createSocket('udp4');
  const timeout = parseInt(args[1]) || 10000; // 10 segundos por padrão
  const servers = new Map();
  
  udpSocket.on('error', (error) => {
    console.error('❌ Erro no socket:', error.message);
  });
  
  udpSocket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString());
      
      if (data.service === SERVICE_NAME && data.ip && data.port) {
        const key = `${data.ip}:${data.port}`;
        
        if (!servers.has(key)) {
          servers.set(key, {
            service: data.service,
            version: data.version || '1.0',
            ip: data.ip,
            port: data.port,
            device_name: data.device_name || 'Unknown',
            timestamp: data.timestamp || Date.now(),
          });
          
          console.log(`\n✅ Servidor encontrado!`);
          console.log(`   Nome: ${data.device_name}`);
          console.log(`   IP: ${data.ip}`);
          console.log(`   Porta: ${data.port}`);
          console.log(`   Versão: ${data.version || '1.0'}`);
          console.log(`   WebSocket: ws://${data.ip}:${data.port}`);
        }
      }
    } catch (error) {
      // Ignora mensagens inválidas
    }
  });
  
  udpSocket.bind(DISCOVERY_PORT, () => {
    console.log(`✅ Escutando na porta ${DISCOVERY_PORT}`);
    console.log(`   Timeout: ${timeout}ms`);
    console.log(`   Aguardando servidores...\n`);
    
    udpSocket.setBroadcast(true);
    
    // Para após timeout
    setTimeout(() => {
      udpSocket.close();
      
      console.log(`\n📊 Resultado da busca:`);
      console.log(`   Servidores encontrados: ${servers.size}\n`);
      
      if (servers.size > 0) {
        servers.forEach((server, key) => {
          console.log(`   ${server.device_name}:`);
          console.log(`     - IP: ${server.ip}`);
          console.log(`     - Porta: ${server.port}`);
          console.log(`     - WebSocket: ws://${server.ip}:${server.port}\n`);
        });
      } else {
        console.log('   Nenhum servidor encontrado na rede.\n');
      }
      
      process.exit(0);
    }, timeout);
  });
}



