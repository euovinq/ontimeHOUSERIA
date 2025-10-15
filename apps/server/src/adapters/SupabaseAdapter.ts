import { createClient } from '@supabase/supabase-js';
import { eventStore } from '../stores/EventStore.js';
import { logger } from '../classes/Logger.js';
import { LogOrigin } from 'houseriaapp-types';
import { getDataProvider } from '../classes/data-provider/DataProvider.js';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { publicDir } from '../setup/index.js';

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
  
  // Debouncing variables to prevent duplicate sends
  private lastTimerSendTime: number = 0;
  private lastDelaySendTime: number = 0;
  private lastDelayOffset: number = 0;
  private lastRollPlayEventId: string | null = null; // Track which event already sent timer_play during roll
  private lastPlayEventId: string | null = null; // Track which event already sent timer_play manually
  private lastAddedTime: number = 0;
  private lastAddedTimeSendTime: number = 0;
  
  // Performance optimization
  private lastSentPayloadHash: string = '';
  private globalThrottleTime: number = 0;
  private readonly GLOBAL_THROTTLE_MS = 200; // Max 5 sends per second
  private readonly DELAY_DEBOUNCE_MS = 2000; // Increased from 500ms to 2s

  constructor() {
    // Listen to eventStore changes with specific triggers
    this.setupEventStoreListener();
    
    // Set config file path
    this.configFilePath = join(publicDir.root, 'supabase-config.json');
    
    // Load hardcoded configuration
    this.loadConfigFromEnv();
  }

  /**
   * Load configuration from hardcoded values (fallback to env if needed)
   */
  private loadConfigFromEnv() {
    // Hardcoded Supabase configuration
    const hardcodedConfig: SupabaseConfig = {
      url: 'https://gxcgwhscnroiizjwswqv.supabase.co',
      anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4Y2d3aHNjbnJvaWl6andzd3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4MDMwNjMsImV4cCI6MjA3NTM3OTA2M30.suNBGtPXUr0YY8BaJEHcSja2m-vdxuCrA2CdOPip5fg',
      tableName: 'ontime_realtime',
      enabled: false
    };

    // Fallback to environment variables if hardcoded values are empty
    const envConfig: SupabaseConfig = {
      url: hardcodedConfig.url || process.env.SUPABASE_URL || '',
      anonKey: hardcodedConfig.anonKey || process.env.SUPABASE_ANON_KEY || '',
      tableName: hardcodedConfig.tableName || process.env.SUPABASE_TABLE_NAME || 'ontime_realtime',
      enabled: hardcodedConfig.enabled !== undefined ? hardcodedConfig.enabled : (process.env.SUPABASE_ENABLED === 'true')
    };

    // Use console.log instead of logger during initialization
    console.log(`Supabase config - URL: ${envConfig.url ? 'SET' : 'NOT SET'}, Key: ${envConfig.anonKey ? 'SET' : 'NOT SET'}, Enabled: ${envConfig.enabled}`);

    if (envConfig.url && envConfig.anonKey) {
      console.log('Supabase configuration loaded');
      this.init(envConfig);
    } else {
      console.warn('Supabase configuration not found');
    }
  }

  /**
   * Initialize Supabase connection
   */
  init(config: SupabaseConfig) {
    if (!config.enabled || !config.url || !config.anonKey) {
      console.log('Supabase adapter disabled or missing config');
      console.log(`Config details - enabled: ${config.enabled}, url: ${config.url ? 'SET' : 'MISSING'}, anonKey: ${config.anonKey ? 'SET' : 'MISSING'}`);
      return;
    }

    try {
      this.config = config;
      this.supabase = createClient(config.url, config.anonKey);
      this.isConnected = true;
      
      console.log(`Supabase adapter initialized for table: ${config.tableName || 'ontime_realtime'}`);
      console.log(`Supabase URL: ${config.url}`);
      console.log(`Supabase anonKey: ${config.anonKey.substring(0, 20)}...`);
      
      // Save configuration
      this.saveConfig(config);
      
      // Send initial data
      this.sendToSupabase();
    } catch (error) {
      console.error(`Failed to initialize Supabase: ${error}`);
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

    // Timer addedTime changes (add/remove time buttons) - WITH DEBOUNCING
    if (key === 'timer' && value?.addedTime !== undefined) {
      const currentAddedTime = value.addedTime;
      const now = Date.now();
      
      // Debouncing: only send if addedTime actually changed and enough time passed
      if (currentAddedTime !== this.lastAddedTime && now - this.lastAddedTimeSendTime > 100) {
        const currentPlayback = currentData.timer?.playback || 'stop';
        logger.info(LogOrigin.Server, `Supabase: Detectou mudança no addedTime - enviando timer atualizado (addedTime: ${currentAddedTime}, playback: ${currentPlayback})`);
        this.handleTimerStateChange(currentPlayback, currentData, { force: true });
        
        this.lastAddedTime = currentAddedTime;
        this.lastAddedTimeSendTime = now;
      }
    }

    // Timer state changes - SIMPLIFIED APPROACH
    if (key === 'timer' && value?.playback) {
      // Special handling for roll state - check if event is actually playing
      if (value.playback === 'roll' || value.playback === 'timer_roll') {
        // Check if event is actually playing during roll (startedAt exists and timer is counting)
        if (this.isEventActuallyPlaying(currentData)) {
          const currentEventId = currentData.eventNow?.id;
          
          // Only send timer_play once per event during roll
          if (currentEventId && this.lastRollPlayEventId !== currentEventId) {
            logger.info(LogOrigin.Server, `Supabase: Evento ${currentEventId} tocando durante roll - enviando timer_play`);
            this.handleTimerStateChange('play', currentData, { force: true });
            this.lastRollPlayEventId = currentEventId;
          }
        }
        return; // Don't process roll state normally
      }
      
      // Always send timer state changes, but with smart detection
      const shouldSend = this.shouldSendTimerState(value.playback, currentData);
      
      if (shouldSend) {
        // Special handling for play state - avoid spam
        if (value.playback === 'play') {
          const currentEventId = currentData.eventNow?.id;
          
          // Only send play once per event
          if (currentEventId && this.lastPlayEventId === currentEventId) {
            return; // Already sent for this event
          }
          
          this.lastPlayEventId = currentEventId;
          this.lastRollPlayEventId = null; // Reset roll tracking when manually playing
        }
        
        logger.info(LogOrigin.Server, `Supabase: Detectou mudança e subindo para o Supabase - Timer ${value.playback}`);
        this.handleTimerStateChange(value.playback, currentData, { force: true });
        this.lastTimerState = value.playback;
      }
    }

    // Event changes (when a new event is loaded during playback)
    if (key === 'eventNow' && value) {
      logger.info(LogOrigin.Server, `Supabase: Detectou mudança e subindo para o Supabase - Evento mudou para ${value.title || value.id}`);
      
      // Reset play tracking when event changes
      this.lastPlayEventId = null;
      this.lastRollPlayEventId = null;
      
      // If we were in delay mode, send accumulated delay now
      if (this.isInDelayMode) {
        this.handleDelayChange(currentData);
        this.isInDelayMode = false;
        this.accumulatedDelay = 0;
      }
      
      // Send timer state when event changes (simplified)
      const timerPlayback = currentData.timer?.playback || 'stop';
      const shouldSend = this.shouldSendTimerState(timerPlayback, currentData);
      
      if (shouldSend) {
        logger.info(LogOrigin.Server, `Supabase: Evento mudou - enviando timer ${timerPlayback}`);
        this.handleTimerStateChange(timerPlayback, currentData, { force: true });
        this.lastTimerState = timerPlayback;
      }
    }

    // Rundown changes (events modified) - check DataProvider directly since eventStore doesn't contain rundown
    const rundownHash = this.calculateRundownHash(rundown);
    if (this.lastRundownHash !== rundownHash) {
      this.lastRundownHash = rundownHash;
      logger.info(LogOrigin.Server, `Supabase: Detectou mudança e subindo para o Supabase - Rundown atualizado`);
      this.handleRundownChange(currentData);
    }

    // Delay changes (offset/relativeOffset) - detect any offset movement
    if (key === 'runtime' && (value?.offset !== undefined || value?.relativeOffset !== undefined)) {
      const currentOffset = value?.offset || 0;
      const now = Date.now();
      
      // Debouncing: prevent processing same offset within 500ms and threshold of 50ms
      if (Math.abs(currentOffset - this.lastDelayOffset) < 50 && now - this.lastDelaySendTime < 500) {
        return;
      }
      
      // Detectar se o offset está se movimentando (qualquer direção)
      const isOffsetMoving = Math.abs(currentOffset - this.lastDelayOffset) > 50;
      
      // Detectar se parou de se movimentar (offset estático)
      const isDelayStopped = this.isInDelayMode && !isOffsetMoving;
      
      // Check if user compensated (offset went back towards zero)
      const isCompensation = Math.abs(currentOffset) < Math.abs(this.lastSentOffset) - 1000;
      
      if (isCompensation) {
        // User compensated - reset delay mode and send immediately
        logger.info(LogOrigin.Server, `Supabase: Usuário compensou delay, offset: ${currentOffset} (era: ${this.lastSentOffset})`);
        this.isInDelayMode = false;
        this.accumulatedDelay = 0;
        this.lastSentOffset = currentOffset;
        this.lastDelayOffset = currentOffset;
        this.lastDelaySendTime = now;
        this.handleDelayChange(currentData);
        return;
      }
      
      if (isOffsetMoving && !this.isInDelayMode) {
        // Offset está se movimentando - entrar em modo delay e enviar UMA VEZ
        logger.info(LogOrigin.Server, `Supabase: Delay subindo detectado - offset: ${currentOffset} (era: ${this.lastDelayOffset})`);
        this.isInDelayMode = true;
        this.accumulatedDelay = currentOffset;
        this.lastSentOffset = currentOffset;
        this.lastDelayOffset = currentOffset;
        this.lastDelaySendTime = now;
        this.handleDelayChange(currentData);
        return;
      }
      
      if (isDelayStopped) {
        // Offset parou de se movimentar - sair do modo delay e enviar UMA VEZ
        logger.info(LogOrigin.Server, `Supabase: Delay parou de subir - offset: ${currentOffset} (era: ${this.lastDelayOffset})`);
        this.isInDelayMode = false;
        this.accumulatedDelay = 0;
        this.lastSentOffset = currentOffset;
        this.lastDelayOffset = currentOffset;
        this.lastDelaySendTime = now;
        this.handleDelayChange(currentData);
        return;
      }
      
      if (this.isInDelayMode) {
        // In delay mode - just accumulate silently, don't send until delay stops
        this.accumulatedDelay = currentOffset;
        // Don't return - continue to send timer updates
      }
      
      // Atualizar último offset processado
      this.lastDelayOffset = currentOffset;
    }
    
    // lastTimerState is now updated manually in the functions above
  }

  /**
   * Simple logic to determine if we should send timer state to Supabase
   */
  private shouldSendTimerState(playback: string, currentData: any): boolean {
    // Always send if state changed
    if (this.lastTimerState !== playback) {
      return true;
    }
    
    // For roll state, only send once
    if (playback === 'roll' || playback === 'timer_roll') {
      return false; // Already sent
    }
    
    // For other states, send if event is actually playing
    if (playback === 'play' && this.isEventActuallyPlaying(currentData)) {
      return true;
    }
    
    // For pause/stop, always send
    if (playback === 'pause' || playback === 'stop') {
      return true;
    }
    
    return false;
  }

  /**
   * Check if the event is actually playing (timer counting down/up)
   */
  private isEventActuallyPlaying(currentData: any): boolean {
    const timer = currentData.timer || {};
    const eventNow = currentData.eventNow;
    
    // If no current event, not playing
    if (!eventNow) {
      return false;
    }
    
    // If timer has startedAt, it's playing
    if (timer.startedAt) {
      return true;
    }
    
    // If timer current is changing (not static), it's playing
    // Check if timer value is different from duration (indicating it's counting)
    if (timer.current !== undefined && timer.duration !== undefined) {
      // If current is different from duration, it's counting
      if (timer.current !== timer.duration) {
        return true;
      }
    }
    
    // If timer has a current value and it's not the initial duration, it's playing
    if (timer.current !== undefined && timer.current !== timer.duration) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if this is a real timer state change (not just setting a timer)
   */
  private isRealTimerStateChange(timerValue: any, currentData: any): boolean {
    // If timer is being set to play but there's no current event, it's likely just setting a timer
    if (timerValue.playback === 'play' && !currentData.eventNow) {
      return false;
    }
    
    // If timer is being set to play but the timer value is 0 or very small (and positive), it's likely just setting a timer
    if (timerValue.playback === 'play' && (!timerValue.current || (timerValue.current > 0 && timerValue.current < 1000))) {
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
  private async handleTimerStateChange(playback: string, currentData: any, options?: { force?: boolean }) {
    const now = Date.now();
    
    // Debouncing: prevent duplicate sends within 500ms
    if (!options?.force && now - this.lastTimerSendTime < 500) {
      return;
    }
    
    // Extra check: if timer is paused, only send once every 5 seconds
    if (!options?.force && playback === 'pause' && now - this.lastTimerSendTime < 5000) {
      return;
    }
    
    this.lastTimerSendTime = now;
    // this.lastTimerState = playback; // Moved to checkForTriggers
    
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
   * Force update to Supabase (called from button actions) with throttling
   */
  public forceUpdate(currentData: any) {
    if (!this.isConnected || !this.config?.enabled) {
      return;
    }
    
    const now = Date.now();
    
    // Throttle force updates to prevent spam from rapid button clicks
    if (now - this.lastTimerSendTime < 1000) {
      console.log('Supabase: Force update throttled - too frequent');
      return;
    }
    
    logger.info(LogOrigin.Server, 'Supabase: Force update triggered by button action');
    
    // Send current timer state
    const timerPlayback = currentData.timer?.playback || 'stop';
    this.handleTimerStateChange(timerPlayback, currentData, { force: true });
  }

  /**
   * Toggle Supabase connection on/off
   */
  public toggleConnection(): boolean {
    if (this.isConnected) {
      this.disconnect();
      logger.info(LogOrigin.Server, 'Supabase: Connection disabled by user');
      return false;
    } else {
      logger.info(LogOrigin.Server, 'Supabase: Attempting to reconnect...');
      this.reconnect();
      logger.info(LogOrigin.Server, 'Supabase: Connection enabled by user');
      return this.isConnected;
    }
  }

  /**
   * Get current connection status
   */
  public getConnectionStatus(): { connected: boolean; enabled: boolean } {
    return {
      connected: this.isConnected,
      enabled: this.config?.enabled || false
    };
  }

  /**
   * Reconnect to Supabase
   */
  private reconnect() {
    // Force enable Supabase with hardcoded config
    const config: SupabaseConfig = {
      url: 'https://gxcgwhscnroiizjwswqv.supabase.co',
      anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4Y2d3aHNjbnJvaWl6andzd3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4MDMwNjMsImV4cCI6MjA3NTM3OTA2M30.suNBGtPXUr0YY8BaJEHcSja2m-vdxuCrA2CdOPip5fg',
      tableName: 'ontime_realtime',
      enabled: true
    };
    this.init(config);
  }

  /**
   * Disconnect from Supabase
   */
  private disconnect() {
    this.isConnected = false;
    this.supabase = null;
    // Keep config so we can reconnect later
  }

  /**
   * Handle delay changes
   */
  private async handleDelayChange(currentData: any) {
    const now = Date.now();
    const currentOffset = currentData.runtime?.offset || 0;
    
    // No debouncing - send immediately when called
    this.lastDelaySendTime = now;
    this.lastDelayOffset = currentOffset;
    
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
    const rundown = getDataProvider().getRundown() || [];
    const customFields = getDataProvider().getCustomFields() || {};
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
        startedAt: (timer.playback || 'stop') === 'stop' ? null : (timer.startedAt || null), // Only null when stopped
        expectedFinish: timer.expectedFinish || null,
        duration: timer.duration || null,
        addedTime: timer.addedTime || 0,
        value: (timer.playback || 'stop') === 'pause' ? (isNaN(timer.current) || timer.current === null || timer.current === undefined ? (timer.duration || 0) : timer.current) : (timer.playback || 'stop') === 'stop' ? 'STOP' : (isNaN(timer.current) || timer.current === null || timer.current === undefined ? (timer.duration || 0) : timer.current),
        playback: playback,
        phase: timer.phase || 'none',
        // Timer is based on the current event's timeStart/timeEnd, not the old clock
        // The frontend calculates current time based on startedAt + elapsed time
        timestamp: Date.now() // Always current timestamp
      },
      delay: {
        offset: (runtime.offset || 0) - 1000, // Apply -1000ms compensation
        expectedEnd: runtime.expectedEnd || null,
        relativeOffset: (runtime.relativeOffset || 0) - 1000, // Apply -1000ms compensation
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
        startedAt: (timer.playback || 'stop') === 'stop' ? null : (timer.startedAt || null), // Only null when stopped
        expectedFinish: timer.expectedFinish || null,
        duration: timer.duration || null,
        addedTime: timer.addedTime || 0,
        value: (timer.playback || 'stop') === 'pause' ? (isNaN(timer.current) || timer.current === null || timer.current === undefined ? (timer.duration || 0) : timer.current) : (timer.playback || 'stop') === 'stop' ? 'STOP' : (isNaN(timer.current) || timer.current === null || timer.current === undefined ? (timer.duration || 0) : timer.current),
        playback: timer.playback || 'stop',
        phase: timer.phase || 'none',
        // Timer is based on the current event's timeStart/timeEnd, not the old clock
        // The frontend calculates current time based on startedAt + elapsed time
        timestamp: Date.now() // Always current timestamp
      },
      delay: {
        offset: (runtime.offset || 0) - 1000, // Apply -1000ms compensation
        expectedEnd: runtime.expectedEnd || null,
        relativeOffset: (runtime.relativeOffset || 0) - 1000, // Apply -1000ms compensation
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
        startedAt: (timer.playback || 'stop') === 'stop' ? null : (timer.startedAt || null), // Only null when stopped
        expectedFinish: timer.expectedFinish || null,
        duration: timer.duration || null,
        addedTime: timer.addedTime || 0,
        value: (timer.playback || 'stop') === 'pause' ? (isNaN(timer.current) || timer.current === null || timer.current === undefined ? (timer.duration || 0) : timer.current) : (timer.playback || 'stop') === 'stop' ? 'STOP' : (isNaN(timer.current) || timer.current === null || timer.current === undefined ? (timer.duration || 0) : timer.current),
        playback: timer.playback || 'stop',
        phase: timer.phase || 'none',
        // Timer is based on the current event's timeStart/timeEnd, not the old clock
        // The frontend calculates current time based on startedAt + elapsed time
        timestamp: Date.now() // Always current timestamp
      },
      delay: {
        offset: (runtime.offset || 0) - 1000, // Apply -1000ms compensation
        expectedEnd: runtime.expectedEnd || null,
        relativeOffset: (runtime.relativeOffset || 0) - 1000, // Apply -1000ms compensation
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
    // Apply -1000ms compensation to delay offset (1 second)
    const delayOffset = (this.isInDelayMode ? this.accumulatedDelay : (runtime.offset || 0)) - 1000;
    const delayRelativeOffset = (this.isInDelayMode ? this.accumulatedDelay : (runtime.relativeOffset || 0)) - 1000;
    
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
        startedAt: (timer.playback || 'stop') === 'stop' ? null : (timer.startedAt || null), // Only null when stopped
        expectedFinish: timer.expectedFinish || null,
        duration: timer.duration || null,
        addedTime: timer.addedTime || 0,
        value: (timer.playback || 'stop') === 'pause' ? (isNaN(timer.current) || timer.current === null || timer.current === undefined ? (timer.duration || 0) : timer.current) : (timer.playback || 'stop') === 'stop' ? 'STOP' : (isNaN(timer.current) || timer.current === null || timer.current === undefined ? (timer.duration || 0) : timer.current),
        playback: timer.playback || 'stop',
        phase: timer.phase || 'none',
        // Timer is based on the current event's timeStart/timeEnd, not the old clock
        // The frontend calculates current time based on startedAt + elapsed time
        timestamp: Date.now() // Always current timestamp
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
      timeEnd: currentEvent.timeEnd ? currentEvent.timeEnd + 2000 : null, // Apply +2000ms compensation
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
      console.log(`Sending ${payload.status} to Supabase for project: ${payload.projectCode}`);

      const { data: result, error } = await this.supabase
        .from(this.config.tableName || 'ontime_realtime')
        .upsert({
          id: payload.projectCode,
          data: payload,
          project_code: payload.projectCode,
          updated_at: new Date().toISOString()
        });

      if (error) {
        console.error(`Supabase upsert error: ${error.message}`);
      } else {
        console.log(`Supabase ${payload.status} sent successfully`);
        this.lastSendTime = Date.now();
      }
    } catch (error) {
      console.error(`Supabase send error: ${error}`);
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
        console.warn('Supabase: Skipping initial send - no data available');
        return;
      }
      
      const rundown = getDataProvider().getRundown();
      if (!rundown || rundown.length === 0) {
        console.warn('Supabase: Skipping initial send - rundown not ready');
        return;
      }
      
      // Send initial project data
      const payload = this.buildProjectPayload(currentData);
      await this.sendOptimizedData(payload);
      
      console.log('Initial project data sent to Supabase');
    } catch (error) {
      console.error(`Supabase initial send error: ${error}`);
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


