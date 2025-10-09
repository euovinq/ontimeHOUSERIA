import express from 'express';

import { 
  configureSupabase, 
  testSupabaseConnection, 
  getSupabaseStatus,
  getActiveProjects,
  cleanupOldProjects,
  getProjectData
} from './supabase.controller.js';

export const router = express.Router();

router.post('/configure', configureSupabase);
router.get('/test', testSupabaseConnection);
router.get('/status', getSupabaseStatus);
router.get('/projects', getActiveProjects);
router.get('/project/:projectCode', getProjectData);
router.post('/cleanup', cleanupOldProjects);




