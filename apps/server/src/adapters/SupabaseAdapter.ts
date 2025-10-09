import { createClient } from '@supabase/supabase-js';
import { eventStore } from '../stores/EventStore.js';
import { logger } from '../classes/Logger.js';
import { LogOrigin } from 'ontime-types';
import { getDataProvider } from '../classes/data-provider/DataProvider.js';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { publicDir } from '../setup/index.js';
import { config } from 'dotenv';
import { throttle } from '../utils/throttle.js';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  tableName?: string;
  enabled?: boolean;
}

export class SupabaseAdapter {
  private supabase: any = null;
  private config: SupabaseConfig | null = null;
  private isConnected = false;
  private lastSentData: any = null;
  private configFilePath: string;
  private throttledSend: any;
  private lastSendTime: number = 0;
  private readonly MIN_SEND_INTERVAL = 2000; // 2 segundos mínimo entre envios

  constructor() {
    // Create throttled send function (max 1 send per 2 seconds)
    this.throttledSend = throttle(this.sendToSupabase.bind(this), this.MIN_SEND_INTERVAL);
    
    // Listen to eventStore changes
    this.setupEventStoreListener();
    
    // Set config file path
    this.configFilePath = join(publicDir.root, 'supabase-config.json');
    
    // Load environment variables
    config({ path: join(process.cwd(), 'supabase.env') });
    
    // Try to load config from environment or saved file
    this.loadConfigFromEnv();
  }

  /**
   * Load configuration from environment variables
   */
  private loadConfigFromEnv() {
    const envConfig: SupabaseConfig = {
      url: process.env.SUPABASE_URL || '',
      anonKey: process.env.SUPABASE_ANON_KEY || '',
      tableName: process.env.SUPABASE_TABLE_NAME || 'ontime_realtime',
      enabled: process.env.SUPABASE_ENABLED === 'true'
    };

    if (envConfig.enabled && envConfig.url && envConfig.anonKey) {
      logger.info(LogOrigin.Server, 'Loading Supabase configuration from environment variables');
      this.init(envConfig);
    } else {
      // Fallback to saved config file
      this.loadConfig();
    }
  }

  /**
   * Load saved configuration from file
   */
  private async loadConfig() {
    try {
      const configData = await readFile(this.configFilePath, 'utf-8');
      const savedConfig = JSON.parse(configData);
      
      if (savedConfig.enabled && savedConfig.url && savedConfig.anonKey) {
        logger.info(LogOrigin.Server, 'Loading saved Supabase configuration');
        this.init(savedConfig);
      }
    } catch (error) {
      // Config file doesn't exist or is invalid, that's ok
      logger.info(LogOrigin.Server, 'No saved Supabase configuration found');
    }
  }

  /**
   * Save configuration to file
   */
  private async saveConfig(config: SupabaseConfig) {
    try {
      await writeFile(this.configFilePath, JSON.stringify(config, null, 2));
      logger.info(LogOrigin.Server, 'Supabase configuration saved');
    } catch (error) {
      logger.error(LogOrigin.Server, `Failed to save Supabase configuration: ${error}`);
    }
  }

  /**
   * Initialize Supabase connection
   */
  init(config: SupabaseConfig) {
    if (!config.enabled || !config.url || !config.anonKey) {
      logger.info(LogOrigin.Server, 'Supabase adapter disabled or missing config');
      logger.info(LogOrigin.Server, `Config details - enabled: ${config.enabled}, url: ${config.url ? 'SET' : 'MISSING'}, anonKey: ${config.anonKey ? 'SET' : 'MISSING'}`);
      return;
    }

    try {
      this.config = config;
      this.supabase = createClient(config.url, config.anonKey);
      this.isConnected = true;
      
      logger.info(LogOrigin.Server, `Supabase adapter initialized for table: ${config.tableName || 'ontime_realtime'}`);
      logger.info(LogOrigin.Server, `Supabase URL: ${config.url}`);
      logger.info(LogOrigin.Server, `Supabase anonKey: ${config.anonKey.substring(0, 20)}...`);
      
      // Save configuration
      this.saveConfig(config);
      
      // Send initial data
      this.sendToSupabase();
    } catch (error) {
      logger.error(LogOrigin.Server, `Failed to initialize Supabase: ${error}`);
      this.isConnected = false;
    }
  }

