// Serviço WebSocket para comunicação com app Python do PowerPoint
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
      logger.info(LogOrigin.Server, '⚠️  PowerPoint WebSocket - URL não configurada, aguardando descoberta...');
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
    logger.info(LogOrigin.Server, `🔌 PowerPoint WebSocket - Conectando em ${wsUrl}...`);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.isConnected = true;
        this.isConnecting = false;
        this.reconnectDelay = 1000; // Reset delay em caso de sucesso
        logger.info(LogOrigin.Server, `✅ PowerPoint WebSocket - Conectado em ${wsUrl}`);
        
        // Emite evento quando conecta para que outros serviços possam reagir
        this.emit('connected');
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const rawMessage = data.toString();
          const message = JSON.parse(rawMessage) as WebSocketMessage;
          
          // ✅ CAPTURA COMPLETA: Log detalhado de TODAS as mensagens recebidas
          if (message.type === 'current_slide') {
            logger.info(LogOrigin.Server, `🔍 PowerPoint WebSocket - RAW MESSAGE (current_slide): ${rawMessage}`);
            logger.info(LogOrigin.Server, `🔍 PowerPoint WebSocket - PARSED MESSAGE: ${JSON.stringify(message, null, 2)}`);
            logger.info(LogOrigin.Server, `🔍 PowerPoint WebSocket - slide_index: ${(message as any).slide_index}, tipo: ${typeof (message as any).slide_index}`);
            logger.info(LogOrigin.Server, `🔍 PowerPoint WebSocket - slide_title: "${(message as any).slide_title}", tipo: ${typeof (message as any).slide_title}`);
            logger.info(LogOrigin.Server, `🔍 PowerPoint WebSocket - slide_notes: "${(message as any).slide_notes}", tipo: ${typeof (message as any).slide_notes}`);
            logger.info(LogOrigin.Server, `🔍 PowerPoint WebSocket - slide_notes existe?: ${(message as any).slide_notes !== undefined}`);
            logger.info(LogOrigin.Server, `🔍 PowerPoint WebSocket - slide_notes é null?: ${(message as any).slide_notes === null}`);
            logger.info(LogOrigin.Server, `🔍 PowerPoint WebSocket - slide_notes é string vazia?: ${(message as any).slide_notes === ''}`);
            logger.info(LogOrigin.Server, `🔍 PowerPoint WebSocket - Todas as chaves do objeto: ${Object.keys(message).join(', ')}`);
          }
          
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
    switch (message.type) {
      case 'connected':
        logger.info(LogOrigin.Server, `✅ PowerPoint WebSocket - ${(message as any).message || 'Conectado ao servidor PowerPoint'}`);
        break;

      case 'slides_info':
        this.slidesInfo = message as SlidesInfoMessage;
        // ✅ DEBUG: Log detalhado para verificar se notes estão chegando
        logger.info(LogOrigin.Server, `📋 PowerPoint WebSocket - slides_info recebido: ${this.slidesInfo.total_slides} slides`);
        if (this.slidesInfo.slides && this.slidesInfo.slides.length > 0) {
          // Log dos primeiros 3 slides para verificar notes
          this.slidesInfo.slides.slice(0, 3).forEach(slide => {
            logger.info(LogOrigin.Server, `   Slide ${slide.index + 1}: title="${slide.title}", notes="${slide.notes}", notes existe?=${slide.notes !== undefined}, notes é null?=${slide.notes === null}, notes length=${slide.notes?.length || 0}, tipo=${typeof slide.notes}`);
          });
          // Log também do slide atual se houver
          if (this.currentSlide && this.currentSlide.slide_index !== undefined) {
            const currentSlideInList = this.slidesInfo.slides.find(s => s.index === this.currentSlide!.slide_index);
            if (currentSlideInList) {
              logger.info(LogOrigin.Server, `   🔍 Slide ATUAL (${this.currentSlide.slide_index + 1}): title="${currentSlideInList.title}", notes="${currentSlideInList.notes}", notes length=${currentSlideInList.notes?.length || 0}`);
            }
          }
        }
        // Lista slides com vídeo no console para teste
        this.logSlidesWithVideo(this.slidesInfo);
        this.updateStatus();
        break;

      case 'current_slide': {
        this.currentSlide = message as CurrentSlideMessage;
        // Log para debug - mostra as notas recebidas
        const currentSlideMsg = message as CurrentSlideMessage;
        logger.info(LogOrigin.Server, `📝 PowerPoint WebSocket - current_slide recebido: slide_index=${currentSlideMsg.slide_index}, title="${currentSlideMsg.slide_title}", notes="${currentSlideMsg.slide_notes}"`);
        
        // ✅ Cacheia notas e título para preservar mesmo quando slides_info chegar novamente
        if (currentSlideMsg.slide_index !== undefined) {
          if (currentSlideMsg.slide_notes !== undefined) {
            this.slideNotesCache.set(currentSlideMsg.slide_index, currentSlideMsg.slide_notes);
            logger.info(LogOrigin.Server, `💾 PowerPoint WebSocket - Notas do slide ${currentSlideMsg.slide_index + 1} cacheadas: "${currentSlideMsg.slide_notes}"`);
          }
          if (currentSlideMsg.slide_title !== undefined) {
            this.slideTitlesCache.set(currentSlideMsg.slide_index, currentSlideMsg.slide_title);
            logger.info(LogOrigin.Server, `💾 PowerPoint WebSocket - Título do slide ${currentSlideMsg.slide_index + 1} cacheado: "${currentSlideMsg.slide_title}"`);
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
            logger.info(LogOrigin.Server, `📝 PowerPoint WebSocket - Atualizando notas do slide ${currentSlideIndex + 1}: "${this.currentSlide.slide_notes}"`);
          }
          // Atualiza título se vier em current_slide (mesmo que seja string vazia)
          if (this.currentSlide.slide_title !== undefined) {
            slideInList.title = this.currentSlide.slide_title || '';
            logger.info(LogOrigin.Server, `📝 PowerPoint WebSocket - Atualizando título do slide ${currentSlideIndex + 1}: "${this.currentSlide.slide_title}"`);
          }
        } else {
          logger.warning(LogOrigin.Server, `⚠️  PowerPoint WebSocket - Slide ${currentSlideIndex} não encontrado na lista para atualizar notas/título`);
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

    // Atualiza último status
    this.lastStatus = status;

    // Log no console mostrando slide atual (ajusta para 1-based)
    if (status.currentSlide >= 0 && status.slideCount > 0) {
      const slideNumber = status.currentSlide + 1; // Converte de 0-based para 1-based
      console.log(`📊 PowerPoint - Slide atual: ${slideNumber}/${status.slideCount}`);
    }

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
    if (this.isConnected) {
      this.isConnected = false;
      this.isConnecting = false;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
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
