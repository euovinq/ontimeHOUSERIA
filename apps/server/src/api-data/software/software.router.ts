import express from 'express';
import { getLatestVersion } from './software.controller.js';

export const softwareRouter = express.Router();

softwareRouter.get('/latest', (req, res, next) => {
  getLatestVersion(req, res).catch(next);
});
