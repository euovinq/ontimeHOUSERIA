import { Request, Response } from 'express';

import { eventStore } from '../../stores/EventStore.js';
import { logger } from '../../classes/Logger.js';
import { LogOrigin } from 'ontime-types';
import { getDataProvider } from '../../classes/data-provider/DataProvider.js';

export interface RealtimeData {
  timer: {
    current: number | null;
    duration: number | null;
    playback: string;
    phase: string;
    elapsed: number | null;
    expectedFinish: number | null;
    startedAt: number | null;
    finishedAt: number | null;
    addedTime: number;
  };
  currentEvent: {
    id: string | null;
    cue: string | null;
    title: string | null;
    note: string | null;
    timeStart: number | null;
    timeEnd: number | null;
    duration: number | null;
    isPublic: boolean;
    colour: string;
    custom: Record<string, any>;
  } | null;
  nextEvent: {
    id: string | null;
    cue: string | null;
    title: string | null;
    note: string | null;
    timeStart: number | null;
    timeEnd: number | null;
    duration: number | null;
    isPublic: boolean;
    colour: string;
    custom: Record<string, any>;
  } | null;
  delay: {
    offset: number;
    relativeOffset: number;
    expectedEnd: number | null;
  };
  clock: number;
  onAir: boolean;
  cuesheet: {
    rundown: any[];
    customFields: any;
    totalEvents: number;
    totalDuration: number;
  };
}

export async function getRealtimeData(_req: Request, res: Response<RealtimeData>) {
  try {
    const store = eventStore.poll();
    
    const timer = store.timer || {};
    const currentEvent = store.eventNow;
    const nextEvent = store.eventNext;
    const runtime = store.runtime || {};
    const clock = store.clock || 0;
    const onAir = store.onAir || false;

    // Get rundown data
    const rundown = getDataProvider().getRundown();
    const customFields = getDataProvider().getCustomFields();

    const response: RealtimeData = {
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
      clock,
      onAir,
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

    res.status(200).json(response);
  } catch (error) {
    logger.error(LogOrigin.Rx, `Error getting realtime data: ${error}`);
    res.status(500).json({
      timer: {
        current: null,
        duration: null,
        playback: 'Stop',
        phase: 'Stopped',
        elapsed: null,
        expectedFinish: null,
        startedAt: null,
        finishedAt: null,
        addedTime: 0,
      },
      currentEvent: null,
      nextEvent: null,
      delay: {
        offset: 0,
        relativeOffset: 0,
        expectedEnd: null,
      },
      clock: 0,
      onAir: false,
    } as RealtimeData);
  }
}

