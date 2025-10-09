import { createClient } from '@supabase/supabase-js';
import { eventStore } from '../stores/EventStore.js';
import { logger } from '../classes/Logger.js';
import { LogOrigin } from 'ontime-types';
import { getDataProvider } from '../classes/data-provider/DataProvider.js';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { publicDir } from '../setup/index.js';
import { config } from 'dotenv';

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
  private lastSendTime: number = 0;
  private lastTimerState: string = 'stop';
  private lastProjectCode: string = '';
  private lastRundownHash: string = '';
  private lastDelayUpdate: number = 0;
  private readonly DELAY_UPDATE_DEBOUNCE = 1000; // 1 second
  private lastSkipLogType: string = '';
  private isInDelayMode: boolean = false;
  private accumulatedDelay: number = 0;
  private lastSentOffset: number = 0;

  constructor() {
    // Listen to eventStore changes with specific triggers
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

    if (envConfig.url && envConfig.anonKey) {
      this.init(envConfig);
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
   * Setup listener for eventStore changes with specific triggers
   */
  private setupEventStoreListener() {
    // Hook into the eventStore.set method to catch specific changes
    const originalSet = eventStore.set;
    
    eventStore.set = <T extends keyof any>(key: T, value: any) => {
      // Call original method
      originalSet.call(eventStore, key, value);
      
      // Check for specific triggers
      if (this.isConnected) {
        this.checkForTriggers(key, value);
      }
    };
  }

  /**
   * Check for specific triggers that require Supabase updates
   */
  private checkForTriggers(key: string | number | symbol, value: any) {
    const currentData = eventStore.poll();
    if (!currentData) return;

    // Get project code from DataProvider (not from eventStore)
    const projectData = getDataProvider().getProjectData();
    const projectCode = projectData?.projectCode || '';
    const rundown = getDataProvider().getRundown();
    
    // Only proceed if we have a valid project code and rundown
    if (!projectCode || !rundown || rundown.length === 0) {
      return; // Silent skip - project not ready
    }

    // Send initial project data when project is first loaded
    if (projectCode && this.lastProjectCode !== projectCode) {
      this.lastProjectCode = projectCode;
      logger.info(LogOrigin.Server, `Supabase: Project loaded - sending initial data for ${projectCode}`);
      this.handleProjectChange(currentData);
      // Reset delay update timer to prevent immediate delay update after project load
      this.lastDelayUpdate = Date.now();
      return; // Don't process other triggers on initial load
    }

    // Skip clock changes (not relevant for Supabase)
    if (key === 'clock') {
      return;
    }

    // Timer state changes - only trigger on actual play/pause/stop actions
    if (key === 'timer' && value?.playback) {
      // Skip timer_roll and roll (setting timer to start) - not a real state change
      if (value.playback === 'timer_roll' || value.playback === 'roll') {
        this.lastTimerState = 'roll';
        
        // Check if timer is in roll state but actually playing
        if (value.startedAt && value.current > 0) {
          // Only send once per roll session
          if (this.lastTimerState !== 'roll_playing') {
            logger.info(LogOrigin.Server, `Supabase: Detectou mudança e subindo para o Supabase - Timer iniciado`);
            this.lastTimerState = 'roll_playing';
            this.handleTimerStateChange('play', currentData);
          }
        }
        return;
      }
      
      if (this.lastTimerState !== value.playback) {
        // Special case: if timer was in roll state and now changed to play, this is a real state change
        if (this.lastTimerState === 'roll' && value.playback === 'play') {
          logger.info(LogOrigin.Server, `Supabase: Detectou mudança e subindo para o Supabase - Timer iniciado`);
          this.lastTimerState = value.playback;
          this.handleTimerStateChange(value.playback, currentData);
          return;
        }
        
        // Also check for other valid transitions from roll state
        if (this.lastTimerState === 'roll' && (value.playback === 'pause' || value.playback === 'stop')) {
          logger.info(LogOrigin.Server, `Supabase: Detectou mudança e subindo para o Supabase - Timer ${value.playback}`);
          this.lastTimerState = value.playback;
          this.handleTimerStateChange(value.playback, currentData);
          return;
        }
        
        // Check if this is a real timer state change (not just setting a timer)
        const isRealStateChange = this.isRealTimerStateChange(value, currentData);
        
        if (isRealStateChange) {
          logger.info(LogOrigin.Server, `Supabase: Detectou mudança e subindo para o Supabase - Timer ${value.playback}`);
          this.lastTimerState = value.playback;
          this.handleTimerStateChange(value.playback, currentData);
        }
      }
    }

    // Event changes (when a new event is loaded during playback)
    if (key === 'eventNow' && value) {
      logger.info(LogOrigin.Server, `Supabase: Detectou mudança e subindo para o Supabase - Evento mudou para ${value.title || value.id}`);
      
      // If we were in delay mode, send accumulated delay now
      if (this.isInDelayMode) {
        this.handleDelayChange(currentData);
        this.isInDelayMode = false;
        this.accumulatedDelay = 0;
      }
      
      // Only send timer state change if it's not roll/timer_roll
      const timerPlayback = currentData.timer?.playback || 'stop';
      if (timerPlayback !== 'roll' && (timerPlayback as string) !== 'timer_roll') {
        this.handleTimerStateChange(timerPlayback, currentData);
      }
    }

    // Rundown changes (events modified) - check DataProvider directly since eventStore doesn't contain rundown
    const rundownHash = this.calculateRundownHash(rundown);
    if (this.lastRundownHash !== rundownHash) {
      this.lastRundownHash = rundownHash;
      logger.info(LogOrigin.Server, `Supabase: Detectou mudança e subindo para o Supabase - Rundown atualizado`);
      this.handleRundownChange(currentData);
    }

    // Delay changes (offset/relativeOffset) - simple delay management
    if (key === 'runtime' && (value?.offset !== undefined || value?.relativeOffset !== undefined)) {
      const currentOffset = value?.offset || 0;
      
      // Check if this is a significant delay (more than 5 seconds)
      const isSignificantDelay = Math.abs(currentOffset) > 5000;
      
      // Check if user compensated (offset went back towards zero)
      const isCompensation = Math.abs(currentOffset) < Math.abs(this.lastSentOffset) && 
                            Math.abs(currentOffset) < Math.abs(this.accumulatedDelay);
      
      if (isCompensation) {
        // User compensated - reset delay mode and send immediately
        logger.info(LogOrigin.Server, `Supabase: Detectou delay - Usuário compensou delay, offset: ${currentOffset}`);
        this.isInDelayMode = false;
        this.accumulatedDelay = 0;
        this.lastSentOffset = currentOffset;
        this.handleDelayChange(currentData);
        return;
      }
      
      if (isSignificantDelay && !this.isInDelayMode) {
        // First significant delay detected - enter delay mode and send immediately
        logger.info(LogOrigin.Server, `Supabase: Detectou delay - Delay significativo iniciado, offset: ${currentOffset}`);
        this.isInDelayMode = true;
        this.accumulatedDelay = currentOffset;
        this.lastSentOffset = currentOffset;
        this.handleDelayChange(currentData);
        return;
      }
      
      if (this.isInDelayMode) {
        // In delay mode - just accumulate silently, don't send until event ends
        this.accumulatedDelay = currentOffset;
        return;
      }
      
      // Small delays - just log, don't send to Supabase
      logger.info(LogOrigin.Server, `Supabase: Detectou delay - Delay pequeno, offset: ${currentOffset} (não enviando para Supabase)`);
    }
  }

  /**
   * Check if this is a real timer state change (not just setting a timer)
   */
  private isRealTimerStateChange(timerValue: any, currentData: any): boolean {
    // If timer is being set to play but there's no current event, it's likely just setting a timer
    if (timerValue.playback === 'play' && !currentData.eventNow) {
      return false;
    }
    
    // If timer is being set to play but the timer value is 0 or very small, it's likely just setting a timer
    if (timerValue.playback === 'play' && (!timerValue.current || timerValue.current < 1000)) {
      return false;
    }
    
    // If timer is being set to play but there's no startedAt timestamp, it's likely just setting a timer
    if (timerValue.playback === 'play' && !timerValue.startedAt) {
      return false;
    }
    
    // All other cases are real state changes
    return true;
  }

  /**
   * Handle timer state changes (start/pause/stop)
   */
  private async handleTimerStateChange(playback: string, currentData: any) {
    logger.info(LogOrigin.Server, `Supabase: Timer state changed to ${playback}`);
    
    // Add a delay to ensure eventNow and eventNext are updated
    setTimeout(async () => {
      const updatedData = eventStore.poll();
      
      // When timer starts playing, delay should stop growing
      if (playback === 'play' && this.isInDelayMode) {
        const currentOffset = updatedData.runtime?.offset || 0;
        
        // Always reset delay mode when timer starts playing
        // This ensures delay stops growing when play is pressed
        this.isInDelayMode = false;
        this.accumulatedDelay = 0;
        this.lastSentOffset = currentOffset;
      }
      
      
      const payload = this.buildTimerPayload(updatedData, playback);
      await this.sendOptimizedData(payload);
    }, 200); // Increased delay to 200ms to allow eventStore to be fully updated
  }

  /**
   * Handle project changes (load/save)
   */
  private async handleProjectChange(currentData: any) {
    logger.info(LogOrigin.Server, `Supabase: Project changed to ${currentData.project?.projectCode}`);
    
    const payload = this.buildProjectPayload(currentData);
    await this.sendOptimizedData(payload);
  }

  /**
   * Handle rundown changes (events modified)
   */
  private async handleRundownChange(currentData: any) {
    logger.info(LogOrigin.Server, 'Supabase: Rundown changed');
    
    const payload = this.buildRundownPayload(currentData);
    await this.sendOptimizedData(payload);
  }

  /**
   * Handle delay changes
   */
  private async handleDelayChange(currentData: any) {
    logger.info(LogOrigin.Server, 'Supabase: Delay changed');
    
    const payload = this.buildDelayPayload(currentData);
    if (payload) {
      await this.sendOptimizedData(payload);
    }
  }

  /**
   * Calculate hash for rundown to detect changes
   */
  private calculateRundownHash(rundown: readonly any[]): string {
    if (!rundown || rundown.length === 0) return '';
    
    const hashData = rundown.map(event => ({
      id: event.id,
      title: event.title,
      timeStart: event.timeStart,
      timeEnd: event.timeEnd,
      duration: event.duration,
      colour: event.colour
    }));
    
    return JSON.stringify(hashData);
  }

  /**
   * Build timer-specific payload (COMPLETE - all data since Supabase doesn't support partial JSON updates)
   */
  private buildTimerPayload(data: any, playback: string) {
    const projectData = getDataProvider().getProjectData();
    const projectCode = projectData?.projectCode || '';
    const rundown = getDataProvider().getRundown();
    const customFields = getDataProvider().getCustomFields();
    const timer = data.timer || {};
    const runtime = data.runtime || {};

    // Send ALL data since Supabase upsert replaces the entire row
    return {
      projectCode,
      timestamp: Date.now(),
      status: `timer_${playback}`,
      project: {
        title: projectData?.title || '',
        projectCode: projectCode
      },
      cuesheet: {
        rundown: rundown || [],
        customFields: customFields || {},
        totalEvents: rundown ? rundown.length : 0,
        totalDuration: rundown ? rundown.reduce((total, event) => {
          if (event.type === 'event' && event.duration) {
            return total + event.duration;
          }
          return total;
        }, 0) : 0
      },
      timer: {
        startedAt: timer.startedAt || null, // Absolute timestamp when timer started (from HouseriaAPP)
        expectedFinish: timer.expectedFinish || null,
        duration: timer.duration || null,
        addedTime: timer.addedTime || 0,
        value: timer.current || timer.duration || 0,
        playback: playback,
        phase: timer.phase || 'none',
        // Timer is based on the current event's timeStart/timeEnd, not the old clock
        // The frontend calculates current time based on startedAt + elapsed time
        timestamp: Date.now() // When this timer value was calculated
      },
      delay: {
        offset: runtime.offset || 0,
        expectedEnd: runtime.expectedEnd || null,
        relativeOffset: runtime.relativeOffset || 0,
        status: this.isInDelayMode ? 'delay_subindo' : 'delay_parado'
      },
      currentEvent: this.getCurrentEvent(data),
      nextEvent: this.getNextEvent(data)
    };
  }

  /**
   * Build project-specific payload (COMPLETE - all fields for initialization)
   */
  private buildProjectPayload(data: any) {
    const projectData = getDataProvider().getProjectData();
    const projectCode = projectData?.projectCode || '';
    const rundown = getDataProvider().getRundown();
    const customFields = getDataProvider().getCustomFields();
    const timer = data.timer || {};
    const runtime = data.runtime || {};

    return {
      projectCode,
      timestamp: Date.now(),
      status: 'project_loaded',
      project: {
        title: projectData?.title || '',
        projectCode: projectCode
      },
      cuesheet: {
        rundown: rundown || [],
        customFields: customFields || {},
        totalEvents: rundown ? rundown.length : 0,
        totalDuration: rundown ? rundown.reduce((total, event) => {
          if (event.type === 'event' && event.duration) {
            return total + event.duration;
          }
          return total;
        }, 0) : 0
      },
      // Include ALL fields for proper incremental updates
      timer: {
        startedAt: timer.startedAt ? Date.now() - (timer.current || 0) : null, // Absolute timestamp when timer started
        expectedFinish: timer.expectedFinish || null,
        duration: timer.duration || null,
        addedTime: timer.addedTime || 0,
        value: timer.current || timer.duration || 0,
        playback: timer.playback || 'stop',
        phase: timer.phase || 'none',
        // Timer is based on the current event's timeStart/timeEnd, not the old clock
        // The frontend calculates current time based on startedAt + elapsed time
        timestamp: Date.now() // When this timer value was calculated
      },
      delay: {
        offset: runtime.offset || 0,
        expectedEnd: runtime.expectedEnd || null,
        relativeOffset: runtime.relativeOffset || 0,
        status: this.isInDelayMode ? 'delay_subindo' : 'delay_parado'
      },
      currentEvent: this.getCurrentEvent(data),
      nextEvent: this.getNextEvent(data)
    };
  }

  /**
   * Build rundown-specific payload (COMPLETE - all data since Supabase doesn't support partial JSON updates)
   */
  private buildRundownPayload(data: any) {
    const projectData = getDataProvider().getProjectData();
    const projectCode = projectData?.projectCode || '';
    const rundown = getDataProvider().getRundown();
    const customFields = getDataProvider().getCustomFields();
    const timer = data.timer || {};
    const runtime = data.runtime || {};

    // Send ALL data since Supabase upsert replaces the entire row
    return {
      projectCode,
      timestamp: Date.now(),
      status: 'events_updated',
      project: {
        title: projectData?.title || '',
        projectCode: projectCode
      },
      cuesheet: {
        rundown: rundown || [],
        customFields: customFields || {},
        totalEvents: rundown ? rundown.length : 0,
        totalDuration: rundown ? rundown.reduce((total, event) => {
          if (event.type === 'event' && event.duration) {
            return total + event.duration;
          }
          return total;
        }, 0) : 0
      },
      timer: {
        startedAt: timer.startedAt ? Date.now() - (timer.current || 0) : null, // Absolute timestamp when timer started
        expectedFinish: timer.expectedFinish || null,
        duration: timer.duration || null,
        addedTime: timer.addedTime || 0,
        value: timer.current || timer.duration || 0,
        playback: timer.playback || 'stop',
        phase: timer.phase || 'none',
        // Timer is based on the current event's timeStart/timeEnd, not the old clock
        // The frontend calculates current time based on startedAt + elapsed time
        timestamp: Date.now() // When this timer value was calculated
      },
      delay: {
        offset: runtime.offset || 0,
        expectedEnd: runtime.expectedEnd || null,
        relativeOffset: runtime.relativeOffset || 0,
        status: this.isInDelayMode ? 'delay_subindo' : 'delay_parado'
      },
      currentEvent: this.getCurrentEvent(data),
      nextEvent: this.getNextEvent(data)
    };
  }

  /**
   * Build delay-specific payload (COMPLETE - all data since Supabase doesn't support partial JSON updates)
   */
  private buildDelayPayload(data: any) {
    const projectData = getDataProvider().getProjectData();
    const projectCode = projectData?.projectCode || '';
    const rundown = getDataProvider().getRundown();
    const customFields = getDataProvider().getCustomFields();
    const timer = data.timer || {};
    const runtime = data.runtime || {};
    
    if (!projectCode) {
      logger.warning(LogOrigin.Server, 'Supabase: Cannot build delay payload - no project code');
      return null;
    }
    
    // Use accumulated delay if in delay mode, otherwise use current offset
    const delayOffset = this.isInDelayMode ? this.accumulatedDelay : (runtime.offset || 0);
    const delayRelativeOffset = this.isInDelayMode ? this.accumulatedDelay : (runtime.relativeOffset || 0);
    
    // Send ALL data since Supabase upsert replaces the entire row
    return {
      projectCode,
      timestamp: Date.now(),
      status: this.isInDelayMode ? 'delay_accumulated' : 'delay_updated',
      project: {
        title: projectData?.title || '',
        projectCode: projectCode
      },
      cuesheet: {
        rundown: rundown || [],
        customFields: customFields || {},
        totalEvents: rundown ? rundown.length : 0,
        totalDuration: rundown ? rundown.reduce((total, event) => {
          if (event.type === 'event' && event.duration) {
            return total + event.duration;
          }
          return total;
        }, 0) : 0
      },
      timer: {
        startedAt: timer.startedAt ? Date.now() - (timer.current || 0) : null, // Absolute timestamp when timer started
        expectedFinish: timer.expectedFinish || null,
        duration: timer.duration || null,
        addedTime: timer.addedTime || 0,
        value: timer.current || timer.duration || 0,
        playback: timer.playback || 'stop',
        phase: timer.phase || 'none',
        // Timer is based on the current event's timeStart/timeEnd, not the old clock
        // The frontend calculates current time based on startedAt + elapsed time
        timestamp: Date.now() // When this timer value was calculated
      },
      delay: {
        offset: delayOffset,
        expectedEnd: runtime.expectedEnd || null,
        relativeOffset: delayRelativeOffset,
        status: this.isInDelayMode ? 'delay_subindo' : 'delay_parado'
      },
      currentEvent: this.getCurrentEvent(data),
      nextEvent: this.getNextEvent(data)
    };
  }

  /**
   * Get current event from data
   */
  private getCurrentEvent(data: any) {
    const currentEvent = data.eventNow;
    if (!currentEvent) return null;
    
    return {
      id: currentEvent.id,
      cue: currentEvent.cue,
      title: currentEvent.title,
      note: currentEvent.note,
      timeStart: currentEvent.timeStart,
      timeEnd: currentEvent.timeEnd,
      duration: currentEvent.duration,
      isPublic: currentEvent.isPublic,
      colour: currentEvent.colour,
      custom: currentEvent.custom || {}
    };
  }

  /**
   * Get next event from data
   */
  private getNextEvent(data: any) {
    const nextEvent = data.eventNext;
    if (!nextEvent) return null;
    
    return {
      id: nextEvent.id,
      cue: nextEvent.cue,
      title: nextEvent.title,
      note: nextEvent.note,
      timeStart: nextEvent.timeStart,
      timeEnd: nextEvent.timeEnd,
      duration: nextEvent.duration,
      isPublic: nextEvent.isPublic,
      colour: nextEvent.colour,
      custom: nextEvent.custom || {}
    };
  }

  /**
   * Send optimized data to Supabase
   */
  private async sendOptimizedData(payload: any) {
    if (!this.isConnected || !this.supabase || !this.config) {
      return;
    }

    try {
      logger.info(LogOrigin.Server, `Sending ${payload.status} to Supabase for project: ${payload.projectCode}`);

      const { data: result, error } = await this.supabase
        .from(this.config.tableName || 'ontime_realtime')
        .upsert({
          id: payload.projectCode,
          data: payload,
          project_code: payload.projectCode,
          updated_at: new Date().toISOString()
        });

      if (error) {
        logger.error(LogOrigin.Server, `Supabase upsert error: ${error.message}`);
      } else {
        logger.info(LogOrigin.Server, `Supabase ${payload.status} sent successfully`);
        this.lastSendTime = Date.now();
      }
    } catch (error) {
      logger.error(LogOrigin.Server, `Supabase send error: ${error}`);
    }
  }

  /**
   * Send initial project data to Supabase (only on project load)
   */
  private async sendToSupabase() {
    if (!this.isConnected || !this.supabase || !this.config) {
      return;
    }

    try {
      const currentData = eventStore.poll();
      
      if (!currentData) {
        logger.warning(LogOrigin.Server, 'Supabase: Skipping initial send - no data available');
        return;
      }
      
      const rundown = getDataProvider().getRundown();
      if (!rundown || rundown.length === 0) {
        logger.warning(LogOrigin.Server, 'Supabase: Skipping initial send - rundown not ready');
        return;
      }
      
      // Send initial project data
      const payload = this.buildProjectPayload(currentData);
      await this.sendOptimizedData(payload);
      
      logger.info(LogOrigin.Server, 'Initial project data sent to Supabase');
    } catch (error) {
      logger.error(LogOrigin.Server, `Supabase initial send error: ${error}`);
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
      logger.error(LogOrigin.Server, `Failed to save Supabase config: ${error}`);
    }
  }

  /**
   * Load configuration from file
   */
  async loadConfig(): Promise<SupabaseConfig | null> {
    try {
      const configData = await readFile(this.configFilePath, 'utf-8');
      const config = JSON.parse(configData);
      this.init(config);
      return config;
    } catch (error) {
      logger.warning(LogOrigin.Server, 'No saved Supabase configuration found');
      return null;
    }
  }

  /**
   * Clean up old projects from Supabase
   */
  private async cleanupOldProjects() {
    if (!this.isConnected || !this.supabase || !this.config) {
      return;
    }

    try {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const { error } = await this.supabase
        .from(this.config.tableName || 'ontime_realtime')
        .delete()
        .lt('updated_at', twoDaysAgo.toISOString());

      if (error) {
        logger.error(LogOrigin.Server, `Supabase cleanup error: ${error.message}`);
      } else {
        logger.info(LogOrigin.Server, 'Supabase: Cleaned up old projects');
      }
    } catch (error) {
      logger.error(LogOrigin.Server, `Supabase cleanup error: ${error}`);
    }
  }

  /**
   * Get current connection status
   */
  isConnectedToSupabase(): boolean {
    return this.isConnected;
  }

  /**
   * Disconnect from Supabase
   */
  disconnect() {
    this.isConnected = false;
    this.supabase = null;
    this.config = null;
    logger.info(LogOrigin.Server, 'Supabase adapter disconnected');
  }

  /**
   * Test connection to Supabase
   */
  async testConnection(): Promise<boolean> {
    if (!this.isConnected || !this.supabase) {
      return false;
    }

    try {
      const { data, error } = await this.supabase
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
   * Get active projects from Supabase
   */
  async getActiveProjects(): Promise<any[]> {
    if (!this.isConnected || !this.supabase) {
      return [];
    }

    try {
      const { data, error } = await this.supabase
        .from(this.config?.tableName || 'ontime_realtime')
        .select('id, project_code, updated_at')
        .order('updated_at', { ascending: false });

      if (error) {
        logger.error(LogOrigin.Server, `Error getting active projects: ${error.message}`);
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error(LogOrigin.Server, `Error getting active projects: ${error}`);
      return [];
    }
  }

  /**
   * Get project data by project code
   */
  async getProjectData(projectCode: string): Promise<any | null> {
    if (!this.isConnected || !this.supabase) {
      return null;
    }

    try {
      const { data, error } = await this.supabase
        .from(this.config?.tableName || 'ontime_realtime')
        .select('data')
        .eq('project_code', projectCode)
        .single();

      if (error) {
        logger.error(LogOrigin.Server, `Error getting project data: ${error.message}`);
        return null;
      }

      return data?.data || null;
    } catch (error) {
      logger.error(LogOrigin.Server, `Error getting project data: ${error}`);
      return null;
    }
  }

  /**
   * Delete project record by project code
   */
  async deleteProjectRecord(projectCode: string): Promise<boolean> {
    if (!this.isConnected || !this.supabase) {
      return false;
    }

    try {
      const { error } = await this.supabase
        .from(this.config?.tableName || 'ontime_realtime')
        .delete()
        .eq('project_code', projectCode);

      if (error) {
        logger.error(LogOrigin.Server, `Error deleting project record: ${error.message}`);
        return false;
      }

      logger.info(LogOrigin.Server, `Deleted Supabase record for project: ${projectCode}`);
      return true;
    } catch (error) {
      logger.error(LogOrigin.Server, `Error deleting project record: ${error}`);
      return false;
    }
  }
}

// Export singleton instance
export const supabaseAdapter = new SupabaseAdapter();