  /**
   * Setup listener for eventStore changes
   */
  private setupEventStoreListener() {
    // We'll hook into the eventStore.set method to catch changes
    const originalSet = eventStore.set;
    
    eventStore.set = <T extends keyof any>(key: T, value: any) => {
      // Call original method
      originalSet.call(eventStore, key, value);
      
      // Send to Supabase if connected (with throttling)
      if (this.isConnected) {
        this.throttledSend();
      }
    };
  }

  /**
   * Send current data to Supabase
   */
  private async sendToSupabase() {
    if (!this.isConnected || !this.supabase || !this.config) {
      return;
    }

    // Additional throttling check
    const now = Date.now();
    if (now - this.lastSendTime < this.MIN_SEND_INTERVAL) {
      logger.info(LogOrigin.Server, 'Supabase: Throttling - too soon since last send');
      return;
    }

    try {
      const currentData = eventStore.poll();
      
      // Check if data is valid before processing
      if (!currentData) {
        logger.warning(LogOrigin.Server, 'Supabase: Skipping send - eventStore.poll() returned null/undefined');
        return;
      }
      
      // Debug: Log what we're getting from eventStore
      logger.info(LogOrigin.Server, `Supabase: eventStore.poll() returned: ${JSON.stringify(Object.keys(currentData))}`);
      
      // The eventStore doesn't contain rundown directly - we need to get it from DataProvider
      const rundown = getDataProvider().getRundown();
      if (!rundown || rundown.length === 0) {
        logger.warning(LogOrigin.Server, 'Supabase: Skipping send - rundown not ready yet');
        return;
      }
      
      // Only send if data has actually changed
      if (this.hasDataChanged(currentData)) {
        const realtimeData = this.transformToRealtimeFormat(currentData);
        
        logger.info(LogOrigin.Server, `Sending data to Supabase with cuesheet: ${realtimeData.cuesheet.totalEvents} events`);
        logger.info(LogOrigin.Server, `Project code being sent: ${realtimeData.project?.projectCode || 'EMPTY'}`);
        
        const projectCode = realtimeData.project?.projectCode || '';
        const currentTime = new Date().toISOString();
        
        // Use project_code as unique identifier instead of 'current'
        const { data: result, error } = await this.supabase
          .from(this.config.tableName || 'ontime_realtime')
          .upsert({
            id: projectCode, // Use project_code as unique identifier
            data: realtimeData,
            project_code: projectCode,
            updated_at: currentTime
          });

        if (error) {
          logger.error(LogOrigin.Server, `Supabase upsert error: ${error.message}`);
          logger.error(LogOrigin.Server, `Supabase error details: ${JSON.stringify(error)}`);
        } else {
          logger.info(LogOrigin.Server, `Supabase upsert result: ${JSON.stringify(result)}`);
          this.lastSentData = JSON.parse(JSON.stringify(currentData));
          this.lastSentData.rundown = getDataProvider().getRundown(); // Store rundown for comparison
          this.lastSentData.project = getDataProvider().getProjectData(); // Store project data for comparison
          this.lastSendTime = now; // Update last send time
          logger.info(LogOrigin.Server, 'Data sent to Supabase successfully');
          
          // Clean up old projects (older than 2 days) - run occasionally
          if (Math.random() < 0.1) { // 10% chance to run cleanup
            this.cleanupOldProjects();
          }
        }
      }
    } catch (error) {
      logger.error(LogOrigin.Server, `Supabase send error: ${error}`);
    }
  }

