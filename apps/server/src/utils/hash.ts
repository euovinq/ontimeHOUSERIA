import { createHash } from 'node:crypto';

/**
 * Creates a hash of the password that is URL safe
 * @link https://stackoverflow.com/questions/17639645/websafe-encoding-of-hashed-string-in-nodejs
 */
export function hashPassword(password: string) {
  return createHash('sha256').update(password).digest('base64url');
}

/**
 * Creates a hash of the password using base64 (não URL-safe)
 * Compatível com hashes armazenados no Supabase (tabela users.password_hash)
 */
export function hashPasswordBase64(password: string) {
  return createHash('sha256').update(password).digest('base64');
}

