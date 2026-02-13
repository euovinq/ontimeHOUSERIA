import { randomBytes } from 'node:crypto';

/**
 * Gera um código de 12 caracteres hexadecimais para acesso à rota de edição sem autenticação.
 * Usado em edit_access_codes por campo customizado no Supabase.
 */
export function generateEditAccessCode(): string {
  return randomBytes(6).toString('hex');
}
