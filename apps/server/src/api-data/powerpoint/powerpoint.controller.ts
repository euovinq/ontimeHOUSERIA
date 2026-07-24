import { Request, Response } from 'express';
import { logger } from '../../classes/Logger.js';
import { LogOrigin } from 'houseriaapp-types';
import path from 'path';
import { fileURLToPath } from 'url';
import { PowerPointWindowsService, PowerPointStatus as WindowsPowerPointStatus } from './powerpoint-windows.service.js';
import { PowerPointSupabaseService } from './powerpoint-supabase.service.js';
import { PowerPointOscService } from './powerpoint-osc.service.js';
import { PowerPointWebSocketService } from './powerpoint-websocket.service.js';
import { getDiscoveryService, PowerPointDiscoveryService, DiscoveredServer } from './powerpoint-discovery.service.js';
import { getMultiSourceService } from './powerpoint-multisource.service.js';
import { supabaseAdapter } from '../../adapters/SupabaseAdapter.js';
import { getDataProvider } from '../../classes/data-provider/DataProvider.js';
import { socket } from '../../adapters/WebsocketAdapter.js';
import { dispatchFromAdapter } from '../../api-integration/integration.controller.js';

// Helper para obter __dirname que funciona tanto em ES modules quanto CommonJS
function getDirname(): string {
  try {
    // Tenta usar import.meta.url (ES modules - desenvolvimento)
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {
    // Ignora erro se import.meta não existir
  }
  
  // Em CommonJS compilado (build do Electron), esbuild injeta __dirname
  // Mas precisamos acessá-lo de forma diferente
  // Vamos usar uma abordagem baseada em require.resolve se disponível
  try {
    if (typeof require !== 'undefined') {
      const modulePath = require.resolve('./powerpoint.controller.ts');
      return path.dirname(modulePath);
    }
  } catch {
    // Ignora erro se require não funcionar
  }
  
  // Fallback final: usa caminho relativo baseado na estrutura do projeto
  // No Electron build, o código está em extraResources/server/
  // No desenvolvimento, está em apps/server/src/api-data/powerpoint
  return path.join(process.cwd(), 'apps/server/src/api-data/powerpoint');
}

const __dirname = getDirname();

// Tipo do status do PowerPoint
type PowerPointStatus = {
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
    hours?: number;
    minutes?: number;
    seconds?: number;
    time?: string; // Formato "HH:MM:SS"
  };
  error?: string;
  timestamp?: number;
};

// Importa o módulo nativo do PowerPoint (apenas no macOS)
let getPowerPointStatus: (() => PowerPointStatus) | null = null;

// Timer para estimar currentTime quando PowerPoint não expõe essa informação
interface VideoTimerState {
  slideNumber: number;
  startedAt: number;
  duration: number;
  lastKnownCurrentTime: number;
}

let videoTimer: VideoTimerState | null = null;

// Serviço Windows como fallback (mantido para compatibilidade)
let windowsService: PowerPointWindowsService | null = null;
// Serviço WebSocket (novo - substitui polling HTTP)
let websocketService: PowerPointWebSocketService | null = null;
let supabaseService: PowerPointSupabaseService | null = null;
let oscService: PowerPointOscService | null = null;
let discoveryService: PowerPointDiscoveryService | null = null;
let lastSavedConfig: { ip: string; port: string } | null = null; // Rastreia última config salva para evitar loops
let isSavingConfig = false; // Flag para evitar salvamentos simultâneos

// Exporta supabaseService, windowsService e websocketService para uso no integration.controller
// initializeSupabaseService é exportado na sua declaração abaixo
export { supabaseService, windowsService, websocketService };

// Função assíncrona para carregar módulo nativo
async function loadNativeModule() {
  if (process.platform === 'darwin') {
    // macOS
    try {
      const modulePath = path.join(__dirname, '../../native/powerpoint-macos/index.js');
      const powerpointModule = await import(modulePath);
      getPowerPointStatus = powerpointModule.getPowerPointStatus;
      logger.info(LogOrigin.Server, 'Módulo nativo do PowerPoint (macOS) carregado');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.warning(LogOrigin.Server, `Módulo nativo do PowerPoint (macOS) não disponível: ${errorMsg}`);
      // Inicializa serviço Windows como fallback
      initializeWindowsService();
    }
  } else if (process.platform === 'win32') {
    // Windows - API COM é muito mais rica e confiável!
    try {
      const modulePath = path.join(__dirname, '../../native/powerpoint-windows/index.js');
      const powerpointModule = await import(modulePath);
      getPowerPointStatus = powerpointModule.getPowerPointStatus;
      logger.info(LogOrigin.Server, 'Módulo nativo do PowerPoint (Windows) carregado - API COM disponível!');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.warning(LogOrigin.Server, `Módulo nativo do PowerPoint (Windows) não disponível: ${errorMsg}`);
      // Inicializa serviço Windows como fallback
      initializeWindowsService();
    }
  } else {
    // Outras plataformas - usa serviço Windows se disponível
    initializeWindowsService();
  }
}

// Carrega módulo nativo de forma segura e não bloqueante
// Usa setTimeout para garantir que não bloqueie a inicialização do servidor
setTimeout(() => {
  loadNativeModule().catch((error) => {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.warning(LogOrigin.Server, `⚠️  PowerPoint - Erro ao carregar módulo nativo: ${errorMsg}`);
    // Não inicializa WindowsService aqui - isso será feito abaixo
  });
}, 1000); // Aguarda 1 segundo para garantir que o servidor está inicializado

// SEMPRE inicializa serviço Windows também (para ter ambos funcionando)
// Isso permite usar o app Windows mesmo quando há módulo nativo disponível
// Carrega configuração salva se existir
// Usa setTimeout muito curto para não bloquear mas também não atrasar muito
setTimeout(() => {
  initializeWindowsService()
    .then(() => {
      // Após windowsService ser inicializado, tenta inicializar Supabase imediatamente
      // Isso reduz o delay para envio de dados
      initializeSupabaseService();
    })
    .catch((error) => {
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error(LogOrigin.Server, `❌ PowerPoint - Erro ao inicializar serviço Windows: ${errorMsg}`);
    });
}, 100); // Reduzido de 500ms para 100ms para não atrasar muito a inicialização

