/**
 * Public API Router
 * Rotas públicas para Stream Deck/Companion (sem autenticação)
 */

import express, { type Request, type Response } from 'express';
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

export const publicRouter = express.Router();

console.log('✅ [PUBLIC-ROUTER] Router público criado para Stream Deck/Companion');

// PowerPoint endpoints
publicRouter.post('/powerpoint/toggle', togglePowerPointController);
console.log('✅ [PUBLIC-ROUTER] Rota POST /powerpoint/toggle registrada');

publicRouter.get('/powerpoint/toggle/status', getPowerPointStatusRESTController);
console.log('✅ [PUBLIC-ROUTER] Rota GET /powerpoint/toggle/status registrada');

publicRouter.get('/powerpoint/status/complete', getPowerPointCompleteStatusController);
console.log('✅ [PUBLIC-ROUTER] Rota GET /powerpoint/status/complete registrada');

publicRouter.get('/powerpoint/status/slide', getPowerPointSlideStatusController);
console.log('✅ [PUBLIC-ROUTER] Rota GET /powerpoint/status/slide registrada');

publicRouter.get('/powerpoint/status/slide/query', getPowerPointSlideQueryParamsController);
console.log('✅ [PUBLIC-ROUTER] Rota GET /powerpoint/status/slide/query registrada');

publicRouter.get('/powerpoint/status/video', getPowerPointVideoStatusController);
console.log('✅ [PUBLIC-ROUTER] Rota GET /powerpoint/status/video registrada');

// Rotas OSC para Companion
publicRouter.post('/powerpoint/osc/config', configureOscController);
console.log('✅ [PUBLIC-ROUTER] Rota POST /powerpoint/osc/config registrada');

publicRouter.post('/powerpoint/osc/start', startOscController);
console.log('✅ [PUBLIC-ROUTER] Rota POST /powerpoint/osc/start registrada');

publicRouter.post('/powerpoint/osc/stop', stopOscController);
console.log('✅ [PUBLIC-ROUTER] Rota POST /powerpoint/osc/stop registrada');

publicRouter.get('/powerpoint/osc/status', getOscStatusController);
console.log('✅ [PUBLIC-ROUTER] Rota GET /powerpoint/osc/status registrada');

// Supabase endpoints
publicRouter.post('/supabase/toggle', toggleSupabaseController);
console.log('✅ [PUBLIC-ROUTER] Rota POST /supabase/toggle registrada');

publicRouter.get('/supabase/toggle/status', getSupabaseToggleStatusController);
console.log('✅ [PUBLIC-ROUTER] Rota GET /supabase/toggle/status registrada');

// Health check
publicRouter.get('/', (_req: Request, res: Response) => {
  res.status(200).json({ message: 'Ontime Public API - Stream Deck endpoints' });
});
console.log('✅ [PUBLIC-ROUTER] Rota GET / (health check) registrada');

