/**
 * Public Timer Control Router
 * TODAS as rotas de controle estão públicas (sem autenticação)
 * Aceita qualquer ação disponível no dispatcher
 */

import express, { type Request, type Response } from 'express';
import { LogOrigin } from 'houseriaapp-types';
import { logger } from '../classes/Logger.js';
import { integrationPayloadFromPath } from '../adapters/utils/parse.js';
import { dispatchFromAdapter } from './integration.controller.js';
import { getErrorMessage } from 'houseriaapp-utils';
import { isEmptyObject } from '../utils/parserUtils.js';

export const publicTimerControlRouter = express.Router();

/**
 * Handler genérico para TODAS as ações públicas
 * Aceita qualquer ação disponível no dispatcher
 */
const handlePublicTimerAction = async (req: Request, res: Response, action: string) => {
  try {
    const query = isEmptyObject(req.query) ? undefined : (req.query as object);
    let payload: unknown = undefined;
    
    // Se há parâmetros na URL (ex: /start/next), processa como path
    const pathParts = req.path.split('/').filter(p => p && p !== action);
    if (pathParts.length > 0) {
      const parsed = integrationPayloadFromPath(pathParts, query);
      payload = parsed !== null ? parsed : (query || undefined);
    } else {
      payload = query || undefined;
    }
    
    const reply = await dispatchFromAdapter(action, payload, 'http');
    res.status(202).json(reply);
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error(LogOrigin.Rx, `HTTP IN (Public Timer): ${errorMessage}`);
    res.status(500).json({ message: errorMessage });
  }
};

// Health check na raiz do /api (deve vir ANTES do catch-all)
publicTimerControlRouter.get('/', (req: Request, res: Response) => {
  console.log(`✅ [PUBLIC-TIMER] Health check capturado: GET /api/`);
  res.status(200).json({ 
    message: 'You have reached Ontime API server',
    public: true,
    note: 'TODAS as rotas de controle estão públicas',
    endpoints: {
      public: '/api/public/*',
      all: '/api/* (qualquer ação)',
    }
  });
});

// Catch-all para TODAS as ações - torna todas as rotas públicas
// Captura qualquer ação: /start, /pause, /message, /change, /auxtimer, /client, etc.
publicTimerControlRouter.get('/*', async (req: Request, res: Response) => {
  // Extrai a ação do path (ex: /start -> 'start', /start/next -> 'start', /message -> 'message')
  let action = req.path.substring(1).split('/')[0];
  
  if (!action) {
    // Se não há ação, já foi tratado pelo health check na raiz
    return res.status(400).json({ error: 'No action found' });
  }
  
  console.log(`✅ [PUBLIC-TIMER] Requisição pública capturada: GET /api${req.path} | Ação: ${action} | IP: ${req.ip} | Origin: ${req.headers.origin || 'N/A'}`);
  
  try {
    await handlePublicTimerAction(req, res, action);
  } catch (error) {
    console.error(`❌ [PUBLIC-TIMER] Erro ao processar ação ${action}:`, error);
    const errorMessage = getErrorMessage(error);
    res.status(500).json({ message: errorMessage, action });
  }
});

console.log('✅ [PUBLIC-TIMER-ROUTER] TODAS as rotas de controle estão públicas (catch-all ativado)');
