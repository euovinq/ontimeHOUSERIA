import { createClient } from '@supabase/supabase-js';
import { eventStore } from '../stores/EventStore.js';
import { logger } from '../classes/Logger.js';
import { LogOrigin } from 'houseriaapp-types';
import { getDataProvider } from '../classes/data-provider/DataProvider.js';
import { readFile } from 'fs/promises';
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
  private isConnected = false; // ALWAYS start as disconnected
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
  private lastPauseEventId: string | null = null; // Track which event already sent timer_pause
  private lastAddedTime: number = 0;
  private lastAddedTimeSendTime: number = 0;
  
  // Performance optimization
  private lastSentPayloadHash: string = '';
  private globalThrottleTime: number = 0;
  private readonly GLOBAL_THROTTLE_MS = 200; // Max 5 sends per second
  private readonly DELAY_DEBOUNCE_MS = 2000; // Increased from 500ms to 2s

  constructor() {
    // Set config file path
    this.configFilePath = join(publicDir.root, 'supabase-config.json');
    
    // Load hardcoded configuration - ALWAYS start disabled
    this.loadConfigFromEnv();
    
    // Setup eventStore listener after a delay to ensure eventStore is initialized
    setTimeout(() => {
      this.setupEventStoreListener();
    }, 1000);
  }

  /**
   * Load configuration from hardcoded values (fallback to env if needed)
   */
  private loadConfigFromEnv() {
    // ALWAYS use hardcoded configuration - NEVER load from saved files
    const config: SupabaseConfig = {
      url: 'https://gxcgwhscnroiizjwswqv.supabase.co',
      anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4Y2d3aHNjbnJvaWl6andzd3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4MDMwNjMsImV4cCI6MjA3NTM3OTA2M30.suNBGtPXUr0YY8BaJEHcSja2m-vdxuCrA2CdOPip5fg',
      tableName: 'ontime_realtime',
      enabled: false  // ← ALWAYS start disabled - user must connect manually
    };

    // ALWAYS store config but NEVER initialize automatically
    this.config = config;
  }

  /**
   * Initialize Supabase connection
   */
  async init(config: SupabaseConfig) {
    if (!config.enabled || !config.url || !config.anonKey) {
      this.isConnected = false;
      return;
    }

    try {
      this.config = config;
      this.supabase = createClient(config.url, config.anonKey);
      
      // Test the client immediately
      const testResult = await this.testConnection();
      
      this.isConnected = testResult;
      
      if (this.isConnected) {
        // Save configuration
        this.saveConfig(config);
        
        // Send initial data
        this.sendToSupabase();
      }
    } catch (error) {
      console.error(`❌ Failed to initialize Supabase: ${error}`);
      this.isConnected = false;
    }
  }

  /**
   * Setup listener for eventStore changes with specific triggers
   */
  private setupEventStoreListener() {
    try {
      // Check if eventStore is available
      if (!eventStore || !eventStore.set) {
        setTimeout(() => this.setupEventStoreListener(), 500);
        return;
      }
      
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
    } catch (error) {
      console.error('❌ Error setting up eventStore listener:', error);
    }
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
          this.lastPauseEventId = null; // Reset pause tracking when playing
        }
        
        // Special handling for pause state - avoid spam
        if (value.playback === 'pause') {
          const currentEventId = currentData.eventNow?.id;
          
          // Only send pause once per event
          if (currentEventId && this.lastPauseEventId === currentEventId) {
            return; // Already sent for this event
          }
          
          this.lastPauseEventId = currentEventId;
        }
        
        logger.info(LogOrigin.Server, `Supabase: Detectou mudança e subindo para o Supabase - Timer ${value.playback}`);
        this.handleTimerStateChange(value.playback, currentData, { force: true });
        this.lastTimerState = value.playback;
      }
    }

    // Event changes (when a new event is loaded during playback)
    if (key === 'eventNow' && value) {
      logger.info(LogOrigin.Server, `Supabase: Detectou mudança e subindo para o Supabase - Evento mudou para ${value.title || value.id}`);
      
      // Reset play and pause tracking when event changes
      this.lastPlayEventId = null;
      this.lastPauseEventId = null;
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
    
    // For pause/stop, only send if state actually changed (no duplicates)
    if (playback === 'pause' || playback === 'stop') {
      return false; // Never send duplicates for pause/stop
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
    
    // Debouncing: prevent duplicate sends within 1000ms
    if (!options?.force && now - this.lastTimerSendTime < 1000) {
      return;
    }
    
    // Extra check: if timer is paused, only send once every 10 seconds
    if (!options?.force && playback === 'pause' && now - this.lastTimerSendTime < 10000) {
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
      return;
    }
    
    logger.info(LogOrigin.Server, 'Supabase: Force update triggered by button action');
    
    // Send current timer state
    const timerPlayback = currentData.timer?.playback || 'stop';
    this.handleTimerStateChange(timerPlayback, currentData, { force: true });
  }

  /**
   * Force project data update to Supabase (called when project data changes)
   */
  public async forceProjectUpdate() {
    if (!this.isConnected || !this.config?.enabled) {
      return;
    }

    try {
      const currentData = eventStore.poll();
      if (!currentData) {
        return;
      }

      logger.info(LogOrigin.Server, 'Supabase: Force project update triggered');
      await this.handleProjectChange(currentData);
    } catch (error) {
      logger.error(LogOrigin.Server, `Supabase: Error forcing project update: ${error}`);
    }
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
    // ALWAYS return disabled and disconnected unless explicitly enabled
    const isEnabled = this.config?.enabled === true;
    const isConnected = isEnabled && this.isConnected;
    
    const status = {
      connected: isConnected,
      enabled: isEnabled
    };
    
    return status;
  }

  /**
   * Reconnect to Supabase
   */
  private reconnect() {
    if (!this.config) {
      console.error('❌ Cannot reconnect Supabase: configuration not loaded');
      return;
    }

    const config: SupabaseConfig = { ...this.config, enabled: true };
    this.init(config).catch(error => {
      console.error('❌ Error reconnecting to Supabase:', error);
    });
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
   * Filter rundown to exclude events with skip=true and recalculate aggregates
   */
  private filterRundownForSupabase(rundown: readonly any[]): {
    filteredRundown: any[];
    totalEvents: number;
    totalDuration: number;
  } {
    if (!rundown || rundown.length === 0) {
      return {
        filteredRundown: [],
        totalEvents: 0,
        totalDuration: 0
      };
    }

    // Filter out events with skip === true
    const filteredRundown = rundown.filter(event => event.skip !== true);

    // Recalculate aggregates based on filtered rundown
    const totalEvents = filteredRundown.length;
    const totalDuration = filteredRundown.reduce((total, event) => {
      if (event.type === 'event' && event.duration) {
        return total + event.duration;
      }
      return total;
    }, 0);

    return {
      filteredRundown,
      totalEvents,
      totalDuration
    };
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

    // Filter rundown to exclude events with skip=true
    const { filteredRundown, totalEvents, totalDuration } = this.filterRundownForSupabase(rundown);

    // Send ALL data since Supabase upsert replaces the entire row
    return {
      projectCode,
      timestamp: Date.now(),
      status: `timer_${playback}`,
      project: {
        title: projectData?.title || '',
        projectCode: projectCode,
        directorWhatsapp: projectData?.directorWhatsapp || null
      },
      cuesheet: {
        rundown: filteredRundown,
        customFields: customFields || {},
        totalEvents: totalEvents,
        totalDuration: totalDuration
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
    const rundown = getDataProvider().getRundown() || [];
    const customFields = getDataProvider().getCustomFields();
    const timer = data.timer || {};
    const runtime = data.runtime || {};

    // Filter rundown to exclude events with skip=true
    const { filteredRundown, totalEvents, totalDuration } = this.filterRundownForSupabase(rundown);

    return {
      projectCode,
      timestamp: Date.now(),
      status: 'project_loaded',
      project: {
        title: projectData?.title || '',
        projectCode: projectCode,
        directorWhatsapp: projectData?.directorWhatsapp || null
      },
      cuesheet: {
        rundown: filteredRundown,
        customFields: customFields || {},
        totalEvents: totalEvents,
        totalDuration: totalDuration
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
    const rundown = getDataProvider().getRundown() || [];
    const customFields = getDataProvider().getCustomFields();
    const timer = data.timer || {};
    const runtime = data.runtime || {};

    // Filter rundown to exclude events with skip=true
    const { filteredRundown, totalEvents, totalDuration } = this.filterRundownForSupabase(rundown);

    // Send ALL data since Supabase upsert replaces the entire row
    return {
      projectCode,
      timestamp: Date.now(),
      status: 'events_updated',
      project: {
        title: projectData?.title || '',
        projectCode: projectCode,
        directorWhatsapp: projectData?.directorWhatsapp || null
      },
      cuesheet: {
        rundown: filteredRundown,
        customFields: customFields || {},
        totalEvents: totalEvents,
        totalDuration: totalDuration
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
    const rundown = getDataProvider().getRundown() || [];
    const customFields = getDataProvider().getCustomFields();
    const timer = data.timer || {};
    const runtime = data.runtime || {};
    
    if (!projectCode) {
      logger.warning(LogOrigin.Server, 'Supabase: Cannot build delay payload - no project code');
      return null;
    }
    
    // Filter rundown to exclude events with skip=true
    const { filteredRundown, totalEvents, totalDuration } = this.filterRundownForSupabase(rundown);
    
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
        projectCode: projectCode,
        directorWhatsapp: projectData?.directorWhatsapp || null
      },
      cuesheet: {
        rundown: filteredRundown,
        customFields: customFields || {},
        totalEvents: totalEvents,
        totalDuration: totalDuration
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
   * Get current event from data (excluding skipped events)
   */
  private getCurrentEvent(data: any) {
    const currentEvent = data.eventNow;
    if (!currentEvent) return null;
    
    // Don't return events with skip=true
    if (currentEvent.skip === true) {
      return null;
    }
    
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
   * Get next event from data (excluding skipped events)
   */
  private getNextEvent(data: any) {
    const nextEvent = data.eventNext;
    if (!nextEvent) return null;
    
    // Don't return events with skip=true
    if (nextEvent.skip === true) {
      return null;
    }
    
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
      // Sanitizar projectCode para garantir consistência (trim + uppercase)
      const sanitizedProjectCode = (payload.projectCode || '').trim().toUpperCase();
      
      if (!sanitizedProjectCode) {
        logger.warning(LogOrigin.Server, 'sendOptimizedData: projectCode vazio, não é possível salvar');
        return;
      }

      // Obter userId do usuário logado (via sessão de autenticação)
      let userId: string | number | null = null;
      try {
        const { getAllSessions } = await import('../api-data/auth/auth-session.service.js');
        const sessions = getAllSessions();
        if (sessions.length > 0) {
          // Pega a sessão mais recente
          const latestSession = sessions
            .slice()
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .at(0);
          if (latestSession) {
            userId = latestSession.userId;
          }
        }
      } catch (error) {
        // Se não conseguir obter userId, continua sem user_id (modo legacy)
        logger.warning(LogOrigin.Server, `Could not get userId for Supabase save: ${error}`);
      }

      // Garantir que o payload também tenha o projectCode sanitizado
      // IMPORTANTE: Remover qualquer campo 'id' do payload (id é auto-incremento na tabela)
      const payloadWithoutId = { ...payload };
      if ('id' in payloadWithoutId) {
        delete payloadWithoutId.id;
      }
      if (payloadWithoutId.project && 'id' in payloadWithoutId.project) {
        delete payloadWithoutId.project.id;
      }
      
      const sanitizedPayload = {
        ...payloadWithoutId,
        projectCode: sanitizedProjectCode,
        project: {
          ...payloadWithoutId.project,
          projectCode: sanitizedProjectCode
        }
      };

      // Buscar por project_code na tabela ontime_realtime
      // Buscar até 5 registros para encontrar o correto (pode haver múltiplos com mesmo project_code)
      logger.info(LogOrigin.Server, `Searching for existing record with project_code: ${sanitizedProjectCode}${userId ? `, user_id: ${userId}` : ''}`);
      const { data: existingList, error: searchError } = await this.supabase
        .from(this.config.tableName || 'ontime_realtime')
        .select('id, user_id, project_code')
        .eq('project_code', sanitizedProjectCode)
        .limit(5);
      
      let error: any = null;
      let existingRecord: any = null;

      if (searchError && searchError.code !== 'PGRST116') {
        logger.warning(LogOrigin.Server, `Error searching for existing record: ${searchError.message} (code: ${searchError.code})`);
      } else if (existingList && existingList.length > 0) {
        logger.info(LogOrigin.Server, `Found ${existingList.length} record(s) with project_code: ${sanitizedProjectCode}`);
        // Achou registro(s) - verificar user_id se disponível
        if (userId !== null) {
          // Tentar encontrar registro com mesmo user_id
          const matchingUser = existingList.find((r: any) => r.user_id === userId);
          existingRecord = matchingUser || existingList[0];
        } else {
          existingRecord = existingList[0];
        }
        logger.info(LogOrigin.Server, `Found existing record: id=${existingRecord.id}, user_id=${existingRecord.user_id || 'null'} (total found: ${existingList.length})`);
        
        // Preparar dados para atualização
        const updateData: any = {
          data: sanitizedPayload,
          project_code: sanitizedProjectCode,
          updated_at: new Date().toISOString()
        };

        // Incluir user_id se disponível (FK para users.id)
        if (userId !== null) {
          updateData.user_id = userId;
        }

        // Atualizar registro existente
        logger.info(LogOrigin.Server, `Updating existing record with id: ${existingRecord.id} for project_code: ${sanitizedProjectCode}`);
        const { data: updateResult, error: updateError, count } = await this.supabase
          .from(this.config.tableName || 'ontime_realtime')
          .update(updateData)
          .eq('id', existingRecord.id)
          .select();
        
        const rowsAffected = count !== null ? count : (updateResult ? updateResult.length : 0);
        
        if (updateError) {
          logger.error(LogOrigin.Server, `Update error for id ${existingRecord.id}: ${updateError.message} (code: ${updateError.code})`);
          error = updateError;
        } else if (rowsAffected === 0) {
          logger.warning(LogOrigin.Server, `Update affected 0 rows for id ${existingRecord.id}. Record may have been deleted. Attempting insert...`);
          // Se não afetou nenhuma linha, tentar inserir
          const { error: insertError } = await this.supabase
            .from(this.config.tableName || 'ontime_realtime')
            .insert(updateData);
          
          if (insertError) {
            logger.error(LogOrigin.Server, `Insert after failed update also failed: ${insertError.message}`);
            error = insertError;
          } else {
            logger.info(LogOrigin.Server, `Successfully inserted record after update affected 0 rows`);
            error = null;
          }
        } else {
          logger.info(LogOrigin.Server, `Successfully updated existing record (rows affected: ${rowsAffected})`);
          error = null;
        }
      } else {
        // Não achou - criar novo registro
        logger.info(LogOrigin.Server, `No record found for project_code: ${sanitizedProjectCode}, creating new record`);
        
        // Buscar id do usuário na tabela users pelo email logado
        let userDbId: string | number | null = null;
        if (userId !== null) {
          try {
            // Buscar o email do usuário logado na tabela users
            const { getAllSessions } = await import('../api-data/auth/auth-session.service.js');
            const { supabase: authSupabase } = await import('../api-data/auth/auth.service.js');
            
            const sessions = getAllSessions();
            if (sessions.length > 0) {
              const latestSession = sessions
                .slice()
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .at(0);
              
              if (latestSession && latestSession.userId === userId) {
                // Buscar email do usuário na tabela users pelo id
                const { data: userRecord, error: userError } = await authSupabase
                  .from('users')
                  .select('id, email')
                  .eq('id', userId)
                  .maybeSingle();
                
                if (userError) {
                  logger.warning(LogOrigin.Server, `Error searching for user in users table: ${userError.message}`);
                } else if (userRecord && userRecord.email) {
                  // Buscar o id do usuário na tabela users pelo email logado
                  const { data: userByEmail, error: emailError } = await this.supabase
                    .from('users')
                    .select('id')
                    .eq('email', userRecord.email)
                    .maybeSingle();
                  
                  if (emailError) {
                    logger.warning(LogOrigin.Server, `Error searching for user by email: ${emailError.message}`);
                  } else if (userByEmail) {
                    userDbId = userByEmail.id;
                    logger.info(LogOrigin.Server, `Found user id in users table by email: ${userDbId} (email: ${userRecord.email})`);
                  }
                } else {
                  logger.warning(LogOrigin.Server, `User not found in users table for userId: ${userId}`);
                }
              }
            }
          } catch (err) {
            logger.warning(LogOrigin.Server, `Error getting user id: ${err}`);
          }
        }

        // Preparar dados para inserção
        // IMPORTANTE: Não incluir campo 'id' - ele é auto-incremento (PK)
        const insertData: any = {
          data: sanitizedPayload,
          project_code: sanitizedProjectCode,
          updated_at: new Date().toISOString()
        };

        // Incluir user_id (FK) se encontrado
        if (userDbId !== null) {
          insertData.user_id = userDbId;
        }
        
        // Garantir que não há campo 'id' no insertData (id é auto-incremento)
        if ('id' in insertData) {
          delete insertData.id;
        }
        
        // Log do que será inserido (sem dados sensíveis)
        logger.info(LogOrigin.Server, `Preparing to insert: project_code="${insertData.project_code}", user_id=${insertData.user_id || 'null'}, has_data=${!!insertData.data}, updated_at=${insertData.updated_at}`);
        logger.info(LogOrigin.Server, `Insert data keys: ${Object.keys(insertData).join(', ')}`);
        
        // Verificação final: garantir que NÃO há campo 'id' em nenhum lugar
        // (id é auto-incremento, não deve ser passado)
        const hasId = 'id' in insertData || (insertData.data && typeof insertData.data === 'object' && 'id' in insertData.data);
        if (hasId) {
          logger.error(LogOrigin.Server, `❌ ERROR: Found 'id' field in insertData! Removing it...`);
          delete insertData.id;
          if (insertData.data && typeof insertData.data === 'object' && 'id' in insertData.data) {
            const dataCopy = { ...insertData.data };
            delete dataCopy.id;
            insertData.data = dataCopy;
          }
        }

        // Criar novo registro
        const { error: insertError } = await this.supabase
          .from(this.config.tableName || 'ontime_realtime')
          .insert(insertData);
        
        if (insertError) {
          logger.error(LogOrigin.Server, `Insert error: ${insertError.message} (code: ${insertError.code})`);
          logger.error(LogOrigin.Server, `Insert error details: ${JSON.stringify(insertError)}`);
          logger.error(LogOrigin.Server, `Insert data that failed: ${JSON.stringify({ ...insertData, data: '[omitted]' })}`);
          
          // Se der erro de duplicata, significa que o registro foi criado por outra thread
          // Buscar novamente e atualizar
          if (insertError.code === '23505') {
            logger.warning(LogOrigin.Server, `⚠️ Duplicate key error on PK (id is auto-increment). This should not happen unless id is being passed explicitly.`);
            logger.info(LogOrigin.Server, `Insert failed due to duplicate key. Trying UPDATE directly by project_code + user_id...`);
            
            // Tentar fazer UPDATE diretamente (o registro pode existir mas a busca não encontra por RLS)
            const updateDataForRetry: any = {
              data: sanitizedPayload,
              project_code: sanitizedProjectCode,
              updated_at: new Date().toISOString()
            };
            if (userDbId !== null) {
              updateDataForRetry.user_id = userDbId;
            }
            
            let updateQuery = this.supabase
              .from(this.config.tableName || 'ontime_realtime')
              .update(updateDataForRetry)
              .eq('project_code', sanitizedProjectCode);
            
            if (userDbId !== null) {
              updateQuery = updateQuery.eq('user_id', userDbId);
            }
            
            const { data: updateResult, error: updateError, count } = await updateQuery.select();
            const rowsAffected = count !== null ? count : (updateResult ? updateResult.length : 0);
            
            if (!updateError && rowsAffected > 0) {
              logger.info(LogOrigin.Server, `✅ Successfully updated existing record via direct UPDATE (rows affected: ${rowsAffected})`);
              error = null;
            } else {
              logger.warning(LogOrigin.Server, `Direct UPDATE did not affect any rows. Searching for record...`);
              // Aguardar mais tempo para garantir que o registro foi commitado
              await new Promise(resolve => setTimeout(resolve, 500));
              
              // Tentar buscar o registro por project_code
              logger.info(LogOrigin.Server, `Searching for record with project_code: "${sanitizedProjectCode}" after duplicate error...`);
            let { data: newRecordList, error: searchError } = await this.supabase
              .from(this.config.tableName || 'ontime_realtime')
              .select('id, user_id, project_code')
              .eq('project_code', sanitizedProjectCode)
              .limit(5);
            
            if (searchError) {
              logger.warning(LogOrigin.Server, `Error searching for record after duplicate insert: ${searchError.message} (code: ${searchError.code})`);
              // Se houver erro de busca, pode ser RLS - tentar buscar todos os registros (sem filtro)
              logger.info(LogOrigin.Server, `Attempting to search all records (no filter) to check RLS...`);
              const { data: allRecords, error: allError } = await this.supabase
                .from(this.config.tableName || 'ontime_realtime')
                .select('id, user_id, project_code')
                .limit(10);
              
              if (allError) {
                logger.warning(LogOrigin.Server, `Error searching all records: ${allError.message} (code: ${allError.code})`);
              } else {
                logger.info(LogOrigin.Server, `Found ${allRecords?.length || 0} total record(s) in table (RLS check)`);
                if (allRecords && allRecords.length > 0) {
                  const matching = allRecords.filter((r: any) => r.project_code === sanitizedProjectCode);
                  logger.info(LogOrigin.Server, `  Records matching project_code "${sanitizedProjectCode}": ${matching.length}`);
                  if (matching.length > 0) {
                    logger.warning(LogOrigin.Server, `  ⚠️ Found matching record but RLS may be blocking filtered search!`);
                    matching.forEach((r: any, idx: number) => {
                      logger.info(LogOrigin.Server, `    Match ${idx + 1}: id=${r.id}, user_id=${r.user_id || 'null'}, project_code="${r.project_code}"`);
                    });
                    // Usar o primeiro match encontrado
                    newRecordList = matching;
                  }
                }
              }
            } else {
              logger.info(LogOrigin.Server, `Search result: found ${newRecordList?.length || 0} record(s) with project_code "${sanitizedProjectCode}"`);
              if (newRecordList && newRecordList.length > 0) {
                newRecordList.forEach((r: any, idx: number) => {
                  logger.info(LogOrigin.Server, `  Record ${idx + 1}: id=${r.id}, user_id=${r.user_id || 'null'}, project_code="${r.project_code}"`);
                });
              }
            }
            
            if (newRecordList && newRecordList.length > 0) {
              // Encontrar o registro que corresponde ao user_id se disponível
              let recordToUpdate = newRecordList[0];
              if (userDbId !== null) {
                const matchingUser = newRecordList.find((r: any) => r.user_id === userDbId);
                if (matchingUser) {
                  recordToUpdate = matchingUser;
                }
              }
              
              logger.info(LogOrigin.Server, `Found record after duplicate insert: id=${recordToUpdate.id}, user_id=${recordToUpdate.user_id || 'null'}`);
              
              const updateData: any = {
                data: sanitizedPayload,
                project_code: sanitizedProjectCode,
                updated_at: new Date().toISOString()
              };
              if (userDbId !== null) {
                updateData.user_id = userDbId;
              }
              
              const { error: updateError } = await this.supabase
                .from(this.config.tableName || 'ontime_realtime')
                .update(updateData)
                .eq('id', recordToUpdate.id);
              
              if (updateError) {
                logger.error(LogOrigin.Server, `Update error after duplicate insert: ${updateError.message} (code: ${updateError.code})`);
                // Se o update falhar, tentar atualizar por project_code + user_id
                if (userDbId !== null) {
                  logger.info(LogOrigin.Server, `Trying update by project_code and user_id as fallback...`);
                  const { error: fallbackError } = await this.supabase
                    .from(this.config.tableName || 'ontime_realtime')
                    .update(updateData)
                    .eq('project_code', sanitizedProjectCode)
                    .eq('user_id', userDbId);
                  
                  if (fallbackError) {
                    logger.error(LogOrigin.Server, `Fallback update also failed: ${fallbackError.message}`);
                    error = fallbackError;
                  } else {
                    logger.info(LogOrigin.Server, `Successfully updated record using fallback method`);
                    error = null;
                  }
                } else {
                  error = updateError;
                }
              } else {
                logger.info(LogOrigin.Server, `Successfully updated record after duplicate insert`);
                error = null;
              }
            } else {
              // Não encontrou o registro após busca - tentar buscar novamente com mais tempo
              logger.warning(LogOrigin.Server, `Record not found after duplicate insert. Waiting longer and searching again...`);
              await new Promise(resolve => setTimeout(resolve, 500));
              
              // Tentar buscar novamente
              logger.info(LogOrigin.Server, `Retry search for project_code: "${sanitizedProjectCode}"...`);
              const { data: retryRecordList, error: retrySearchError } = await this.supabase
                .from(this.config.tableName || 'ontime_realtime')
                .select('id, user_id, project_code')
                .eq('project_code', sanitizedProjectCode)
                .limit(5);
              
              if (retrySearchError) {
                logger.warning(LogOrigin.Server, `Error in retry search: ${retrySearchError.message} (code: ${retrySearchError.code})`);
              } else {
                logger.info(LogOrigin.Server, `Retry search result: found ${retryRecordList?.length || 0} record(s)`);
                if (retryRecordList && retryRecordList.length > 0) {
                  retryRecordList.forEach((r: any, idx: number) => {
                    logger.info(LogOrigin.Server, `  Retry Record ${idx + 1}: id=${r.id}, user_id=${r.user_id || 'null'}, project_code="${r.project_code}"`);
                  });
                }
              }
              
              if (retryRecordList && retryRecordList.length > 0) {
                // Encontrou agora - atualizar
                let recordToUpdate = retryRecordList[0];
                if (userDbId !== null) {
                  const matchingUser = retryRecordList.find((r: any) => r.user_id === userDbId);
                  if (matchingUser) {
                    recordToUpdate = matchingUser;
                  }
                }
                
                logger.info(LogOrigin.Server, `Found record on retry: id=${recordToUpdate.id}, user_id=${recordToUpdate.user_id || 'null'}`);
                
                const updateData: any = {
                  data: sanitizedPayload,
                  project_code: sanitizedProjectCode,
                  updated_at: new Date().toISOString()
                };
                if (userDbId !== null) {
                  updateData.user_id = userDbId;
                }
                
                const { error: updateError } = await this.supabase
                  .from(this.config.tableName || 'ontime_realtime')
                  .update(updateData)
                  .eq('id', recordToUpdate.id);
                
                if (updateError) {
                  logger.error(LogOrigin.Server, `Update error on retry: ${updateError.message}`);
                  error = updateError;
                } else {
                  logger.info(LogOrigin.Server, `Successfully updated record on retry`);
                  error = null;
                }
              } else {
                // Ainda não encontrou - tentar fazer update direto por project_code
                logger.warning(LogOrigin.Server, `Record still not found. Trying direct update by project_code...`);
                const updateData: any = {
                  data: sanitizedPayload,
                  project_code: sanitizedProjectCode,
                  updated_at: new Date().toISOString()
                };
                if (userDbId !== null) {
                  updateData.user_id = userDbId;
                }
                
                let updateQuery = this.supabase
                  .from(this.config.tableName || 'ontime_realtime')
                  .update(updateData)
                  .eq('project_code', sanitizedProjectCode);
                
                if (userDbId !== null) {
                  updateQuery = updateQuery.eq('user_id', userDbId);
                }
                
                // Usar select() para verificar quantas linhas foram afetadas
                const { data: updateResult, error: directUpdateError, count } = await updateQuery.select();
                const rowsAffected = count !== null ? count : (updateResult ? updateResult.length : 0);
                
                if (directUpdateError) {
                  logger.error(LogOrigin.Server, `Direct update failed: ${directUpdateError.message}`);
                  error = directUpdateError;
                } else if (rowsAffected === 0) {
                  // Nenhuma linha foi afetada - o registro realmente não existe
                  // Tentar inserir novamente (pode ter sido deletado entre as tentativas)
                  logger.warning(LogOrigin.Server, `Direct update affected 0 rows. Record may not exist. Attempting insert again...`);
                  const { error: retryInsertError } = await this.supabase
                    .from(this.config.tableName || 'ontime_realtime')
                    .insert(insertData);
                  
                  if (retryInsertError) {
                    if (retryInsertError.code === '23505') {
                      // Ainda duplicata - registro existe mas não conseguimos atualizar
                      // Isso é uma condição de corrida - ignorar
                      logger.warning(LogOrigin.Server, `Retry insert also failed with duplicate key. This is a race condition - ignoring.`);
                      error = null;
                    } else {
                      logger.error(LogOrigin.Server, `Retry insert failed: ${retryInsertError.message}`);
                      error = retryInsertError;
                    }
                  } else {
                    logger.info(LogOrigin.Server, `Successfully inserted record on retry`);
                    error = null;
                  }
                } else {
                  logger.info(LogOrigin.Server, `Successfully updated record using direct update method (rows affected: ${rowsAffected})`);
                  error = null;
                }
              }
            }
            }
          } else {
            error = insertError;
          }
        } else {
          logger.info(LogOrigin.Server, `Successfully created new record for project_code: ${sanitizedProjectCode}${userDbId ? ` with user_id: ${userDbId}` : ''}`);
          error = null;
        }
      }

      if (error) {
        logger.error(LogOrigin.Server, `Supabase upsert error: ${error.message} (code: ${error.code})`);
        console.error(`Supabase upsert error: ${error.message}`);
      } else {
        logger.info(LogOrigin.Server, `Dados salvos no Supabase para projeto: ${sanitizedProjectCode}${userId ? ` (user_id: ${userId})` : ''}`);
        this.lastSendTime = Date.now();
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error(LogOrigin.Server, `Supabase send error: ${errorMsg}`);
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
   * Save configuration to file - DISABLED to prevent overriding hardcoded config
   */
  private async saveConfig(_config: SupabaseConfig) {
    // DISABLED: Never save config to prevent overriding hardcoded settings
    logger.info(LogOrigin.Server, 'Supabase configuration save disabled - using hardcoded config');
    return;
  }

  /**
   * Load configuration from file
   */
  async loadConfig(): Promise<SupabaseConfig | null> {
    try {
      const configData = await readFile(this.configFilePath, 'utf-8');
      const config = JSON.parse(configData);
      await this.init(config);
      return config;
    } catch (error) {
      logger.warning(LogOrigin.Server, 'No saved Supabase configuration found');
      return null;
    }
  }

  /**
   * Clean up old projects from Supabase
   * Tornado: exposto publicamente para uso em controllers REST
   */
  public async cleanupOldProjects() {
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
    if (!this.supabase) {
      return false;
    }

    try {
      const { error } = await this.supabase
        .from(this.config?.tableName || 'ontime_realtime')
        .select('id')
        .limit(1);
      
      if (error) {
        logger.error(LogOrigin.Server, `Supabase connection test failed: ${error}`);
        return false;
      }
      
      return true;
    } catch (error) {
      logger.error(LogOrigin.Server, `Supabase connection test failed: ${error}`);
      return false;
    }
  }

  /**
   * Get active projects from Supabase
   * Admin vê todos, não-admin apenas registros com user_id correspondente (quando fornecido)
   */
  async getActiveProjects(authUser?: { userId?: string | number; isAdmin?: boolean }): Promise<any[]> {
    if (!this.isConnected || !this.supabase) {
      return [];
    }

    try {
      let query = this.supabase
        .from(this.config?.tableName || 'ontime_realtime')
        .select('id, project_code, updated_at, user_id')
        .order('updated_at', { ascending: false });

      if (authUser && !authUser.isAdmin && authUser.userId != null) {
        query = query.eq('user_id', authUser.userId);
      }

      const { data, error } = await query;

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
   * Não aplica filtro de user_id aqui; a checagem de propriedade é feita no controller
   */
  async getProjectData(
    projectCode: string,
  ): Promise<{ data: any; user_id?: string | number | null } | null> {
    // Sanitizar projectCode (trim + uppercase para garantir consistência)
    const sanitizedCode = (projectCode || '').trim().toUpperCase();
    
    if (!sanitizedCode) {
      logger.warning(LogOrigin.Server, 'getProjectData: projectCode vazio ou inválido');
      return null;
    }

    if (!this.isConnected || !this.supabase) {
      logger.warning(LogOrigin.Server, `getProjectData: Supabase não está conectado. Tentando buscar projeto ${sanitizedCode}`);
      return null;
    }

    try {
      logger.info(LogOrigin.Server, `Buscando projeto no Supabase com project_code: ${sanitizedCode}`);
      
      // Busca por project_code - pode haver múltiplos registros com o mesmo project_code
      // então buscamos todos e pegamos o mais recente (ordenado por updated_at DESC)
      const { data: allRecords, error: queryError } = await this.supabase
        .from(this.config?.tableName || 'ontime_realtime')
        .select('data, user_id, project_code, id, updated_at')
        .eq('project_code', sanitizedCode)
        .order('updated_at', { ascending: false })
        .limit(10); // Limita a 10 para performance

      if (queryError) {
        // Se der erro na query, tenta buscar por id como fallback
        logger.info(LogOrigin.Server, `Erro ao buscar por project_code, tentando por id: ${queryError.message}`);
        const resultById = await this.supabase
          .from(this.config?.tableName || 'ontime_realtime')
          .select('data, user_id, project_code, id, updated_at')
          .eq('id', sanitizedCode)
          .maybeSingle();
        
        if (resultById.data) {
          logger.info(LogOrigin.Server, `Encontrado por id (fallback): ${sanitizedCode}`);
          const data = resultById.data;
          
          // Se encontrou por id mas não tem project_code ou está diferente, atualiza
          if (!data.project_code || data.project_code.toUpperCase() !== sanitizedCode) {
            logger.info(LogOrigin.Server, `Atualizando project_code do registro encontrado por id`);
            try {
              await this.supabase
                .from(this.config?.tableName || 'ontime_realtime')
                .update({ project_code: sanitizedCode })
                .eq('id', sanitizedCode);
              data.project_code = sanitizedCode;
            } catch (updateError) {
              logger.warning(LogOrigin.Server, `Não foi possível atualizar project_code: ${updateError}`);
            }
          }
          
          return {
            data: data.data,
            user_id: (data as any).user_id ?? null,
          };
        }
        
        // Se chegou aqui com erro, não encontrou
        logger.info(LogOrigin.Server, `Erro ao buscar projeto: ${queryError.message}`);
        await this.debugListProjects(sanitizedCode);
        return null;
      } else if (allRecords && allRecords.length > 0) {
        // Encontrou registros - pega o mais recente (já está ordenado)
        const data = allRecords[0];
        
        if (allRecords.length > 1) {
          logger.warning(LogOrigin.Server, `⚠️ Encontrados ${allRecords.length} registros com project_code="${sanitizedCode}". Usando o mais recente (id: ${data.id}, updated_at: ${data.updated_at})`);
        } else {
          logger.info(LogOrigin.Server, `✅ Projeto encontrado: ${sanitizedCode} (id: ${data.id})`);
        }
        
        return {
          data: data.data,
          user_id: (data as any).user_id ?? null,
        };
      } else {
        // Não encontrou por project_code, tenta por id
        logger.info(LogOrigin.Server, `Não encontrado por project_code, tentando por id: ${sanitizedCode}`);
        const resultById = await this.supabase
          .from(this.config?.tableName || 'ontime_realtime')
          .select('data, user_id, project_code, id, updated_at')
          .eq('id', sanitizedCode)
          .maybeSingle();
        
        if (resultById.data) {
          const data = resultById.data;
          logger.info(LogOrigin.Server, `Encontrado por id (fallback): ${sanitizedCode}`);
          
          // Se encontrou por id mas não tem project_code ou está diferente, atualiza
          if (!data.project_code || data.project_code.toUpperCase() !== sanitizedCode) {
            logger.info(LogOrigin.Server, `Atualizando project_code do registro encontrado por id`);
            try {
              await this.supabase
                .from(this.config?.tableName || 'ontime_realtime')
                .update({ project_code: sanitizedCode })
                .eq('id', sanitizedCode);
              data.project_code = sanitizedCode;
            } catch (updateError) {
              logger.warning(LogOrigin.Server, `Não foi possível atualizar project_code: ${updateError}`);
            }
          }
          
          return {
            data: data.data,
            user_id: (data as any).user_id ?? null,
          };
        }
        
        // Se chegou aqui, não encontrou nem por project_code nem por id
        logger.info(LogOrigin.Server, `Nenhum registro encontrado para project_code/id: ${sanitizedCode}`);
        // Tenta listar alguns registros para debug
        await this.debugListProjects(sanitizedCode);
        return null;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error(LogOrigin.Server, `Exceção ao buscar projeto ${sanitizedCode}: ${errorMsg}`);
      return null;
    }
  }

  /**
   * Função auxiliar para debug - lista alguns projetos para ajudar a identificar problemas
   */
  private async debugListProjects(searchCode: string) {
    try {
      const { data, error } = await this.supabase
        .from(this.config?.tableName || 'ontime_realtime')
        .select('id, project_code, updated_at')
        .limit(10)
        .order('updated_at', { ascending: false });

      if (!error && data && data.length > 0) {
        logger.info(LogOrigin.Server, `📋 Registros encontrados na tabela (últimos 10):`);
        data.forEach((record: any, index: number) => {
          logger.info(LogOrigin.Server, `  ${index + 1}. id="${record.id}", project_code="${record.project_code || '(vazio)'}"`);
        });
        logger.info(LogOrigin.Server, `🔍 Procurando por: "${searchCode}"`);
      }
    } catch (err) {
      // Ignora erros de debug
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

  /**
   * Check if a projectCode already exists for a given user email
   * Verifies via FK: ontime_realtime.user_id -> users.id -> users.email
   */
  async checkProjectCodeExists(userEmail: string, projectCode: string): Promise<boolean> {
    if (!this.isConnected || !this.supabase) {
      return false;
    }

    try {
      // Sanitizar projectCode
      const sanitizedCode = (projectCode || '').trim().toUpperCase();
      
      if (!sanitizedCode) {
        return false;
      }

      // Busca na tabela ontime_realtime por project_code
      const { data: projectRecord, error: projectError } = await this.supabase
        .from(this.config?.tableName || 'ontime_realtime')
        .select('user_id')
        .eq('project_code', sanitizedCode)
        .maybeSingle();

      if (projectError) {
        logger.warning(LogOrigin.Server, `Error checking project code existence: ${projectError.message}`);
        return false;
      }

      // Se não encontrou registro, projectCode não existe
      if (!projectRecord || !projectRecord.user_id) {
        return false;
      }

      // Busca na tabela users pelo id (FK)
      const { data: userRecord, error: userError } = await this.supabase
        .from('users')
        .select('email')
        .eq('id', projectRecord.user_id)
        .maybeSingle();

      if (userError) {
        logger.warning(LogOrigin.Server, `Error checking user email: ${userError.message}`);
        return false;
      }

      // Compara email do usuário encontrado com o email fornecido
      if (userRecord && userRecord.email === userEmail) {
        logger.info(LogOrigin.Server, `Project code ${sanitizedCode} already exists for user ${userEmail}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error(LogOrigin.Server, `Error in checkProjectCodeExists: ${error}`);
      return false;
    }
  }

  /**
   * Check if a project exists in the database for a given user email
   * Verifies via FK: ontime_realtime.user_id -> users.id -> users.email
   */
  async projectExistsForUser(userEmail: string, projectCode: string): Promise<boolean> {
    if (!this.isConnected || !this.supabase) {
      return false;
    }

    try {
      // Sanitizar projectCode
      const sanitizedCode = (projectCode || '').trim().toUpperCase();
      
      if (!sanitizedCode) {
        return false;
      }

      // Busca na tabela ontime_realtime por project_code
      const { data: projectRecord, error: projectError } = await this.supabase
        .from(this.config?.tableName || 'ontime_realtime')
        .select('user_id')
        .eq('project_code', sanitizedCode)
        .maybeSingle();

      if (projectError) {
        logger.warning(LogOrigin.Server, `Error checking if project exists: ${projectError.message}`);
        return false;
      }

      // Se não encontrou registro, projeto não existe
      if (!projectRecord || !projectRecord.user_id) {
        return false;
      }

      // Busca na tabela users pelo id (FK)
      const { data: userRecord, error: userError } = await this.supabase
        .from('users')
        .select('email')
        .eq('id', projectRecord.user_id)
        .maybeSingle();

      if (userError) {
        logger.warning(LogOrigin.Server, `Error checking user email: ${userError.message}`);
        return false;
      }

      // Compara email do usuário encontrado com o email fornecido
      if (userRecord && userRecord.email === userEmail) {
        logger.info(LogOrigin.Server, `Project ${sanitizedCode} exists for user ${userEmail}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error(LogOrigin.Server, `Error in projectExistsForUser: ${error}`);
      return false;
    }
  }
}

// Export singleton instance
export const supabaseAdapter = new SupabaseAdapter();

