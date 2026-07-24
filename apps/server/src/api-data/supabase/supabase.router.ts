import express from 'express';

import { 
  configureSupabase, 
  testSupabaseConnection, 
  getSupabaseStatus,
  getActiveProjects,
  cleanupOldProjects,
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
router.post('/cleanup', cleanupOldProjects);

// Links de edição multi-campo (edit_share_links)
router.get('/project/:projectCode/share-links', ensureSupabaseAuth, getShareLinksController);
router.post('/project/:projectCode/share-links', ensureSupabaseAuth, addShareLinkController);
router.delete('/project/:projectCode/share-links/:token', ensureSupabaseAuth, removeShareLinkController);

// Rotas para Stream Deck/Companion
router.post('/toggle', toggleSupabaseController);
router.get('/toggle/status', getSupabaseToggleStatusController);

