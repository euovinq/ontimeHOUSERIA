// Serviço de descoberta para encontrar servidores PowerPoint na rede local.
// Dois modos: BROADCAST (UDP 7899, push) e SCAN UNICAST (TCP 7800, pull).
// O scan existe porque o macOS (Sequoia+) barra broadcast/multicast sem o
// entitlement da Apple, mas libera unicast com o prompt de Rede Local — então
// o scan varre o /24 e conecta direto, mantendo a auto-descoberta no Mac.
import * as dgram from 'node:dgram';
import * as net from 'node:net';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../../classes/Logger.js';
import { LogOrigin } from 'houseriaapp-types';
import { getNetworkInterfaces } from '../../utils/network.js';
import { hostname, networkInterfaces } from 'os';

export interface DiscoveredServer {
  service: string;
  version: string;
  ip: string;
  port: number;
  device_name: string;
  timestamp: number;
  // Identidade da instância (multi-instância / grupos). Opcionais p/ compat com apps antigos.
  instance_id?: string;
  machine_name?: string;
  group_id?: string;
  group_name?: string;
  priority?: number;
}

export class PowerPointDiscoveryService extends EventEmitter {
  private udpSocket: dgram.Socket | null = null;
  private broadcastSocket: dgram.Socket | null = null;
  private isListening = false;
  private isBroadcasting = false;
  private broadcastInterval: NodeJS.Timeout | null = null;
  private activeSearchInterval: NodeJS.Timeout | null = null;
  private readonly DISCOVERY_PORT = 7899;
  private readonly BROADCAST_INTERVAL = 5000; // 5 segundos
  private readonly ACTIVE_SEARCH_INTERVAL = 30000; // 30 segundos - busca ativa apenas quando necessário
  private readonly SERVICE_NAME = 'houseria-ppt-control';
  private readonly SERVICE_VERSION = '1.0';
  private serverPort: number = 0;
  private serverHost: string = '';
  private discoveredServers: Map<string, DiscoveredServer> = new Map();
  private onServerFoundCallback: ((server: DiscoveredServer) => void) | null = null;

  // --- Scan unicast (alternativa ao broadcast, obrigatória no macOS) ---
  private readonly SCAN_PORT = 7800; // porta TCP/WS do PPT (o mesmo do stream de dados)
  private readonly SCAN_INTERVAL = 4000; // varre o /24 a cada 4s
  private readonly TCP_TIMEOUT = 500; // timeout do probe TCP por host
  private readonly WS_PROBE_TIMEOUT = 2500; // timeout pra colher a identidade via WS
  private readonly SCAN_CONCURRENCY = 32; // hosts sondados em paralelo
  private scanInterval: NodeJS.Timeout | null = null;
  private isScanning = false;
  private scanInFlight = false; // impede ciclos sobrepostos
  private identityCache = new Map<string, DiscoveredServer>(); // ip -> identidade já colhida
  private probing = new Set<string>(); // ips com WS-probe em andamento

