import { createClient } from '@supabase/supabase-js';
import { hashPassword } from '../../utils/hash.js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://gxcgwhscnroiizjwswqv.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4Y2d3aHNjbnJvaWl6andzd3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4MDMwNjMsImV4cCI6MjA3NTM3OTA2M30.suNBGtPXUr0YY8BaJEHcSja2m-vdxuCrA2CdOPip5fg';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Em runtime real isso deve ser configurado corretamente
  // Aqui apenas garantimos que exista algum valor para evitar crash imediato.
  // Os erros reais serão tratados nas chamadas.
  // eslint-disable-next-line no-console
  console.warn(
    '[AUTH] Variáveis de ambiente do Supabase não configuradas. Usando valores padrão do projeto.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

type AuthErrorCode = 'invalid_credentials' | 'period_expired';

export type LoginResult =
  | {
      success: true;
      isAdmin: boolean;
      userId: string | number;
      /**
       * Data de expiração da licença (YYYY-MM-DD) baseada no timestamp_final máximo de sales,
       * ou null se não aplicável.
       */
      licenseExpiresAt: string | null;
    }
  | {
      success: false;
      code: AuthErrorCode;
      message: string;
    };

export async function authenticateUser(
  email: string,
  password: string
): Promise<LoginResult> {
  // Importante: usar o MESMO formato salvo no Supabase (SHA-256 + base64url, sem "=" no final)
  const passwordHash = hashPassword(password);

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/cad92a88-f000-48bd-b9dd-48d41852b469', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      runId: 'pre-fix',
      hypothesisId: 'H1',
      location: 'auth.service.ts:authenticateUser:entry',
      message: 'authenticateUser entry',
      data: {
        hasEmail: !!email,
        hasPassword: !!password,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  const {
    data: users,
    error: userError,
  } = await supabase
    .from('users')
    .select('id, email, is_admin, password_hash')
    .eq('email', email)
    .limit(1);

  if (userError) {
    throw new Error(
      `Erro ao consultar tabela users no Supabase: ${userError.message}`
    );
  }

  const user = users?.[0] as
    | { id: string | number; email: string; is_admin: boolean; password_hash: string }
    | undefined;

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/cad92a88-f000-48bd-b9dd-48d41852b469', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      runId: 'pre-fix',
      hypothesisId: 'H2',
      location: 'auth.service.ts:authenticateUser:userLookup',
      message: 'Result of users lookup',
      data: {
        foundUser: !!user,
        isAdmin: user?.is_admin ?? null,
        userIdType: user ? typeof user.id : null,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (!user || user.password_hash !== passwordHash) {
    return {
      success: false,
      code: 'invalid_credentials',
      message: 'Usuário ou senha inválidos.',
    };
  }

  if (user.is_admin) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/cad92a88-f000-48bd-b9dd-48d41852b469', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'pre-fix',
        hypothesisId: 'H3',
        location: 'auth.service.ts:authenticateUser:adminBypass',
        message: 'Admin user bypassing sales check',
        data: {
          userId: user.id,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    return {
      success: true,
      isAdmin: true,
      userId: user.id,
      licenseExpiresAt: null,
    };
  }

  // Buscar todos os registros de sales para o usuário e filtrar em JavaScript
  // Isso evita problemas de tipo SQL (time vs timestamp)
  const {
    data: allSales,
    error: salesError,
  } = await supabase
    .from('sales')
    .select('id, timestamp_inicio, timestamp_final')
    .eq('id_usuario', user.id);

  if (salesError) {
    console.error('[AUTH] Erro ao consultar tabela sales:', {
      error: salesError.message,
      code: salesError.code,
      details: salesError.details,
      hint: salesError.hint,
      userId: user.id,
    });
    throw new Error(
      `Erro ao consultar tabela sales no Supabase: ${salesError.message}`
    );
  }

  // Filtrar em JavaScript para evitar problemas de tipo SQL (time vs timestamp)
  const now = new Date();
  const sales = Array.isArray(allSales) ? allSales.filter((sale) => {
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

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/cad92a88-f000-48bd-b9dd-48d41852b469', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      runId: 'pre-fix',
      hypothesisId: 'H1',
      location: 'auth.service.ts:authenticateUser:salesCheck',
      message: 'Result of sales date window check',
      data: {
        startOfToday: null,
        startOfTomorrow: null,
        salesCount: sales?.length ?? 0,
        userId: user.id,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (!sales || sales.length === 0) {
    return {
      success: false,
      code: 'period_expired',
      message: 'Seu período de acesso expirou. Faça uma nova aquisição.',
    };
  }

  // Calcula a maior data de expiração entre os registros válidos
  type SaleRow = { id: string | number; timestamp_inicio: string | null; timestamp_final: string | null };
  const typedSales = sales as SaleRow[];

  const rawLicenseTs =
    typedSales
      .map((s) => s.timestamp_final)
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .sort()
      .at(-1) ?? null;

  // Normaliza para data simples (YYYY-MM-DD), ignorando detalhes de fuso horário
  const licenseExpiresAt =
    rawLicenseTs && typeof rawLicenseTs === 'string'
      ? rawLicenseTs.split('T')[0] ?? null
      : null;

  return {
    success: true,
    isAdmin: false,
    userId: user.id,
    licenseExpiresAt,
  };
}