// Função para inicializar serviço Supabase (reutilizável)
// O serviço PPT é independente e sempre deve estar ativo quando windowsService está rodando
// Mas só inicializa se windowsService tem configuração válida (IP/Porta)
// EXPORTA para poder ser chamada externamente (ex: integration.controller)
export function initializeSupabaseService(): void {
  // Só loga na primeira verificação ou quando há mudanças importantes
  const _shouldLog = !supabaseService;
  
  // Verifica apenas WebSocket (único serviço usado agora)
  const hasWebSocket = websocketService && websocketService.isServiceConnected();
  
  if (!hasWebSocket) {
    return;
  }
  
  // Serviço PPT é independente - sempre inicializa se WebSocket está conectado
  // Não depende de supabaseAdapter estar conectado
  if (!supabaseService) {
    try {
      // Só inicializa se WebSocket está conectado
      if (!websocketService || !websocketService.isServiceConnected()) {
        return;
      }
      
      logger.info(LogOrigin.Server, '🚀 PowerPoint - Inicializando serviço Supabase (independente do adapter)...');
      supabaseService = new PowerPointSupabaseService(
        null, // Não usa mais Windows service
        websocketService, // Só usa WebSocket
        supabaseAdapter || null
      );
      
      // Configura projectCode se disponível
      const projectData = getDataProvider().getProjectData();
      const projectCode = projectData?.projectCode;
      if (projectCode) {
        supabaseService.setProjectCode(projectCode);
      }
      
      supabaseService.start();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error(LogOrigin.Server, `❌ PowerPoint - Erro ao inicializar integração Supabase: ${errorMsg}`);
      if (error instanceof Error && error.stack) {
        logger.error(LogOrigin.Server, `Stack: ${error.stack}`);
      }
    }
  }
  
  // Não precisa atualizar cliente explicitamente aqui - o isSupabaseAvailable() já faz isso automaticamente
  // quando o adapter está conectado (linha 75 do powerpoint-supabase.service.ts)
  // Isso evita loop de atualizações quando Supabase conecta ou eventos são disparados
  
  // Atualiza projectCode se disponível e mudou
  if (supabaseService) {
    const projectData = getDataProvider().getProjectData();
    const projectCode = projectData?.projectCode;
    const currentProjectCode = supabaseService.getProjectCode();
    
    if (projectCode && projectCode !== currentProjectCode) {
      supabaseService.setProjectCode(projectCode);
      logger.info(LogOrigin.Server, `📌 PowerPoint - Project code atualizado: ${currentProjectCode} → ${projectCode}`);
    }
  }
  
  // Se Supabase conectou e windowsService tem config, tenta salvar configuração pendente
  // MAS só salva se ainda não foi salva (evita loop)
  const hasWindowsService = !!(windowsService?.hasValidConfig && windowsService.hasValidConfig());
  if (supabaseAdapter?.isConnectedToSupabase() && hasWindowsService) {
    const config = windowsService?.getConfig ? windowsService.getConfig() : null;
    if (config && config.url) {
      const urlMatch = config.url.match(/^http:\/\/([^:]+):(\d+)$/);
      if (urlMatch) {
        const ip = urlMatch[1];
        const port = urlMatch[2];
        // Só salva se for diferente da última salva
        if (!lastSavedConfig || lastSavedConfig.ip !== ip || lastSavedConfig.port !== port) {
          setTimeout(() => {
            savePendingPowerPointConfig().catch(err => {
              console.error('💾 [SAVE-PENDING] Erro ao salvar config pendente:', err);
            });
          }, 500); // Aguarda 500ms para garantir que tudo está inicializado
        }
      }
    }
  }
  // Não loga se já existe - evita spam de logs
}

// Tenta inicializar integração Supabase periodicamente (se não estiver conectado inicialmente)
// Isso garante que quando o Supabase for conectado, a integração será iniciada
// Mas só verifica se windowsService tem configuração válida (IP/Porta)
// IMPORTANTE: Não atualiza cliente Supabase repetidamente - o refreshSupabaseClient tem throttle interno
// Reduzido de 5 segundos para 2 segundos para verificação mais rápida
setInterval(() => {
  // Só verifica se windowsService tem config válida
  if (windowsService && windowsService.hasValidConfig && windowsService.hasValidConfig()) {
    initializeSupabaseService();
    
    // NÃO força refresh aqui - o initializeSupabaseService já faz isso quando necessário
    // Isso evita loop de atualizações quando Supabase conecta
  }
  // Se não tem config válida, não verifica (evita logs desnecessários)
}, 2000); // Reduzido de 5 segundos para 2 segundos para verificação mais rápida

// Chama imediatamente também (só se tiver config válida)
// Reduzido o delay para inicialização mais rápida
setTimeout(() => {
  // Só inicializa se windowsService tem config válida
  if (windowsService && windowsService.hasValidConfig && windowsService.hasValidConfig()) {
    initializeSupabaseService();
  }
}, 200); // Reduzido para verificação mais rápida após windowsService estar pronto

/**
 * Salva configuração do PowerPoint (IP e Porta) no Supabase
 */
async function savePowerPointConfig(ip: string, port: string): Promise<void> {
  // Evita salvamentos simultâneos ou duplicados
  if (isSavingConfig) {
    console.log('💾 [SAVE-CONFIG] Já existe um salvamento em andamento, ignorando...');
    return;
  }
  
  // Verifica se já foi salva a mesma configuração recentemente
  if (lastSavedConfig && lastSavedConfig.ip === ip && lastSavedConfig.port === port) {
    console.log('💾 [SAVE-CONFIG] Configuração já foi salva recentemente, ignorando...');
    return;
  }
  
  // Verifica se Supabase está conectado ANTES de setar a flag
  if (!supabaseAdapter?.isConnectedToSupabase()) {
    const msg = '⚠️  PowerPoint - Supabase não conectado - não é possível salvar configuração';
    console.warn('💾 [SAVE-CONFIG]', msg);
    logger.warning(LogOrigin.Server, msg);
    return;
  }
  
  // Agora sim seta a flag para evitar salvamentos simultâneos
  isSavingConfig = true;
  console.log('💾 [SAVE-CONFIG] Iniciando salvamento de configuração...');
  console.log('💾 [SAVE-CONFIG] IP:', ip, 'Port:', port);
  
  const projectData = getDataProvider().getProjectData();
  const projectCode = projectData?.projectCode;
  
  console.log('💾 [SAVE-CONFIG] ProjectCode:', projectCode);
  
  if (!projectCode) {
    const msg = '⚠️  PowerPoint - ProjectCode não encontrado - não é possível salvar configuração';
    console.warn('💾 [SAVE-CONFIG]', msg);
    logger.warning(LogOrigin.Server, msg);
    isSavingConfig = false; // Reseta flag antes de retornar
    return;
  }

  try {
    // Obtém cliente Supabase do adapter
    const adapterAny = supabaseAdapter as any;
    const supabase = adapterAny.supabase;
    const tableName = adapterAny.config?.tableName || 'ontime_realtime';

    console.log('💾 [SAVE-CONFIG] TableName:', tableName);
    console.log('💾 [SAVE-CONFIG] Supabase client disponível:', !!supabase);

    if (!supabase) {
      const msg = '❌ PowerPoint - Cliente Supabase não disponível';
      console.error('💾 [SAVE-CONFIG]', msg);
      logger.error(LogOrigin.Server, msg);
      isSavingConfig = false; // Reseta flag antes de retornar
      return;
    }

    // Lê dados existentes usando project_code (como faz getProjectData)
    console.log('💾 [SAVE-CONFIG] Buscando dados existentes...');
    const { data: existing, error: readError } = await supabase
      .from(tableName)
      .select('data')
      .eq('project_code', projectCode)
      .single();

    if (readError && readError.code !== 'PGRST116') { // PGRST116 = não encontrado (é OK)
      console.error('💾 [SAVE-CONFIG] Erro ao ler:', readError);
      logger.error(LogOrigin.Server, `❌ PowerPoint - Erro ao ler dados do Supabase: ${readError.message}`);
      isSavingConfig = false; // Reseta flag antes de retornar
      return;
    }

    console.log('💾 [SAVE-CONFIG] Dados existentes:', existing ? 'encontrados' : 'não encontrados (criando novo)');

    // Faz merge com nova configuração
    const existingData = existing?.data || {};
    const newData = {
      ...existingData,
      powerpoint: {
        ...existingData.powerpoint,
        config: {
          ip,
          port,
        },
      },
    };

    console.log('💾 [SAVE-CONFIG] Novo data preparado:', JSON.stringify(newData, null, 2));

    // Salva de volta no Supabase
    console.log('💾 [SAVE-CONFIG] Fazendo upsert...');
    const { error: upsertError } = await supabase
      .from(tableName)
      .upsert({
        id: projectCode,
        data: newData,
        project_code: projectCode,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'id',
      });

    if (upsertError) {
      console.error('💾 [SAVE-CONFIG] Erro no upsert:', upsertError);
      logger.error(LogOrigin.Server, `❌ PowerPoint - Erro ao salvar configuração no Supabase: ${upsertError.message}`);
      isSavingConfig = false; // Reseta flag antes de retornar
      return;
    }

    const msg = `✅ PowerPoint - Configuração salva no Supabase: ip=${ip}, port=${port}`;
    console.log('💾 [SAVE-CONFIG]', msg);
    logger.info(LogOrigin.Server, msg);
    
    // Atualiza última config salva
    lastSavedConfig = { ip, port };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('💾 [SAVE-CONFIG] Erro geral:', error);
    logger.error(LogOrigin.Server, `❌ PowerPoint - Erro ao salvar configuração: ${errorMsg}`);
  } finally {
    isSavingConfig = false;
  }
}

