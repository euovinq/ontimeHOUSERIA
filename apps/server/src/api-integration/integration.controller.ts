import { MessageState, OffsetMode, OntimeEvent, SimpleDirection, SimplePlayback, LogOrigin, Playback } from 'houseriaapp-types';
import { MILLIS_PER_HOUR, MILLIS_PER_SECOND } from 'houseriaapp-utils';

import { DeepPartial } from 'ts-essentials';

import { ONTIME_VERSION } from '../ONTIME_VERSION.js';
import { auxTimerService } from '../services/aux-timer-service/AuxTimerService.js';
import * as messageService from '../services/message-service/MessageService.js';
import { validateMessage, validateTimerMessage } from '../services/message-service/messageUtils.js';
import { runtimeService } from '../services/runtime-service/RuntimeService.js';
import { eventStore } from '../stores/EventStore.js';
import { getState } from '../stores/runtimeState.js';
import * as assert from '../utils/assert.js';
import { isEmptyObject } from '../utils/parserUtils.js';
import { parseProperty, updateEvent } from './integration.utils.js';
import { socket } from '../adapters/WebsocketAdapter.js';
import { throttle } from '../utils/throttle.js';
import { willCauseRegeneration } from '../services/rundown-service/rundownCacheUtils.js';

import { handleLegacyMessageConversion } from './integration.legacy.js';
import { coerceEnum } from '../utils/coerceType.js';
import { supabaseAdapter } from '../adapters/SupabaseAdapter.js';
import { logger } from '../classes/Logger.js';
import { getDataProvider } from '../classes/data-provider/DataProvider.js';

const throttledUpdateEvent = throttle(updateEvent, 20);
let lastRequest: Date | null = null;

export function dispatchFromAdapter(type: string, payload: unknown, _source?: 'osc' | 'ws' | 'http') {
  const action = type.toLowerCase();
  const handler = actionHandlers[action];
  lastRequest = new Date();

  if (handler) {
    const result = handler(payload);

    // Trigger Supabase update for any button action
    if (supabaseAdapter && _source === 'ws') {
      // Add small delay to ensure state is updated
      setTimeout(() => {
        const currentData = eventStore.poll();
        supabaseAdapter.forceUpdate(currentData);
      }, 100);
    }

    return result;
  } else {
    throw new Error(`Unhandled message ${type}`);
  }
}

export function getLastRequest() {
  return lastRequest;
}

type AsyncPayload = Promise<{ payload: unknown }>;
type ActionHandler = (payload: unknown) => { payload: unknown } | AsyncPayload;

