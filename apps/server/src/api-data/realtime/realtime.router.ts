import express from 'express';

import { getRealtimeData } from './realtime.controller.js';

export const router = express.Router();

router.get('/', getRealtimeData);