  /**
   * Check if data has changed since last send
   */
  private hasDataChanged(currentData: any): boolean {
    if (!this.lastSentData) {
      return true;
    }

    // Compare key fields that matter for realtime (optimized)
    const keyFields = ['timer', 'eventNow', 'eventNext', 'runtime', 'clock', 'onAir'];
    
    for (const field of keyFields) {
      if (JSON.stringify(currentData[field]) !== JSON.stringify(this.lastSentData[field])) {
        logger.info(LogOrigin.Server, `Supabase: Data changed in field: ${field}`);
        return true;
      }
    }
    
    // Check if project data has changed (including projectCode)
    const currentProject = getDataProvider().getProjectData();
    const lastProject = this.lastSentData.project;
    
    if (JSON.stringify(currentProject) !== JSON.stringify(lastProject)) {
      return true;
    }
    
    // Check rundown changes more efficiently (only check length and first few events)
    const currentRundown = getDataProvider().getRundown();
    const lastRundown = this.lastSentData.rundown;
    
    if (!lastRundown || currentRundown.length !== lastRundown.length) {
      logger.info(LogOrigin.Server, 'Supabase: Rundown length changed');
      return true;
    }

    // Only check first 3 events for changes (most important ones)
    const eventsToCheck = Math.min(currentRundown.length, 3);
    for (let i = 0; i < eventsToCheck; i++) {
      const currentEvent = currentRundown[i];
      const lastEvent = lastRundown[i];
      
      if (!lastEvent || 
          currentEvent.title !== lastEvent.title ||
          currentEvent.timeStart !== lastEvent.timeStart ||
          currentEvent.timeEnd !== lastEvent.timeEnd ||
          currentEvent.colour !== lastEvent.colour) {
        logger.info(LogOrigin.Server, `Supabase: Event ${i} changed`);
        return true;
      }
    }
    
    logger.info(LogOrigin.Server, 'Supabase: No significant data changes detected');
    return false;
  }

  /**
   * Transform Ontime data to our realtime format
   */
  private transformToRealtimeFormat(data: any) {
    const timer = data.timer || {};
    const currentEvent = data.eventNow;
    const nextEvent = data.eventNext;
    const runtime = data.runtime || {};

    // Get rundown data
    const rundown = getDataProvider().getRundown();
    const customFields = getDataProvider().getCustomFields();
    const projectData = getDataProvider().getProjectData();

    return {
      timer: {
        current: timer.current || null,
        duration: timer.duration || null,
        playback: timer.playback || 'Stop',
        phase: timer.phase || 'Stopped',
        elapsed: timer.elapsed || null,
        expectedFinish: timer.expectedFinish || null,
        startedAt: timer.startedAt || null,
        finishedAt: timer.finishedAt || null,
        addedTime: timer.addedTime || 0,
      },
      currentEvent: currentEvent ? {
        id: currentEvent.id,
        cue: currentEvent.cue,
        title: currentEvent.title,
        note: currentEvent.note,
        timeStart: currentEvent.timeStart,
        timeEnd: currentEvent.timeEnd,
        duration: currentEvent.duration,
        isPublic: currentEvent.isPublic,
        colour: currentEvent.colour,
        custom: currentEvent.custom || {},
      } : null,
      nextEvent: nextEvent ? {
        id: nextEvent.id,
        cue: nextEvent.cue,
        title: nextEvent.title,
        note: nextEvent.note,
        timeStart: nextEvent.timeStart,
        timeEnd: nextEvent.timeEnd,
        duration: nextEvent.duration,
        isPublic: nextEvent.isPublic,
        colour: nextEvent.colour,
        custom: nextEvent.custom || {},
      } : null,
      delay: {
        offset: runtime.offset || 0,
        relativeOffset: runtime.relativeOffset || 0,
        expectedEnd: runtime.expectedEnd || null,
      },
      clock: data.clock || 0,
      onAir: data.onAir || false,
      // Project information
      project: {
        title: projectData?.title || '',
        projectCode: projectData?.projectCode || '',
      },
      // Cuesheet completo
      cuesheet: {
        rundown: rundown || [],
        customFields: customFields || {},
        totalEvents: rundown ? rundown.length : 0,
        totalDuration: rundown ? rundown.reduce((total, event) => {
          if (event.type === 'event' && event.duration) {
            return total + event.duration;
          }
          return total;
        }, 0) : 0,
      },
    };
  }

  /**
   * Clean up old projects (older than 2 days)
   */
  async cleanupOldProjects() {
    if (!this.isConnected || !this.supabase || !this.config) {
      return;
    }

    try {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const cutoffTime = twoDaysAgo.toISOString();

      logger.info(LogOrigin.Server, `Cleaning up projects older than ${cutoffTime}`);

      const { error } = await this.supabase
        .from(this.config.tableName || 'ontime_realtime')
        .delete()
        .lt('updated_at', cutoffTime);

      if (error) {
        logger.error(LogOrigin.Server, `Supabase cleanup error: ${error.message}`);
      } else {
        logger.info(LogOrigin.Server, 'Old projects cleaned up successfully');
      }
    } catch (error) {
      logger.error(LogOrigin.Server, `Cleanup error: ${error}`);
    }
  }

