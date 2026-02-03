import type { Request, Response } from 'express';
import { getErrorMessage } from 'houseriaapp-utils';
import { logger } from '../../classes/Logger.js';
import { LogOrigin } from 'houseriaapp-types';
import { authenticateUser, type LoginResult } from './auth.service.js';
import { registerLoginSession } from './auth-realtime.service.js';

interface LicenseInfo {
  userId: string | number;
  isAdmin: boolean;
  licenseExpiresAt: string | null;
}

let lastLicenseInfo: LicenseInfo | null = null;

export async function login(req: Request, res: Response) {
  try {
    const { email, password, machineId: _machineId } = req.body as {
      email?: string;
      password?: string;
      machineId?: string;
    };

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: 'E-mail e senha são obrigatórios.' });
    }

    const result = await authenticateUser(email, password);

    if (!result.success) {
      const errorResult = result as { success: false; code: string; message: string };
      if (errorResult.code === 'invalid_credentials') {
        return res
          .status(401)
          .json({ message: errorResult.message, code: errorResult.code });
      }
      if (errorResult.code === 'period_expired') {
        return res
          .status(403)
          .json({ message: errorResult.message, code: errorResult.code });
      }
      // Se houver outro tipo de erro não tratado, retorna erro genérico
      return res
        .status(401)
        .json({ message: errorResult.message || 'Erro ao fazer login.' });
    }

    const successResult = result as Extract<LoginResult, { success: true }>;

    // Cria/atualiza sessão de autenticação e inicia monitoramento do período (para não-admin)
    try {
      registerLoginSession(successResult.userId, successResult.isAdmin);
    } catch (sessionError) {
      logger.error(
        LogOrigin.Server,
        `[AUTH] Erro ao registrar sessão de login: ${
          sessionError instanceof Error ? sessionError.message : String(sessionError)
        }`
      );
      // Não falhar o login se houver erro ao registrar sessão, apenas logar
    }

    // Cookies HttpOnly para identificar usuário nas próximas requisições protegidas
    res.cookie('auth_user_id', successResult.userId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24h
    });
    res.cookie('auth_is_admin', successResult.isAdmin ? '1' : '0', {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24h
    });

    // Guarda última info de licença para exibir no front
    lastLicenseInfo = {
      userId: successResult.userId,
      isAdmin: successResult.isAdmin,
      licenseExpiresAt: successResult.licenseExpiresAt ?? null,
    };
    return res.status(200).json({
      message: 'Login efetuado com sucesso.',
      isAdmin: successResult.isAdmin,
      userId: successResult.userId,
      licenseExpiresAt: successResult.licenseExpiresAt ?? null,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    const errorDetails = error instanceof Error ? {
      message: error.message,
      stack: error.stack,
      name: error.name,
    } : String(error);
    
    logger.error(
      LogOrigin.Server,
      `[AUTH] Erro no endpoint /auth/login: ${JSON.stringify(errorDetails, null, 2)}`
    );
    
    return res.status(500).json({ message });
  }
}

export function getLicenseInfo(_req: Request, res: Response) {
  if (!lastLicenseInfo) {
    return res.status(404).json({
      message: 'Nenhuma sessão autenticada no momento.',
    });
  }

  return res.status(200).json(lastLicenseInfo);
}

