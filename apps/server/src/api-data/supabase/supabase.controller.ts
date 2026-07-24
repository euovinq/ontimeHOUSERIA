import { Request, Response } from 'express';
import { supabaseAdapter } from '../../adapters/SupabaseAdapter.js';
import { logger } from '../../classes/Logger.js';
import { LogOrigin } from 'houseriaapp-types';
import { socket } from '../../adapters/WebsocketAdapter.js';
import { AuthSession } from '../auth/auth-session.service.js';
import { RequestWithAuthUser } from './supabase.auth.middleware.js';

export interface SupabaseConfigRequest {
  url: string;
  anonKey: string;
  tableName?: string;
  enabled: boolean;
}

export async function configureSupabase(
  req: Request<Record<string, unknown>, Record<string, unknown>, SupabaseConfigRequest>,
  res: Response
) {
  try {
    const { url, anonKey, tableName, enabled } = req.body;

    if (!url || !anonKey) {
      return res.status(400).json({ 
        error: 'URL and anonKey are required' 
      });
    }

    // Initialize Supabase adapter
    await supabaseAdapter.init({
      url,
      anonKey,
      tableName: tableName || 'ontime_realtime',
      enabled
    });

    // Test connection
    const isConnected = await supabaseAdapter.testConnection();
    
    if (isConnected) {
      logger.info(LogOrigin.Server, 'Supabase configuration successful');
      res.status(200).json({ 
        message: 'Supabase configured successfully',
        connected: true,
        tableName: tableName || 'ontime_realtime'
      });
    } else {
      logger.error(LogOrigin.Server, 'Supabase connection test failed');
      res.status(400).json({ 
        error: 'Failed to connect to Supabase. Please check your credentials.',
        connected: false
      });
    }
  } catch (error) {
    logger.error(LogOrigin.Server, `Supabase configuration error: ${error}`);
    res.status(500).json({ 
      error: 'Internal server error',
      connected: false
    });
  }
}

export async function testSupabaseConnection(_req: Request, res: Response) {
  try {
    const isConnected = await supabaseAdapter.testConnection();
    
    res.status(200).json({ 
      connected: isConnected,
      message: isConnected ? 'Connection successful' : 'Connection failed'
    });
  } catch (error) {
    logger.error(LogOrigin.Server, `Supabase test error: ${error}`);
    res.status(500).json({ 
      error: 'Test failed',
      connected: false
    });
  }
}

export async function getSupabaseStatus(_req: Request, res: Response) {
  try {
    const isConnected = await supabaseAdapter.testConnection();
    
    res.status(200).json({ 
      connected: isConnected,
      status: isConnected ? 'active' : 'inactive'
    });
  } catch (error) {
    res.status(200).json({ 
      connected: false,
      status: 'error'
    });
  }
}