/**
 * Tenta salvar configuração pendente do windowsService no Supabase
 * Chamada quando Supabase conecta ou quando windowsService tem config válida
 */
async function savePendingPowerPointConfig(): Promise<void> {
  console.log('💾 [SAVE-PENDING] Verificando se há configuração pendente...');
  
  if (!windowsService || !windowsService.hasValidConfig || !windowsService.hasValidConfig()) {
    console.log('💾 [SAVE-PENDING] Não há config pendente (windowsService não tem config válida)');
    return; // Não há config pendente
  }
  
  const config = windowsService.getConfig ? windowsService.getConfig() : null;
  if (!config || !config.url) {
    console.log('💾 [SAVE-PENDING] Não há config pendente (sem URL configurada)');
    return; // Não há URL configurada
  }
  
  // Extrai IP e Porta da URL (ex: http://192.168.0.240:7800)
  const urlMatch = config.url.match(/^http:\/\/([^:]+):(\d+)$/);
  if (!urlMatch) {
    console.log('💾 [SAVE-PENDING] Não há config pendente (URL inválida)');
    return; // URL inválida
  }
  
  const ip = urlMatch[1];
  const port = urlMatch[2];
  
  // Verifica se já foi salva esta configuração
  if (lastSavedConfig && lastSavedConfig.ip === ip && lastSavedConfig.port === port) {
    console.log('💾 [SAVE-PENDING] Configuração já foi salva anteriormente, ignorando...');
    return;
  }
  
  console.log('💾 [SAVE-PENDING] Tentando salvar configuração pendente:', { ip, port });
  await savePowerPointConfig(ip, port);
}

/**
 * Carrega configuração do PowerPoint (IP e Porta) do Supabase
 */
async function loadPowerPointConfig(): Promise<{ ip: string; port: string } | null> {
  if (!supabaseAdapter?.isConnectedToSupabase()) {
    return null;
  }

  const projectData = getDataProvider().getProjectData();
  const projectCode = projectData?.projectCode;
  
  if (!projectCode) {
    logger.info(LogOrigin.Server, 'ℹ️  PowerPoint - ProjectCode não encontrado - não é possível carregar configuração');
    return null;
  }

  try {
    const projectRecord = await supabaseAdapter.getProjectData(projectCode);
    const config = projectRecord?.data?.powerpoint?.config;
    
    if (config && config.ip && config.port) {
      logger.info(LogOrigin.Server, `✅ PowerPoint - Configuração carregada do Supabase: ip=${config.ip}, port=${config.port}`);
      return {
        ip: String(config.ip),
        port: String(config.port),
      };
    }
    
    return null;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.warning(LogOrigin.Server, `⚠️  PowerPoint - Erro ao carregar configuração do Supabase: ${errorMsg}`);
    return null;
  }
}

/**
 * Limpa configuração do PowerPoint (IP e Porta) do Supabase
 */
async function clearPowerPointConfig(): Promise<void> {
  if (!supabaseAdapter?.isConnectedToSupabase()) {
    logger.warning(LogOrigin.Server, '⚠️  PowerPoint - Supabase não conectado - não é possível limpar configuração');
    return;
  }

  const projectData = getDataProvider().getProjectData();
  const projectCode = projectData?.projectCode;
  
  if (!projectCode) {
    logger.warning(LogOrigin.Server, '⚠️  PowerPoint - ProjectCode não encontrado - não é possível limpar configuração');
    return;
  }

  try {
    // Obtém cliente Supabase do adapter
    const adapterAny = supabaseAdapter as any;
    const supabase = adapterAny.supabase;
    const tableName = adapterAny.config?.tableName || 'ontime_realtime';

    if (!supabase) {
      logger.error(LogOrigin.Server, '❌ PowerPoint - Cliente Supabase não disponível');
      return;
    }

    // Lê dados existentes
    const { data: existing, error: readError } = await supabase
      .from(tableName)
      .select('data')
      .eq('id', projectCode)
      .single();

    if (readError && readError.code !== 'PGRST116') { // PGRST116 = não encontrado (é OK)
      logger.error(LogOrigin.Server, `❌ PowerPoint - Erro ao ler dados do Supabase: ${readError.message}`);
      return;
    }

    // Faz merge removendo configuração
    const existingData = existing?.data || {};
    const newData = {
      ...existingData,
      powerpoint: {
        ...existingData.powerpoint,
        config: null,
      },
    };

    // Salva de volta no Supabase
    const { error: upsertError } = await supabase
      .from(tableName)
      .upsert({
        id: projectCode,
        data: newData,
        project_code: projectCode,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'id',
      });

    if (upsertError) {
      logger.error(LogOrigin.Server, `❌ PowerPoint - Erro ao limpar configuração no Supabase: ${upsertError.message}`);
      return;
    }

    logger.info(LogOrigin.Server, '✅ PowerPoint - Configuração removida do Supabase');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ PowerPoint - Erro ao limpar configuração: ${errorMsg}`);
  }
}

/**
 * Inicializa o serviço Windows do PowerPoint
 * Carrega configuração salva do Supabase se existir
 */
async function initializeWindowsService(): Promise<void> {
  if (windowsService) {
    return;
  }
  
  try {
    // Tenta carregar configuração salva do Supabase
    const savedConfig = await loadPowerPointConfig();
    let initialUrl = '';
    
    if (savedConfig && savedConfig.ip && savedConfig.port) {
      initialUrl = `http://${savedConfig.ip}:${savedConfig.port}`;
    }
    
    // Cria serviço com configuração salva (ou vazio se não houver)
    windowsService = new PowerPointWindowsService({ url: initialUrl });
    
    // Se tem config válida salva, inicia o serviço
    if (initialUrl && windowsService.hasValidConfig()) {
      windowsService.start();
      logger.info(LogOrigin.Server, 'Serviço PowerPoint Windows iniciado com configuração do Supabase');
    }
    
  // Sempre inicializa serviço PPT (independente do adapter Supabase)
  // O serviço PPT tem sua própria conexão com Supabase para a tabela powerpoint_realtime
  initializeSupabaseService();
  
  // Inicializa serviço de descoberta UDP e conecta automaticamente ao servidor encontrado
  setTimeout(() => {
    initializeDiscoveryService().catch((error) => {
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.warning(LogOrigin.Server, `⚠️  PowerPoint Discovery - Não foi possível inicializar: ${errorMsg}`);
    });
  }, 300);
  
  // Inicializa serviço OSC se windowsService estiver disponível
  if (windowsService && !oscService) {
    try {
      oscService = new PowerPointOscService(windowsService, '127.0.0.1', 8000);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.warning(LogOrigin.Server, `Não foi possível criar serviço PowerPoint OSC: ${errorMsg}`);
    }
  }
  
  // REMOVIDO: Não precisa salvar aqui, o initializeSupabaseService já verifica se precisa salvar
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.warning(LogOrigin.Server, `Não foi possível criar serviço PowerPoint Windows: ${errorMsg}`);
  }
}

