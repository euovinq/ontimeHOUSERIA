import { randomBytes } from 'node:crypto';

/**
 * Gera um código de 12 caracteres hexadecimais para acesso à rota de edição sem autenticação.
 * Usado em edit_access_codes por campo customizado no Supabase.
 */
export function generateEditAccessCode(): string {
  return randomBytes(6).toString('hex');
}

/**
 * Gera um token de 32 caracteres hexadecimais (16 bytes) para links de edição
 * multi-campo (coluna edit_share_links). Mais longo por ser "chave ao portador".
 */
export function generateShareToken(): string {
  return randomBytes(16).toString('hex');
}
