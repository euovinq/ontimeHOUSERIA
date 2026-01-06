import { Request, Response } from 'express';
import { supabaseAdapter } from '../../adapters/SupabaseAdapter.js';
import { logger } from '../../classes/Logger.js';
import { LogOrigin } from 'houseriaapp-types';
import { socket } from '../../adapters/WebsocketAdapter.js';

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

export async function getActiveProjects(_req: Request, res: Response) {
  try {
    const projects = await supabaseAdapter.getActiveProjects();
    
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
    
    if (!projectCode) {
      return res.status(400).json({ 
        error: 'Project code is required' 
      });
    }
    
    const projectData = await supabaseAdapter.getProjectData(projectCode);
    
    if (!projectData) {
      return res.status(404).json({ 
        error: 'Project not found',
        projectCode 
      });
    }
    
    res.status(200).json({ 
      project: projectData
    });
  } catch (error) {
    logger.error(LogOrigin.Server, `Error getting project data: ${error}`);
    res.status(500).json({ 
      error: 'Failed to get project data'
    });
  }
}

/**
 * Loads a project from Supabase by project code and applies it to the current project
 */
export async function loadProjectFromSupabase(req: Request, res: Response) {
  try {
    const { projectCode } = req.params;
    
    if (!projectCode) {
      return res.status(400).json({ 
        error: 'Project code is required' 
      });
    }

    logger.info(LogOrigin.Server, `Loading project from Supabase: ${projectCode}`);
    
    // Check if Supabase is connected
    if (!supabaseAdapter.isConnectedToSupabase()) {
      return res.status(503).json({ 
        error: 'Supabase is not connected. Please configure and connect Supabase first.' 
      });
    }
    
    // Get project data from Supabase
    const projectData = await supabaseAdapter.getProjectData(projectCode);
    
    if (!projectData) {
      return res.status(404).json({ 
        error: `Project with code "${projectCode}" not found in Supabase`,
        projectCode 
      });
    }

    // Load and apply the project data
    const { loadProjectFromSupabaseData } = await import('../../services/project-service/ProjectService.js');
    await loadProjectFromSupabaseData(projectData);
    
    logger.info(LogOrigin.Server, `Project ${projectCode} loaded successfully from Supabase`);
    
    res.status(200).json({ 
      message: `Project ${projectCode} loaded successfully`
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(LogOrigin.Server, `Error loading project from Supabase: ${errorMessage}`);
    res.status(500).json({ 
      error: `Failed to load project: ${errorMessage}`
    });
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



