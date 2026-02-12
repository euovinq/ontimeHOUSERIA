import { createClient } from '@supabase/supabase-js';
import { eventStore } from '../stores/EventStore.js';
import { logger } from '../classes/Logger.js';
import { LogOrigin } from 'houseriaapp-types';
import { getDataProvider } from '../classes/data-provider/DataProvider.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { publicDir } from '../setup/index.js';
import { socket } from './WebsocketAdapter.js';
import type { OntimeChange } from 'houseriaapp-types';
import { updateEvent } from '../api-integration/integration.utils.js';

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
  
  private isApplyingRealtimeUpdate = false; // Flag to prevent loops when applying updates

  // Changes listener - INDEPENDENT of toggle, always active when project is loaded
  private changesSupabaseClient: any = null;
  private changesRealtimeChannel: any = null;
  private lastChangesProjectCode: string = '';
  private changesCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Set config file path
    this.configFilePath = join(publicDir.root, 'supabase-config.json');

    // Load hardcoded configuration - ALWAYS start disabled
    this.loadConfigFromEnv();

    // Setup eventStore listener after a delay to ensure eventStore is initialized
    setTimeout(() => {
      this.setupEventStoreListener();
    }, 1000);

    // Setup changes listener - INDEPENDENT of toggle, checks periodically for project
    this.startChangesListenerCheck();
  }

  /**
   * Start periodic check for project - setup changes Realtime subscription when project is loaded
   * This runs independently of the toggle button
   */
  private startChangesListenerCheck() {
    if (this.changesCheckInterval) return;
    const check = () => {
      try {
        const projectData = getDataProvider().getProjectData();
        const projectCode = projectData?.projectCode || '';
        if (projectCode && projectCode !== this.lastChangesProjectCode) {
          this.setupChangesRealtimeSubscription();
        } else if (!projectCode && this.lastChangesProjectCode) {
          this.teardownChangesRealtimeSubscription();
        }
      } catch {
        // DataProvider not ready yet (db.data undefined)
      }
    };
    setTimeout(check, 1500); // Delay until DataProvider is initialized
    this.changesCheckInterval = setInterval(check, 3000);
  }

  /**
   * Setup Realtime subscription for changes - INDEPENDENT of toggle
   * Always listens when we have config (url, anonKey) and projectCode
   */
  private setupChangesRealtimeSubscription() {
    if (!this.config?.url || !this.config?.anonKey) return;

    const projectData = getDataProvider().getProjectData();
    const projectCode = projectData?.projectCode || '';
    if (!projectCode) return;

    if (this.lastChangesProjectCode === projectCode && this.changesRealtimeChannel) {
      return; // Already subscribed to this project
    }

    this.teardownChangesRealtimeSubscription();

    try {
      this.changesSupabaseClient = createClient(this.config.url, this.config.anonKey);
      this.lastChangesProjectCode = projectCode;

      logger.info(
        LogOrigin.Server,
        `Supabase: Setting up changes listener (independent of toggle) for project: ${projectCode}`,
      );

      this.changesRealtimeChannel = this.changesSupabaseClient
        .channel(`ontime-changes-${projectCode}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: this.config.tableName || 'ontime_realtime',
            filter: `id=eq.${projectCode}`,
          },
          (payload: any) => {
            this.handleRealtimeUpdate(payload);
          },
        )
        .subscribe((status: string) => {
          logger.info(LogOrigin.Server, `Supabase changes listener: status=${status}`);
          if (status === 'SUBSCRIBED') {
            this.fetchAndBroadcastInitialChanges(projectCode);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            this.lastChangesProjectCode = '';
          }
        });
    } catch (error) {
      logger.error(LogOrigin.Server, `Supabase: Error setting up changes listener: ${error}`);
    }
  }

  /**
   * Fetch current changes from DB and broadcast to clients (for items already in DB before subscription)
   */
  private async fetchAndBroadcastInitialChanges(projectCode: string) {
    if (!this.changesSupabaseClient || !this.config) return;
    try {
      const sanitized = (projectCode || '').trim().toUpperCase();
      if (!sanitized) return;

      // Try project_code first, then id (table may use either)
      let result = await this.changesSupabaseClient
        .from(this.config.tableName || 'ontime_realtime')
        .select('changes')
        .eq('project_code', sanitized)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (result.error || !result.data?.length) {
        result = await this.changesSupabaseClient
          .from(this.config.tableName || 'ontime_realtime')
          .select('changes')
          .eq('id', sanitized)
          .maybeSingle();
      }

      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      const raw = row?.changes;
      const toBroadcast = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
      if (toBroadcast.length > 0) {
        logger.info(LogOrigin.Server, `Supabase: Broadcasting initial changes (${toBroadcast.length} item(s))`);
        socket.sendAsJson({ type: 'ontime-changes', payload: toBroadcast });
      }
    } catch (err) {
      logger.warning(LogOrigin.Server, `Supabase: Error fetching initial changes: ${err}`);
    }
  }

  /**
   * Teardown changes Realtime subscription
   */
  private teardownChangesRealtimeSubscription() {
    if (this.changesRealtimeChannel) {
      try {
        this.changesRealtimeChannel.unsubscribe();
      } catch (e) {
        // ignore
      }
      this.changesRealtimeChannel = null;
    }
    this.changesSupabaseClient = null;
    this.lastChangesProjectCode = '';
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

        // Send initial data (await para garantir que o envio complete)
        await this.sendToSupabase();

        // Realtime for changes is handled by setupChangesRealtimeSubscription (independent of toggle)
      }
    } catch (error) {
      console.error(`❌ Failed to initialize Supabase: ${error}`);
      this.isConnected = false;
    }
  }

  /**
   * Handle realtime updates received from Supabase (from changes listener)
   */
  private async handleRealtimeUpdate(payload: any) {
    try {
      const eventType = payload.eventType; // 'INSERT', 'UPDATE', 'DELETE'
      const newData = payload.new;

      logger.info(LogOrigin.Server, `Supabase: Realtime update received - event: ${eventType}`);
      logger.info(LogOrigin.Server, `Supabase: Payload structure - newData keys: ${newData ? Object.keys(newData).join(', ') : 'null'}`);
      
      // Only process UPDATE events (INSERT/DELETE are less common for project updates)
      if (eventType !== 'UPDATE') {
        logger.info(LogOrigin.Server, `Supabase: Ignoring ${eventType} event (only processing UPDATE)`);
        return;
      }

      if (!newData) {
        logger.warning(LogOrigin.Server, 'Supabase: Realtime update received but newData is null');
        return;
      }

      // Extract project code from the row
      const projectCode = newData.id || newData.project_code;
      
      if (!projectCode) {
        logger.warning(LogOrigin.Server, 'Supabase: Realtime update received but no project code found');
        return;
      }

      // Verify this is for the current project
      const currentProjectData = getDataProvider().getProjectData();
      const currentProjectCode = currentProjectData?.projectCode || '';
      
      if (projectCode !== currentProjectCode) {
        logger.info(LogOrigin.Server, `Supabase: Ignoring realtime update for different project: ${projectCode} (current: ${currentProjectCode})`);
        return;
      }

      // Process changes column - ALWAYS broadcast (independent of toggle)
      const raw = newData.changes;
      const toBroadcast = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
      if (toBroadcast.length > 0) {
        logger.info(LogOrigin.Server, `Supabase: Broadcasting changes to clients (${toBroadcast.length} item(s))`);
        socket.sendAsJson({ type: 'ontime-changes', payload: toBroadcast });
      }

      // NÃO aplica os dados automaticamente - requer aprovação do usuário.
      // Os dados (project, rundown, customFields, etc.) só serão aplicados quando
      // o usuário clicar em "Aplicar" ou "Aplicar tudo" no toast de alterações.
    } catch (error) {
      logger.error(LogOrigin.Server, `Supabase: Error handling realtime update: ${error}`);
      console.error('Supabase handleRealtimeUpdate error:', error);
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
        // Don't send updates if we're currently applying a realtime update (to avoid loops)
        if (this.isConnected && !this.isApplyingRealtimeUpdate) {
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

      // Changes listener is updated by startChangesListenerCheck (independent of toggle)

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
   * Envia os dados atuais para o Supabase conectando, enviando e desconectando.
   * Usa a mesma lógica que funciona quando o usuário clica em Conectar.
   */
  public async syncDataToSupabase(): Promise<boolean> {
    if (!this.config?.url || !this.config?.anonKey) {
      logger.warning(LogOrigin.Server, 'syncDataToSupabase: config ausente');
      return false;
    }

    const wasConnected = this.isConnected;

    try {
      const config: SupabaseConfig = { ...this.config, enabled: true };
      await this.init(config);

      if (!this.isConnected) {
        logger.warning(LogOrigin.Server, 'syncDataToSupabase: init falhou');
        return false;
      }

      logger.info(LogOrigin.Server, 'syncDataToSupabase: dados enviados com sucesso');

      if (!wasConnected) {
        this.disconnect();
      }
      return true;
    } catch (err) {
      logger.error(LogOrigin.Server, `syncDataToSupabase error: ${err}`);
      if (!wasConnected) {
        this.disconnect();
      }
      return false;
    }
  }

  /**
   * Disconnect from Supabase (send only - does NOT affect changes listener)
   */
  private disconnect() {
    this.isConnected = false;
    this.supabase = null;
    // Keep config so we can reconnect later
    // Changes listener (changesSupabaseClient) stays active - independent of toggle
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

      // Garantir que o payload também tenha o projectCode sanitizado
      const sanitizedPayload = {
        ...payload,
        projectCode: sanitizedProjectCode,
        project: {
          ...payload.project,
          projectCode: sanitizedProjectCode
        }
      };

      const { error } = await this.supabase
        .from(this.config.tableName || 'ontime_realtime')
        .upsert({
          id: sanitizedProjectCode,
          data: sanitizedPayload,
          project_code: sanitizedProjectCode,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'id'  // Usa id como chave primária (id = project_code)
        });

      if (error) {
        logger.error(LogOrigin.Server, `Supabase upsert error: ${error.message} (code: ${error.code})`);
        console.error(`Supabase upsert error: ${error.message}`);
      } else {
        logger.info(LogOrigin.Server, `Dados salvos no Supabase para projeto: ${sanitizedProjectCode}`);
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
      const { data: _data, error } = await this.supabase
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
   * Busca projeto no Supabase SOMENTE LEITURA - não conecta, não envia dados.
   * Usado pelo Recarregar para baixar projeto atualizado sem sobrescrever no Supabase.
   */
  async getProjectDataReadOnly(
    projectCode: string,
  ): Promise<{ data: any; user_id?: string | number | null } | null> {
    const sanitizedCode = (projectCode || '').trim().toUpperCase();
    if (!sanitizedCode) return null;
    if (!this.config?.url || !this.config?.anonKey) {
      logger.warning(LogOrigin.Server, 'getProjectDataReadOnly: config ausente');
      return null;
    }

    const readClient = createClient(this.config.url, this.config.anonKey);
    const table = this.config.tableName || 'ontime_realtime';

    try {
      logger.info(LogOrigin.Server, `Buscando projeto (read-only): ${sanitizedCode}`);

      const { data: allRecords, error: queryError } = await readClient
        .from(table)
        .select('data, user_id, project_code, id, updated_at')
        .eq('project_code', sanitizedCode)
        .order('updated_at', { ascending: false })
        .limit(10);

      if (queryError) {
        const resultById = await readClient
          .from(table)
          .select('data, user_id, project_code, id, updated_at')
          .eq('id', sanitizedCode)
          .maybeSingle();
        if (resultById.data) {
          const d = resultById.data;
          return { data: d.data, user_id: (d as any).user_id ?? null };
        }
        logger.info(LogOrigin.Server, `Erro read-only: ${queryError.message}`);
        return null;
      }

      if (allRecords && allRecords.length > 0) {
        const d = allRecords[0];
        logger.info(LogOrigin.Server, `✅ Projeto encontrado (read-only): ${sanitizedCode}`);
        return { data: d.data, user_id: (d as any).user_id ?? null };
      }

      const resultById = await readClient
        .from(table)
        .select('data, user_id, project_code, id, updated_at')
        .eq('id', sanitizedCode)
        .maybeSingle();

      if (resultById.data) {
        const d = resultById.data;
        return { data: d.data, user_id: (d as any).user_id ?? null };
      }

      return null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error(LogOrigin.Server, `getProjectDataReadOnly erro: ${msg}`);
      return null;
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
   * Busca o array changes de um projeto. Usa changes client, main client, ou cria um temporário.
   */
  async getChangesForProject(projectCode: string): Promise<unknown[]> {
    let client = this.getSupabaseClientForDb();
    if (!client && this.config?.url && this.config?.anonKey) {
      client = createClient(this.config.url, this.config.anonKey);
    }
    if (!client || !this.config) return [];

    try {
      const sanitizedCode = (projectCode || '').trim().toUpperCase();
      if (!sanitizedCode) return [];

      let row: { changes?: unknown[] } | null = null;

      const byProjectCode = await client
        .from(this.config.tableName || 'ontime_realtime')
        .select('changes')
        .eq('project_code', sanitizedCode)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (!byProjectCode.error && byProjectCode.data?.[0]) {
        row = byProjectCode.data[0];
      } else {
        const byId = await client
          .from(this.config.tableName || 'ontime_realtime')
          .select('changes')
          .eq('id', sanitizedCode)
          .maybeSingle();
        if (!byId.error && byId.data) row = byId.data;
      }

      const raw = row?.changes;
      return Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    } catch {
      return [];
    }
  }

  /**
   * Get Supabase client for DB operations - use main client if connected, else changes client
   */
  private getSupabaseClientForDb(): any {
    if (this.supabase) return this.supabase;
    if (this.changesSupabaseClient) return this.changesSupabaseClient;
    return null;
  }

  /**
   * Remove a change item from the changes array in ontime_realtime
   * Works with either main client or changes client (so approve/reject works when toggle is off)
   */
  async removeChangeFromArray(projectCode: string, changeId: string): Promise<boolean> {
    const client = this.getSupabaseClientForDb();
    if (!client || !this.config) {
      return false;
    }

    try {
      const sanitizedCode = (projectCode || '').trim().toUpperCase();
      if (!sanitizedCode) {
        return false;
      }

      // Fetch current row - by project_code (or id as fallback for backwards compat)
      let row: { id: string; changes?: unknown[] } | null = null;

      const byProjectCode = await client
        .from(this.config.tableName || 'ontime_realtime')
        .select('id, changes')
        .eq('project_code', sanitizedCode)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (!byProjectCode.error && byProjectCode.data && byProjectCode.data.length > 0) {
        row = byProjectCode.data[0];
      } else {
        const byId = await client
          .from(this.config.tableName || 'ontime_realtime')
          .select('id, changes')
          .eq('id', sanitizedCode)
          .maybeSingle();
        if (!byId.error && byId.data) {
          row = byId.data;
        }
      }

      if (!row) {
        logger.warning(LogOrigin.Server, `removeChangeFromArray: No row found for project ${sanitizedCode}`);
        return false;
      }
      const currentChanges = Array.isArray(row.changes) ? row.changes : row.changes != null ? [row.changes] : [];
      let newChanges = currentChanges.filter((c: { id?: string }) => (c as any)?.id !== changeId);
      if (newChanges.length === currentChanges.length) {
        const hasProjectUpdateNoId = currentChanges.some(
          (c: any) => c?.type === 'project_data_updated' && !c?.id
        );
        if (hasProjectUpdateNoId) {
          newChanges = [];
          logger.info(LogOrigin.Server, `removeChangeFromArray: Cleared project_data_updated (no id)`);
        } else {
          logger.warning(LogOrigin.Server, `removeChangeFromArray: Change ${changeId} not found in array`);
        }
      }

      const { error: updateError } = await client
        .from(this.config.tableName || 'ontime_realtime')
        .update({
          changes: newChanges,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      if (updateError) {
        logger.error(LogOrigin.Server, `removeChangeFromArray error: ${updateError.message}`);
        return false;
      }

      logger.info(LogOrigin.Server, `removeChangeFromArray: Removed change ${changeId} from project ${sanitizedCode}`);
      return true;
    } catch (error) {
      logger.error(LogOrigin.Server, `removeChangeFromArray error: ${error}`);
      return false;
    }
  }

  /**
   * Apply an OntimeChange (custom action) to the local project and remove it from the array
   */
  async applyChangeAndRemove(change: OntimeChange): Promise<boolean> {
    try {
      if (change.path === 'cuesheet.rundown' && change.eventId && change.field?.startsWith('custom.')) {
        const fieldName = change.field.replace('custom.', '');
        updateEvent({
          id: change.eventId,
          custom: { [fieldName]: change.after },
        } as any);
      } else if (change.path === 'cuesheet.rundown' && change.eventId) {
        // Non-custom field
        updateEvent({
          id: change.eventId,
          [change.field]: change.after,
        } as any);
      } else {
        logger.warning(LogOrigin.Server, `applyChangeAndRemove: Unsupported path/field: ${change.path}/${change.field}`);
        return false;
      }

      const projectData = getDataProvider().getProjectData();
      const projectCode = projectData?.projectCode || '';
      if (!projectCode) {
        logger.warning(LogOrigin.Server, 'applyChangeAndRemove: No project code');
        return false;
      }

      const removed = await this.removeChangeFromArray(projectCode, change.id);
      if (removed) {
        await new Promise((r) => setTimeout(r, 250));
        await this.syncDataToSupabase();
        return true;
      }
      return false;
    } catch (error) {
      logger.error(LogOrigin.Server, `applyChangeAndRemove error: ${error}`);
      return false;
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

