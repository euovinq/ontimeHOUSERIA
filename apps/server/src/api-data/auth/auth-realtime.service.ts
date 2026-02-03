import { LogOrigin } from 'houseriaapp-types';

import { socket } from '../../adapters/WebsocketAdapter.js';
import { logger } from '../../classes/Logger.js';
import { supabase } from './auth.service.js';
import {
  AuthSession,
  createAuthSession,
  getAllSessions,
  getAuthSession,
  removeAuthSession,
} from './auth-session.service.js';

type Json = Record<string, any>;

let isInitialised = false;
let _checkInterval: NodeJS.Timeout | null = null; // lint: used only for potential future clearInterval

/**
 * Registra uma sessão de login e garante que o monitoramento realtime esteja ativo.
 * Chamado após login bem-sucedido para usuários não-admin.
 */
export function registerLoginSession(userId: string | number, isAdmin: boolean): AuthSession | null {
  const session = createAuthSession(userId, isAdmin);

  if (isAdmin) {
    // Admin não precisa de monitoramento do período, mas mantém sessão para identificar o usuário
    return session;
  }

  initialiseAuthRealtime();

  // Faz uma verificação imediata assim que o usuário loga
  void ensureUserHasValidSalesWindow(userId);

  return session;
}

/**
 * Inicializa o monitoramento Realtime e o timer periódico apenas uma vez.
 */
function initialiseAuthRealtime() {
  if (isInitialised) return;
  isInitialised = true;

  logger.info(LogOrigin.Server, '[AUTH] Inicializando monitoramento Realtime da tabela sales...');

  // Assinatura Realtime na tabela sales
  const channel = supabase
    .channel('sales-monitor')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'sales',
      },
      (payload) => {
        handleSalesChange(payload as Json).catch((error) => {
          logger.error(
            LogOrigin.Server,
            `[AUTH] Erro ao processar mudança Realtime em sales: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
      }
    )
    .subscribe((status) => {
      logger.info(
        LogOrigin.Server,
        `[AUTH] Canal Realtime 'sales-monitor' status: ${status}`
      );
      if (status === 'CHANNEL_ERROR') {
        logger.error(
          LogOrigin.Server,
          '[AUTH] Erro no canal Realtime de sales. Verifique configuração do Supabase.'
        );
      }
    });

  // Timer periódico – checa todas as sessões ativas a cada 60 minutos
  _checkInterval = setInterval(() => {
    void checkAllSessions();
  }, 60 * 60 * 1000);

  // Pequena verificação inicial para sessões já existentes (em teoria, vazio no boot)
  void checkAllSessions();

  // Apenas para evitar lint sobre variável não usada
  void channel;
}

async function handleSalesChange(payload: Json): Promise<void> {
  const eventType = payload.eventType as string | undefined;
  const newRow = payload.new as Json | null | undefined;
  const oldRow = payload.old as Json | null | undefined;

  const userId =
    (newRow && (newRow.id_usuario as string | number | undefined)) ??
    (oldRow && (oldRow.id_usuario as string | number | undefined));

  if (!userId) {
    return;
  }

  const session = getAuthSession(userId);
  if (!session) {
    // Não há sessão ativa para esse usuário, nada a fazer
    return;
  }

  logger.info(
    LogOrigin.Server,
    `[AUTH] Mudança Realtime em sales para usuário ${String(
      userId
    )}, evento=${eventType ?? 'desconhecido'}`
  );

  await ensureUserHasValidSalesWindow(userId);
}

async function checkAllSessions(): Promise<void> {
  const sessions = getAllSessions();
  if (!sessions.length) return;

  logger.info(
    LogOrigin.Server,
    `[AUTH] Verificando janelas de acesso de ${sessions.length} sessão(ões) ativa(s)...`
  );

  for (const session of sessions) {
    await ensureUserHasValidSalesWindow(session.userId);
  }
}

/**
 * Reaproveita a lógica de verificação de período usada no login:
 * - Procura registros em sales para o usuário
 * - Considera válido se houver pelo menos 1 registro cujo intervalo
 *   [timestamp_inicio, timestamp_final] englobe o dia atual.
 */
async function ensureUserHasValidSalesWindow(userId: string | number): Promise<void> {
  const session = getAuthSession(userId);
  if (!session) return;

  // Buscar todos os registros de sales para o usuário e filtrar em JavaScript
  // Isso evita problemas de tipo SQL (time vs timestamp)
  const {
    data: sales,
    error: salesError,
  } = await supabase
    .from('sales')
    .select('id, timestamp_inicio, timestamp_final')
    .eq('id_usuario', userId);

  if (salesError) {
    logger.error(
      LogOrigin.Server,
      `[AUTH] Erro ao consultar tabela sales (monitor): ${salesError.message} (code=${
        salesError.code ?? 'n/a'
      }, userId=${String(userId)})`
    );
    // Em caso de erro de consulta, NÃO desconectamos o usuário automaticamente.
    return;
  }

  // Filtrar em JavaScript para evitar problemas de tipo SQL
  const now = new Date();
  const validSales = Array.isArray(sales) ? sales.filter((sale) => {
    if (!sale.timestamp_inicio || !sale.timestamp_final) return false;
    
    // Se os campos são time (hora do dia), comparar apenas a hora
    // Se são timestamp (data+hora), comparar normalmente
    try {
      const inicio = new Date(sale.timestamp_inicio);
      const final = new Date(sale.timestamp_final);
      
      // Verificar se são datas válidas
      if (isNaN(inicio.getTime()) || isNaN(final.getTime())) {
        // Se não são datas válidas, podem ser apenas horas (time)
        // Nesse caso, comparar apenas a hora do dia atual
        const nowTime = now.toTimeString().substring(0, 8); // HH:MM:SS
        return sale.timestamp_inicio <= nowTime && sale.timestamp_final >= nowTime;
      }
      
      // São timestamps completos, comparar normalmente
      return inicio <= now && final >= now;
    } catch {
      return false;
    }
  }) : [];

  const hasValidSales = validSales.length > 0;

  if (!hasValidSales) {
    handleLicenseExpired(userId);
  }
}

function handleLicenseExpired(userId: string | number): void {
  logger.info(
    LogOrigin.Server,
    `[AUTH] Período de acesso expirado para usuário ${String(userId)} – desconectando...`
  );

  removeAuthSession(userId);

  // Envia mensagem via WebSocket para TODOS os clientes conectados.
  // Em setups típicos há um único cliente principal (Electron).
  socket.sendAsJson({
    type: 'auth-license-expired',
    payload: {
      userId,
      reason: 'period_expired',
      timestamp: new Date().toISOString(),
    },
  });
}


