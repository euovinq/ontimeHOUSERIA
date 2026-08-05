import { createClient } from '@supabase/supabase-js';
import { hashPassword } from '../../utils/hash.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn('[AUTH] SUPABASE_URL e SUPABASE_ANON_KEY não configuradas. Operações de auth falharão.');
}

// Usa um fallback com URL/key em formato válido quando as variáveis não estão
// configuradas. createClient lança "supabaseUrl is required" se a URL for vazia,
// o que derrubaria todo o backend já no carregamento do módulo. Com o fallback o
// servidor sobe normalmente e apenas as operações de auth falham em runtime.
export const supabase = createClient(
  SUPABASE_URL || 'http://localhost:54321',
  SUPABASE_ANON_KEY || 'missing-anon-key',
);

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

/**
 * ATENÇÃO — este caminho de login NÃO é o que o app usa, e não funciona mais.
 *
 * O login do HouseriaAPP é feito pelo processo Electron
 * (`apps/electron/src/services/AuthService.js`), que chama
 * `POST https://www.houseria.art.br/api/auth/desktop/login` no site. Lá a
 * verificação roda com service role, a senha é conferida com Argon2id e o
 * app recebe um JWT. Nada disso passa por aqui.
 *
 * Esta função é a implementação antiga, exposta pelo servidor Express local em
 * `POST /auth/login` (anunciada em `PublicRoutesList.tsx` como rota pública).
 * Ela lê `users` e `sales` com a anon key — e essas duas tabelas foram
 * fechadas ao `anon` em 05/08/2026, junto com a troca do hash de senha.
 * Portanto:
 *
 *   1. qualquer chamada a `/auth/login` do servidor local agora falha;
 *   2. mesmo que não falhasse, o SHA-256 abaixo não confere mais senha
 *      nenhuma que já tenha sido migrada para Argon2id.
 *
 * Está mantida em vez de removida porque a rota é anunciada como pública e
 * pode haver integração de terceiro (Companion, automação) apontada para ela.
 * O erro abaixo é explícito de propósito: quem estiver usando descobre o que
 * fazer em vez de receber uma falha obscura de Postgres.
 */
export async function authenticateUser(
  email: string,
  password: string
): Promise<LoginResult> {
  // Importante: usar o MESMO formato salvo no Supabase (SHA-256 + base64url, sem "=" no final)
  const passwordHash = hashPassword(password);

  const {
    data: users,
    error: userError,
  } = await supabase
    .from('users')
    .select('id, email, is_admin, password_hash')
    .eq('email', email)
    .limit(1);

  if (userError) {
    // 42501 = permission denied; 401/403 vêm do PostgREST sem grant.
    throw new Error(
      'Este endpoint de login foi desativado. A tabela `users` não é mais ' +
        'legível pela chave anônima. O login do app passa pelo Electron, em ' +
        'POST https://www.houseria.art.br/api/auth/desktop/login. ' +
        `(erro original: ${userError.message})`
    );
  }

  const user = users?.[0] as
    | { id: string | number; email: string; is_admin: boolean; password_hash: string }
    | undefined;

  if (!user || user.password_hash !== passwordHash) {
    return {
      success: false,
      code: 'invalid_credentials',
      message: 'Usuário ou senha inválidos.',
    };
  }

  if (user.is_admin) {
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


