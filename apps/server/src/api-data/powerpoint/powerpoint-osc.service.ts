// Serviço para enviar dados do PowerPoint via OSC para Companion
import { type OscPacketInput, toBuffer as oscPacketToBuffer } from 'osc-min';
import * as dgram from 'node:dgram';
import { logger } from '../../classes/Logger.js';
import { LogOrigin } from 'houseriaapp-types';
import { PowerPointWindowsService, PowerPointStatus } from './powerpoint-windows.service.js';

export class PowerPointOscService {
  private windowsService: PowerPointWindowsService;
  private udpClient: dgram.Socket;
  private targetIP: string;
  private targetPort: number;
  private isRunning: boolean = false;
  private lastSentStatus: PowerPointStatus | null = null;
  private readonly UPDATE_INTERVAL_MS = 100; // Envia atualizações a cada 100ms

  constructor(
    windowsService: PowerPointWindowsService,
    targetIP: string = '127.0.0.1',
    targetPort: number = 8000
  ) {
    this.windowsService = windowsService;
    this.targetIP = targetIP;
    this.targetPort = targetPort;
    this.udpClient = dgram.createSocket('udp4');
  }

  /**
   * Inicia o serviço OSC
   */
  start(): void {
    if (this.isRunning) {
      logger.warning(LogOrigin.Server, '⚠️  PowerPoint OSC - Serviço já está rodando');
      return;
    }

    this.isRunning = true;
    logger.info(LogOrigin.Server, `📡 PowerPoint OSC - Iniciando envio para ${this.targetIP}:${this.targetPort}`);

    // Escuta mudanças de status do Windows Service
    this.windowsService.on('statusChange', (status: PowerPointStatus) => {
      this.sendStatus(status);
    });

    // Envia status inicial se disponível
    const currentStatus = this.windowsService.getStatus();
    if (currentStatus) {
      this.sendStatus(currentStatus);
    }
  }

  /**
   * Para o serviço OSC
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.windowsService.removeAllListeners('statusChange');
    logger.info(LogOrigin.Server, '📡 PowerPoint OSC - Serviço parado');
  }

  /**
   * Envia status via OSC
   */
  private sendStatus(status: PowerPointStatus): void {
    if (!this.isRunning) {
      return;
    }

    // Verifica se dados mudaram
    if (this.lastSentStatus && 
        this.lastSentStatus.currentSlide === status.currentSlide &&
        this.lastSentStatus.slideCount === status.slideCount &&
        (!status.video || !this.lastSentStatus.video || 
         status.video.currentTime === this.lastSentStatus.video.currentTime)) {
      return; // Dados não mudaram
    }

    this.lastSentStatus = { ...status };

    try {
      // Envia múltiplas mensagens OSC para cada campo
      // Companion pode ler cada variável separadamente
      
      // Slide info
      this.sendOscMessage('/powerpoint/slide/current', [status.currentSlide]);
      this.sendOscMessage('/powerpoint/slide/count', [status.slideCount]);
      this.sendOscMessage('/powerpoint/slide/remaining', [status.slidesRemaining]);
      this.sendOscMessage('/powerpoint/slide/info', [`Slide ${status.currentSlide} / ${status.slideCount}`]);
      
      // Status geral
      this.sendOscMessage('/powerpoint/available', [status.isAvailable ? 1 : 0]);
      this.sendOscMessage('/powerpoint/inSlideShow', [status.isInSlideShow ? 1 : 0]);
      
      // Vídeo se houver
      if (status.video?.hasVideo) {
        this.sendOscMessage('/powerpoint/video/hasVideo', [1]);
        this.sendOscMessage('/powerpoint/video/currentTime', [status.video.currentTime || 0]);
        this.sendOscMessage('/powerpoint/video/duration', [status.video.duration || 0]);
        this.sendOscMessage('/powerpoint/video/isPlaying', [status.video.isPlaying ? 1 : 0]);
        
        if (status.video.hours !== undefined) {
          this.sendOscMessage('/powerpoint/video/hours', [status.video.hours]);
        }
        if (status.video.minutes !== undefined) {
          this.sendOscMessage('/powerpoint/video/minutes', [status.video.minutes]);
        }
        if (status.video.seconds !== undefined) {
          this.sendOscMessage('/powerpoint/video/seconds', [status.video.seconds]);
        }
        if (status.video.time) {
          this.sendOscMessage('/powerpoint/video/time', [status.video.time]);
        }
      } else {
        this.sendOscMessage('/powerpoint/video/hasVideo', [0]);
      }
      
      logger.info(LogOrigin.Server, `📡 PowerPoint OSC - Enviado: Slide ${status.currentSlide}/${status.slideCount}`);
    } catch (error) {
      logger.error(LogOrigin.Server, `❌ PowerPoint OSC - Erro ao enviar: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }
  }

  /**
   * Envia uma mensagem OSC
   */
  private sendOscMessage(address: string, args: (number | string)[]): void {
    try {
      const oscArgs: any[] = args.map(arg => {
        if (typeof arg === 'number') {
          return { type: 'f', value: arg }; // Float
        } else {
          return { type: 's', value: String(arg) }; // String
        }
      });

      const packet: OscPacketInput = {
        address: address,
        args: oscArgs.length > 0 ? oscArgs : undefined,
      };

      const buffer = oscPacketToBuffer(packet);
      this.udpClient.send(buffer, 0, buffer.byteLength, this.targetPort, this.targetIP, (error) => {
        if (error) {
          logger.warning(LogOrigin.Server, `⚠️  PowerPoint OSC - Erro ao enviar ${address}: ${error.message}`);
        }
      });
    } catch (error) {
      logger.error(LogOrigin.Server, `❌ PowerPoint OSC - Erro ao criar mensagem ${address}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }
  }

  /**
   * Configura IP e porta de destino
   */
  setTarget(targetIP: string, targetPort: number): void {
    this.targetIP = targetIP;
    this.targetPort = targetPort;
    logger.info(LogOrigin.Server, `📡 PowerPoint OSC - Destino atualizado: ${this.targetIP}:${this.targetPort}`);
  }

  /**
   * Retorna configuração atual
   */
  getConfig(): { targetIP: string; targetPort: number; isRunning: boolean } {
    return {
      targetIP: this.targetIP,
      targetPort: this.targetPort,
      isRunning: this.isRunning,
    };
  }
}