const actionHandlers: Record<string, ActionHandler> = {
  /* General */
  version: () => ({ payload: ONTIME_VERSION }),
  poll: () => ({
    payload: eventStore.poll(),
  }),
  change: (payload) => {
    assert.isObject(payload);
    if (Object.keys(payload).length === 0) {
      throw new Error('Payload is empty');
    }

    const id = Object.keys(payload).at(0);
    if (!id) {
      throw new Error('Missing Event ID');
    }

    const data = payload[id as keyof typeof payload];
    const patchEvent: Partial<OntimeEvent> & { id: string } = { id };

    let shouldThrottle = false;

    Object.entries(data).forEach(([property, value]) => {
      if (typeof property !== 'string' || value === undefined) {
        throw new Error('Invalid property or value');
      }
      // parseProperty is async because of the data lock
      const newObjectProperty = parseProperty(property, value);
      const key = Object.keys(newObjectProperty)[0] as keyof OntimeEvent;
      shouldThrottle = shouldThrottle || willCauseRegeneration(key);
      if (patchEvent.custom && newObjectProperty.custom) {
        Object.assign(patchEvent.custom, newObjectProperty.custom);
      } else {
        Object.assign(patchEvent, newObjectProperty);
      }
    });

    if (shouldThrottle) {
      if (throttledUpdateEvent(patchEvent)) {
        return { payload: 'throttled' };
      }
    } else {
      updateEvent(patchEvent);
    }
    return { payload: 'success' };
  },
  /* Message Service */
  message: (payload) => {
    assert.isObject(payload);

    // TODO: remove this once we feel its been enough time, ontime 3.6.0, 20/09/2024
    const migratedPayload = handleLegacyMessageConversion(payload);

    const patch: DeepPartial<MessageState> = {
      timer: 'timer' in migratedPayload ? validateTimerMessage(migratedPayload.timer) : undefined,
      external: 'external' in migratedPayload ? validateMessage(migratedPayload.external) : undefined,
    };

    const newMessage = messageService.patch(patch);
    return { payload: newMessage };
  },
  /* Playback */
  start: (payload) => {
    if (payload === undefined) {
      return successPayloadOrError(runtimeService.start(), 'Unable to start');
    }

    if (payload && typeof payload === 'object') {
      if ('index' in payload) {
        const eventIndex = numberOrError(payload.index);
        if (eventIndex <= 0) {
          throw new Error(`Event index out of range ${eventIndex}`);
        }
        // Indexes in frontend are 1 based
        return successPayloadOrError(
          runtimeService.startByIndex(eventIndex - 1),
          `Event index not recognised or out of range ${eventIndex}`,
        );
      }

      if ('id' in payload) {
        assert.isString(payload.id);
        return successPayloadOrError(runtimeService.startById(payload.id), `Unable to start ID: ${payload.id}`);
      }

      if ('cue' in payload) {
        const cue = extractCue(payload.cue);
        return successPayloadOrError(runtimeService.startByCue(cue), `Unable to start CUE: ${cue}`);
      }
    }

    if (payload === 'next') {
      return successPayloadOrError(runtimeService.startNext(), 'Unable to start next event');
    }

    if (payload === 'previous') {
      return successPayloadOrError(runtimeService.startPrevious(), 'Unable to start previous event');
    }

    throw new Error('No matching start function');
  },
  pause: () => {
    runtimeService.pause();
    return { payload: 'success' };
  },
  stop: () => {
    runtimeService.stop();
    return { payload: 'success' };
  },
  go: () => {
    const state = getState();
    const currentPlayback = state.timer.playback;
    
    // Se está pausado, resume (start)
    if (currentPlayback === Playback.Pause) {
      return successPayloadOrError(runtimeService.start(), 'Unable to resume');
    }
    
    // Se está tocando, avança para o próximo e inicia
    if (currentPlayback === Playback.Play) {
      return successPayloadOrError(runtimeService.startNext(), 'Unable to start next event');
    }
    
    // Se está armado ou parado, apenas inicia
    return successPayloadOrError(runtimeService.start(), 'Unable to start');
  },
  reload: () => {
    runtimeService.reload();
    return { payload: 'success' };
  },
  roll: () => {
    runtimeService.roll();
    return { payload: 'success' };
  },
  load: (payload) => {
    if (payload && typeof payload === 'object') {
      if ('index' in payload) {
        const eventIndex = numberOrError(payload.index);
        if (eventIndex <= 0) {
          throw new Error(`Event index out of range ${eventIndex}`);
        }
        // Indexes in frontend are 1 based
        return successPayloadOrError(
          runtimeService.loadByIndex(eventIndex - 1),
          `Event index not recognised or out of range ${eventIndex}`,
        );
      }

      if ('id' in payload) {
        assert.isString(payload.id);
        return successPayloadOrError(runtimeService.loadById(payload.id), `Unable to load ID: ${payload.id}`);
      }

      if ('cue' in payload) {
        const cue = extractCue(payload.cue);
        return successPayloadOrError(runtimeService.loadByCue(cue), `Unable to load CUE: ${cue}`);
      }
    }

    if (payload === 'next') {
      return successPayloadOrError(runtimeService.loadNext(), 'Unable to load next event');
    }

    if (payload === 'previous') {
      return successPayloadOrError(runtimeService.loadPrevious(), 'Unable to load previous event');
    }
    throw new Error('No matching method provided');
  },
  addtime: (payload) => {
    let time = 0;
    if (payload && typeof payload === 'object') {
      if ('add' in payload) {
        time = numberOrError(payload.add);
      } else if ('remove' in payload) {
        time = numberOrError(payload.remove) * -1;
      }
    } else {
      time = numberOrError(payload);
    }
    assert.isNumber(time);
    if (time === 0) {
      return { payload: 'success' };
    }

    const timeToAdd = time * MILLIS_PER_SECOND; // frontend is seconds based
    if (Math.abs(timeToAdd) > MILLIS_PER_HOUR) {
      throw new Error(`Payload too large: ${time}`);
    }

    runtimeService.addTime(timeToAdd);
    return { payload: 'success' };
  },
  /* Extra timers */
  auxtimer: (payload) => {
    assert.isObject(payload);
    if (!('1' in payload)) {
      throw new Error('Invalid auxtimer index');
    }
    let command = payload['1'];
    
    // Tenta fazer parse de JSON se o comando for uma string que parece JSON
    // Isso é necessário quando JSON é passado via query string (GET)
    if (typeof command === 'string' && (command.trim().startsWith('{') || command.trim().startsWith('['))) {
      try {
        command = JSON.parse(command);
      } catch {
        // Se não conseguir fazer parse, continua como string
      }
    }
    
    if (typeof command === 'string') {
      if (command === SimplePlayback.Start) {
        const reply = auxTimerService.start();
        return { payload: reply };
      }
      if (command === SimplePlayback.Pause) {
        const reply = auxTimerService.pause();
        return { payload: reply };
      }
      if (command === SimplePlayback.Stop) {
        const reply = auxTimerService.stop();
        return { payload: reply };
      }
    } else if (command && typeof command === 'object') {
      const reply = { payload: {} };
      if ('duration' in command) {
        // convert duration in seconds to ms
        const timeInMs = numberOrError(command.duration) * 1000;
        reply.payload = auxTimerService.setTime(timeInMs);
      }
      if ('addtime' in command) {
        // convert addTime in seconds to ms
        // Valores negativos removem tempo, valores positivos adicionam
        const timeInMs = numberOrError(command.addtime) * 1000;
        reply.payload = auxTimerService.addTime(timeInMs);
      }
      if ('direction' in command) {
        if (command.direction === SimpleDirection.CountUp || command.direction === SimpleDirection.CountDown) {
          reply.payload = auxTimerService.setDirection(command.direction);
        } else {
          throw new Error('Invalid direction payload');
        }
      }
      if (!isEmptyObject(reply.payload)) {
        return reply;
      }
    }
    throw new Error('No matching method provided');
  },
  /* Client */
  client: (payload) => {
    assert.isObject(payload);
    if (!('target' in payload) || typeof payload.target != 'string') {
      throw new Error('No or invalid client target');
    }

    if ('rename' in payload && typeof payload.rename == 'string') {
      const { target, rename } = payload;
      socket.renameClient(target, rename);
      return { payload: 'success' };
    }

    if ('redirect' in payload && typeof payload.redirect == 'string') {
      const { target, redirect } = payload;
      socket.redirectClient(target, redirect);
      return { payload: 'success' };
    }

    if ('identify' in payload && typeof payload.identify == 'boolean') {
      const { target, identify } = payload;
      socket.identifyClient(target, identify);
      return { payload: 'success' };
    }

    throw new Error('No matching method provided');
  },
  offsetmode: (payload) => {
    const mode = coerceEnum<OffsetMode>(payload, OffsetMode);
    runtimeService.setOffsetMode(mode);
    return { payload: 'success' };
  },
  togglesupabase: async () => {
    const wasConnected = supabaseAdapter.getConnectionStatus().connected;
    const isConnected = supabaseAdapter.toggleConnection();
    
    // Aguarda um delay para garantir que init() completo foi executado
    // (init() é assíncrono e chama testConnection() que também é assíncrono)
    await new Promise(resolve => setTimeout(resolve, 800));
    
    const status = supabaseAdapter.getConnectionStatus();
    
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
      logger.info(LogOrigin.Server, `📡 Supabase toggle - Usando fallback: status baseado no toggle`);
    }
    
    logger.info(
      LogOrigin.Server,
      `📡 Supabase toggle - Status final: ${JSON.stringify(finalStatus)}`
    );
    
    // Envia atualização via WebSocket para todos os clientes conectados
    socket.sendAsJson({
      type: 'togglesupabase',
      payload: finalStatus,
    });
    
    return { payload: finalStatus };
  },
  getsupabasestatus: () => {
    const status = supabaseAdapter.getConnectionStatus();
    return { payload: status };
  },
  'approve-change': async (payload) => {
    assert.isObject(payload);
    if (!('change' in payload) || typeof payload.change !== 'object' || payload.change === null) {
      throw new Error('approve-change requires payload.change (object)');
    }
    const change = payload.change as import('houseriaapp-types').OntimeChange;
    const success = await supabaseAdapter.applyChangeAndRemove(change);
    return { payload: success ? 'success' : 'error' };
  },
  'get-changes': async () => {
    const projectCode = getDataProvider().getProjectData()?.projectCode || '';
    if (!projectCode) return { payload: [] };
    const changes = await supabaseAdapter.getChangesForProject(projectCode);
    return { payload: changes };
  },
  'reject-change': async (payload) => {
    assert.isObject(payload);
    if (!('changeId' in payload) || typeof payload.changeId !== 'string') {
      throw new Error('reject-change requires payload.changeId (string)');
    }
    const projectCode = getDataProvider().getProjectData()?.projectCode || '';
    if (!projectCode) {
      throw new Error('No project loaded');
    }
    const success = await supabaseAdapter.removeChangeFromArray(projectCode, payload.changeId);
    return { payload: success ? 'success' : 'error' };
  },
  togglepowerpoint: async () => {
    // Importa dinamicamente para evitar dependência circular
    const module = await import('../api-data/powerpoint/powerpoint.controller.js');
    let { supabaseService } = module;
    const { initializeSupabaseService, websocketService: wsSocketService } = module;
    
    // Verifica se WebSocket está conectado (único critério agora)
    const hasWebSocket = wsSocketService && wsSocketService.isServiceConnected && wsSocketService.isServiceConnected();
    
    // Log de debug para entender o estado
    if (wsSocketService) {
      const isConnected = wsSocketService.isServiceConnected();
      const hasStatus = wsSocketService.getStatus && wsSocketService.getStatus() !== null;
      logger.info(LogOrigin.Server, `🔍 PowerPoint toggle - Debug: WebSocket existe=${!!wsSocketService}, isConnected=${isConnected}, hasStatus=${hasStatus}`);
    } else {
      logger.warning(LogOrigin.Server, '⚠️  PowerPoint toggle - websocketService não existe ainda');
    }
    
    if (!hasWebSocket) {
      logger.warning(LogOrigin.Server, '⚠️  PowerPoint toggle - WebSocket não conectado! Aguarde conexão com o HouseriaPPT.');
      socket.sendAsJson({
        type: 'powerpoint-status',
        payload: { enabled: false, error: 'Não conectado ao HouseriaPPT. Aguarde conexão automática ou verifique se o HouseriaPPT está rodando.' },
      });
      return { payload: { enabled: false, error: 'Não conectado ao HouseriaPPT. Aguarde conexão automática ou verifique se o HouseriaPPT está rodando.' } };
    }
    
    // Se serviço não existe, tenta inicializar
    if (!supabaseService) {
      logger.info(LogOrigin.Server, '⚠️  PowerPoint toggle - Serviço não existe, tentando inicializar...');
      
      try {
        if (initializeSupabaseService) {
          initializeSupabaseService();
          // Espera um pouco para o serviço ser criado
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Importa novamente para pegar o serviço criado
          const refreshedModule = await import('../api-data/powerpoint/powerpoint.controller.js');
          supabaseService = refreshedModule.supabaseService;
          
          if (supabaseService) {
            // Serviço foi criado - atualiza projectCode e faz toggle
            logger.info(LogOrigin.Server, '✅ PowerPoint toggle - Serviço criado com sucesso após inicialização!');
            
            // Atualiza projectCode antes de fazer toggle
            const projectData = getDataProvider().getProjectData();
            const projectCode = projectData?.projectCode;
            if (projectCode) {
              supabaseService.setProjectCode(projectCode);
              logger.info(LogOrigin.Server, `📌 PowerPoint toggle - Project code configurado: ${projectCode}`);
            } else {
              logger.warning(LogOrigin.Server, '⚠️  PowerPoint toggle - Project code não encontrado');
            }
            
            const enabled = await supabaseService.toggleEnabled();
            
            // Busca informações do slide
            const slideInfo: { currentSlide?: number; slideCount?: number } = {};
            try {
              const { websocketService: wsSvc } = refreshedModule;
              if (wsSvc && wsSvc.isServiceConnected()) {
                const status = wsSvc.getStatus();
                if (status) {
                  slideInfo.currentSlide = status.currentSlide;
                  slideInfo.slideCount = status.slideCount;
                }
              }
            } catch (error) {
              // Ignora erro
            }
            
            socket.sendAsJson({
              type: 'powerpoint-status',
              payload: { enabled, ...slideInfo },
            });
            logger.info(LogOrigin.Server, `🔄 PowerPoint toggle (após inicialização): ${enabled ? 'Habilitado (verde)' : 'Desabilitado (vermelho)'}`);
            return { payload: { enabled, ...slideInfo } };
          } else {
            logger.warning(LogOrigin.Server, '⚠️  PowerPoint toggle - Serviço não foi criado. Verificando logs de erro...');
          }
        }
      } catch (err) {
        logger.error(LogOrigin.Server, `❌ PowerPoint toggle - Erro ao inicializar: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
        if (err instanceof Error && err.stack) {
          logger.error(LogOrigin.Server, `Stack: ${err.stack}`);
        }
      }
      
      // Se não conseguiu inicializar, retorna erro
      socket.sendAsJson({
        type: 'powerpoint-status',
        payload: { enabled: false, error: 'Erro ao inicializar serviço. Verifique logs do servidor.' },
      });
      return { payload: { enabled: false, error: 'Erro ao inicializar serviço. Verifique logs do servidor.' } };
    }
    
    // Serviço existe - atualiza projectCode e faz toggle do estado enabled
    // Atualiza projectCode antes de fazer toggle
    const projectData = getDataProvider().getProjectData();
    const projectCode = projectData?.projectCode;
    if (projectCode && supabaseService) {
      supabaseService.setProjectCode(projectCode);
      logger.info(LogOrigin.Server, `📌 PowerPoint toggle - Project code atualizado: ${projectCode}`);
    }
    
    const enabled = await supabaseService.toggleEnabled();
    
    // Busca informações do slide do WebSocket (único serviço usado agora)
    const slideInfo: { currentSlide?: number; slideCount?: number } = {};
    try {
      const { websocketService } = await import('../api-data/powerpoint/powerpoint.controller.js');
      if (websocketService && websocketService.isServiceConnected()) {
        const status = websocketService.getStatus();
        if (status) {
          slideInfo.currentSlide = status.currentSlide;
          slideInfo.slideCount = status.slideCount;
        }
      }
    } catch (error) {
      // Ignora erro ao buscar slide info
    }
    
    // Envia evento para todos os clientes
    socket.sendAsJson({
      type: 'powerpoint-status',
      payload: { enabled, ...slideInfo },
    });
    logger.info(LogOrigin.Server, `🔄 PowerPoint toggle: ${enabled ? 'Habilitado (verde) - Enviando dados' : 'Desabilitado (vermelho) - Não enviando dados'}`);
    return { payload: { enabled, ...slideInfo } };
  },
  getpowerpointstatus: async () => {
    // Importa dinamicamente para evitar dependência circular
    const { supabaseService, websocketService, windowsService } = await import('../api-data/powerpoint/powerpoint.controller.js');
    
    const payload: { enabled: boolean; currentSlide?: number; slideCount?: number } = { enabled: false };
    
    if (supabaseService) {
      payload.enabled = supabaseService.getEnabled();
      
      // Busca informações do slide do serviço ativo
      if (websocketService && websocketService.isServiceConnected()) {
        const status = websocketService.getStatus();
        if (status) {
          payload.currentSlide = status.currentSlide;
          payload.slideCount = status.slideCount;
        }
      } else if (windowsService) {
        const status = windowsService.getStatus ? windowsService.getStatus() : null;
        if (status) {
          payload.currentSlide = status.currentSlide;
          payload.slideCount = status.slideCount;
        }
      }
    }
    
    return { payload };
  },
};

/**
 * Returns a value of type number, converting if necessary
 * Otherwise throws
 * @param value
 * @returns number
 * @throws
 */
function numberOrError(value: unknown) {
  const converted = Number(value);
  if (isNaN(converted)) {
    throw new Error('Payload is not a valid number');
  }
  return converted;
}

function extractCue(value: unknown): string {
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  throw new Error('Payload is not a valid string or number');
}

function successPayloadOrError(success: boolean, error: string) {
  if (!success) {
    throw new Error(error);
  }
  return { payload: 'success' };
}
