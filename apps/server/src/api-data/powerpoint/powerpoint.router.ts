import express from 'express';
import {
  getPowerPointStatusController,
  getWindowsStatusController,
  configureWindowsController,
  startWindowsController,
  stopWindowsController,
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
} from './powerpoint.controller.js';

export const router = express.Router();

// Debug: Verificar se router está sendo criado
console.log('✅ [POWERPOINT-ROUTER] Router criado');

// Rota principal de status (usa módulo nativo ou serviço Windows)
router.get('/status', getPowerPointStatusController);
console.log('✅ [POWERPOINT-ROUTER] Rota GET /status registrada');

// Rotas de configuração do serviço Windows
router.get('/windows/status', getWindowsStatusController);
console.log('✅ [POWERPOINT-ROUTER] Rota GET /windows/status registrada');

router.post('/windows/config', configureWindowsController);
console.log('✅ [POWERPOINT-ROUTER] Rota POST /windows/config registrada');

router.post('/windows/start', startWindowsController);
console.log('✅ [POWERPOINT-ROUTER] Rota POST /windows/start registrada');

router.post('/windows/stop', stopWindowsController);
console.log('✅ [POWERPOINT-ROUTER] Rota POST /windows/stop registrada');

// Rotas para Stream Deck/Companion
router.post('/toggle', togglePowerPointController);
console.log('✅ [POWERPOINT-ROUTER] Rota POST /toggle registrada');

router.get('/toggle/status', getPowerPointStatusRESTController);
console.log('✅ [POWERPOINT-ROUTER] Rota GET /toggle/status registrada');

router.get('/status/complete', getPowerPointCompleteStatusController);
console.log('✅ [POWERPOINT-ROUTER] Rota GET /status/complete registrada');

router.get('/status/slide', getPowerPointSlideStatusController);
console.log('✅ [POWERPOINT-ROUTER] Rota GET /status/slide registrada');

router.get('/status/slide/query', getPowerPointSlideQueryParamsController);
console.log('✅ [POWERPOINT-ROUTER] Rota GET /status/slide/query registrada');

router.get('/status/video', getPowerPointVideoStatusController);
console.log('✅ [POWERPOINT-ROUTER] Rota GET /status/video registrada');

// Rotas para serviço OSC (Companion)
router.post('/osc/config', configureOscController);
console.log('✅ [POWERPOINT-ROUTER] Rota POST /osc/config registrada');

router.post('/osc/start', startOscController);
console.log('✅ [POWERPOINT-ROUTER] Rota POST /osc/start registrada');

router.post('/osc/stop', stopOscController);
console.log('✅ [POWERPOINT-ROUTER] Rota POST /osc/stop registrada');

router.get('/osc/status', getOscStatusController);
console.log('✅ [POWERPOINT-ROUTER] Rota GET /osc/status registrada');

