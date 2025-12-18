import type { Request, Response } from 'express';
import { getErrorMessage } from 'houseriaapp-utils';
import { authenticateUser } from './auth.service.js';
import { registerLoginSession } from './auth-realtime.service.js';

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
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

    const successResult = result as { success: true; isAdmin: boolean; userId: string | number };

    // Cria/atualiza sessão de autenticação e inicia monitoramento do período (para não-admin)
    registerLoginSession(successResult.userId, successResult.isAdmin);
    return res.status(200).json({
      message: 'Login efetuado com sucesso.',
      isAdmin: successResult.isAdmin,
      userId: successResult.userId,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    return res.status(500).json({ message });
  }
}


