// Serviço para integrar dados do PowerPoint Windows com Supabase
import { PowerPointWindowsService, PowerPointStatus } from './powerpoint-windows.service.js';
import { SupabaseAdapter } from '../../adapters/SupabaseAdapter.js';
import { logger } from '../../classes/Logger.js';
import { LogOrigin } from 'houseriaapp-types';
import { createClient } from '@supabase/supabase-js';

export class PowerPointSupabaseService {
  private windowsService: PowerPointWindowsService;
  private supabaseAdapter: SupabaseAdapter | null;
  private supabaseClient: any = null; // Cliente Supabase direto (independente do adapter)
  private isRunning: boolean = false;
  private isEnabled: boolean = false; // Estado de habilitação (verde/vermelho) - começa DESABILITADO por padrão
  private lastSentHash: string = '';
  private lastSendTime: number = 0;
  private lastSentSlide: number = 0; // Rastreia último slide enviado para detectar mudanças
  private lastSentStatus: PowerPointStatus | null = null; // Armazena último status completo enviado para comparação
  private readonly TABLE_NAME = 'powerpoint_realtime';
  private isSending: boolean = false; // Flag para evitar envios simultâneos
  private pendingStatus: PowerPointStatus | null = null; // Status pendente enquanto está enviando
  private projectCode: string | null = null; // Código do projeto atual (usado como id na tabela)
  private lastClientRefresh: number = 0; // Timestamp da última atualização do cliente
  private readonly CLIENT_REFRESH_THROTTLE_MS = 10000; // Throttle de 10 segundos para evitar refresh excessivo
  
  // Configuração do Supabase (pode vir do adapter ou ser independente)
  private supabaseUrl: string | null = null;
  private supabaseKey: string | null = null;

  constructor(windowsService: PowerPointWindowsService, supabaseAdapter?: SupabaseAdapter | null) {
    this.windowsService = windowsService;
    this.supabaseAdapter = supabaseAdapter || null;
    
    // Tenta obter configuração do Supabase do adapter se disponível
    if (supabaseAdapter) {
      try {
        const adapterAny = supabaseAdapter as any;
        if (adapterAny.config) {
          this.supabaseUrl = adapterAny.config.url || null;
          this.supabaseKey = adapterAny.config.anonKey || null;
        }
        if (adapterAny.supabase) {
          this.supabaseClient = adapterAny.supabase;
        }
      } catch (e) {
        // Ignora erros
      }
    }
    
    // Tenta obter do environment também
    if (!this.supabaseUrl) {
      this.supabaseUrl = process.env.SUPABASE_URL || null;
      this.supabaseKey = process.env.SUPABASE_ANON_KEY || null;
    }
    
    // Cria cliente Supabase se tiver configuração
    if (this.supabaseUrl && this.supabaseKey && !this.supabaseClient) {
      try {
        this.supabaseClient = createClient(this.supabaseUrl, this.supabaseKey);
      } catch (e) {
        // Ignora erros - cliente será criado quando necessário
      }
    }
  }
  
  /**
   * Verifica se o Supabase está disponível (via adapter ou cliente direto)
   * Força atualização do cliente se o adapter foi conectado recentemente
   */
  private isSupabaseAvailable(): boolean {
    // Tenta usar adapter se disponível
    if (this.supabaseAdapter) {
      try {
        const adapterAny = this.supabaseAdapter as any;
        
        // Se adapter tem cliente e está conectado, usa ele (atualiza referência)
        if (adapterAny.supabase && adapterAny.isConnectedToSupabase()) {
          this.supabaseClient = adapterAny.supabase;
          // Atualiza URL e Key também para uso futuro
          if (adapterAny.config) {
            this.supabaseUrl = adapterAny.config.url || this.supabaseUrl;
            this.supabaseKey = adapterAny.config.anonKey || this.supabaseKey;
          }
          return true;
        }
        
        // Se adapter tem config mas não está conectado, usa a config para criar cliente próprio
        // Isso permite que o serviço PPT funcione mesmo quando adapter não está "conectado"
        if (adapterAny.config && adapterAny.config.url && adapterAny.config.anonKey) {
          this.supabaseUrl = adapterAny.config.url;
          this.supabaseKey = adapterAny.config.anonKey;
          
          // Se não tem cliente ainda ou cliente está desatualizado, cria novo
          if (!this.supabaseClient || (this.supabaseUrl && this.supabaseKey)) {
            try {
              this.supabaseClient = createClient(this.supabaseUrl, this.supabaseKey);
              return true;
            } catch (e) {
              // Ignora erro - tenta novamente depois
            }
          }
        }
      } catch (e) {
        // Continua tentando cliente direto
      }
    }
    
    // Se não tem cliente, tenta criar se tiver URL e Key
    if (!this.supabaseClient && this.supabaseUrl && this.supabaseKey) {
      try {
        this.supabaseClient = createClient(this.supabaseUrl, this.supabaseKey);
        return true;
      } catch (e) {
        return false;
      }
    }
    
    return !!this.supabaseClient;
  }
  
