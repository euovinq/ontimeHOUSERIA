import { Request, Response } from 'express';
import { supabaseAdapter } from '../../adapters/SupabaseAdapter.js';
import { logger } from '../../classes/Logger.js';
import { LogOrigin } from 'houseriaapp-types';

export interface SupabaseConfigRequest {
  url: string;
  anonKey: string;
  tableName?: string;
  enabled: boolean;
}

export async function configureSupabase(req: Request<{}, {}, SupabaseConfigRequest>, res: Response) {
  try {
    const { url, anonKey, tableName, enabled } = req.body;

    if (!url || !anonKey) {
      return res.status(400).json({ 
        error: 'URL and anonKey are required' 
      });
    }

    // Initialize Supabase adapter
    supabaseAdapter.init({
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