export async function getActiveProjects(req: Request, res: Response) {
  try {
    const authUser = (req as RequestWithAuthUser).authUser as AuthSession | undefined;

    if (!authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const projects = await supabaseAdapter.getActiveProjects(authUser);
    
    res.status(200).json({ 
      projects,
      count: projects.length
    });
  } catch (error) {
    logger.error(LogOrigin.Server, `Error getting active projects: ${error}`);
    res.status(500).json({ 
      error: 'Failed to get active projects',
      projects: []
    });
  }
}

export async function cleanupOldProjects(_req: Request, res: Response) {
  try {
    // Force cleanup of old projects
    await supabaseAdapter.cleanupOldProjects();
    
    res.status(200).json({ 
      message: 'Cleanup completed successfully'
    });
  } catch (error) {
    logger.error(LogOrigin.Server, `Error during cleanup: ${error}`);
    res.status(500).json({ 
      error: 'Cleanup failed'
    });
  }
}

export async function getProjectData(req: Request, res: Response) {
  try {
    const { projectCode } = req.params;
    
    // Sanitizar projectCode (trim + uppercase)
    const sanitizedCode = (projectCode || '').trim().toUpperCase();
    
    if (!sanitizedCode) {
      return res.status(400).json({ 
        error: 'Project code is required' 
      });
    }
    
    const authUser = (req as RequestWithAuthUser).authUser as AuthSession | undefined;

    if (!authUser) {
      return res.status(401).json({ 
        error: 'Unauthorized' 
      });
    }
    
    logger.info(LogOrigin.Server, `🔍 Buscando projeto: ${sanitizedCode} (usuário: ${authUser.userId})`);

    const connectionStatus = supabaseAdapter.getConnectionStatus();
    const projectRecord = connectionStatus.connected
      ? await supabaseAdapter.getProjectData(sanitizedCode)
      : await supabaseAdapter.getProjectDataReadOnly(sanitizedCode);
    
    if (!projectRecord) {
      logger.info(LogOrigin.Server, `❌ Projeto não encontrado: ${sanitizedCode}`);
      
      // Tenta listar projetos disponíveis para debug (apenas para admin)
      let availableProjects: any[] = [];
      if (authUser.isAdmin) {
        try {
          availableProjects = await supabaseAdapter.getActiveProjects({ userId: authUser.userId, isAdmin: true });
          logger.info(LogOrigin.Server, `📋 Projetos disponíveis no banco: ${availableProjects.length}`);
        } catch (err) {
          // Ignora erro ao listar projetos
        }
      }
      
      return res.status(404).json({ 
        error: 'Project not found',
        projectCode: sanitizedCode,
        message: `Nenhum projeto encontrado com o código: ${sanitizedCode}`,
        ...(authUser.isAdmin && availableProjects.length > 0 ? {
          hint: 'Projetos disponíveis no banco',
          availableProjects: availableProjects.map(p => ({
            id: p.id,
            project_code: p.project_code || '(vazio)',
            updated_at: p.updated_at
          }))
        } : {})
      });
    }

    const isAdmin = Boolean(authUser.isAdmin);
    const isOwner = projectRecord.user_id != null && projectRecord.user_id === authUser.userId;

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        error: 'not_owner',
        message: 'Você não é o proprietário deste projeto.',
      });
    }
    
    res.status(200).json({ 
      project: projectRecord.data,
      edit_access_codes: projectRecord.edit_access_codes ?? undefined,
    });
  } catch (error) {
    logger.error(LogOrigin.Server, `Error getting project data: ${error}`);
    res.status(500).json({ 
      error: 'Failed to get project data'
    });
  }
}

/** Valida acesso do usuário ao projeto (dono ou admin) para gerir share links. */
async function assertProjectAccess(
  req: Request,
  res: Response,
): Promise<{ sanitizedCode: string } | null> {
  const { projectCode } = req.params;
  const sanitizedCode = (projectCode || '').trim().toUpperCase();
  if (!sanitizedCode) {
    res.status(400).json({ error: 'Project code is required' });
    return null;
  }
  const authUser = (req as RequestWithAuthUser).authUser as AuthSession | undefined;
  if (!authUser) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const connectionStatus = supabaseAdapter.getConnectionStatus();
  const projectRecord = connectionStatus.connected
    ? await supabaseAdapter.getProjectData(sanitizedCode)
    : await supabaseAdapter.getProjectDataReadOnly(sanitizedCode);
  if (!projectRecord) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }
  const isAdmin = Boolean(authUser.isAdmin);
  const isOwner = projectRecord.user_id != null && projectRecord.user_id === authUser.userId;
  if (!isAdmin && !isOwner) {
    res.status(403).json({ error: 'not_owner', message: 'Você não é o proprietário deste projeto.' });
    return null;
  }
  return { sanitizedCode };
}

/** Lista os links de edição multi-campo do projeto. */
export async function getShareLinksController(req: Request, res: Response) {
  try {
    const access = await assertProjectAccess(req, res);
    if (!access) return;
    const links = await supabaseAdapter.getShareLinks(access.sanitizedCode);
    res.status(200).json({ links });
  } catch (error) {
    logger.error(LogOrigin.Server, `Error listing share links: ${error}`);
    res.status(500).json({ error: 'Failed to list share links' });
  }
}

/** Cria um novo link de edição multi-campo. */
export async function addShareLinkController(req: Request, res: Response) {
  try {
    const access = await assertProjectAccess(req, res);
    if (!access) return;
    const { fields, label } = req.body as { fields?: unknown; label?: unknown };
    const cleanFields = Array.isArray(fields) ? fields.filter((f): f is string => typeof f === 'string') : [];
    if (cleanFields.length === 0) {
      return res.status(400).json({ error: 'Informe ao menos um campo.' });
    }
    const link = await supabaseAdapter.addShareLink(
      access.sanitizedCode,
      cleanFields,
      typeof label === 'string' ? label : undefined,
    );
    if (!link) return res.status(500).json({ error: 'Falha ao gerar link.' });
    res.status(200).json({ link });
  } catch (error) {
    logger.error(LogOrigin.Server, `Error adding share link: ${error}`);
    res.status(500).json({ error: 'Failed to add share link' });
  }
}