  /**
   * Força atualização do cliente Supabase (útil quando adapter conecta)
   * Mas só atualiza se passou tempo suficiente desde a última atualização (throttle)
   */
  public refreshSupabaseClient(): void {
    const now = Date.now();
    const timeSinceLastRefresh = now - this.lastClientRefresh;
    
    // Throttle: só atualiza se passou tempo suficiente
    if (timeSinceLastRefresh < this.CLIENT_REFRESH_THROTTLE_MS) {
      // Não loga para não poluir - é esperado que seja chamado múltiplas vezes
      return;
    }
    
    // Atualiza timestamp
    this.lastClientRefresh = now;
    
    // Limpa cliente atual para forçar recriação
    this.supabaseClient = null;
    // Força verificação novamente
    this.isSupabaseAvailable();
    logger.info(LogOrigin.Server, '🔄 PowerPoint Supabase - Cliente atualizado');
  }

  /**
   * Define o código do projeto atual (usado como id na tabela)
   */
  public setProjectCode(projectCode: string | null): void {
    const oldCode = this.projectCode;
    this.projectCode = projectCode;
    
      if (oldCode !== projectCode) {
      // Se projeto mudou, limpa cache de último slide enviado
      this.lastSentSlide = 0;
      this.lastSentHash = '';
      this.lastSendTime = 0;
      this.lastSentStatus = null;
      this.isSending = false; // Reseta flag de envio
      this.pendingStatus = null; // Limpa status pendente
      
      if (projectCode) {
        logger.info(LogOrigin.Server, `📌 PowerPoint Supabase - Project code definido: ${projectCode}`);
      } else {
        logger.warning(LogOrigin.Server, '⚠️  PowerPoint Supabase - Project code removido (null)');
      }
    }
  }

  /**
   * Obtém o código do projeto atual
   */
  public getProjectCode(): string | null {
    return this.projectCode;
  }

  /**
   * Inicia o serviço de integração
   */
  start(): void {
    if (this.isRunning) {
      logger.warning(LogOrigin.Server, 'PowerPoint Supabase service já está em execução');
      return;
    }

    this.isRunning = true;
    
    // Verifica se Supabase está disponível (adapter ou cliente direto)
    if (!this.isSupabaseAvailable()) {
      logger.warning(LogOrigin.Server, '⚠️  PowerPoint Supabase service iniciado mas Supabase não está configurado - aguardando configuração');
      // Continua rodando mesmo sem Supabase - o botão PPT controla se envia ou não
    } else {
      logger.info(LogOrigin.Server, '✅ PowerPoint Supabase service iniciado - Supabase disponível');
    }
    
    // Escuta mudanças do serviço Windows
    const listenerCountBefore = this.windowsService.listenerCount('statusChange');
    this.windowsService.on('statusChange', (status: PowerPointStatus) => {
      logger.info(LogOrigin.Server, `🔔 PowerPoint Supabase - Evento statusChange recebido: Slide ${status.currentSlide}/${status.slideCount}`);
      this.onStatusChange(status);
    });
    const listenerCountAfter = this.windowsService.listenerCount('statusChange');
    logger.info(LogOrigin.Server, `👂 PowerPoint Supabase - Listener registrado (${listenerCountBefore} → ${listenerCountAfter} listeners)`);

    // Envia status inicial se disponível E se estiver habilitado
    // Não envia se estiver desabilitado (botão vermelho)
    if (this.isEnabled) {
      const currentStatus = this.windowsService.getStatus();
      if (currentStatus) {
        logger.info(LogOrigin.Server, `📤 PowerPoint Supabase - Enviando status inicial: Slide ${currentStatus.currentSlide}/${currentStatus.slideCount}`);
        this.onStatusChange(currentStatus);
      }
    } else {
      logger.info(LogOrigin.Server, '⚠️  PowerPoint Supabase - Serviço iniciado mas DESABILITADO (botão vermelho) - não enviará dados até ser habilitado');
    }

    logger.info(LogOrigin.Server, '✅ PowerPoint Supabase service iniciado e escutando eventos');
  }