export async function getPowerPointStatusController(
  _req: Request,
  res: Response
): Promise<void> {
  try {
    const now = Date.now();
    let status: PowerPointStatus | null = null;
    
    // Prioriza serviço Windows se estiver configurado e conectado
    // Garante que serviço Windows está inicializado
    if (!windowsService) {
      await initializeWindowsService();
    }
    
    if (windowsService) {
      const windowsStatus = windowsService.getStatus();
      if (windowsStatus && windowsStatus.isAvailable) {
        // Usa dados do serviço Windows se disponíveis
        status = windowsStatus as PowerPointStatus;
      }
    }
    
    // Se serviço Windows não retornou dados válidos, tenta módulo nativo
    if (!status && getPowerPointStatus) {
      try {
        status = getPowerPointStatus();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
        logger.warning(LogOrigin.Server, `Erro ao obter status do módulo nativo: ${errorMsg}`);
      }
    }
    
    // Se ainda não tem status, retorna status de espera
    if (!status) {
      status = {
        isAvailable: false,
        slideCount: 0,
        visibleSlideCount: 0,
        currentSlide: 0,
        isInSlideShow: false,
        slidesRemaining: 0,
        hiddenSlides: [],
        error: 'Aguardando dados do PowerPoint...',
        timestamp: now,
      };
    }
    
    // WORKAROUND: Timer para estimar currentTime quando PowerPoint não expõe essa informação
    // ESTRATÉGIA AGRESSIVA: Em modo apresentação com vídeo, inicia timer e verifica se avança
    // Se o timer avançar (indicando que o vídeo realmente está tocando), marca isPlaying = true
    if (status.video?.hasVideo && status.video.duration > 0) {
      // Se currentTime está disponível do PowerPoint, usa ele e sincroniza o timer
      if (status.video.currentTime > 0) {
        // PowerPoint está fornecendo currentTime - usa ele e atualiza timer
        if (!videoTimer || videoTimer.slideNumber !== status.currentSlide || videoTimer.duration !== status.video.duration) {
          // Novo vídeo ou slide mudou - inicializa timer
          videoTimer = {
            slideNumber: status.currentSlide,
            startedAt: now - (status.video.currentTime * 1000),
            duration: status.video.duration,
            lastKnownCurrentTime: status.video.currentTime,
          };
        } else {
          // Atualiza timer com o valor real do PowerPoint
          videoTimer.lastKnownCurrentTime = status.video.currentTime;
          videoTimer.startedAt = now - (status.video.currentTime * 1000);
        }
        // Marca como tocando se currentTime > 0
        status.video.isPlaying = true;
      } else {
        // currentTime não está disponível - usa heurística mais agressiva
        
        // Critério 1: Se PowerPoint reporta isPlaying = true, confia nele
        // Critério 2: Se estamos em modo apresentação com vídeo válido, assume que pode estar tocando
        // e inicia/mantém o timer - se o timer avançar, confirma que está tocando
        const shouldConsiderPlaying = status.video.isPlaying || 
                                      (status.isInSlideShow && status.video.duration > 0);
        
        if (shouldConsiderPlaying) {
          if (videoTimer && videoTimer.slideNumber === status.currentSlide && videoTimer.duration === status.video.duration) {
            // Timer já está rodando - verifica se está avançando
            const elapsedSeconds = (now - videoTimer.startedAt) / 1000;
            
            // Se passou pelo menos 0.5 segundos, assume que o vídeo está realmente tocando
            if (elapsedSeconds >= 0.5) {
              status.video.isPlaying = true;
            }
            
            // Só estima se não passou da duração
            if (elapsedSeconds <= videoTimer.duration) {
              status.video.currentTime = Math.max(0, elapsedSeconds);
              status.video.remainingTime = Math.max(0, videoTimer.duration - elapsedSeconds);
            } else {
              // Vídeo terminou
              status.video.currentTime = videoTimer.duration;
              status.video.remainingTime = 0;
              status.video.isPlaying = false;
              videoTimer = null;
            }
          } else {
            // Novo vídeo ou slide mudou - inicia novo timer
            // Se PowerPoint reporta isPlaying, marca imediatamente
            // Caso contrário, só marca se o timer avançar (verificado na próxima iteração)
            videoTimer = {
              slideNumber: status.currentSlide,
              startedAt: now,
              duration: status.video.duration,
              lastKnownCurrentTime: 0,
            };
            status.video.currentTime = 0;
            status.video.remainingTime = status.video.duration;
            // Só marca isPlaying se PowerPoint confirmou, senão espera o timer avançar
            if (!status.video.isPlaying) {
              status.video.isPlaying = false; // Deixa false por enquanto, será atualizado na próxima iteração se o timer avançar
            }
          }
        } else {
          // Não há evidência de que está tocando - limpa timer
          videoTimer = null;
          status.video.isPlaying = false;
        }
      }
    } else {
      // Não há vídeo - limpa timer
      videoTimer = null;
    }
    
    if (!status.isAvailable) {
      res.status(404).json({
        ...status,
        timestamp: now,
        error: status.error || 'PowerPoint não está aberto ou não há apresentação ativa',
      });
      return;
    }

    res.status(200).json({
      ...status,
      timestamp: now,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `Erro ao obter status do PowerPoint: ${errorMessage}`);
    res.status(500).json({
      error: errorMessage,
      isAvailable: false,
      timestamp: Date.now(),
    });
  }
}

/**
 * Controller para obter status do serviço Windows
 */
export async function getWindowsStatusController(
  req: Request,
  res: Response
): Promise<void> {
  console.log('✅ [CONTROLLER] getWindowsStatusController chamado');
  console.log('✅ [CONTROLLER] Path:', req.path);
  console.log('✅ [CONTROLLER] Method:', req.method);
  try {
    if (!windowsService) {
      await initializeWindowsService();
    }

    if (!windowsService) {
      res.status(503).json({
        connected: false,
        error: 'Serviço Windows não disponível',
      });
      return;
    }

    const serviceStatus = windowsService.getServiceStatus();
    const lastStatus = windowsService.getStatus();

    res.status(200).json({
      ...serviceStatus,
      status: lastStatus,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `Erro ao obter status do serviço Windows: ${errorMessage}`);
    res.status(500).json({
      error: errorMessage,
      connected: false,
    });
  }
}

/**
 * Controller para configurar serviço Windows
 */
export async function configureWindowsController(
  req: Request,
  res: Response
): Promise<void> {
  console.log('🔧 [CONTROLLER] configureWindowsController chamado');
  console.log('🔧 [CONTROLLER] req.body:', req.body);
  console.log('🔧 [CONTROLLER] req.headers:', req.headers);
  
  try {
    // Log do body recebido para debug
    logger.info(
      LogOrigin.Server,
      `🔧 [CONTROLLER] PowerPoint Windows - Body recebido: ${JSON.stringify(req.body)}`
    );
    logger.info(
      LogOrigin.Server,
      `🔧 [CONTROLLER] PowerPoint Windows - Content-Type: ${String(req.headers['content-type'] ?? '')}`
    );
    
    const { ip, port } = req.body || {};
    
    if (!req.body) {
      console.error('❌ [CONTROLLER] Body vazio!');
      logger.error(LogOrigin.Server, '❌ PowerPoint Windows - Body vazio! Verifique se express.json() está configurado');
      res.status(400).json({ success: false, error: 'Body da requisição não foi parseado. Verifique Content-Type.' });
      return;
    }
    
    logger.info(LogOrigin.Server, `🔧 PowerPoint Windows - Recebendo configuração: ip=${ip}, port=${port}`);

    // Permite limpar configuração (ip e port vazios)
    if (!ip || !port || (typeof ip === 'string' && ip.trim() === '') || (typeof port === 'string' && port.trim() === '')) {
      logger.info(LogOrigin.Server, '🔧 PowerPoint Windows - Limpando configuração');
      if (windowsService) {
        windowsService.configure(null);
      }
      
      // Remove configuração salva do Supabase
      await clearPowerPointConfig();
      
      console.log('✅ [CONTROLLER] Enviando resposta de remoção:', { success: true, url: null });
      res.status(200).json({ success: true, url: null, message: 'Configuração removida' });
      return;
    }

    // Converte para string e valida
    const ipStr = String(ip).trim();
    const portStr = String(port).trim();

    // Valida IP básico
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ipStr)) {
      logger.warning(LogOrigin.Server, `⚠️  PowerPoint Windows - IP inválido: ${ipStr}`);
      res.status(400).json({ success: false, error: 'IP inválido' });
      return;
    }

    // Valida porta
    const portNum = parseInt(portStr, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      logger.warning(LogOrigin.Server, `⚠️  PowerPoint Windows - Porta inválida: ${portStr}`);
      res.status(400).json({ success: false, error: 'Porta inválida (deve ser entre 1 e 65535)' });
      return;
    }

    const url = `http://${ipStr}:${portNum}`;
    logger.info(LogOrigin.Server, `🔧 PowerPoint Windows - Configurando URL: ${url}`);

    if (!windowsService) {
      logger.info(LogOrigin.Server, '🔧 PowerPoint Windows - Inicializando serviço...');
      await initializeWindowsService();
    }

    if (!windowsService) {
      logger.error(LogOrigin.Server, '❌ PowerPoint Windows - Serviço não disponível');
      res.status(500).json({ success: false, error: 'Serviço Windows não disponível' });
      return;
    }

    try {
      console.log('🔧 [CONTROLLER] Configurando windowsService com URL:', url);
      windowsService.configure({ url });
      console.log('✅ [CONTROLLER] windowsService.configure() chamado');
      
      // Verifica imediatamente se configuração foi aplicada
      const hasConfigNow = windowsService.hasValidConfig && windowsService.hasValidConfig();
      const configNow = windowsService.getConfig ? windowsService.getConfig() : null;
      console.log(`🔍 [CONTROLLER] Após configure() - hasValidConfig: ${hasConfigNow}`);
      console.log(`🔍 [CONTROLLER] Após configure() - getConfig():`, JSON.stringify(configNow));
      
      if (!hasConfigNow) {
        logger.error(LogOrigin.Server, `❌ PowerPoint Windows - Configuração não foi aplicada! URL: ${url}, hasValidConfig: false`);
        console.error('❌ [CONTROLLER] ERRO: Configuração não foi aplicada após configure()!');
      }
      
      // Salva configuração no Supabase para persistência
      console.log('🔧 [CONTROLLER] Salvando configuração no Supabase...');
      console.log('🔧 [CONTROLLER] Supabase conectado?', supabaseAdapter?.isConnectedToSupabase());
      
      // Tenta salvar mesmo se Supabase não estiver conectado ainda
      // A função vai logar mas não vai falhar se não conseguir
      await savePowerPointConfig(ipStr, portStr);
      console.log('✅ [CONTROLLER] Chamada a savePowerPointConfig concluída');
      
      // Se Supabase não estava conectado mas agora está, tenta salvar novamente após um delay
      if (!supabaseAdapter?.isConnectedToSupabase()) {
        console.log('⚠️  [CONTROLLER] Supabase não conectado agora, mas tentará salvar quando conectar...');
        // REMOVIDO: Não precisa mais tentar salvar novamente aqui, o initializeSupabaseService já faz isso
      }
      
      // Verifica novamente após salvar
      const hasConfigAfterSave = windowsService.hasValidConfig && windowsService.hasValidConfig();
      console.log(`🔍 [CONTROLLER] Após salvar - hasValidConfig: ${hasConfigAfterSave}`);
      
      // Inicializa serviço Supabase se windowsService tem config válida
      if (hasConfigAfterSave) {
        console.log('🔧 [CONTROLLER] Inicializando serviço Supabase...');
        initializeSupabaseService();
        console.log('✅ [CONTROLLER] Serviço Supabase inicializado (ou já existia)');
      } else {
        logger.error(LogOrigin.Server, `❌ PowerPoint Windows - Não foi possível inicializar Supabase porque hasValidConfig é false`);
        console.error('❌ [CONTROLLER] ERRO: Não foi possível inicializar Supabase - hasValidConfig é false!');
      }
      
      logger.info(LogOrigin.Server, `✅ PowerPoint Windows - Configuração aplicada e salva: ${url}, hasValidConfig: ${hasConfigAfterSave}`);
      console.log('✅ [CONTROLLER] Enviando resposta:', { success: true, url, hasValidConfig: hasConfigAfterSave });
      
      // Garante que a resposta é enviada
      if (!res.headersSent) {
        res.status(200).json({ success: true, url, hasValidConfig: hasConfigAfterSave });
      } else {
        console.error('❌ [CONTROLLER] Resposta já foi enviada!');
      }
      return;
    } catch (configureError) {
      console.error('❌ [CONTROLLER] Erro no try-catch interno:', configureError);
      const errorMsg = configureError instanceof Error ? configureError.message : 'Erro desconhecido ao configurar';
      logger.error(LogOrigin.Server, `❌ PowerPoint Windows - Erro ao configurar: ${errorMsg}`);
      if (configureError instanceof Error && configureError.stack) {
        logger.error(LogOrigin.Server, `Stack: ${configureError.stack}`);
        console.error('Stack:', configureError.stack);
      }
      
      // Garante que a resposta de erro é enviada
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: `Erro ao configurar serviço: ${errorMsg}` });
      } else {
        console.error('❌ [CONTROLLER] Resposta de erro já foi enviada!');
      }
      return;
    }
  } catch (error) {
    console.error('❌ [CONTROLLER] Erro no catch externo:', error);
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ PowerPoint Windows - Erro geral: ${errorMsg}`);
    if (error instanceof Error && error.stack) {
      logger.error(LogOrigin.Server, `Stack: ${error.stack}`);
      console.error('Stack completo:', error.stack);
    }
    
    // Garante que a resposta de erro é enviada
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: errorMsg });
    } else {
      console.error('❌ [CONTROLLER] Resposta do catch externo já foi enviada!');
    }
    return;
  }
}

/**
 * Controller para iniciar serviço Windows
 */
export async function startWindowsController(
  _req: Request,
  res: Response
): Promise<void> {
  try {
    if (!windowsService) {
      await initializeWindowsService();
    }

    if (!windowsService) {
      res.status(503).json({
        success: false,
        error: 'Serviço Windows não disponível',
      });
      return;
    }

    windowsService.start();

    res.status(200).json({
      success: true,
      message: 'Serviço Windows iniciado',
      status: windowsService.getServiceStatus(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `Erro ao iniciar serviço Windows: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
}

