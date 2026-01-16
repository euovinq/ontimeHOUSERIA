import { LogOrigin } from 'houseriaapp-types';

import express, { type Request, type Response, type NextFunction } from 'express';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { parse as parseCookie } from 'cookie';

import { hashPassword } from '../utils/hash.js';
import { srcFiles } from '../setup/index.js';
import { logger } from '../classes/Logger.js';
import { hashedPassword, hasPassword } from '../api-data/session/session.service.js';

import { noopMiddleware } from './noop.js';

/**
 * List of public assets that can be accessed without authentication
 * should match the files in client/public
 */
const publicAssets = new Set([
  '/favicon.ico',
  '/manifest.json',
  '/ontime-logo.png',
  '/robots.txt',
  '/site.webmanifest',
]);

export const loginRouter = express.Router();

// serve static files at root
loginRouter.use('/', express.static(srcFiles.login));

// verify password and set cookies + redirect appropriately
loginRouter.post('/', (req, res) => {
  res.clearCookie('token');
  const { password: reqPassword, redirect } = req.body;

  if (hashPassword(reqPassword) === hashedPassword) {
    setSessionCookie(res, hashedPassword);
    res.redirect(redirect || '/');
    return;
  }

  res.status(401).send('Unauthorized');
});

/**
 * Express middleware to authenticate requests
 * @param {string} prefix - Prefix is used for the client hashes in Ontime Cloud
 */
export function makeAuthenticateMiddleware(prefix: string) {
  // we dont need to initialise the authenticate middleware if there is no password
  if (!hasPassword) {
    return { authenticate: noopMiddleware, authenticateAndRedirect: noopMiddleware };
  }

  function authenticate(req: Request, res: Response, next: NextFunction) {
    // Rotas públicas - SEM autenticação
    if (
      req.path.startsWith('/api/public') ||
      req.path.startsWith('/api/') ||
      req.path.startsWith('/data/realtime') ||
      req.path.startsWith('/data/automations') ||
      req.path.startsWith('/data/custom-fields') ||
      req.path.startsWith('/data/db') ||
      req.path.startsWith('/data/project') ||
      req.path.startsWith('/data/settings') ||
      req.path.startsWith('/data/session') ||
      req.path.startsWith('/data/url-presets') ||
      req.path.startsWith('/data/view-settings') ||
      req.path.startsWith('/data/report') ||
      req.path.startsWith('/data/rundown') ||
      req.path.startsWith('/data/rundowns') ||
      req.path.startsWith('/auth')
    ) {
      console.log(`✅ [AUTH] Rota pública permitida sem autenticação: ${req.path}`);
      return next();
    }

    // Para rotas Supabase, deixamos a autenticação para o middleware específico (ensureSupabaseAuth)
    if (req.path.startsWith('/supabase')) {
      return next();
    }

    // Log apenas para rotas PowerPoint para debug
    if (req.path.includes('powerpoint')) {
      console.log('🔐 [AUTH] Autenticando requisição PowerPoint:', req.method, req.path);
      console.log('🔐 [AUTH] Token do query:', req.query.token);
      console.log('🔐 [AUTH] Token do cookie:', req.cookies?.token);
    }
    
    const token = req.query.token || req.cookies?.token;
    if (token && token === hashedPassword) {
      if (req.path.includes('powerpoint')) {
        console.log('✅ [AUTH] Autenticação OK para PowerPoint');
      }
      return next();
    }

    if (req.path.includes('powerpoint')) {
      console.error('❌ [AUTH] Autenticação FALHOU para PowerPoint - token não encontrado ou inválido');
    }
    res.status(401).send('Unauthorized');
  }

  function authenticateAndRedirect(req: Request, res: Response, next: NextFunction) {
    // Allow access to specific public assets without authentication
    if (publicAssets.has(req.originalUrl)) {
      return next();
    }

    // we shouldnt be here in the login route
    if (req.originalUrl.startsWith('/login')) {
      return next();
    }

    // we expect the token to be in the cookies
    if (req.cookies?.token === hashedPassword) {
      return next();
    }

    // we use query params for generating authenticated URLs and for clients like the companion module
    // if the user gives is a token in the query params, we set the cookie to be used in further requests
    if (req.query.token === hashedPassword) {
      setSessionCookie(res, hashedPassword);
      return next();
    }

    res.redirect(`${prefix}/login?redirect=${req.originalUrl}`);
  }

  return { authenticate, authenticateAndRedirect };
}

/**
 * Middleware to authenticate a WebSocket connection with a token in the cookie
 */
export function authenticateSocket(_ws: WebSocket, req: IncomingMessage, next: (error?: Error) => void) {
  if (!hasPassword) {
    return next();
  }

  // check if the token is in the cookie
  const cookieString = req.headers.cookie;
  if (typeof cookieString === 'string') {
    const cookies = parseCookie(cookieString);
    if (cookies.token === hashedPassword) {
      return next();
    }
  }

  // check if token is in the params
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  if (token === hashedPassword) {
    return next();
  }

  logger.warning(LogOrigin.Client, 'Unauthorized WebSocket connection attempt');
  return next(new Error('Unauthorized'));
}

function setSessionCookie(res: Response, token: string) {
  res.cookie('token', token, {
    httpOnly: false, // allow websocket to access cookie
    secure: process.env.NODE_ENV === 'production',
    path: '/', // allow cookie to be accessed from any path
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  });
}