  /**
   * Delete a specific project record by project code
   */
  async deleteProjectRecord(projectCode: string) {
    if (!this.isConnected || !this.supabase || !this.config) {
      logger.warning(LogOrigin.Server, 'Cannot delete project record: Supabase not connected');
      return;
    }

    try {
      logger.info(LogOrigin.Server, `Deleting Supabase record for project code: ${projectCode}`);

      const { error } = await this.supabase
        .from(this.config.tableName || 'ontime_realtime')
        .delete()
        .eq('id', projectCode);

      if (error) {
        logger.error(LogOrigin.Server, `Failed to delete project record ${projectCode}: ${error.message}`);
        throw error;
      } else {
        logger.info(LogOrigin.Server, `Successfully deleted project record: ${projectCode}`);
      }
    } catch (error) {
      logger.error(LogOrigin.Server, `Error deleting project record ${projectCode}: ${error}`);
      throw error;
    }
  }

  /**
   * Get list of active projects in Supabase
   */
  async getActiveProjects(): Promise<Array<{id: string, project_code: string, updated_at: string}>> {
    if (!this.isConnected || !this.supabase || !this.config) {
      return [];
    }

    try {
      const { data, error } = await this.supabase
        .from(this.config.tableName || 'ontime_realtime')
        .select('id, project_code, updated_at')
        .order('updated_at', { ascending: false });

      if (error) {
        logger.error(LogOrigin.Server, `Error fetching active projects: ${error.message}`);
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error(LogOrigin.Server, `Error fetching active projects: ${error}`);
      return [];
    }
  }

  /**
   * Get specific project data including project name and event colors
   */
  async getProjectData(projectCode: string): Promise<any> {
    if (!this.isConnected || !this.supabase || !this.config) {
      logger.warning(LogOrigin.Server, 'Cannot get project data: Supabase not connected');
      return null;
    }

    try {
      logger.info(LogOrigin.Server, `Fetching project data for: ${projectCode}`);

      const { data, error } = await this.supabase
        .from(this.config.tableName || 'ontime_realtime')
        .select('*')
        .eq('project_code', projectCode)
        .single();

      if (error) {
        logger.error(LogOrigin.Server, `Error fetching project data for ${projectCode}: ${error.message}`);
        return null;
      }

      if (!data) {
        logger.warning(LogOrigin.Server, `No data found for project: ${projectCode}`);
        return null;
      }

      // Extract and format the data
      const projectData = {
        projectCode: data.project_code,
        projectName: data.data?.project?.title || 'Sem nome',
        lastUpdated: data.updated_at,
        currentEvent: data.data?.currentEvent || null,
        nextEvent: data.data?.nextEvent || null,
        timer: data.data?.timer || null,
        onAir: data.data?.onAir || false,
        clock: data.data?.clock || 0,
        cuesheet: {
          totalEvents: data.data?.cuesheet?.totalEvents || 0,
          totalDuration: data.data?.cuesheet?.totalDuration || 0,
          events: data.data?.cuesheet?.rundown?.map((event: any) => ({
            id: event.id,
            cue: event.cue,
            title: event.title,
            note: event.note,
            timeStart: event.timeStart,
            timeEnd: event.timeEnd,
            duration: event.duration,
            colour: event.colour,
            isPublic: event.isPublic,
            type: event.type
          })) || []
        }
      };

      logger.info(LogOrigin.Server, `Successfully fetched project data for ${projectCode}: ${projectData.cuesheet.totalEvents} events`);
      return projectData;
    } catch (error) {
      logger.error(LogOrigin.Server, `Error fetching project data for ${projectCode}: ${error}`);
      return null;
    }
  }

  /**
   * Test Supabase connection
   */
  async testConnection(): Promise<boolean> {
    if (!this.isConnected || !this.supabase) {
      return false;
    }

    try {
      const { error } = await this.supabase
        .from(this.config?.tableName || 'ontime_realtime')
        .select('id')
        .limit(1);
      
      return !error;
    } catch (error) {
      logger.error(LogOrigin.Server, `Supabase connection test failed: ${error}`);
      return false;
    }
  }

  /**
   * Shutdown adapter
   */
  shutdown() {
    this.isConnected = false;
    this.supabase = null;
    this.config = null;
    logger.info(LogOrigin.Server, 'Supabase adapter shutdown');
  }
}

// Export singleton instance
export const supabaseAdapter = new SupabaseAdapter();