/**
 * Controller para parar serviço Windows
 */
export async function stopWindowsController(
  _req: Request,
  res: Response
): Promise<void> {
  try {
    if (!windowsService) {
      res.status(404).json({
        success: false,
        error: 'Serviço Windows não está rodando',
      });
      return;
    }

    windowsService.stop();

    res.status(200).json({
      success: true,
      message: 'Serviço Windows parado',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `Erro ao parar serviço Windows: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
}

/**
 * Controller para toggle do PowerPoint via REST API (Stream Deck/Companion)
 * Usa o mesmo handler do botão PPT na interface para garantir consistência
 */
export async function togglePowerPointController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    logger.info(LogOrigin.Server, '🔄 PowerPoint toggle REST - Chamando handler de integração');
    
    // Usa o mesmo handler que o botão PPT usa (via WebSocket)
    // Isso garante que ambos usam exatamente a mesma lógica
    const result = dispatchFromAdapter('togglepowerpoint', undefined, 'http');
    
    // O handler pode retornar uma Promise ou um objeto direto
    const resolvedResult = result instanceof Promise ? await result : result;
    
    if (resolvedResult && resolvedResult.payload) {
      const payload = resolvedResult.payload as { enabled?: boolean; error?: string; currentSlide?: number; slideCount?: number };
      
      if (payload.error) {
        logger.warning(LogOrigin.Server, `⚠️  PowerPoint toggle REST - Erro: ${payload.error}`);
        res.status(503).json({
          success: false,
          enabled: false,
          error: payload.error,
        });
        return;
      }
      
      const enabled = Boolean(payload.enabled);
      logger.info(LogOrigin.Server, `✅ PowerPoint toggle REST: ${enabled ? 'Habilitado (verde)' : 'Desabilitado (vermelho)'}`);
      
      res.status(200).json({
        success: true,
        enabled,
        message: enabled ? 'PowerPoint habilitado' : 'PowerPoint desabilitado',
        currentSlide: payload.currentSlide,
        slideCount: payload.slideCount,
      });
    } else {
      logger.warning(LogOrigin.Server, '⚠️  PowerPoint toggle REST - Resposta inválida do handler');
      res.status(500).json({
        success: false,
        enabled: false,
        error: 'Resposta inválida do servidor',
      });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ PowerPoint toggle REST - Erro: ${errorMsg}`);
    res.status(500).json({
      success: false,
      error: errorMsg,
      enabled: false,
    });
  }
}

/**
 * Controller para obter status do PowerPoint (enabled/disabled) via REST API
 */
export async function getPowerPointStatusRESTController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    await initializeSupabaseService();
    
    if (!supabaseService) {
      res.status(503).json({
        success: false,
        enabled: false,
        error: 'Serviço PowerPoint não disponível',
      });
      return;
    }
    
    const enabled = supabaseService.getEnabled();
    
    res.status(200).json({
      success: true,
      enabled,
      message: enabled ? 'PowerPoint está habilitado' : 'PowerPoint está desabilitado',
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ PowerPoint status REST - Erro: ${errorMsg}`);
    res.status(500).json({
      success: false,
      error: errorMsg,
      enabled: false,
    });
  }
}

/**
 * Controller para obter status COMPLETO do PowerPoint via REST API (Stream Deck)
 * Inclui informações de vídeo, duração, conexão, etc
 */
export async function getPowerPointCompleteStatusController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    await initializeSupabaseService();
    
    // Obtém status enabled (se está enviando para Supabase)
    const enabled = supabaseService ? supabaseService.getEnabled() : false;
    
    // Obtém status do PowerPoint (slide, vídeo, etc)
    let powerpointStatus: PowerPointStatus | null = null;
    
    // Prioriza serviço Windows se estiver configurado e conectado
    if (!windowsService) {
      await initializeWindowsService();
    }
    
    if (windowsService) {
      const windowsStatus = windowsService.getStatus();
      if (windowsStatus && windowsStatus.isAvailable) {
        powerpointStatus = windowsStatus as PowerPointStatus;
      }
    }
    
    // Se serviço Windows não retornou dados válidos, tenta módulo nativo
    if (!powerpointStatus && getPowerPointStatus) {
      try {
        powerpointStatus = getPowerPointStatus();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
        logger.warning(LogOrigin.Server, `Erro ao obter status do módulo nativo: ${errorMsg}`);
      }
    }
    
    // Se ainda não tem status, cria status vazio
    if (!powerpointStatus) {
      powerpointStatus = {
        isAvailable: false,
        slideCount: 0,
        visibleSlideCount: 0,
        currentSlide: 0,
        isInSlideShow: false,
        slidesRemaining: 0,
        hiddenSlides: [],
        error: 'Aguardando dados do PowerPoint...',
        timestamp: Date.now(),
      };
    }
    
    // Obtém informações de conexão (se disponível)
    const connection = windowsService ? windowsService.getServiceStatus() : {
      connected: false,
      url: '',
      pollInterval: 0,
      lastUpdate: null,
      errorCount: 0,
    };
    
    res.status(200).json({
      success: true,
      enabled,
      powerpoint: powerpointStatus,
      connection,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ PowerPoint complete status REST - Erro: ${errorMsg}`);
    res.status(500).json({
      success: false,
      error: errorMsg,
      enabled: false,
      powerpoint: null,
      connection: null,
    });
  }
}

