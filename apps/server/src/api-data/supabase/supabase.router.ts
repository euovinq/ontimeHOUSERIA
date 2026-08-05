import express from 'express';

import { 
  configureSupabase, 
  testSupabaseConnection, 
  getSupabaseStatus,
  getActiveProjects,
  getProjectData,
  toggleSupabaseController,
  getSupabaseToggleStatusController,
  getShareLinksController,
  addShareLinkController,
  removeShareLinkController,
} from './supabase.controller.js';
import { ensureSupabaseAuth } from './supabase.auth.middleware.js';

export const router = express.Router();

router.post('/configure', configureSupabase);
router.get('/test', testSupabaseConnection);
router.get('/status', getSupabaseStatus);
router.get('/projects', ensureSupabaseAuth, getActiveProjects);
router.get('/project/:projectCode', ensureSupabaseAuth, getProjectData);

// NÃO existe mais rota de limpeza. Havia `POST /cleanup`, que apagava todo
// projeto com mais de 2 dias sem atualização — e era a única rota deste
// arquivo SEM o `ensureSupabaseAuth`. Removida em 05/08/2026: projeto é
// histórico do cliente, e apagar é decisão dele, não de uma rotina.

// Links de edição multi-campo (edit_share_links)
router.get('/project/:projectCode/share-links', ensureSupabaseAuth, getShareLinksController);
router.post('/project/:projectCode/share-links', ensureSupabaseAuth, addShareLinkController);
router.delete('/project/:projectCode/share-links/:token', ensureSupabaseAuth, removeShareLinkController);

// Rotas para Stream Deck/Companion
router.post('/toggle', toggleSupabaseController);
router.get('/toggle/status', getSupabaseToggleStatusController);

