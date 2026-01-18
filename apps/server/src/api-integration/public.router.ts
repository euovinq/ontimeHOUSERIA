/**
 * Public API Router
 * Rotas públicas para Stream Deck/Companion (sem autenticação)
 */

import express, { type Request, type Response } from 'express';
import { LogOrigin } from 'houseriaapp-types';
import { 
  togglePowerPointController, 
  getPowerPointStatusRESTController,
  getPowerPointCompleteStatusController,
  getPowerPointSlideStatusController,
  getPowerPointVideoStatusController,
  getPowerPointSlideQueryParamsController,
  configureOscController,
  startOscController,
  stopOscController,
  getOscStatusController,
} from '../api-data/powerpoint/powerpoint.controller.js';
import { 
  toggleSupabaseController, 
  getSupabaseToggleStatusController 
} from '../api-data/supabase/supabase.controller.js';
import { dispatchFromAdapter } from './integration.controller.js';
import { integrationPayloadFromPath } from '../adapters/utils/parse.js';
import { isEmptyObject } from '../utils/parserUtils.js';
import { logger } from '../classes/Logger.js';
import { getErrorMessage } from 'houseriaapp-utils';

export const publicRouter = express.Router();

// ============================================
// Endpoints públicos básicos de controle do timer (para Companion)
// ============================================
/**
 * Handler genérico para endpoints de controle público
 * Reutiliza a mesma lógica do integrationRouter mas sem autenticação
 */
const handlePublicControlAction = async (req: Request, res: Response, action: string) => {
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
    console.error(`❌ [PUBLIC-ROUTER] Erro ao processar ação ${action}:`, errorMessage);
    logger.error(LogOrigin.Rx, `HTTP IN (Public): ${errorMessage}`);
    res.status(500).json({ message: errorMessage, action });
  }
};

// Health check (deve ser registrado primeiro para não ser capturado pelo fallback)
publicRouter.get('/', (req: Request, res: Response) => {
  res.status(200).json({ 
    message: 'Ontime Public API - Stream Deck/Companion endpoints',
    endpoints: {
      control: [
        'GET /api/public/start',
        'GET /api/public/pause',
        'GET /api/public/stop',
        'GET /api/public/poll',
        'GET /api/public/load',
        'GET /api/public/roll',
        'GET /api/public/reload',
        'GET /api/public/addtime',
      ],
      powerpoint: [
        'POST /api/public/powerpoint/toggle',
        'GET /api/public/powerpoint/toggle',
        'GET /api/public/powerpoint/toggle/status',
        'GET /api/public/togglepowerpoint',
        'GET /api/public/getpowerpointstatus',
        'GET /api/public/powerpoint/status/complete',
      ],
      supabase: [
        'POST /api/public/supabase/toggle',
        'GET /api/public/supabase/toggle',
        'GET /api/public/supabase/toggle/status',
        'GET /api/public/togglesupabase',
        'GET /api/public/getsupabasestatus',
      ],
    },
  });
});

// PowerPoint endpoints (rotas específicas antes do fallback genérico)
publicRouter.post('/powerpoint/toggle', togglePowerPointController);

publicRouter.get('/powerpoint/toggle', togglePowerPointController);

publicRouter.get('/powerpoint/toggle/status', getPowerPointStatusRESTController);

publicRouter.get('/powerpoint/status/complete', getPowerPointCompleteStatusController);

publicRouter.get('/powerpoint/status/slide', getPowerPointSlideStatusController);

publicRouter.get('/powerpoint/status/slide/query', getPowerPointSlideQueryParamsController);

publicRouter.get('/powerpoint/status/video', getPowerPointVideoStatusController);

// Rotas OSC para Companion
publicRouter.post('/powerpoint/osc/config', configureOscController);

publicRouter.post('/powerpoint/osc/start', startOscController);

publicRouter.post('/powerpoint/osc/stop', stopOscController);

publicRouter.get('/powerpoint/osc/status', getOscStatusController);

// Supabase endpoints
publicRouter.post('/supabase/toggle', toggleSupabaseController);

publicRouter.get('/supabase/toggle', toggleSupabaseController);

publicRouter.get('/supabase/toggle/status', getSupabaseToggleStatusController);

// Rotas GET públicas para toggle via integration handlers (para Companion)
publicRouter.get('/togglesupabase', async (req, res) => {
  await handlePublicControlAction(req, res, 'togglesupabase');
});

publicRouter.get('/togglepowerpoint', async (req, res) => {
  await handlePublicControlAction(req, res, 'togglepowerpoint');
});

publicRouter.get('/getsupabasestatus', async (req, res) => {
  await handlePublicControlAction(req, res, 'getsupabasestatus');
});

publicRouter.get('/getpowerpointstatus', async (req, res) => {
  await handlePublicControlAction(req, res, 'getpowerpointstatus');
});

// Endpoints básicos de controle do timer (GET) - fallback genérico
// Processa qualquer ação de controle (start, pause, stop, poll, load, roll, reload, addtime, etc.)
// Deve ser registrado por último para não capturar rotas específicas acima
publicRouter.get('/*', async (req: Request, res: Response) => {
  // Ignora rotas já tratadas acima (powerpoint, supabase, toggle específicos)
  // Mas permite rotas específicas que foram registradas acima
  if (
    req.path.startsWith('/powerpoint/') || 
    (req.path.startsWith('/supabase/') && req.path !== '/supabase/toggle') ||
    req.path === '/togglesupabase' ||
    req.path === '/togglepowerpoint' ||
    req.path === '/getsupabasestatus' ||
    req.path === '/getpowerpointstatus'
  ) {
    return res.status(404).json({ error: 'Route not found' });
  }
  
  // Extrai a ação do path (ex: /start -> 'start', /start/next -> 'start')
  const action = req.path.substring(1).split('/')[0];
  if (!action) {
    return res.status(400).json({ error: 'No action found' });
  }
  
  await handlePublicControlAction(req, res, action);
});