/** Revoga (remove) um link de edição multi-campo pelo token. */
export async function removeShareLinkController(req: Request, res: Response) {
  try {
    const access = await assertProjectAccess(req, res);
    if (!access) return;
    const token = (req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Token é obrigatório.' });
    const ok = await supabaseAdapter.removeShareLink(access.sanitizedCode, token);
    if (!ok) return res.status(500).json({ error: 'Falha ao revogar link.' });
    res.status(200).json({ success: true });
  } catch (error) {
    logger.error(LogOrigin.Server, `Error removing share link: ${error}`);
    res.status(500).json({ error: 'Failed to remove share link' });
  }
}

/**
 * Controller para toggle do Supabase via REST API (Stream Deck)
 */
export async function toggleSupabaseController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const wasConnected = supabaseAdapter.getConnectionStatus().connected;
    const isConnected = supabaseAdapter.toggleConnection();
    
    // Aguarda um delay maior para garantir que init() completo foi executado
    // (init() é assíncrono e chama testConnection() que também é assíncrono)
    await new Promise(resolve => setTimeout(resolve, 800));
    
    const status = supabaseAdapter.getConnectionStatus();
    
    logger.info(
      LogOrigin.Server,
      `📡 Supabase toggle REST - Status obtido após toggle: ${JSON.stringify(status)}`
    );
    logger.info(
      LogOrigin.Server,
      `📡 Supabase toggle REST - isConnected retornado: ${String(isConnected)}`
    );
    logger.info(
      LogOrigin.Server,
      `📡 Supabase toggle REST - Era conectado antes: ${String(wasConnected)}`
    );
    
    // O status final deve ser o oposto do que era antes (toggle)
    // Mas também verifica getConnectionStatus() que é mais confiável após o delay
    const finalStatus = {
      connected: Boolean(status.connected),
      enabled: Boolean(status.enabled),
    };
    
    // Se getConnectionStatus() ainda não atualizou (raro), usa o toggle como fallback
    if (!finalStatus.connected && !wasConnected && isConnected) {
      finalStatus.connected = true;
      finalStatus.enabled = true;
      logger.info(LogOrigin.Server, `📡 Supabase toggle REST - Usando fallback: status baseado no toggle`);
    }
    
    logger.info(
      LogOrigin.Server,
      `📡 Supabase toggle REST - Status final a ser enviado: ${JSON.stringify(finalStatus)}`
    );
    
    // Envia atualização via WebSocket para todos os clientes conectados
    socket.sendAsJson({
      type: 'togglesupabase',
      payload: finalStatus,
    });
    logger.info(LogOrigin.Server, `✅ Supabase toggle REST - Mensagem WebSocket enviada`);
    
    logger.info(LogOrigin.Server, `🔄 Supabase toggle REST: ${finalStatus.connected ? 'Conectado' : 'Desconectado'}`);
    
    res.status(200).json({
      success: true,
      connected: finalStatus.connected,
      enabled: finalStatus.enabled,
      message: finalStatus.connected ? 'Supabase conectado' : 'Supabase desconectado',
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ Supabase toggle REST - Erro: ${errorMsg}`);
    res.status(500).json({
      success: false,
      error: errorMsg,
      connected: false,
      enabled: false,
    });
  }
}

/**
 * Controller para obter status do Supabase via REST API
 */
export async function getSupabaseToggleStatusController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const status = supabaseAdapter.getConnectionStatus();
    
    res.status(200).json({
      success: true,
      connected: status.connected,
      enabled: status.enabled,
      message: status.connected ? 'Supabase está conectado' : 'Supabase está desconectado',
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error(LogOrigin.Server, `❌ Supabase status REST - Erro: ${errorMsg}`);
    res.status(500).json({
      success: false,
      error: errorMsg,
      connected: false,
      enabled: false,
    });
  }
}



