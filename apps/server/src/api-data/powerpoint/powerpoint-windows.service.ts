// Serviço para comunicação com o app Windows do PowerPoint
import { EventEmitter } from 'events';
import net from 'net';
import { logger } from '../../classes/Logger.js';
import { LogOrigin } from 'houseriaapp-types';

// Tipo do status do PowerPoint (compatível com o existente)
export type PowerPointStatus = {
  isAvailable: boolean;
  slideCount: number;
  visibleSlideCount: number;
  currentSlide: number;
  isInSlideShow: boolean;
  slidesRemaining: number;
  hiddenSlides: number[];
  video?: {
    hasVideo: boolean;
    isPlaying: boolean;
    duration: number;
    currentTime: number;
    remainingTime: number;
    volume: number;
    muted: boolean;
    fileName: string;
    sourceUrl: string;
    time?: string; // Formato "HH:MM:SS"
    hours?: number;
    minutes?: number;
    seconds?: number;
  };
  error?: string;
  timestamp?: number;
};

interface PowerPointWindowsConfig {
  url?: string;
  pollInterval?: number;
}

interface ParsedResponse {
  slide_info?: string;
  hours?: string;
  minutes?: string;
  seconds?: string;
  time?: string;
}

export class PowerPointWindowsService extends EventEmitter {
  private static logUpdateCount = 0; // Contador estático para logs
  private url: string;
  private pollInterval: number;
  private pollTimer: NodeJS.Timeout | null = null;
  private isPolling: boolean = false;
  private lastStatus: PowerPointStatus | null = null;
  private lastUpdateTime: number = 0;
  private errorCount: number = 0;
  private maxErrors: number = 5;
  private reconnectDelay: number = 1000;
  private maxReconnectDelay: number = 30000;
  private isConnected: boolean = false;
  private lastVideoTime: string | null = null;
  private currentClient: net.Socket | null = null; // Rastreia conexão ativa
  private isPollingInProgress: boolean = false; // Flag para evitar múltiplas conexões simultâneas

  constructor(config: PowerPointWindowsConfig = {}) {
    super();
    // Não define URL padrão - começa vazio (zerado)
    this.url = config.url || '';
    this.pollInterval = config.pollInterval || parseInt(process.env.POWERPOINT_WINDOWS_POLL_INTERVAL || '1000', 10);
    
    // Só extrai host e porta se URL estiver configurada
    if (this.url && this.url.trim() !== '') {
      const urlMatch = this.url.match(/^http:\/\/([^:]+):(\d+)/);
      if (urlMatch) {
        this.host = urlMatch[1];
        this.port = parseInt(urlMatch[2], 10);
      } else {
        // URL inválida - deixa host/port vazios mas não faz throw
        this.host = '';
        this.port = 0;
      }
    } else {
      // Sem URL configurada - inicia vazio
      this.host = '';
      this.port = 0;
    }
  }

  private host: string = '';
  private port: number = 0;

  /**
   * Inicia o polling do app Windows
   * Só inicia se tiver URL válida configurada
   */
  start(): void {
    if (this.isPolling) {
      logger.warning(LogOrigin.Server, 'PowerPoint Windows service já está em execução');
      return;
    }

    // Verifica se tem configuração válida
    if (!this.url || this.url.trim() === '' || !this.host || this.port === 0) {
      logger.info(LogOrigin.Server, '⚠️  PowerPoint Windows service - Configuração não definida (IP/Porta vazios) - não iniciando polling');
      this.isPolling = false;
      return;
    }

    logger.info(LogOrigin.Server, `Iniciando serviço PowerPoint Windows: ${this.url}`);
    this.isPolling = true;
    this.errorCount = 0;
    this.reconnectDelay = 1000;
    
    // Faz primeira requisição imediatamente
    this.poll();
    
    // Configura polling periódico
    this.pollTimer = setInterval(() => {
      if (this.isPolling) {
        this.poll();
      }
    }, this.pollInterval);
  }

