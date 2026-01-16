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
  startDiscoveryBroadcastController,
  stopDiscoveryBroadcastController,
  discoverServersController,
  getDiscoveryStatusController,
} from './powerpoint.controller.js';

export const router = express.Router();

// Rota principal de status (usa módulo nativo ou serviço Windows)
router.get('/status', getPowerPointStatusController);

// Rotas de configuração do serviço Windows
router.get('/windows/status', getWindowsStatusController);

router.post('/windows/config', configureWindowsController);

router.post('/windows/start', startWindowsController);

router.post('/windows/stop', stopWindowsController);

// Rotas para Stream Deck/Companion
router.post('/toggle', togglePowerPointController);

router.get('/toggle/status', getPowerPointStatusRESTController);

router.get('/status/complete', getPowerPointCompleteStatusController);

router.get('/status/slide', getPowerPointSlideStatusController);

router.get('/status/slide/query', getPowerPointSlideQueryParamsController);

router.get('/status/video', getPowerPointVideoStatusController);

// Rotas para serviço OSC (Companion)
router.post('/osc/config', configureOscController);

router.post('/osc/start', startOscController);

router.post('/osc/stop', stopOscController);

router.get('/osc/status', getOscStatusController);

// Rotas para serviço de descoberta UDP
router.post('/discovery/broadcast/start', startDiscoveryBroadcastController);

router.post('/discovery/broadcast/stop', stopDiscoveryBroadcastController);

router.get('/discovery/servers', discoverServersController);

router.get('/discovery/status', getDiscoveryStatusController);

