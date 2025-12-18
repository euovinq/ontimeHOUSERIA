import express from 'express';
import { login } from './auth.controller.js';
import { validateLogin } from './auth.validation.js';

export const router = express.Router();

router.post('/login', validateLogin, login);