  /**
   * Para o serviço
   */
  stop(): void {
    this.isRunning = false;
    this.windowsService.removeAllListeners('statusChange');
    this.isSending = false; // Reseta flag de envio
    this.pendingStatus = null; // Limpa status pendente
    logger.info(LogOrigin.Server, 'PowerPoint Supabase service parado');
  }

  /**
   * Handler de mudanças de status
   */
  private onStatusChange(status: PowerPointStatus): void {
    if (!this.isRunning) {
      logger.warning(LogOrigin.Server, '⚠️  PowerPoint Supabase - Serviço não está rodando, ignorando mudança');
      return;
    }

    // Verifica se está habilitado (botão verde/vermelho)
    // Se estiver vermelho (desabilitado), NÃO envia dados para Supabase
    if (!this.isEnabled) {
      // Não loga a cada mudança para não poluir logs
      // logger.info(LogOrigin.Server, '⚠️  PowerPoint Supabase - Envio desabilitado (botão vermelho), ignorando mudança');
      return;
    }

    // Verifica se Supabase está disponível
    if (!this.isSupabaseAvailable()) {
      // Não loga para não poluir - Supabase pode não estar configurado ainda
      return;
    }

    // Verifica se dados realmente mudaram comparando diretamente os valores
    const hasChanged = this.hasStatusChanged(status);
    
    if (!hasChanged) {
      // Dados não mudaram, ignora
      return;
    }

    // ✅ CORREÇÃO: Garante envio sequencial para evitar slides pulados
    // Se já está enviando, armazena status pendente e processa após envio atual
    if (this.isSending) {
      logger.info(LogOrigin.Server, `⏳ PowerPoint Supabase - Envio em andamento, armazenando status pendente: Slide ${status.currentSlide}`);
      this.pendingStatus = status; // Armazena para processar após envio atual
      return;
    }

    // Dados mudaram - envia IMEDIATAMENTE para Supabase (sem debounce)
    logger.info(LogOrigin.Server, `📤 PowerPoint Supabase - Dados mudaram, enviando IMEDIATAMENTE: Slide ${status.currentSlide}/${status.slideCount}${status.video?.hasVideo ? ` | Vídeo: ${status.video.currentTime?.toFixed(2)}s` : ''}`);
    
    // ✅ CORREÇÃO: Atualiza cache ANTES de enviar para evitar race condition
    // Isso garante que próxima atualização compare com o valor correto
    const previousStatus = this.lastSentStatus;
    this.lastSentSlide = status.currentSlide;
    this.lastSentHash = this.getDataHash(status);
    this.lastSendTime = Date.now();
    this.lastSentStatus = {
      ...status,
      video: status.video ? { ...status.video } : undefined,
    };
    
    // Marca como enviando
    this.isSending = true;
    
    // Envia de forma assíncrona sequencial
    this.sendToSupabase(status)
      .then(() => {
        this.isSending = false;
        
        // ✅ CORREÇÃO: Após envio completar, processa status pendente se houver
        if (this.pendingStatus) {
          const pending = this.pendingStatus;
          this.pendingStatus = null;
          logger.info(LogOrigin.Server, `🔄 PowerPoint Supabase - Processando status pendente: Slide ${pending.currentSlide}`);
          // Processa status pendente recursivamente
          this.onStatusChange(pending);
        }
      })
      .catch(err => {
        logger.error(LogOrigin.Server, `Erro ao enviar para Supabase: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
        this.isSending = false;
        
        // ✅ CORREÇÃO: Em caso de erro, reverte cache para permitir retry
        if (previousStatus) {
          this.lastSentStatus = previousStatus;
          this.lastSentSlide = previousStatus.currentSlide;
          this.lastSentHash = this.getDataHash(previousStatus);
        }
        
        // Processa status pendente mesmo em caso de erro
        if (this.pendingStatus) {
          const pending = this.pendingStatus;
          this.pendingStatus = null;
          logger.info(LogOrigin.Server, `🔄 PowerPoint Supabase - Processando status pendente após erro: Slide ${pending.currentSlide}`);
          this.onStatusChange(pending);
        }
      });
  }

  /**
   * Verifica se o status realmente mudou comparando diretamente os valores
   * Ao invés de usar hash (que pode ignorar mudanças), compara valores importantes
   */
  private hasStatusChanged(status: PowerPointStatus): boolean {
    // Primeira vez - sempre envia
    if (!this.lastSentStatus) {
      return true;
    }

    const last = this.lastSentStatus;

    // Verifica mudança de slide (prioridade máxima)
    if (status.currentSlide !== last.currentSlide) {
      const slideDiff = status.currentSlide - last.currentSlide;
      
      // ✅ NOVO: Detecta e loga quando há gap nos slides
      if (slideDiff > 1) {
        const skippedSlides = [];
        for (let i = last.currentSlide + 1; i < status.currentSlide; i++) {
          skippedSlides.push(i);
        }
        logger.warning(LogOrigin.Server, `⚠️  PowerPoint Supabase - GAP detectado: slides ${skippedSlides.join(', ')} foram pulados (${last.currentSlide} → ${status.currentSlide}). O app Windows não enviou dados para esses slides.`);
      }
      
      logger.info(LogOrigin.Server, `🔍 PowerPoint Supabase - Mudança detectada: slide (${last.currentSlide} → ${status.currentSlide})`);
      return true;
    }

    // Verifica mudança de slideCount
    if (status.slideCount !== last.slideCount) {
      logger.info(LogOrigin.Server, `🔍 PowerPoint Supabase - Mudança detectada: slideCount (${last.slideCount} → ${status.slideCount})`);
      return true;
    }

    // Verifica mudança de vídeo
    if (status.video?.hasVideo || last.video?.hasVideo) {
      // Se estado de vídeo mudou (tem vídeo vs não tem)
      if (!!status.video?.hasVideo !== !!last.video?.hasVideo) {
        logger.info(LogOrigin.Server, `🔍 PowerPoint Supabase - Mudança detectada: hasVideo (${!!last.video?.hasVideo} → ${!!status.video?.hasVideo})`);
        return true;
      }

      // Se tem vídeo, verifica mudanças no tempo com PRECISÃO MÁXIMA
      if (status.video?.hasVideo && last.video?.hasVideo) {
        const currentTime = status.video.currentTime || 0;
        const lastTime = last.video.currentTime || 0;
        
        // ✅ PRECISÃO MÁXIMA: Detecta qualquer mudança de 0.1 segundos ou mais
        // (antes era 1 segundo) - detecta mudanças muito mais rapidamente
        if (Math.abs(currentTime - lastTime) >= 0.1) {
          logger.info(LogOrigin.Server, `🔍 PowerPoint Supabase - Mudança detectada: video currentTime (${lastTime.toFixed(2)}s → ${currentTime.toFixed(2)}s)`);
          return true;
        }

        // ✅ NOVO: Compara horas, minutos e segundos individualmente
        // Isso detecta mudanças mesmo quando currentTime pode ter pequeno erro de cálculo
        // e garante que sempre detecta mudanças de segundo em segundo
        if (status.video.hours !== undefined && last.video.hours !== undefined) {
          if (status.video.hours !== last.video.hours) {
            logger.info(LogOrigin.Server, `🔍 PowerPoint Supabase - Mudança detectada: video hours (${last.video.hours} → ${status.video.hours})`);
            return true;
          }
        }
        
        if (status.video.minutes !== undefined && last.video.minutes !== undefined) {
          if (status.video.minutes !== last.video.minutes) {
            logger.info(LogOrigin.Server, `🔍 PowerPoint Supabase - Mudança detectada: video minutes (${last.video.minutes} → ${status.video.minutes})`);
            return true;
          }
        }
        
        if (status.video.seconds !== undefined && last.video.seconds !== undefined) {
          if (status.video.seconds !== last.video.seconds) {
            logger.info(LogOrigin.Server, `🔍 PowerPoint Supabase - Mudança detectada: video seconds (${last.video.seconds} → ${status.video.seconds})`);
            return true;
          }
        }

        // Verifica mudança de estado de reprodução (playing/paused)
        if (status.video.isPlaying !== last.video.isPlaying) {
          logger.info(LogOrigin.Server, `🔍 PowerPoint Supabase - Mudança detectada: video isPlaying (${last.video.isPlaying} → ${status.video.isPlaying})`);
          return true;
        }

        // Verifica mudança no formato time (HH:MM:SS) - pode mudar mesmo que currentTime não mude muito
        if (status.video.time && last.video.time && status.video.time !== last.video.time) {
          logger.info(LogOrigin.Server, `🔍 PowerPoint Supabase - Mudança detectada: video time (${last.video.time} → ${status.video.time})`);
          return true;
        }
      }
    }

    // Verifica outras mudanças importantes
    if (status.visibleSlideCount !== last.visibleSlideCount ||
        status.isInSlideShow !== last.isInSlideShow ||
        status.slidesRemaining !== last.slidesRemaining) {
      logger.info(LogOrigin.Server, `🔍 PowerPoint Supabase - Mudança detectada: propriedades gerais`);
      return true;
    }

    // ✅ NOVO: Compara timestamp - se timestamp mudou significativamente, significa que houve atualização
    // Isso garante que nunca perde uma atualização mesmo que outros campos não mudem
    if (status.timestamp && last.timestamp && status.timestamp !== last.timestamp) {
      // Só considera mudança relevante se passou tempo suficiente desde último envio
      // (evita enviar múltiplas vezes para o mesmo timestamp)
      const timeSinceLastSend = Date.now() - this.lastSendTime;
      if (timeSinceLastSend > 50) { // Mínimo 50ms entre envios
        logger.info(LogOrigin.Server, `🔍 PowerPoint Supabase - Mudança detectada: timestamp atualizado`);
        return true;
      }
    }

    // Nenhuma mudança detectada
    return false;
  }

  /**
   * Envia dados para Supabase
   */
  private async sendToSupabase(status: PowerPointStatus): Promise<void> {
    // Sempre tenta enviar diretamente
    await this.sendDirectToSupabase(status);
  }

  /**
   * Envia diretamente para Supabase usando cliente
   */
  private async sendDirectToSupabase(status: PowerPointStatus): Promise<void> {
    try {
      // Verifica se Supabase está disponível
      if (!this.isSupabaseAvailable()) {
        logger.warning(LogOrigin.Server, 'Supabase não disponível - não é possível enviar dados');
        return;
      }
      
      // Verifica se projectCode está configurado
      if (!this.projectCode) {
        logger.warning(LogOrigin.Server, '⚠️  PowerPoint Supabase - Project code não configurado, não é possível enviar dados');
        return;
      }
      
      // Usa cliente Supabase (pode ser do adapter ou direto)
      const supabase = this.supabaseClient;
      
      if (!supabase) {
        logger.warning(LogOrigin.Server, 'Cliente Supabase não disponível');
        return;
      }

      const data = {
        id: this.projectCode, // Usa project_code como id
        data: {
          currentSlide: status.currentSlide,
          slideCount: status.slideCount,
          visibleSlideCount: status.visibleSlideCount,
          isInSlideShow: status.isInSlideShow,
          slidesRemaining: status.slidesRemaining,
          hiddenSlides: status.hiddenSlides,
          video: status.video ? {
            hasVideo: status.video.hasVideo,
            isPlaying: status.video.isPlaying,
            duration: status.video.duration,
            currentTime: status.video.currentTime,
            remainingTime: status.video.remainingTime,
            volume: status.video.volume,
            muted: status.video.muted,
            fileName: status.video.fileName,
            sourceUrl: status.video.sourceUrl,
            time: status.video.time,
            hours: status.video.hours,
            minutes: status.video.minutes,
            seconds: status.video.seconds,
          } : null,
          timestamp: status.timestamp || Date.now(),
        },
        updated_at: new Date().toISOString(),
      };

      // Tenta usar tabela específica, senão usa ontime_realtime
      const tableName = this.TABLE_NAME;
      
      logger.info(LogOrigin.Server, `🔄 PowerPoint Supabase - Tentando upsert na tabela ${tableName}...`);
      logger.info(LogOrigin.Server, `📋 PowerPoint Supabase - Dados: ${JSON.stringify(data).substring(0, 200)}...`);
      
      const { error, data: result } = await supabase
        .from(tableName)
        .upsert(data, {
          onConflict: 'id',
        });

      if (error) {
        logger.error(LogOrigin.Server, `❌ PowerPoint Supabase - Erro ao fazer upsert: ${error.message} (code: ${error.code})`);
        logger.error(LogOrigin.Server, `❌ PowerPoint Supabase - Detalhes do erro: ${JSON.stringify(error)}`);
        
        // Se tabela não existe, tenta criar ou usar ontime_realtime
        if (error.code === '42P01' || error.message.includes('does not exist')) {
          logger.warning(LogOrigin.Server, `⚠️  Tabela ${tableName} não existe, tentando usar ontime_realtime`);
          await this.sendToOntimeRealtime(supabase, status);
        } else {
          throw error;
        }
      } else {
        // Log sempre para confirmar que está enviando
        logger.info(LogOrigin.Server, `✅ PowerPoint dados enviados para Supabase (${tableName}): Slide ${status.currentSlide}/${status.slideCount}${status.video?.hasVideo ? ` | Vídeo: ${status.video.currentTime?.toFixed(1)}s` : ''}`);
        // Armazena último status enviado (será atualizado também no onStatusChange, mas garante aqui também)
        this.lastSentStatus = {
          ...status,
          video: status.video ? { ...status.video } : undefined,
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error(LogOrigin.Server, `Erro ao enviar PowerPoint para Supabase: ${errorMsg}`);
    }
  }

  /**
   * Envia para tabela ontime_realtime (fallback)
   */
  private async sendToOntimeRealtime(supabase: any, status: PowerPointStatus): Promise<void> {
    try {
      // Verifica se projectCode está configurado
      if (!this.projectCode) {
        logger.warning(LogOrigin.Server, '⚠️  PowerPoint Supabase - Project code não configurado, não é possível enviar para ontime_realtime');
        return;
      }

      const data = {
        id: this.projectCode, // Usa project_code como id
        data: {
          powerpoint: {
            currentSlide: status.currentSlide,
            slideCount: status.slideCount,
            visibleSlideCount: status.visibleSlideCount,
            isInSlideShow: status.isInSlideShow,
            slidesRemaining: status.slidesRemaining,
            video: status.video ? {
              hasVideo: status.video.hasVideo,
              isPlaying: status.video.isPlaying,
              currentTime: status.video.currentTime,
              time: status.video.time,
              hours: status.video.hours,
              minutes: status.video.minutes,
              seconds: status.video.seconds,
            } : null,
          },
        },
        updated_at: new Date().toISOString(),
      };

      // Verifica se já existe registro com o project_code
      const { data: existing } = await supabase
        .from('ontime_realtime')
        .select('data')
        .eq('id', this.projectCode)
        .single();

      if (existing && existing.data) {
        // Merge com dados existentes
        data.data = {
          ...existing.data,
          ...data.data,
        };
      }

      // Salva usando project_code como id
      const { error } = await supabase
        .from('ontime_realtime')
        .upsert({
          id: this.projectCode,
          data: data.data,
          updated_at: data.updated_at,
        }, {
          onConflict: 'id',
        });

      if (error) {
        throw error;
      }

      logger.info(LogOrigin.Server, `✅ PowerPoint dados enviados para Supabase (ontime_realtime) - Project: ${this.projectCode}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error(LogOrigin.Server, `Erro ao enviar PowerPoint para ontime_realtime: ${errorMsg}`);
    }
  }

  /**
   * Gera hash simples dos dados para verificar mudanças
   * Estratégia: reduz spam quando vídeo está em loop, mas sempre detecta mudanças importantes
   * IMPORTANTE: slide sempre muda quando muda de slide (verificação é feita ANTES do hash)
   */
  private getDataHash(status: PowerPointStatus): string {
    // Se há vídeo tocando, arredonda currentTime para múltiplos de 10 segundos
    // Isso reduz spam: atualiza a cada ~10 segundos ao invés de a cada segundo
    // Mas ainda permite atualizações periódicas para acompanhar o progresso
    const videoCurrentTime = status.video?.hasVideo && status.video?.isPlaying
      ? Math.floor((status.video.currentTime || 0) / 10) * 10  // Arredonda para múltiplos de 10 segundos
      : status.video?.currentTime || 0;  // Se não está tocando, usa valor exato
    
    // Quando vídeo está tocando, NÃO inclui 'time' no hash (só currentTime arredondado)
    // Isso evita que pequenas variações de segundos causem hash diferente
    // Quando vídeo não está tocando, inclui 'time' para detectar mudanças precisas
    const normalizedTime = status.video?.hasVideo && status.video?.isPlaying
      ? null  // Quando tocando, ignora time (usa apenas currentTime arredondado)
      : status.video?.time 
        ? status.video.time.replace(/^00:/, '').substring(0, 5)  // Quando pausado, normaliza time
        : null;
    
    return JSON.stringify({
      slide: status.currentSlide,
      video: status.video ? {
        hasVideo: status.video.hasVideo,
        isPlaying: status.video.isPlaying,
        currentTime: Math.floor(videoCurrentTime),  // Garante que é número inteiro
        time: normalizedTime,  // null quando tocando, normalizado quando pausado
      } : null,
    });
  }

  /**
   * Toggle habilitar/desabilitar envio para Supabase
   */
  public async toggleEnabled(): Promise<boolean> {
    this.isEnabled = !this.isEnabled;
    
    if (!this.isEnabled) {
      // Se desabilitou, apaga a linha do banco
      await this.deleteFromSupabase();
      logger.info(LogOrigin.Server, '🔴 PowerPoint Supabase - Envio desabilitado, linha removida do banco');
    } else {
      // Se habilitou, envia o último dado disponível
      logger.info(LogOrigin.Server, '🟢 PowerPoint Supabase - Envio habilitado, enviando último dado disponível');
      
      const lastStatus = this.windowsService.getStatus();
      if (lastStatus) {
        logger.info(LogOrigin.Server, `📤 PowerPoint Supabase - Enviando último status: Slide ${lastStatus.currentSlide}/${lastStatus.slideCount}`);
        // Envia imediatamente sem debounce ou hash check
        await this.sendToSupabase(lastStatus);
        // Atualiza cache para evitar reenvio imediato
        const dataHash = this.getDataHash(lastStatus);
        this.lastSentHash = dataHash;
        this.lastSentSlide = lastStatus.currentSlide;
        this.lastSendTime = Date.now();
        this.lastSentStatus = {
          ...lastStatus,
          video: lastStatus.video ? { ...lastStatus.video } : undefined,
        };
      } else {
        logger.warning(LogOrigin.Server, '⚠️  PowerPoint Supabase - Nenhum dado disponível para enviar ao habilitar');
      }
    }
    
    return this.isEnabled;
  }

  /**
   * Obtém status de habilitação
   */
  public getEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Apaga a linha do banco de dados
   */
  private async deleteFromSupabase(): Promise<void> {
    try {
      if (!this.isSupabaseAvailable()) {
        return;
      }

      // Verifica se projectCode está configurado
      if (!this.projectCode) {
        logger.warning(LogOrigin.Server, '⚠️  PowerPoint Supabase - Project code não configurado, não é possível apagar linha');
        return;
      }

      const supabase = this.supabaseClient;
      if (!supabase) {
        return;
      }

      // Apaga o registro com id = projectCode
      const { error } = await supabase
        .from(this.TABLE_NAME)
        .delete()
        .eq('id', this.projectCode);

      if (error) {
        // Se tabela não existe ou erro, tenta na ontime_realtime
        if (error.code === '42P01' || error.message.includes('does not exist')) {
          // Tenta atualizar ontime_realtime removendo dados do PowerPoint
          try {
            const { data: existing } = await supabase
              .from('ontime_realtime')
              .select('data')
              .eq('id', this.projectCode)
              .single();

            if (existing && existing.data) {
              // Remove dados do PowerPoint mas mantém o resto
              const newData = { ...existing.data };
              delete newData.powerpoint;
              
              await supabase
                .from('ontime_realtime')
                .upsert({
                  id: this.projectCode,
                  data: newData,
                  updated_at: new Date().toISOString(),
                }, {
                  onConflict: 'id',
                });
            }
          } catch (e) {
            // Ignora erros
          }
        } else {
          logger.error(LogOrigin.Server, `Erro ao apagar PowerPoint do Supabase: ${error.message}`);
        }
      } else {
        logger.info(LogOrigin.Server, `✅ PowerPoint removido do Supabase (${this.TABLE_NAME}) - Project: ${this.projectCode}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error(LogOrigin.Server, `Erro ao apagar PowerPoint do Supabase: ${errorMsg}`);
    }
  }
}

