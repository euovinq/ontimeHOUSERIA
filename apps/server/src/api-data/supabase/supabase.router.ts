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
} from './supabase.controller.js';

export const router = express.Router();

router.post('/configure', configureSupabase);
router.get('/test', testSupabaseConnection);
router.get('/status', getSupabaseStatus);
router.get('/projects', getActiveProjects);
router.get('/project/:projectCode', getProjectData);
router.post('/cleanup', cleanupOldProjects);

// Rotas para Stream Deck/Companion
router.post('/toggle', toggleSupabaseController);
router.get('/toggle/status', getSupabaseToggleStatusController);