  /**
   * Inicia o serviço de descoberta como CLIENTE (escuta broadcasts)
   */
  startListening(): void {
    if (this.isListening) {
      logger.warning(LogOrigin.Server, 'PowerPoint Discovery - Já está escutando broadcasts');
      return;
    }

    // Se já existe socket, fecha primeiro
    if (this.udpSocket) {
      try {
        this.udpSocket.close();
      } catch (e) {
        // Ignora erro ao fechar
      }
      this.udpSocket = null;
    }

    try {
      this.udpSocket = dgram.createSocket('udp4');
      
      // Remove listener de erro anterior se existir antes de adicionar novo
      this.udpSocket.removeAllListeners('error');
      
      this.udpSocket.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          logger.warning(LogOrigin.Server, `PowerPoint Discovery - Porta ${this.DISCOVERY_PORT} já em uso. Tentando reutilizar...`);
          // Não fecha o socket aqui - apenas loga o aviso
          // O socket pode estar sendo usado por outra instância legítima
        } else {
          logger.error(LogOrigin.Server, `PowerPoint Discovery - Erro no socket UDP: ${error.message}`);
        }
      });

      this.udpSocket.on('message', (msg, _rinfo) => {
        try {
          const data = JSON.parse(msg.toString());
          
          // Valida se é um servidor válido
          if (data.service === this.SERVICE_NAME && data.ip && data.port) {
            const discoveredServer: DiscoveredServer = {
              service: data.service,
              version: data.version || '1.0',
              ip: data.ip,
              port: data.port,
              device_name: data.device_name || 'Unknown',
              timestamp: data.timestamp || Date.now(),
              instance_id: data.instance_id || '',
              machine_name: data.machine_name || data.device_name || '',
              group_id: data.group_id || '',
              group_name: data.group_name || '',
              priority: typeof data.priority === 'number' ? data.priority : Number(data.priority) || 1,
            };

            // Chave única: prefere instance_id (estável); cai pra IP:PORT em apps antigos
            const key = discoveredServer.instance_id || `${discoveredServer.ip}:${discoveredServer.port}`;
            
            // Atualiza timestamp se já existe
            const existing = this.discoveredServers.get(key);
            const isNewServer = !existing;
            
            if (existing) {
              discoveredServer.timestamp = Math.max(existing.timestamp, discoveredServer.timestamp);
            }
            
            this.discoveredServers.set(key, discoveredServer);

            // Servidor encontrado (não loga para evitar spam)

            // Emite evento para quem está escutando (sempre, para listeners gerais)
            this.emit('serverFound', discoveredServer);
            
            // Chama callback se configurado (apenas uma vez por servidor)
            // Só chama se é um servidor novo (não atualização de timestamp)
            if (this.onServerFoundCallback && isNewServer) {
              this.onServerFoundCallback(discoveredServer);
            }
          }
        } catch (error) {
          // Ignora mensagens inválidas (log removido para evitar spam)
        }
      });

      this.udpSocket.bind(this.DISCOVERY_PORT, () => {
        this.isListening = true;
        
        // Permite receber broadcasts (aguarda um pouco para garantir que socket está pronto)
        if (this.udpSocket) {
          try {
            // Em alguns sistemas, precisa aguardar um pouco após bind
            setTimeout(() => {
              if (this.udpSocket) {
                try {
                  this.udpSocket.setBroadcast(true);
                } catch (error) {
                  // Ignora erro se não conseguir setar broadcast (não é crítico)
                  // Log removido - não é crítico
                }
              }
            }, 100);
          } catch (error) {
            // Ignora erro - não é crítico
          }
        }
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error(LogOrigin.Server, `❌ PowerPoint Discovery - Erro ao iniciar escuta: ${errorMsg}`);
    }
  }

  /**
   * Para de escutar broadcasts
   */
  stopListening(): void {
    if (!this.isListening) {
      return;
    }

    if (this.udpSocket) {
      this.udpSocket.close();
      this.udpSocket = null;
    }

    this.isListening = false;
    logger.info(LogOrigin.Server, 'PowerPoint Discovery - Parou de escutar broadcasts');
  }

  /**
   * Inicia o serviço de descoberta como SERVIDOR (faz broadcast)
   * @param serverPort Porta do servidor WebSocket/HTTP
   * @param serverHost Host/IP do servidor (opcional, detecta automaticamente se não fornecido)
   */
  startBroadcasting(serverPort: number, serverHost?: string): void {
    if (this.isBroadcasting) {
      logger.warning(LogOrigin.Server, 'PowerPoint Discovery - Já está fazendo broadcast');
      return;
    }

    this.serverPort = serverPort;
    
    // Detecta IP da rede se não fornecido
    if (!serverHost) {
      const interfaces = getNetworkInterfaces();
      if (interfaces.length > 0) {
        this.serverHost = interfaces[0].address;
      } else {
        this.serverHost = '127.0.0.1';
      }
    } else {
      this.serverHost = serverHost;
    }

    try {
      this.broadcastSocket = dgram.createSocket('udp4');
      
      this.broadcastSocket.on('error', (error) => {
        logger.error(LogOrigin.Server, `PowerPoint Discovery - Erro no socket de broadcast: ${error.message}`);
      });

      // Envia broadcast imediatamente
      this.sendBroadcast();

      // Configura intervalo periódico
      this.broadcastInterval = setInterval(() => {
        if (this.isBroadcasting) {
          this.sendBroadcast();
        }
      }, this.BROADCAST_INTERVAL);

      this.isBroadcasting = true;
      logger.info(
        LogOrigin.Server,
        `📢 PowerPoint Discovery - Fazendo broadcast: ${this.serverHost}:${this.serverPort} a cada ${this.BROADCAST_INTERVAL}ms`
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error(LogOrigin.Server, `❌ PowerPoint Discovery - Erro ao iniciar broadcast: ${errorMsg}`);
    }
  }

  /**
   * Envia um broadcast anunciando este servidor
   */
  private sendBroadcast(): void {
    if (!this.broadcastSocket) {
      return;
    }

    const message: DiscoveredServer = {
      service: this.SERVICE_NAME,
      version: this.SERVICE_VERSION,
      ip: this.serverHost,
      port: this.serverPort,
      device_name: hostname(),
      timestamp: Date.now(),
    };

    const buffer = Buffer.from(JSON.stringify(message));
    const broadcastAddress = '255.255.255.255';

    this.broadcastSocket.send(
      buffer,
      0,
      buffer.length,
      this.DISCOVERY_PORT,
      broadcastAddress,
      (error) => {
        if (error) {
          logger.error(LogOrigin.Server, `PowerPoint Discovery - Erro ao enviar broadcast: ${error.message}`);
        } else {
          // Broadcast enviado com sucesso
        }
      }
    );
  }

  /**
   * Para de fazer broadcast
   */
  stopBroadcasting(): void {
    if (!this.isBroadcasting) {
      return;
    }

    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }

    if (this.broadcastSocket) {
      this.broadcastSocket.close();
      this.broadcastSocket = null;
    }

    this.isBroadcasting = false;
    logger.info(LogOrigin.Server, 'PowerPoint Discovery - Parou de fazer broadcast');
  }

  /**
   * Busca servidores na rede (ativa busca por alguns segundos)
   * @param timeout Tempo em ms para buscar (padrão: 5 segundos)
   * @returns Promise com lista de servidores encontrados
   */
  async discoverServers(timeout: number = 5000): Promise<DiscoveredServer[]> {
    return new Promise((resolve) => {
      const servers: Map<string, DiscoveredServer> = new Map();
      const timeoutId = setTimeout(() => {
        this.removeListener('serverFound', onServerFound);
        resolve(Array.from(servers.values()));
      }, timeout);

      const onServerFound = (server: DiscoveredServer) => {
        // Usa IP:PORT como chave única
        const key = `${server.ip}:${server.port}`;
        servers.set(key, server);
      };

      this.on('serverFound', onServerFound);

      // Se não estiver escutando, inicia escuta temporariamente
      const wasListening = this.isListening;
      if (!wasListening) {
        this.startListening();
      }

      // Limpa listener após timeout
      timeoutId.unref();
    });
  }

  /**
   * Retorna o primeiro servidor descoberto
   */
  getFirstDiscoveredServer(): DiscoveredServer | null {
    if (this.discoveredServers.size === 0) {
      return null;
    }
    return Array.from(this.discoveredServers.values())[0];
  }

  /**
   * Configura callback para quando servidor for encontrado
   */
  setOnServerFoundCallback(callback: (server: DiscoveredServer) => void): void {
    this.onServerFoundCallback = callback;
  }

  /**
   * Inicia busca ativa periódica (apenas quando não há servidor conectado)
   * Esta busca é leve - apenas aguarda broadcasts que já estão sendo enviados
   */
  startPeriodicSearch(): void {
    if (this.activeSearchInterval) {
      return; // Já está rodando
    }

    // Garante que está escutando
    if (!this.isListening) {
      this.startListening();
    }

    // Busca ativa inicial imediata
    this.discoverServers(5000).then((servers) => {
      if (servers.length > 0 && this.onServerFoundCallback) {
        this.onServerFoundCallback(servers[0]);
      }
    });

    // Agenda buscas periódicas com intervalo espaçado (30 segundos)
    this.activeSearchInterval = setInterval(() => {
      // Só busca se não houver servidor já descoberto
      if (this.discoveredServers.size === 0) {
        this.discoverServers(5000).then((servers) => {
          if (servers.length > 0 && this.onServerFoundCallback) {
            this.onServerFoundCallback(servers[0]);
          }
        });
      }
    }, this.ACTIVE_SEARCH_INTERVAL);
  }

  /**
   * Para busca periódica
   */
  stopPeriodicSearch(): void {
    if (this.activeSearchInterval) {
      clearInterval(this.activeSearchInterval);
      this.activeSearchInterval = null;
      logger.info(LogOrigin.Server, 'PowerPoint Discovery - Busca periódica parada');
    }
  }

  // ==========================================================================
  // SCAN UNICAST — varre o /24 e conecta direto na 7800 (sem broadcast).
  // Funciona no macOS (unicast passa pelo prompt de Rede Local; broadcast não).
  // Emite o MESMO evento 'serverFound' do broadcast, então grupos/failover no
  // multisource funcionam sem mudança.
  // ==========================================================================

  /** Inicia a varredura periódica do /24 local. */
  startScanning(): void {
    if (this.isScanning) return;
    this.isScanning = true;
    void this.runScanCycle();
    this.scanInterval = setInterval(() => void this.runScanCycle(), this.SCAN_INTERVAL);
    logger.info(LogOrigin.Server, `🔎 PowerPoint Discovery - scan unicast iniciado (/24 na porta ${this.SCAN_PORT})`);
  }

  /** Para a varredura. */
  stopScanning(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.isScanning = false;
    this.probing.clear();
  }

  /** Hosts do(s) /24 das interfaces LAN privadas (cap em /24 por segurança). */
  private subnetHosts(): string[] {
    const nets = networkInterfaces();
    const hosts: string[] = [];
    const seenBase = new Set<string>();
    for (const name of Object.keys(nets)) {
      for (const ni of nets[name] || []) {
        if (ni.family !== 'IPv4' || ni.internal) continue;
        // só ranges privados (LAN de evento), nunca varre IP público
        if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ni.address)) continue;
        const base = ni.address.split('.').slice(0, 3).join('.'); // força /24
        if (seenBase.has(base)) continue;
        seenBase.add(base);
        for (let i = 1; i <= 254; i++) hosts.push(`${base}.${i}`);
      }
    }
    return hosts;
  }

  /** Um ciclo: TCP-probe em todos os hosts, depois colhe/atualiza identidade. */
  private async runScanCycle(): Promise<void> {
    if (this.scanInFlight) return;
    this.scanInFlight = true;
    try {
      const hosts = this.subnetHosts();
      const open: string[] = [];
      let idx = 0;
      const worker = async () => {
        while (idx < hosts.length) {
          const ip = hosts[idx++];
          if (await this.tcpOpen(ip, this.SCAN_PORT)) open.push(ip);
        }
      };
      await Promise.all(Array.from({ length: this.SCAN_CONCURRENCY }, () => worker()));

      const openSet = new Set(open);
      // Solta do cache identidades de IPs que sumiram (reprobar se voltarem).
      for (const ip of [...this.identityCache.keys()]) {
        if (!openSet.has(ip)) this.identityCache.delete(ip);
      }
      for (const ip of open) {
        const cached = this.identityCache.get(ip);
        if (cached) {
          cached.timestamp = Date.now(); // mantém vivo (refresh lastSeen no multisource)
          this.emitFound(cached);
        } else if (!this.probing.has(ip)) {
          this.wsProbe(ip); // novo host: colhe identidade via WS (assíncrono)
        }
      }
    } catch (error) {
      logger.error(
        LogOrigin.Server,
        `PowerPoint Discovery - erro no scan: ${error instanceof Error ? error.message : 'desconhecido'}`,
      );
    } finally {
      this.scanInFlight = false;
    }
  }

  /** true se a porta TCP abre dentro do timeout. */
  private tcpOpen(ip: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const sock = new net.Socket();
      let done = false;
      const finish = (v: boolean) => {
        if (done) return;
        done = true;
        try { sock.destroy(); } catch { /* */ }
        resolve(v);
      };
      sock.setTimeout(this.TCP_TIMEOUT);
      sock.once('connect', () => finish(true));
      sock.once('timeout', () => finish(false));
      sock.once('error', () => finish(false));
      try { sock.connect(port, ip); } catch { finish(false); }
    });
  }

  /**
   * Abre um WS curto pra colher a identidade (grupo/prioridade/instance/nome),
   * que a máquina do PPT põe em todo pacote. Confirma que é um PPT antes de
   * registrar (evita casar com outro serviço qualquer na 7800).
   */
  private wsProbe(ip: string): void {
    this.probing.add(ip);
    let ws: WebSocket | null = null;
    let done = false;
    let timer: NodeJS.Timeout;

    const finish = (server: DiscoveredServer | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      this.probing.delete(ip);
      try {
        ws?.removeAllListeners();
        ws?.close();
      } catch { /* */ }
      if (server) {
        this.identityCache.set(ip, server);
        this.emitFound(server);
      }
    };

    timer = setTimeout(() => finish(null), this.WS_PROBE_TIMEOUT);
    if (typeof timer.unref === 'function') timer.unref();

    try {
      ws = new WebSocket(`ws://${ip}:${this.SCAN_PORT}`);
      ws.on('error', () => finish(null));
      ws.on('close', () => finish(null));
      ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          const knownType =
            msg && typeof msg.type === 'string' &&
            ['connected', 'slides_info', 'current_slide', 'video_status', 'pong'].includes(msg.type);
          const hasIdentity = msg && (msg.instance_id || msg.group_id || msg.group_name);
          if (!knownType && !hasIdentity) return; // não parece PPT ainda; espera a próxima
          const server: DiscoveredServer = {
            service: this.SERVICE_NAME,
            version: this.SERVICE_VERSION,
            ip,
            port: this.SCAN_PORT,
            device_name: msg.machine_name || msg.device_name || ip,
            timestamp: Date.now(),
            instance_id: msg.instance_id || `${ip}:${this.SCAN_PORT}`,
            machine_name: msg.machine_name || '',
            group_id: msg.group_id || '',
            group_name: msg.group_name || '',
            priority: typeof msg.priority === 'number' ? msg.priority : Number(msg.priority) || 1,
          };
          logger.info(
            LogOrigin.Server,
            `🔎 PowerPoint Discovery - scan achou PPT em ${ip}:${this.SCAN_PORT} ` +
              `(grupo "${server.group_name || server.group_id || 'solo'}", P${server.priority})`,
          );
          console.log(
            `🔎 [SCAN] PPT em ${ip}:${this.SCAN_PORT} grupo="${server.group_name || server.group_id || 'solo'}" P${server.priority} instance=${server.instance_id}`,
          );
          finish(server);
        } catch { /* ignora pacote inválido; espera o próximo */ }
      });
    } catch {
      finish(null);
    }
  }

  /** Registra um servidor achado (broadcast OU scan) e notifica os ouvintes. */
  private emitFound(server: DiscoveredServer): void {
    const key = server.instance_id || `${server.ip}:${server.port}`;
    const isNew = !this.discoveredServers.has(key);
    this.discoveredServers.set(key, server);
    this.emit('serverFound', server);
    if (this.onServerFoundCallback && isNew) {
      this.onServerFoundCallback(server);
    }
  }

  /**
   * Para todos os serviços
   */
  shutdown(): void {
    this.stopListening();
    this.stopBroadcasting();
    this.stopPeriodicSearch();
    this.stopScanning();
  }

  /**
   * Retorna status do serviço
   */
  getStatus(): {
    listening: boolean;
    broadcasting: boolean;
    serverHost: string;
    serverPort: number;
  } {
    return {
      listening: this.isListening,
      broadcasting: this.isBroadcasting,
      serverHost: this.serverHost,
      serverPort: this.serverPort,
    };
  }
}

// Instância singleton
let discoveryService: PowerPointDiscoveryService | null = null;

export function getDiscoveryService(): PowerPointDiscoveryService {
  if (!discoveryService) {
    discoveryService = new PowerPointDiscoveryService();
  }
  return discoveryService;
}