  /**
   * Para o polling
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isPolling = false;
    this.isConnected = false;
    
    // Fecha conexão ativa se existir
    if (this.currentClient && !this.currentClient.destroyed) {
      try {
        this.currentClient.destroy();
      } catch (err) {
        // Ignora erros ao fechar
      }
      this.currentClient = null;
    }
    this.isPollingInProgress = false;
    
    logger.info(LogOrigin.Server, 'Serviço PowerPoint Windows parado');
  }

  /**
   * Retorna o último status recebido
   */
  getStatus(): PowerPointStatus | null {
    return this.lastStatus;
  }

  /**
   * Verifica se está conectado
   */
  isServiceConnected(): boolean {
    return this.isConnected && this.lastStatus !== null;
  }

  /**
   * Faz requisição HTTP para o app Windows
   * Garante que apenas uma conexão seja mantida por vez
   */
  private async poll(): Promise<void> {
    // Verifica se tem configuração válida antes de fazer polling
    if (!this.url || this.url.trim() === '' || !this.host || this.port === 0) {
      // Sem configuração, não faz polling
      return;
    }
    
    if (!this.isPolling) {
      // Se não está rodando, não faz polling
      return;
    }
    
    // Se já existe uma conexão em andamento, ignora esta chamada
    if (this.isPollingInProgress) {
      return;
    }
    
    // Se existe uma conexão anterior ainda ativa, fecha ela primeiro
    if (this.currentClient && !this.currentClient.destroyed) {
      try {
        this.currentClient.destroy();
      } catch (err) {
        // Ignora erros ao fechar conexão anterior
      }
      this.currentClient = null;
    }
    
    // Marca que está fazendo polling
    this.isPollingInProgress = true;
    
    return new Promise((resolve) => {
      const client = new net.Socket();
      this.currentClient = client; // Armazena referência da conexão atual
      let responseData = '';
      let responseReceived = false;
      let hasBeenProcessed = false; // Flag para evitar processamento duplicado
      
      client.setTimeout(5000); // Timeout de 5 segundos

      client.connect(this.port, this.host, () => {
        // Envia requisição HTTP GET solicitando slide_info E dados de vídeo
        // O app pode não seguir padrão HTTP completo, então tentamos formato mais simples
        const request = `GET /?slide_info&hours&minutes&seconds&time HTTP/1.0\r\n` +
                       `Host: ${this.host}:${this.port}\r\n` +
                       `\r\n`;
        
        client.write(request);
      });
      
      // Log quando inicia conexão (a cada 50 tentativas para não poluir)
      if (!PowerPointWindowsService.logUpdateCount) {
        PowerPointWindowsService.logUpdateCount = 0;
      }
      if (++PowerPointWindowsService.logUpdateCount % 50 === 0) {
        logger.info(LogOrigin.Server, `🔍 PowerPoint Windows - Fazendo polling... (tentativa ${PowerPointWindowsService.logUpdateCount})`);
      }

      let dataTimer: NodeJS.Timeout | null = null;
      
      client.on('data', (data: Buffer) => {
        responseData += data.toString();
        
        // Cancela timer anterior se existir
        if (dataTimer) {
          clearTimeout(dataTimer);
          dataTimer = null;
        }
        
        // Para após receber dados (app não envia headers HTTP padrão)
        // Aguarda um pouco mais para garantir que recebeu tudo
        if (responseData.length > 0 && !responseReceived) {
          responseReceived = true;
          // ✅ PRECISÃO: Aguarda 50ms para receber possíveis dados adicionais
          // Reduzido de 100ms para resposta ainda mais rápida e precisa
          dataTimer = setTimeout(() => {
            // Verifica novamente se ainda não foi processado pelo handler 'end'
            if (!hasBeenProcessed && responseData.length > 0) {
              hasBeenProcessed = true;
              try {
                if (!client.destroyed) {
                  client.end();
                }
                this.handleResponse(responseData);
              } catch (err) {
                logger.warning(LogOrigin.Server, `Erro ao processar resposta do Windows: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
              }
            }
            // Limpa referência e flag
            if (this.currentClient === client) {
              this.currentClient = null;
            }
            this.isPollingInProgress = false;
            resolve();
          }, 50); // ✅ REDUZIDO de 100ms para 50ms - resposta ainda mais rápida e precisa
        }
      });

      client.on('end', () => {
        // Cancela timer do handler 'data' se existir (evita processamento duplicado)
        if (dataTimer) {
          clearTimeout(dataTimer);
          dataTimer = null;
        }
        
        // Só processa se ainda não foi processado pelo handler 'data' (timeout)
        if (!hasBeenProcessed) {
          if (responseData.length > 0) {
            hasBeenProcessed = true;
            this.handleResponse(responseData);
          } else {
            // Conexão fechou sem dados - não é erro, apenas não há dados no momento
            // Não incrementa contador de erro, apenas resolve
          }
        }
        // Limpa referência e flag
        if (this.currentClient === client) {
          this.currentClient = null;
        }
        this.isPollingInProgress = false;
        resolve();
      });

      client.on('error', (err: Error) => {
        try {
          if (!responseReceived) {
            this.handleError(err);
          }
        } catch (handleErr) {
          // Captura erro no handler para não derrubar o servidor
          logger.warning(LogOrigin.Server, `Erro ao tratar erro de conexão: ${handleErr instanceof Error ? handleErr.message : 'Erro desconhecido'}`);
        }
        // Limpa referência e flag
        if (this.currentClient === client) {
          this.currentClient = null;
        }
        this.isPollingInProgress = false;
        resolve();
      });

      client.on('timeout', () => {
        if (dataTimer) {
          clearTimeout(dataTimer);
          dataTimer = null;
        }
        try {
          if (!hasBeenProcessed && responseData.length > 0) {
            hasBeenProcessed = true;
            this.handleResponse(responseData);
          } else {
            // Timeout sem dados ou já processado - app pode não ter dados para enviar no momento
            // Não trata como erro (é normal quando não há mudanças)
            // Apenas marca como desconectado temporariamente
            this.isConnected = false;
            // Não incrementa errorCount nem loga - é comportamento esperado
          }
        } catch (err) {
          // Captura qualquer erro no handler para não derrubar o servidor
          logger.warning(LogOrigin.Server, `Erro ao tratar timeout: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
        }
        try {
          if (!client.destroyed) {
            client.destroy();
          }
        } catch {
          // Ignora erros ao destruir cliente
        }
        // Limpa referência e flag
        if (this.currentClient === client) {
          this.currentClient = null;
        }
        this.isPollingInProgress = false;
        resolve();
      });
    });
  }

  /**
   * Processa resposta recebida
   */
  private handleResponse(data: string): void {
    try {
      // Valida se dados não estão vazios
      if (!data || data.trim().length === 0) {
        logger.warning(LogOrigin.Server, '⚠️  PowerPoint Windows - Resposta vazia recebida');
        return;
      }

      // Log dados brutos recebidos (para debug)
      const dataPreview = data.substring(0, 200).replace(/[\r\n]/g, ' ');
      logger.info(LogOrigin.Server, `📥 PowerPoint Windows - Dados recebidos: ${dataPreview}${data.length > 200 ? '...' : ''}`);
      
      const parsed = this.parseResponse(data);
      const normalized = this.normalizeData(parsed);
      
      // Valida dados normalizados antes de atualizar estado
      if (!normalized || normalized.currentSlide === undefined) {
        logger.warning(LogOrigin.Server, '⚠️  PowerPoint Windows - Dados normalizados inválidos');
        return;
      }
      
      this.isConnected = true;
      this.errorCount = 0;
      this.reconnectDelay = 1000;
      this.lastStatus = normalized;
      this.lastUpdateTime = Date.now();
      
      // Emite evento de mudança (sempre que receber dados válidos)
      const listenerCount = this.listenerCount('statusChange');
      if (listenerCount > 0) {
        logger.info(LogOrigin.Server, `🔔 PowerPoint Windows - Emitindo statusChange (${listenerCount} listeners)`);
        try {
          this.emit('statusChange', normalized);
        } catch (emitErr) {
          logger.error(LogOrigin.Server, `Erro ao emitir evento statusChange: ${emitErr instanceof Error ? emitErr.message : 'Erro desconhecido'}`);
        }
      }
      
      // Log sempre que receber dados (para debug)
      logger.info(LogOrigin.Server, `✅ PowerPoint Windows - Slide ${normalized.currentSlide}/${normalized.slideCount}${normalized.video ? ` | Vídeo: ${normalized.video.currentTime?.toFixed(1)}s/${normalized.video.duration?.toFixed(1)}s` : ''}`);
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error(LogOrigin.Server, `Erro ao processar resposta PowerPoint Windows: ${errorMsg}`);
      if (error instanceof Error) {
        this.handleError(error);
      }
    }
  }

  /**
   * Trata erros e implementa reconexão com backoff exponencial
   */
  private handleError(error: Error): void {
    try {
      this.isConnected = false;
      this.errorCount++;
      
      const errorMsg = error.message;
      
      // Só loga se não tiver excedido muito (evita spam de logs)
      if (this.errorCount <= this.maxErrors || this.errorCount % 10 === 0) {
        logger.warning(LogOrigin.Server, `Erro PowerPoint Windows (${this.errorCount}/${this.maxErrors}): ${errorMsg}`);
      }
      
      if (this.errorCount >= this.maxErrors) {
        // Cria status de erro apenas uma vez
        if (!this.lastStatus || this.lastStatus.isAvailable) {
          this.lastStatus = {
            isAvailable: false,
            slideCount: 0,
            visibleSlideCount: 0,
            currentSlide: 0,
            isInSlideShow: false,
            slidesRemaining: 0,
            hiddenSlides: [],
            error: `Não foi possível conectar ao app Windows após ${this.errorCount} tentativas`,
            timestamp: Date.now(),
          };
        }
        
        // Emite erro apenas se houver listeners (evita exception não tratada)
        if (this.listenerCount('error') > 0) {
          try {
            this.emit('error', error);
          } catch (emitErr) {
            // Ignora erros ao emitir evento
          }
        }
        
        // Tenta reconectar após delay
        if (this.isPolling) {
          setTimeout(() => {
            if (this.isPolling) {
              this.errorCount = 0;
              logger.info(LogOrigin.Server, 'Tentando reconectar ao app Windows...');
            }
          }, this.reconnectDelay);
          
          // Backoff exponencial
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
        }
      }
    } catch (err) {
      // Captura qualquer erro no handler para não derrubar o servidor
      logger.error(LogOrigin.Server, `Erro no handleError: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
    }
  }

  /**
   * Parseia resposta query string
   */
  private parseResponse(data: string): ParsedResponse {
    const parsed: ParsedResponse = {};
    
    // Tenta extrair query string da resposta (pode vir com headers HTTP ou sozinha)
    let queryString = data;
    
    // Se tem headers HTTP, extrai o body
    const headerEnd = data.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      queryString = data.substring(headerEnd + 4);
    }
    
    // Remove caracteres não imprimíveis e quebras de linha
    const cleanData = queryString.trim().replace(/[\r\n]/g, '');
    
    // Tenta parsear como query string
    try {
      // Se não começa com ?, adiciona
      const queryToParse = cleanData.startsWith('?') ? cleanData.substring(1) : cleanData;
      const params = new URLSearchParams(queryToParse);
      
      for (const [key, value] of params.entries()) {
        switch (key) {
          case 'slide_info':
            parsed.slide_info = decodeURIComponent(value);
            break;
          case 'hours':
            parsed.hours = value;
            break;
          case 'minutes':
            parsed.minutes = value;
            break;
          case 'seconds':
            parsed.seconds = value;
            break;
          case 'time':
            parsed.time = value;
            break;
        }
      }
    } catch (e) {
      // Se falhar, tenta parsear manualmente
      logger.warning(LogOrigin.Server, `Erro ao parsear query string, tentando método alternativo: ${e instanceof Error ? e.message : 'Erro desconhecido'}`);
      
      // Parse manual simples: slide_info=Slide%205%20/%2014
      const slideMatch = cleanData.match(/slide_info=([^&]+)/i);
      if (slideMatch) {
        parsed.slide_info = decodeURIComponent(slideMatch[1]);
      }
      
      const hoursMatch = cleanData.match(/hours=(\d+)/i);
      if (hoursMatch) {
        parsed.hours = hoursMatch[1];
      }
      
      const minutesMatch = cleanData.match(/minutes=(\d+)/i);
      if (minutesMatch) {
        parsed.minutes = minutesMatch[1];
      }
      
      const secondsMatch = cleanData.match(/seconds=(\d+)/i);
      if (secondsMatch) {
        parsed.seconds = secondsMatch[1];
      }
      
      const timeMatch = cleanData.match(/time=([^&]+)/i);
      if (timeMatch) {
        parsed.time = timeMatch[1];
      }
    }
    
    return parsed;
  }

  /**
   * Normaliza dados para formato PowerPointStatus
   */
  private normalizeData(parsed: ParsedResponse): PowerPointStatus {
    const now = Date.now();
    
    // Parseia slide_info: "Slide 5 / 14"
    let currentSlide = 1;
    let slideCount = 0;
    
    if (parsed.slide_info) {
      const slideMatch = parsed.slide_info.match(/Slide\s+(\d+)\s*\/\s*(\d+)/i);
      if (slideMatch) {
        currentSlide = parseInt(slideMatch[1], 10) || 1;
        slideCount = parseInt(slideMatch[2], 10) || 0;
      }
    } else {
      // Se não tem slide_info na resposta atual (comum quando há vídeo),
      // mantém o último slide conhecido do lastStatus
      // Isso permite que o vídeo continue atualizando enquanto mantém o slide correto
      if (this.lastStatus) {
        currentSlide = this.lastStatus.currentSlide;
        slideCount = this.lastStatus.slideCount;
      }
    }
    
    // Verifica se há vídeo (presença de hours, minutes, seconds ou time)
    const hasVideo = !!(parsed.hours !== undefined || parsed.minutes !== undefined || 
                        parsed.seconds !== undefined || parsed.time);
    
    // ✅ CORREÇÃO: Detecta quando vídeo para E não tem slide_info (pode indicar mudança de slide)
    // Se tinha vídeo antes e agora não tem E não tem slide_info, pode ter mudado de slide
    if (this.lastStatus?.video?.hasVideo && !hasVideo && !parsed.slide_info) {
      logger.info(LogOrigin.Server, `⚠️  PowerPoint Windows - Vídeo parou mas sem slide_info. Mantendo slide ${currentSlide} até receber slide_info atualizado`);
    }
    
    // ✅ NOVO: Detecta gaps nos slides (slide pulado)
    // Se estava no slide 5 e agora está no 7, o slide 6 foi pulado
    if (this.lastStatus && parsed.slide_info) {
      const lastSlide = this.lastStatus.currentSlide;
      if (currentSlide > lastSlide + 1) {
        const skippedSlides = [];
        for (let i = lastSlide + 1; i < currentSlide; i++) {
          skippedSlides.push(i);
        }
        logger.warning(LogOrigin.Server, `⚠️  PowerPoint Windows - Slides pulados detectados: ${skippedSlides.join(', ')} (${lastSlide} → ${currentSlide}). O app Windows pode ter pulado slides ou não enviou dados intermediários.`);
      }
    }
    
    // Calcula currentTime em segundos
    let currentTime = 0;
    let hours = 0;
    let minutes = 0;
    let seconds = 0;
    
    if (hasVideo) {
      hours = parsed.hours ? parseInt(parsed.hours, 10) || 0 : 0;
      minutes = parsed.minutes ? parseInt(parsed.minutes, 10) || 0 : 0;
      seconds = parsed.seconds ? parseInt(parsed.seconds, 10) || 0 : 0;
      
      // Se não tem horas/minutos/segundos mas tem time, parseia time
      if (!parsed.hours && !parsed.minutes && !parsed.seconds && parsed.time) {
        const timeMatch = parsed.time.match(/(\d+):(\d+):(\d+)/);
        if (timeMatch) {
          hours = parseInt(timeMatch[1], 10) || 0;
          minutes = parseInt(timeMatch[2], 10) || 0;
          seconds = parseInt(timeMatch[3], 10) || 0;
        }
      }
      
      currentTime = hours * 3600 + minutes * 60 + seconds;
    }
    
    // Detecta se está tocando (tempo mudou desde última atualização)
    const isPlaying = hasVideo && (
      this.lastVideoTime === null || 
      this.lastVideoTime !== parsed.time ||
      (this.lastStatus?.video && this.lastStatus.video.currentTime !== currentTime)
    );
    
    if (parsed.time) {
      this.lastVideoTime = parsed.time;
    }
    
    // Cria status normalizado
    const status: PowerPointStatus = {
      isAvailable: true,
      slideCount,
      visibleSlideCount: slideCount,
      currentSlide,
      isInSlideShow: true, // Assumimos que está em apresentação se o app está enviando dados
      slidesRemaining: Math.max(0, slideCount - currentSlide),
      hiddenSlides: [],
      timestamp: now,
    };
    
    // Adiciona informações de vídeo se houver
    if (hasVideo) {
      status.video = {
        hasVideo: true,
        isPlaying,
        duration: 0, // Não disponível do app Windows
        currentTime,
        remainingTime: 0, // Não disponível sem duration
        volume: 0,
        muted: false,
        fileName: '',
        sourceUrl: '',
        time: parsed.time || `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
        hours,
        minutes,
        seconds,
      };
    } else {
      status.video = {
        hasVideo: false,
        isPlaying: false,
        duration: 0,
        currentTime: 0,
        remainingTime: 0,
        volume: 0,
        muted: false,
        fileName: '',
        sourceUrl: '',
      };
    }
    
    return status;
  }

  /**
   * Configura a URL do serviço Windows
   * Se URL estiver vazia, para o serviço
   */
  configure(config: { url: string } | null): void {
    try {
      if (!config || !config.url || config.url.trim() === '') {
        logger.info(LogOrigin.Server, 'PowerPoint Windows service - Configuração removida (IP/Porta vazios)');
        // Para o serviço se estiver rodando
        if (this.isPolling) {
          this.stop();
        }
        this.url = '';
        this.host = '';
        this.port = 0;
        return;
      }
      
      this.url = config.url;
      
      // Extrai host e porta da URL
      const urlMatch = this.url.match(/^http:\/\/([^:]+):(\d+)/);
      if (!urlMatch) {
        const errorMsg = `URL inválida: ${this.url}. Use formato http://host:port`;
        logger.warning(LogOrigin.Server, errorMsg);
        this.host = '';
        this.port = 0;
        if (this.isPolling) {
          this.stop();
        }
        throw new Error(errorMsg);
      }
      
      this.host = urlMatch[1];
      this.port = parseInt(urlMatch[2], 10);
      
      if (isNaN(this.port) || this.port <= 0 || this.port > 65535) {
        const errorMsg = `Porta inválida: ${urlMatch[2]}`;
        logger.warning(LogOrigin.Server, errorMsg);
        this.host = '';
        this.port = 0;
        if (this.isPolling) {
          this.stop();
        }
        throw new Error(errorMsg);
      }
      
      logger.info(LogOrigin.Server, `PowerPoint Windows service configurado: ${this.url} (${this.host}:${this.port})`);
      
      // Se não estiver rodando e tem config válida, inicia
      if (!this.isPolling) {
        this.start();
      } else {
        // Se já está rodando, reinicia para aplicar nova configuração
        this.stop();
        this.start();
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido ao configurar';
      logger.error(LogOrigin.Server, `❌ PowerPoint Windows service - Erro em configure: ${errorMsg}`);
      throw error; // Re-throw para ser capturado pelo controller
    }
  }
  
  /**
   * Obtém a configuração atual
   */
  getConfig(): { url: string } | null {
    if (!this.url || this.url.trim() === '') {
      return null;
    }
    return { url: this.url };
  }
  
  /**
   * Verifica se tem configuração válida
   */
  hasValidConfig(): boolean {
    return !!(this.url && this.url.trim() !== '' && this.host && this.port > 0);
  }
  
  /**
   * Verifica se está rodando (polling ativo)
   */
  isRunning(): boolean {
    return this.isPolling;
  }

  /**
   * Retorna informações de status do serviço
   */
  getServiceStatus(): {
    connected: boolean;
    url: string;
    pollInterval: number;
    lastUpdate: number | null;
    errorCount: number;
  } {
    return {
      connected: this.isConnected,
      url: this.url,
      pollInterval: this.pollInterval,
      lastUpdate: this.lastUpdateTime || null,
      errorCount: this.errorCount,
    };
  }
}