// Helper para obter status do PowerPoint
async function getPowerPointStatusData(): Promise<PowerPointStatus | null> {
  // Prioriza serviço Windows se estiver configurado e conectado
  if (!windowsService) {
    await initializeWindowsService();
  }
  
  let powerpointStatus: PowerPointStatus | null = null;
  
  if (windowsService) {
    const windowsStatus = windowsService.getStatus();
    if (windowsStatus && windowsStatus.isAvailable) {
      powerpointStatus = windowsStatus as PowerPointStatus;
    }
  }
  
  // Se serviço Windows não retornou dados válidos, tenta módulo nativo
  if (!powerpointStatus && getPowerPointStatus) {
    try {
      powerpointStatus = getPowerPointStatus();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.warning(LogOrigin.Server, `Erro ao obter status do módulo nativo: ${errorMsg}`);
    }
  }
  
  return powerpointStatus;
}

// Endpoint para obter apenas informações do slide
export async function getPowerPointSlideStatusController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const powerpointStatus = await getPowerPointStatusData();
    
    // Se format=query, retorna redirect com query params (para Companion)
    if (req.query.format === 'query') {
      const currentSlide = powerpointStatus?.currentSlide || 0;
      const slideCount = powerpointStatus?.slideCount || 0;
      const slidesRemaining = powerpointStatus?.slidesRemaining || 0;
      const isInSlideShow = powerpointStatus?.isInSlideShow ? 'true' : 'false';
      
      const baseUrl = req.protocol + '://' + req.get('host');
      const redirectUrl = `${baseUrl}/api/public/powerpoint/status/slide?currentSlide=${currentSlide}&slideCount=${slideCount}&slidesRemaining=${slidesRemaining}&isInSlideShow=${isInSlideShow}`;
      
      res.redirect(redirectUrl);
      return;
    }
    
    if (!powerpointStatus) {
      res.status(200).json({
        success: true,
        slide: {
          isAvailable: false,
          currentSlide: 0,
          slideCount: 0,
          visibleSlideCount: 0,
          slidesRemaining: 0,
          hiddenSlides: [],
          isInSlideShow: false,
          error: 'Aguardando dados do PowerPoint...',
          timestamp: Date.now(),
        },
      });
      return;
    }
    
    res.status(200).json({
      success: true,
      slide: {
        isAvailable: powerpointStatus.isAvailable,
        currentSlide: powerpointStatus.currentSlide,
        slideCount: powerpointStatus.slideCount,
        visibleSlideCount: powerpointStatus.visibleSlideCount,
        slidesRemaining: powerpointStatus.slidesRemaining,
        hiddenSlides: powerpointStatus.hiddenSlides,
        isInSlideShow: powerpointStatus.isInSlideShow,
        error: powerpointStatus.error,
        timestamp: powerpointStatus.timestamp,
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ PowerPoint slide status REST - Erro: ${errorMsg}`);
    res.status(500).json({
      success: false,
      error: errorMsg,
      slide: null,
    });
  }
}

// Endpoint específico para Companion que retorna os dados
// Retorna como query string (formato Windows) OU JSON conforme parâmetro
export async function getPowerPointSlideQueryParamsController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const powerpointStatus = await getPowerPointStatusData();
    
    const currentSlide = powerpointStatus?.currentSlide || 0;
    const slideCount = powerpointStatus?.slideCount || 0;
    const slideInfo = `Slide ${currentSlide} / ${slideCount}`;
    
    // Extrai dados do vídeo se disponíveis
    const hasVideo = powerpointStatus?.video?.hasVideo || false;
    const videoHours = powerpointStatus?.video?.hours ?? 0;
    const videoMinutes = powerpointStatus?.video?.minutes ?? 0;
    const videoSeconds = powerpointStatus?.video?.seconds ?? 0;
    const videoTime = powerpointStatus?.video?.time || `${String(videoHours).padStart(2, '0')}:${String(videoMinutes).padStart(2, '0')}:${String(videoSeconds).padStart(2, '0')}`;
    const videoCurrentTime = powerpointStatus?.video?.currentTime ?? 0;
    const videoIsPlaying = powerpointStatus?.video?.isPlaying || false;
    
    // Log para debug
    if (hasVideo) {
      logger.info(LogOrigin.Server, `📹 Vídeo detectado - Hours: ${videoHours}, Minutes: ${videoMinutes}, Seconds: ${videoSeconds}, Time: ${videoTime}, CurrentTime: ${videoCurrentTime}, IsPlaying: ${videoIsPlaying}`);
    }
    
    // Se format=json, retorna JSON (para Companion parsear facilmente)
    if (req.query.format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      const response: any = {
        slide_info: slideInfo,
        currentSlide: currentSlide,
        slideCount: slideCount,
        slidesRemaining: powerpointStatus?.slidesRemaining || 0,
      };
      
      // Sempre inclui dados do vídeo se disponíveis
      if (hasVideo) {
        response.hours = String(videoHours).padStart(2, '0');
        response.minutes = String(videoMinutes).padStart(2, '0');
        response.seconds = String(videoSeconds).padStart(2, '0');
        response.time = videoTime;
        response.currentTime = videoCurrentTime;
        response.isPlaying = videoIsPlaying;
      }
      
      res.status(200).json(response);
      return;
    }
    
    // Formato padrão: query string (igual ao programa Windows)
    const queryParams = new URLSearchParams({
      slide_info: slideInfo,
    });
    
    // Sempre inclui dados do vídeo se disponíveis
    if (hasVideo) {
      queryParams.set('hours', String(videoHours).padStart(2, '0'));
      queryParams.set('minutes', String(videoMinutes).padStart(2, '0'));
      queryParams.set('seconds', String(videoSeconds).padStart(2, '0'));
      queryParams.set('time', videoTime);
    }
    
    // Retorna query string pura (formato Windows)
    res.removeHeader('Content-Type');
    res.removeHeader('ETag');
    res.status(200).send(queryParams.toString());
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ PowerPoint slide query params REST - Erro: ${errorMsg}`);
    
    if (req.query.format === 'json') {
      res.status(200).json({
        slide_info: 'Slide 0 / 0',
        currentSlide: 0,
        slideCount: 0,
        error: errorMsg,
      });
    } else {
      const queryParams = new URLSearchParams({
        slide_info: 'Slide 0 / 0',
      });
      res.removeHeader('Content-Type');
      res.status(200).send(queryParams.toString());
    }
  }
}

