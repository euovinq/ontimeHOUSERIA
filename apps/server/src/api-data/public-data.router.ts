/**
 * Public Data Router
 * Rotas públicas de leitura em /data/ para Companion/Stream Deck
 * Apenas rotas de leitura (GET) - sem modificação de dados
 * Necessárias para o módulo oficial do Ontime funcionar
 */

import express from 'express';
import { getRealtimeData } from './realtime/realtime.controller.js';
import { getAutomationSettings } from './automation/automation.controller.js';
import { getCustomFields } from './custom-fields/customFields.controller.js';
import { currentProjectDownload } from './db/db.controller.js';
import { getProjectData } from './project/project.controller.js';
import { getSettings } from './settings/settings.controller.js';
import { getSessionStats, getInfo } from './session/session.controller.js';
import { getUrlPresets } from './url-presets/urlPresets.controller.js';
import { getViewSettings } from './view-settings/viewSettings.controller.js';
import { getAll as getReportAll } from './report/report.controller.js';
import { rundownGetAll, rundownGetNormalised } from './rundown/rundown.controller.js';

export const publicDataRouter = express.Router();

// Middleware de log para todas as rotas públicas de dados
publicDataRouter.use((req, res, next) => {
  next();
});

// Rotas públicas de leitura (GET apenas) - necessárias para módulo oficial do Ontime

// GET /data/realtime - Dados em tempo real
publicDataRouter.get('/realtime', (req, res, next) => {
  getRealtimeData(req, res).catch(next);
});

// GET /data/automations - Configurações de automação
publicDataRouter.get('/automations', (req, res, _next) => {
  getAutomationSettings(req, res);
});

// GET /data/custom-fields - Campos customizados
publicDataRouter.get('/custom-fields', (req, res, next) => {
  getCustomFields(req, res).catch(next);
});

// GET /data/db - Download do projeto atual
publicDataRouter.get('/db', (req, res, next) => {
  currentProjectDownload(req, res).catch(next);
});

// GET /data/project - Dados do projeto
publicDataRouter.get('/project', (req, res, _next) => {
  getProjectData(req, res);
});

// GET /data/settings - Configurações
publicDataRouter.get('/settings', (req, res, next) => {
  getSettings(req, res).catch(next);
});

// GET /data/session - Estatísticas de sessão
publicDataRouter.get('/session', (req, res, next) => {
  getSessionStats(req, res).catch(next);
});

// GET /data/session/info - Informações da sessão
publicDataRouter.get('/session/info', (req, res, next) => {
  getInfo(req, res).catch(next);
});

// GET /data/url-presets - Presets de URL
publicDataRouter.get('/url-presets', (req, res, next) => {
  getUrlPresets(req, res).catch(next);
});

// GET /data/view-settings - Configurações de visualização
publicDataRouter.get('/view-settings', (req, res, next) => {
  getViewSettings(req, res).catch(next);
});

// GET /data/report - Relatórios
publicDataRouter.get('/report', (req, res, _next) => {
  getReportAll(req, res);
});

// GET /data/rundown - Todos os eventos (GET /data/rundown)
publicDataRouter.get('/rundown', (req, res, next) => {
  rundownGetAll(req, res).catch(next);
});

// GET /data/rundown/normalised - Rundown normalizado
publicDataRouter.get('/rundown/normalised', (req, res, next) => {
  rundownGetNormalised(req, res).catch(next);
});

// GET /data/rundowns - Alias para compatibilidade com módulo oficial (plural)
publicDataRouter.get('/rundowns', (req, res, next) => {
  rundownGetAll(req, res).catch(next);
});

// GET /data/rundowns/current - Rundown atual (alias para normalised)
publicDataRouter.get('/rundowns/current', (req, res, next) => {
  rundownGetNormalised(req, res).catch(next);
});
