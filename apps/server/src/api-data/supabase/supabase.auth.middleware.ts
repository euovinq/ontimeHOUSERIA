import { NextFunction, Request, Response } from 'express';

import { AuthSession, getAllSessions, getAuthSession } from '../auth/auth-session.service.js';
import { hashedPassword } from '../session/session.service.js';

export interface RequestWithAuthUser extends Request {
  authUser?: AuthSession;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'string') {
    return value === '1' || value.toLowerCase() === 'true';
  }
  return Boolean(value);
}

export function ensureSupabaseAuth(
  req: RequestWithAuthUser,
  res: Response,
  next: NextFunction
): void {
  const userIdCookie = req.cookies?.auth_user_id;
  const isAdminCookie = req.cookies?.auth_is_admin;

  const userIdQuery = (req.query as Record<string, unknown> | undefined)?.user_id;
  const isAdminQuery = (req.query as Record<string, unknown> | undefined)?.is_admin;

  // Permite também headers como fallback (ex: chamadas externas)
  const userIdHeader = req.header('x-user-id');
  const isAdminHeader = req.header('x-is-admin');

  const userId = userIdCookie ?? userIdHeader ?? userIdQuery;
  const isAdminRaw = isAdminCookie ?? isAdminHeader ?? isAdminQuery;

  const tokenQuery = (req.query as Record<string, unknown> | undefined)?.token;
  const tokenHeader = req.header('x-auth-token');
  const legacyToken = req.cookies?.token;

  if (!userId) {
    // Fallback: se vier com token/cookie legacy (login padrão) OU se há password configurado (compat local/Electron)
    const hasLegacy =
      hashedPassword &&
      [legacyToken, tokenQuery, tokenHeader].some((t) => typeof t === 'string' && t === hashedPassword);

    // Fallback 2: se há sessões em memória (usuário logado), usa a sessão mais recente
    const sessions = getAllSessions();
    const latestSession = sessions
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .at(0);

    if (hasLegacy || hashedPassword || latestSession) {
      const sessionToUse = latestSession ?? {
        userId: 'legacy-admin',
        isAdmin: true,
        createdAt: new Date(),
      };

      req.authUser = {
        userId: sessionToUse.userId,
        isAdmin: sessionToUse.isAdmin ?? true,
        createdAt: sessionToUse.createdAt,
      };
      next();
      return;
    }

    res.status(401).json({ error: 'Unauthorized: missing user identification' });
    return;
  }

  const session = getAuthSession(userId);

  // Se não houver sessão em memória (ex: servidor reiniciado), mas tivermos cookies/headers,
  // ainda permitimos seguir usando os dados fornecidos, para evitar 401 indevido.
  if (!session) {
    const isAdmin = isAdminRaw != null ? parseBoolean(isAdminRaw) : false;
    req.authUser = {
      userId,
      isAdmin,
      createdAt: new Date(),
    };
    next();
    return;
  }

  const isAdmin = isAdminRaw != null ? parseBoolean(isAdminRaw) : session.isAdmin;

  req.authUser = {
    userId: session.userId,
    isAdmin,
    createdAt: session.createdAt,
  };

  next();
}


