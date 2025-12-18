import { LogOrigin } from 'houseriaapp-types';
import { logger } from '../../classes/Logger.js';

export interface AuthSession {
  userId: string | number;
  isAdmin: boolean;
  createdAt: Date;
}

const sessions = new Map<string | number, AuthSession>();

/**
 * Registra/atualiza sessão de autenticação de um usuário.
 */
export function createAuthSession(userId: string | number, isAdmin: boolean): AuthSession {
  const session: AuthSession = {
    userId,
    isAdmin,
    createdAt: new Date(),
  };

  sessions.set(userId, session);

  logger.info(
    LogOrigin.Server,
    `[AUTH] Sessão criada para usuário ${String(userId)} (isAdmin=${isAdmin})`
  );

  return session;
}

export function getAuthSession(userId: string | number): AuthSession | undefined {
  return sessions.get(userId);
}

export function removeAuthSession(userId: string | number): void {
  if (sessions.delete(userId)) {
    logger.info(
      LogOrigin.Server,
      `[AUTH] Sessão removida para usuário ${String(userId)}`
    );
  }
}

export function getAllSessions(): AuthSession[] {
  return Array.from(sessions.values());
}


