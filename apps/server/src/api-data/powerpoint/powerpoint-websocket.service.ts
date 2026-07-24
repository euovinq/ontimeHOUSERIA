// Serviço WebSocket para comunicação com HouseriaPPT do PowerPoint
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { logger } from '../../classes/Logger.js';
import { LogOrigin } from 'houseriaapp-types';
import type { PowerPointStatus } from './powerpoint-windows.service.js';

interface PowerPointWebSocketConfig {
  url?: string;
}

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

interface SlidesInfoMessage extends WebSocketMessage {
  type: 'slides_info';
  total_slides: number;
  slides: Array<{
    index: number;
    title: string;
    hidden: boolean;
    has_video: boolean;
    notes: string;
  }>;
}

interface CurrentSlideMessage extends WebSocketMessage {
  type: 'current_slide';
  slide_index: number;
  slide_title: string;
  slide_notes: string;
}

interface VideoStatusMessage extends WebSocketMessage {
  type: 'video_status';
  slide_index: number;
  is_playing: boolean;
  current_time: number;
  duration: number;
  remaining_time: number;
  has_video?: boolean;
  hours?: number;
  minutes?: number;
  seconds?: number;
}

export class PowerPointWebSocketService extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private isConnected: boolean = false;
  private isConnecting: boolean = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay: number = 1000; // Começa com 1 segundo
  private maxReconnectDelay: number = 30000; // Máximo 30 segundos
  private lastStatus: PowerPointStatus | null = null;
  
  // Estado acumulado das mensagens recebidas
  private slidesInfo: SlidesInfoMessage | null = null;
  private currentSlide: CurrentSlideMessage | null = null;
  private videoStatus: VideoStatusMessage | null = null;
  private videoDurations: Map<number, number> = new Map(); // Mapeia slide_index -> duração do vídeo
  private slideNotesCache: Map<number, string> = new Map(); // Cache de notas por slide_index (preserva notas de current_slide)
  private slideTitlesCache: Map<number, string> = new Map(); // Cache de títulos por slide_index (preserva títulos de current_slide)

  // Identidade da instância (grupo) aprendida do próprio stream (multi-instância)
  private identity: {
    instanceId?: string;
    machineName?: string;
    groupId?: string;
    groupName?: string;
    priority?: number;
  } = {};

  constructor(config: PowerPointWebSocketConfig = {}) {
    super();
    this.url = config.url || '';
  }

  /**
   * Inicia conexão WebSocket
   */
  start(): void {
    // Verifica se já está conectando ou conectado
    if (this.isConnecting) {
      // Já está conectando, aguardando...
      return;
    }
    
    if (this.isConnected) {
      // Já está conectado
      return;
    }

    if (!this.url || this.url.trim() === '') {
      return;
    }

    this.connect();
  }

  /**
   * Para conexão WebSocket
   */
  stop(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }

    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectDelay = 1000; // Reset delay
    logger.info(LogOrigin.Server, 'PowerPoint WebSocket - Conexão parada');
  }

  /**
   * Define URL e reconecta se necessário
   */
  setUrl(url: string): void {
    // Se URL não mudou e já está conectado, não faz nada
    if (this.url === url && this.isConnected) {
      return;
    }
    
    const wasConnected = this.isConnected;
    const urlChanged = this.url !== url;
    this.url = url;
    
    // Só reconecta se URL mudou E estava conectado
    if (wasConnected && urlChanged) {
      // Reconecta com nova URL
      this.stop();
      setTimeout(() => this.start(), 500);
    } else if (!wasConnected && url) {
      // Se não estava conectado mas agora tem URL, conecta
      this.start();
    }
  }

  /**
   * Retorna último status recebido
   */
  getStatus(): PowerPointStatus | null {
    return this.lastStatus;
  }

  /**
   * Verifica se está conectado
   * Considera conectado se WebSocket está aberto (mesmo sem ter recebido status ainda)
   */
  isServiceConnected(): boolean {
    return this.isConnected === true;
  }

  /**
   * Envia uma mensagem JSON para o app PPT (ex: capture_state — canal de volta).
   */
  send(payload: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch (error) {
      logger.error(
        LogOrigin.Server,
        `PowerPoint WebSocket - Erro ao enviar mensagem: ${error instanceof Error ? error.message : 'desconhecido'}`,
      );
      return false;
    }
  }

  /**
   * URL atual desta conexão.
   */
  getUrl(): string {
    return this.url;
  }

  /**
   * Estabelece conexão WebSocket
   */
  private connect(): void {
    if (this.isConnecting || this.isConnected) {
      return;
    }

    if (!this.url || this.url.trim() === '') {
      return;
    }

    // Converte http:// para ws:// se necessário
    const wsUrl = this.url.replace(/^http/, 'ws');
    
    this.isConnecting = true;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.isConnected = true;
        this.isConnecting = false;
        this.reconnectDelay = 1000; // Reset delay em caso de sucesso
        
        // Emite evento quando conecta para que outros serviços possam reagir
        this.emit('connected');
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const rawMessage = data.toString();
          const message = JSON.parse(rawMessage) as WebSocketMessage;
          
          // ✅ CORREÇÃO CRÍTICA: Removidos logs excessivos que causavam sobrecarga
          // Logs detalhados removidos - apenas processa a mensagem
          
          this.handleMessage(message);
        } catch (error) {
          logger.error(LogOrigin.Server, `PowerPoint WebSocket - Erro ao parsear mensagem: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
        }
      });

      this.ws.on('error', (error: Error) => {
        logger.error(LogOrigin.Server, `PowerPoint WebSocket - Erro: ${error.message}`);
        this.handleDisconnection();
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        const reasonStr = reason.toString();
        logger.warning(LogOrigin.Server, `PowerPoint WebSocket - Conexão fechada (código: ${code}, motivo: ${reasonStr || 'sem motivo'})`);
        this.handleDisconnection();
      });

    } catch (error) {
      this.isConnecting = false;
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error(LogOrigin.Server, `PowerPoint WebSocket - Erro ao criar conexão: ${errorMsg}`);
      this.scheduleReconnect();
    }
  }

  /**
   * Processa mensagens recebidas do WebSocket
   */
  private handleMessage(message: WebSocketMessage): void {
    // Aprende a identidade de grupo do próprio stream (todo pacote do PPT a carrega)
    if (message.instance_id || message.group_id || message.group_name) {
      this.identity = {
        instanceId: message.instance_id ?? this.identity.instanceId,
        machineName: message.machine_name ?? this.identity.machineName,
        groupId: message.group_id ?? this.identity.groupId,
        groupName: message.group_name ?? this.identity.groupName,
        priority: typeof message.priority === 'number' ? message.priority : this.identity.priority,
      };
    }

    switch (message.type) {
      case 'connected':
        break;

      case 'slides_info':
        this.slidesInfo = message as SlidesInfoMessage;
        // ✅ CORREÇÃO: Log reduzido - apenas informação essencial
        logger.info(LogOrigin.Server, `📋 PowerPoint WebSocket - slides_info: ${this.slidesInfo.total_slides} slides`);
        // Logs detalhados removidos para evitar sobrecarga
        this.logSlidesWithVideo(this.slidesInfo);
        this.updateStatus();
        break;

      case 'current_slide': {
        this.currentSlide = message as CurrentSlideMessage;
        const currentSlideMsg = message as CurrentSlideMessage;
        // ✅ CORREÇÃO: Log reduzido - apenas quando slide realmente muda
        const previousSlide = this.lastStatus?.currentSlide ?? -1;
        if (currentSlideMsg.slide_index !== previousSlide) {
          logger.info(LogOrigin.Server, `📝 PowerPoint WebSocket - Slide ${currentSlideMsg.slide_index + 1}`);
        }
        
        // ✅ Cacheia notas e título para preservar mesmo quando slides_info chegar novamente
        if (currentSlideMsg.slide_index !== undefined) {
          if (currentSlideMsg.slide_notes !== undefined) {
            this.slideNotesCache.set(currentSlideMsg.slide_index, currentSlideMsg.slide_notes);
          }
          if (currentSlideMsg.slide_title !== undefined) {
            this.slideTitlesCache.set(currentSlideMsg.slide_index, currentSlideMsg.slide_title);
          }
        }
        
        this.updateStatus();
        break;
      }

      case 'video_status': {
        this.videoStatus = message as VideoStatusMessage;
        // Armazena duração do vídeo para o slide atual
        const videoMsg = message as VideoStatusMessage;
        if (videoMsg.duration > 0 && videoMsg.slide_index !== undefined) {
          this.videoDurations.set(videoMsg.slide_index, videoMsg.duration);
        }
        this.updateStatus();
        break;
      }

      case 'pong':
        // Ping/pong para manter conexão viva - não precisa fazer nada
        break;

      default:
        // Mensagem desconhecida ignorada
        break;
    }
  }

  /**
   * Lista slides com vídeo no console (para teste)
   */
  private logSlidesWithVideo(slidesInfo: SlidesInfoMessage): void {
    const slidesWithVideo = slidesInfo.slides.filter(slide => slide.has_video);
    const hiddenSlides = slidesInfo.slides.filter(slide => slide.hidden);
    
    console.log('\n📊 PowerPoint - Informações dos Slides:');
    console.log(`   Total de slides: ${slidesInfo.total_slides}`);
    console.log(`   Slides visíveis: ${slidesInfo.slides.length - hiddenSlides.length}`);
    console.log(`   Slides ocultos: ${hiddenSlides.length}`);
    console.log(`   Slides com vídeo: ${slidesWithVideo.length}`);
    
    if (slidesWithVideo.length > 0) {
      console.log('\n🎬 Slides com vídeo:');
      slidesWithVideo.forEach(slide => {
        const slideNumber = slide.index + 1;
        const title = slide.title || '(sem título)';
        const hidden = slide.hidden ? ' [OCULTO]' : '';
        console.log(`   - Slide ${slideNumber}: ${title}${hidden}`);
      });
    } else {
      console.log('   Nenhum slide com vídeo encontrado');
    }
    
    // Lista todos os slides para referência
    console.log('\n📋 Lista completa de slides:');
    slidesInfo.slides.forEach(slide => {
      const slideNumber = slide.index + 1;
      const title = slide.title || '(sem título)';
      const video = slide.has_video ? ' 🎬' : '';
      const hidden = slide.hidden ? ' 👁️ [OCULTO]' : '';
      console.log(`   ${slideNumber}. ${title}${video}${hidden}`);
    });
    console.log('');
  }

  /**
   * Atualiza status combinando todas as mensagens recebidas
   */
  private updateStatus(): void {
    if (!this.slidesInfo && !this.currentSlide) {
      // Não temos informação suficiente ainda
      return;
    }

    // Cria lista de vídeos com informações de duração
    const videoItems: Array<{ slideIndex: number; duration: number; hasVideo: boolean }> = [];
    if (this.slidesInfo) {
      this.slidesInfo.slides.forEach(slide => {
        if (slide.has_video) {
          const duration = this.videoDurations.get(slide.index) || 0;
          videoItems.push({
            slideIndex: slide.index,
            duration: duration,
            hasVideo: true,
          });
        }
      });
    }

    // Cria lista de slides baseada em slides_info
    let slidesList: Array<{ index: number; title: string; hidden: boolean; hasVideo: boolean; notes: string }> = [];
    if (this.slidesInfo) {
      slidesList = this.slidesInfo.slides.map(slide => {
        // ✅ USA CACHE: Prioriza notas e títulos do cache (de current_slide) sobre slides_info
        // MAS: só usa cache se tiver valor não-vazio, senão usa slides_info
        const cachedNotes = this.slideNotesCache.get(slide.index);
        const cachedTitle = this.slideTitlesCache.get(slide.index);
        
        // Se cache tem valor não-vazio, usa cache; senão usa slides_info
        // ✅ GARANTE que usa slide.notes se não tiver cache (mesmo que seja string vazia)
        const finalNotes = (cachedNotes !== undefined && cachedNotes !== null && cachedNotes !== '') 
          ? cachedNotes 
          : (slide.notes !== undefined && slide.notes !== null ? slide.notes : '');
        
        const finalTitle = (cachedTitle !== undefined && cachedTitle !== null && cachedTitle !== '') 
          ? cachedTitle 
          : (slide.title !== undefined && slide.title !== null ? slide.title : '');
        
        return {
          index: slide.index,
          title: finalTitle,
          hidden: slide.hidden,
          hasVideo: slide.has_video,
          notes: finalNotes,
        };
      });
      
      // ✅ NOVO: Atualiza notas e título do slide atual se current_slide tiver informações atualizadas
      // (isso garante que mesmo que slides_info venha depois, as notas de current_slide sejam preservadas)
      if (this.currentSlide && this.currentSlide.slide_index !== undefined) {
        const currentSlideIndex = this.currentSlide.slide_index;
        const slideInList = slidesList.find(s => s.index === currentSlideIndex);
        if (slideInList) {
          // Atualiza notas se vierem em current_slide (mesmo que seja string vazia)
          if (this.currentSlide.slide_notes !== undefined) {
            slideInList.notes = this.currentSlide.slide_notes || '';
            // ✅ CORREÇÃO: Log removido para evitar sobrecarga
          }
          // Atualiza título se vier em current_slide (mesmo que seja string vazia)
          if (this.currentSlide.slide_title !== undefined) {
            slideInList.title = this.currentSlide.slide_title || '';
            // ✅ CORREÇÃO: Log removido para evitar sobrecarga
          }
        } else {
          logger.warning(LogOrigin.Server, `⚠️  PowerPoint WebSocket - Slide ${currentSlideIndex} não encontrado na lista`);
        }
      }
    }

    const status: PowerPointStatus = {
      isAvailable: true,
      slideCount: this.slidesInfo?.total_slides || 0,
      visibleSlideCount: this.slidesInfo?.slides.filter(s => !s.hidden).length || 0,
      currentSlide: this.currentSlide?.slide_index ?? 0,
      isInSlideShow: true, // Assumimos que está em apresentação se está recebendo dados
      slidesRemaining: 0,
      hiddenSlides: this.slidesInfo?.slides.filter(s => s.hidden).map(s => s.index) || [],
      slidesWithVideo: this.slidesInfo?.slides.filter(s => s.has_video).map(s => s.index) || [], // Lista de índices dos slides com vídeo
      videoItems: videoItems.length > 0 ? videoItems : undefined, // Lista de objetos com informações de vídeo
      // Lista completa de slides com todas as informações (incluindo notes atualizadas de current_slide)
      slides: slidesList,
      timestamp: Date.now(),
    };

    // Calcula slides restantes
    if (status.slideCount > 0 && status.currentSlide >= 0) {
      status.slidesRemaining = Math.max(0, status.slideCount - status.currentSlide - 1);
    }

    // Adiciona informações de vídeo se disponíveis
    if (this.videoStatus) {
      const video = this.videoStatus;
      const hasVideo = video.has_video ?? (video.duration > 0 || video.current_time > 0);
      
      status.video = {
        hasVideo,
        isPlaying: video.is_playing,
        duration: video.duration || 0,
        currentTime: video.current_time || 0,
        remainingTime: video.remaining_time || 0,
        volume: 0, // Não disponível no protocolo WebSocket
        muted: false, // Não disponível no protocolo WebSocket
        fileName: '', // Não disponível no protocolo WebSocket
        sourceUrl: '', // Não disponível no protocolo WebSocket
      };

      // Adiciona campos de tempo formatado se disponíveis
      if (video.hours !== undefined) {
        status.video.hours = video.hours;
      }
      if (video.minutes !== undefined) {
        status.video.minutes = video.minutes;
      }
      if (video.seconds !== undefined) {
        status.video.seconds = video.seconds;
      }
      if (video.hours !== undefined && video.minutes !== undefined && video.seconds !== undefined) {
        const h = String(video.hours).padStart(2, '0');
        const m = String(video.minutes).padStart(2, '0');
        const s = String(video.seconds).padStart(2, '0');
        status.video.time = `${h}:${m}:${s}`;
      }
    }

    // Anexa a identidade de grupo (usada pelo multisource e pelo upsert do Supabase)
    status.groupId = this.identity.groupId;
    status.groupName = this.identity.groupName;
    status.instanceId = this.identity.instanceId;
    status.machineName = this.identity.machineName;
    status.priority = this.identity.priority;

    // Atualiza último status
    this.lastStatus = status;

    // ✅ CORREÇÃO: Log reduzido - apenas quando slide realmente muda
    // Log do slide atual removido para evitar sobrecarga em cada mensagem

    // Emite evento de mudança
    this.emit('statusChange', status);
  }

  /**
   * Converte mensagem WebSocket para formato PowerPointStatus
   */
  private convertToPowerPointStatus(): PowerPointStatus {
    // Este método não é mais necessário pois usamos updateStatus()
    // Mas mantemos para compatibilidade futura se necessário
    return this.lastStatus || {
      isAvailable: false,
      slideCount: 0,
      visibleSlideCount: 0,
      currentSlide: 0,
      isInSlideShow: false,
      slidesRemaining: 0,
      hiddenSlides: [],
    };
  }

  /**
   * Trata desconexão e agenda reconexão
   */
  private handleDisconnection(): void {
    const wasConnected = this.isConnected;
    
    if (this.isConnected) {
      this.isConnected = false;
      this.isConnecting = false;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }

    // Se estava conectado, atualiza status para desconectado e notifica clientes
    if (wasConnected) {
      logger.info(LogOrigin.Server, '🔌 PowerPoint WebSocket - Desconectado do HouseriaPPT, atualizando status...');
      
      // Limpa estado acumulado
      this.slidesInfo = null;
      this.currentSlide = null;
      this.videoStatus = null;
      this.videoDurations.clear();
      this.slideNotesCache.clear();
      this.slideTitlesCache.clear();
      
      // Atualiza status para desconectado
      this.lastStatus = {
        isAvailable: false,
        slideCount: 0,
        visibleSlideCount: 0,
        currentSlide: 0,
        isInSlideShow: false,
        slidesRemaining: 0,
        hiddenSlides: [],
        slidesWithVideo: [],
        slides: [],
        timestamp: Date.now(),
      };
      
      // Emite evento de desconexão para que outros serviços possam reagir
      this.emit('disconnected');
      
      // Emite statusChange com estado desconectado para notificar clientes
      this.emit('statusChange', this.lastStatus);
    }

    // Agenda reconexão automática
    this.scheduleReconnect();
  }

  /**
   * Agenda reconexão com backoff exponencial
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return; // Já existe uma reconexão agendada
    }

    if (!this.url || this.url.trim() === '') {
      // Sem URL, não tenta reconectar
      return;
    }

    logger.info(
      LogOrigin.Server,
      `🔄 PowerPoint WebSocket - Reconectando em ${this.reconnectDelay}ms...`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.isConnecting = false; // Permite nova tentativa
      this.connect();
      
      // Aumenta delay para próxima tentativa (backoff exponencial)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }, this.reconnectDelay);
  }
}