// Endpoint para obter apenas informações do vídeo
export async function getPowerPointVideoStatusController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const powerpointStatus = await getPowerPointStatusData();
    
    if (!powerpointStatus || !powerpointStatus.video) {
      res.status(200).json({
        success: true,
        video: {
          hasVideo: false,
          isPlaying: false,
          duration: 0,
          currentTime: 0,
          remainingTime: 0,
          volume: 0,
          muted: false,
          fileName: '',
          sourceUrl: '',
          hours: 0,
          minutes: 0,
          seconds: 0,
          time: '00:00:00',
        },
      });
      return;
    }
    
    // Extrai dados do vídeo com valores padrão corretos
    const videoHours = powerpointStatus.video.hours ?? 0;
    const videoMinutes = powerpointStatus.video.minutes ?? 0;
    const videoSeconds = powerpointStatus.video.seconds ?? 0;
    const videoTime = powerpointStatus.video.time || `${String(videoHours).padStart(2, '0')}:${String(videoMinutes).padStart(2, '0')}:${String(videoSeconds).padStart(2, '0')}`;
    
    res.status(200).json({
      success: true,
      video: {
        hasVideo: powerpointStatus.video.hasVideo,
        isPlaying: powerpointStatus.video.isPlaying,
        duration: powerpointStatus.video.duration,
        currentTime: powerpointStatus.video.currentTime ?? 0,
        remainingTime: powerpointStatus.video.remainingTime,
        volume: powerpointStatus.video.volume,
        muted: powerpointStatus.video.muted,
        fileName: powerpointStatus.video.fileName,
        sourceUrl: powerpointStatus.video.sourceUrl,
        hours: videoHours,
        minutes: videoMinutes,
        seconds: videoSeconds,
        time: videoTime,
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ PowerPoint video status REST - Erro: ${errorMsg}`);
    res.status(500).json({
      success: false,
      error: errorMsg,
      video: null,
    });
  }
}

// Endpoint para configurar serviço OSC
export async function configureOscController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    if (!windowsService) {
      await initializeWindowsService();
    }
    
    if (!windowsService) {
      res.status(503).json({
        success: false,
        error: 'Serviço Windows não disponível',
      });
      return;
    }
    
    const { targetIP, targetPort } = req.body;
    
    if (!targetIP || !targetPort) {
      res.status(400).json({
        success: false,
        error: 'targetIP e targetPort são obrigatórios',
      });
      return;
    }
    
    // Cria ou atualiza serviço OSC
    if (!oscService) {
      oscService = new PowerPointOscService(windowsService, targetIP, targetPort);
      logger.info(LogOrigin.Server, `📡 PowerPoint OSC - Serviço criado: ${targetIP}:${targetPort}`);
    } else {
      oscService.setTarget(targetIP, targetPort);
      logger.info(LogOrigin.Server, `📡 PowerPoint OSC - Destino atualizado: ${targetIP}:${targetPort}`);
    }
    
    res.status(200).json({
      success: true,
      message: 'Serviço OSC configurado',
      config: oscService.getConfig(),
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ PowerPoint OSC config - Erro: ${errorMsg}`);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
}

// Endpoint para iniciar serviço OSC
export async function startOscController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    if (!oscService) {
      res.status(400).json({
        success: false,
        error: 'Serviço OSC não configurado. Configure IP/Porta primeiro.',
      });
      return;
    }
    
    oscService.start();
    
    res.status(200).json({
      success: true,
      message: 'Serviço OSC iniciado',
      config: oscService.getConfig(),
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ PowerPoint OSC start - Erro: ${errorMsg}`);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
}

// Endpoint para parar serviço OSC
export async function stopOscController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    if (!oscService) {
      res.status(400).json({
        success: false,
        error: 'Serviço OSC não configurado',
      });
      return;
    }
    
    oscService.stop();
    
    res.status(200).json({
      success: true,
      message: 'Serviço OSC parado',
      config: oscService.getConfig(),
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ PowerPoint OSC stop - Erro: ${errorMsg}`);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
}

// Endpoint para obter status do serviço OSC
export async function getOscStatusController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    if (!oscService) {
      res.status(200).json({
        success: true,
        configured: false,
        config: null,
      });
      return;
    }
    
    res.status(200).json({
      success: true,
      configured: true,
      config: oscService.getConfig(),
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ PowerPoint OSC status - Erro: ${errorMsg}`);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
}

// ============================================
// Controllers de Descoberta UDP
// ============================================

/**
 * Inicializa o serviço de descoberta e conecta ao primeiro servidor encontrado
 */
async function initializeDiscoveryService(): Promise<void> {
  if (discoveryService) {
    return;
  }

  try {
    discoveryService = getDiscoveryService();

    // Inicia escuta de broadcasts (modo passivo - muito leve)
    discoveryService.startListening();

    // Multi-instância: o MultiSourceService assume a orquestração
    // (agrupa por group_id, escolhe a ativa por prioridade, failover, capture_state
    // e publicação por grupo no Supabase). Substitui o antigo auto-connect single-source.
    getMultiSourceService().start();
    logger.info(
      LogOrigin.Server,
      '🎛️  PowerPoint - modo multi-instância ativo (agrupamento por group_id + failover)',
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ PowerPoint Discovery - Erro ao inicializar: ${errorMsg}`);
  }
}

/**
 * Conecta ao servidor descoberto via WebSocket
 */
// Variável para evitar múltiplas tentativas de conexão ao mesmo servidor
let lastConnectedServerUrl: string | null = null;
let connectionAttemptTime: number = 0;
const CONNECTION_COOLDOWN = 5000; // 5 segundos entre tentativas
// ✅ CORREÇÃO: Adiciona proteção contra loops infinitos de reconexão
let reconnectAttempts: number = 0;
const MAX_RECONNECT_ATTEMPTS = 5; // Máximo de tentativas recursivas

function connectToDiscoveredServer(server: DiscoveredServer): void {
  const wsUrl = `http://${server.ip}:${server.port}`;
  const now = Date.now();
  
  // Evita tentativas múltiplas muito rápidas ao mesmo servidor
  if (lastConnectedServerUrl === wsUrl && (now - connectionAttemptTime) < CONNECTION_COOLDOWN) {
    return;
  }
  
  // ✅ CORREÇÃO: Proteção contra loops infinitos
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logger.error(LogOrigin.Server, `❌ PowerPoint WebSocket - Máximo de tentativas de reconexão atingido (${MAX_RECONNECT_ATTEMPTS}), parando...`);
    reconnectAttempts = 0; // Reset após um tempo
    return;
  }
  
  // Se já existe conexão WebSocket ativa para o mesmo servidor, não reconecta
  if (websocketService) {
    const isConnected = websocketService.isServiceConnected();
    const isConnecting = (websocketService as any).isConnecting || false;
    const currentUrl = (websocketService as any).url || '';
    
    if (isConnected && currentUrl === wsUrl) {
      // Já conectado ao mesmo servidor, ignorando...
      reconnectAttempts = 0; // Reset contador quando conectado com sucesso
      // Mesmo assim, garante que Supabase service está inicializado
      if (!supabaseService) {
        setTimeout(() => {
          initializeSupabaseService();
        }, 500);
      }
      return;
    }
    
    if (isConnecting && currentUrl === wsUrl) {
      // Já está conectando ao servidor, aguardando...
      return;
    }
    
    // Se URL mudou, para conexão anterior
    if (currentUrl !== wsUrl && (isConnected || isConnecting)) {
      logger.info(LogOrigin.Server, `PowerPoint WebSocket - Servidor diferente detectado (${currentUrl} → ${wsUrl}), reconectando...`);
      reconnectAttempts++; // Incrementa contador de tentativas
      websocketService.stop();
      // Aguarda um pouco antes de reconectar
      setTimeout(() => {
        connectToDiscoveredServer(server);
      }, 1000);
      return;
    }
  }
  
  // Reset contador quando conecta com sucesso
  reconnectAttempts = 0;
  
  // Atualiza timestamp da tentativa
  lastConnectedServerUrl = wsUrl;
  connectionAttemptTime = now;
  
  // Cria novo serviço WebSocket se não existir
  if (!websocketService) {
    websocketService = new PowerPointWebSocketService({ url: wsUrl });
    
    // Escuta quando WebSocket conectar
    websocketService.on('connected', () => {
      logger.info(LogOrigin.Server, '🚀 PowerPoint - WebSocket conectado, inicializando Supabase service...');
      // Aguarda um pouco para garantir que recebeu primeiro status
      setTimeout(() => {
        if (!supabaseService && websocketService && websocketService.isServiceConnected()) {
          initializeSupabaseService();
        }
      }, 1000);
    });
    
    // Escuta quando WebSocket desconectar
    websocketService.on('disconnected', () => {
      logger.info(LogOrigin.Server, '🔌 PowerPoint - WebSocket desconectado, notificando clientes...');
      
      // Se supabaseService existe e está habilitado, desabilita automaticamente
      // pois não há como enviar dados sem conexão WebSocket
      if (supabaseService && supabaseService.getEnabled()) {
        logger.info(LogOrigin.Server, '🔌 PowerPoint - Desabilitando Supabase service (sem conexão WebSocket)');
        // Desabilita o serviço sem toggle (apenas seta estado interno)
        (supabaseService as any).isEnabled = false;
      }
      
      // Notifica todos os clientes via WebSocket que o PowerPoint desconectou
      socket.sendAsJson({
        type: 'powerpoint-status',
        payload: { 
          enabled: false, 
          error: 'Desconectado do HouseriaPPT',
          currentSlide: 0,
          slideCount: 0,
        },
      });
    });
    
    // Escuta eventos de mudança de status
    websocketService.on('statusChange', (_status: WindowsPowerPointStatus) => {
      // Propaga para supabaseService se existir
      if (supabaseService) {
        // O supabaseService já está escutando, mas garantimos que recebe
        // Status atualizado via WebSocket
      }
    });
  } else {
    // Atualiza URL do serviço existente apenas se mudou
    const currentUrl = (websocketService as any).url || '';
    if (currentUrl !== wsUrl) {
      websocketService.setUrl(wsUrl);
    }
  }

  // Inicia conexão apenas se não estiver conectando ou conectado
  const isConnected = websocketService.isServiceConnected();
  const isConnecting = (websocketService as any).isConnecting || false;
  
  if (!isConnected && !isConnecting) {
    websocketService.start();
  }
  
  // Para busca periódica já que encontramos servidor
  if (discoveryService) {
    discoveryService.stopPeriodicSearch();
  }
}

/**
 * Inicia broadcast deste servidor
 */
export async function startDiscoveryBroadcastController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    if (!discoveryService) {
      await initializeDiscoveryService();
    }

    const { port, host } = req.body;
    
    if (!port || typeof port !== 'number') {
      res.status(400).json({
        success: false,
        error: 'Porta do servidor é obrigatória',
      });
      return;
    }

    discoveryService!.startBroadcasting(port, host);
    
    res.status(200).json({
      success: true,
      message: 'Broadcast de descoberta iniciado',
      status: discoveryService!.getStatus(),
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ PowerPoint Discovery broadcast start - Erro: ${errorMsg}`);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
}

/**
 * Para broadcast deste servidor
 */
export async function stopDiscoveryBroadcastController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    if (!discoveryService) {
      res.status(200).json({
        success: true,
        message: 'Serviço de descoberta não estava ativo',
      });
      return;
    }

    discoveryService.stopBroadcasting();
    
    res.status(200).json({
      success: true,
      message: 'Broadcast de descoberta parado',
      status: discoveryService.getStatus(),
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ PowerPoint Discovery broadcast stop - Erro: ${errorMsg}`);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
}

/**
 * Busca servidores na rede
 */
export async function discoverServersController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    if (!discoveryService) {
      await initializeDiscoveryService();
    }

    const timeout = parseInt(req.query.timeout as string) || 5000;
    
    logger.info(LogOrigin.Server, `🔍 PowerPoint Discovery - Buscando servidores (timeout: ${timeout}ms)...`);
    
    const servers = await discoveryService!.discoverServers(timeout);
    
    res.status(200).json({
      success: true,
      servers,
      count: servers.length,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ PowerPoint Discovery - Erro ao buscar servidores: ${errorMsg}`);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
}

/**
 * Obtém status do serviço de descoberta
 */
export async function getDiscoveryStatusController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    if (!discoveryService) {
      res.status(200).json({
        success: true,
        initialized: false,
        status: null,
      });
      return;
    }

    res.status(200).json({
      success: true,
      initialized: true,
      status: discoveryService.getStatus(),
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ PowerPoint Discovery status - Erro: ${errorMsg}`);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
}

/**
 * GET /groups — lista os grupos multi-instância descobertos (com máquinas e ativa).
 */
export async function getPowerPointGroupsController(_req: Request, res: Response): Promise<void> {
  try {
    res.status(200).json({
      success: true,
      groups: getMultiSourceService().getSnapshot(),
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    res.status(500).json({ success: false, error: errorMsg });
  }
}

/**
 * POST /groups/consume — { groupId, consume } liga/desliga o consumo de um grupo.
 */
export async function setPowerPointGroupConsumeController(req: Request, res: Response): Promise<void> {
  try {
    const { groupId, consume } = req.body ?? {};
    if (typeof groupId !== 'string' || !groupId) {
      res.status(400).json({ success: false, error: 'groupId é obrigatório' });
      return;
    }
    getMultiSourceService().setConsumed(groupId, consume !== false);
    res.status(200).json({ success: true, groups: getMultiSourceService().getSnapshot() });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    res.status(500).json({ success: false, error: errorMsg });
  }
}

/**
 * POST /groups/cloud — { groupId, cloud } liga/desliga a publicação de um grupo no Supabase.
 */
export async function setPowerPointGroupCloudController(req: Request, res: Response): Promise<void> {
  try {
    const { groupId, cloud } = req.body ?? {};
    if (typeof groupId !== 'string' || !groupId) {
      res.status(400).json({ success: false, error: 'groupId é obrigatório' });
      return;
    }
    getMultiSourceService().setCloud(groupId, cloud === true);
    res.status(200).json({ success: true, groups: getMultiSourceService().getSnapshot() });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    res.status(500).json({ success: false, error: errorMsg });
  }
}
