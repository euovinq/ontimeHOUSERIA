import {
  ErrorResponse,
  MessageResponse,
  OntimeRundown,
  OntimeRundownEntry,
  RundownCached,
  RundownPaginated,
} from 'houseriaapp-types';
import { getErrorMessage } from 'houseriaapp-utils';

import type { Request, Response } from 'express';

import { supabaseAdapter } from '../../adapters/SupabaseAdapter.js';
import { failEmptyObjects } from '../../utils/routerUtils.js';
import {
  addEvent,
  applyDelay,
  batchEditEvents,
  deleteAllEvents,
  deleteEvent,
  editEvent,
  reorderEvent,
  swapEvents,
} from '../../services/rundown-service/RundownService.js';
import {
  getEventWithId,
  getNormalisedRundown,
  getPaginated,
  getRundown,
} from '../../services/rundown-service/rundownUtils.js';

export async function rundownGetAll(_req: Request, res: Response<OntimeRundown>) {
  const rundown = getRundown();
  res.json(rundown);
}

export async function rundownGetNormalised(_req: Request, res: Response<RundownCached>) {
  const cachedRundown = getNormalisedRundown();
  res.json(cachedRundown);
}

export async function rundownGetById(req: Request, res: Response<OntimeRundownEntry | ErrorResponse>) {
  const { eventId } = req.params;

  try {
    const event = getEventWithId(eventId);

    if (!event) {
      res.status(404).send({ message: 'Event not found' });
      return;
    }
    res.status(200).json(event);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(500).json({ message });
  }
}

export async function rundownGetPaginated(req: Request, res: Response<RundownPaginated | ErrorResponse>) {
  const { limit, offset } = req.query;

  if (limit == null && offset == null) {
    return res.json({
      rundown: getRundown(),
      total: getRundown().length,
    });
  }

  try {
    let parsedOffset = Number(offset);
    if (Number.isNaN(parsedOffset)) {
      parsedOffset = 0;
    }
    let parsedLimit = Number(limit);
    if (Number.isNaN(parsedLimit)) {
      parsedLimit = Infinity;
    }
    const paginatedRundown = getPaginated(parsedOffset, parsedLimit);

    res.status(200).json(paginatedRundown);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).json({ message });
  }
}

export async function rundownPost(req: Request, res: Response<OntimeRundownEntry | ErrorResponse>) {
  if (failEmptyObjects(req.body, res)) {
    return;
  }

  try {
    const newEvent = await addEvent(req.body);
    setTimeout(() => supabaseAdapter.forceProjectUpdate(), 100);
    res.status(201).send(newEvent);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}

export async function rundownPut(req: Request, res: Response<OntimeRundownEntry | ErrorResponse>) {
  if (failEmptyObjects(req.body, res)) {
    return;
  }

  try {
    const event = await editEvent(req.body);
    setTimeout(() => supabaseAdapter.forceProjectUpdate(), 100);
    res.status(200).send(event);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}

export async function rundownBatchPut(req: Request, res: Response<MessageResponse | ErrorResponse>) {
  if (failEmptyObjects(req.body, res)) {
    return res.status(404);
  }

  try {
    const { data, ids } = req.body;
    await batchEditEvents(ids, data);
    setTimeout(() => supabaseAdapter.forceProjectUpdate(), 100);
    res.status(200).send({ message: 'Batch edit successful' });
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}

export async function rundownReorder(req: Request, res: Response<OntimeRundownEntry | ErrorResponse>) {
  if (failEmptyObjects(req.body, res)) {
    return;
  }

  try {
    const { eventId, from, to } = req.body;
    const event = await reorderEvent(eventId, from, to);
    setTimeout(() => supabaseAdapter.forceProjectUpdate(), 100);
    res.status(200).send(event.newEvent);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}

export async function rundownSwap(req: Request, res: Response<MessageResponse | ErrorResponse>) {
  if (failEmptyObjects(req.body, res)) {
    return;
  }

  try {
    const { from, to } = req.body;
    await swapEvents(from, to);
    setTimeout(() => supabaseAdapter.forceProjectUpdate(), 100);
    res.status(200).send({ message: 'Swap successful' });
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}

export async function rundownApplyDelay(req: Request, res: Response<MessageResponse | ErrorResponse>) {
  try {
    await applyDelay(req.params.eventId);
    setTimeout(() => supabaseAdapter.forceProjectUpdate(), 100);
    res.status(200).send({ message: 'Delay applied' });
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}

export async function rundownDelete(_req: Request, res: Response<MessageResponse | ErrorResponse>) {
  try {
    await deleteAllEvents();
    setTimeout(() => supabaseAdapter.forceProjectUpdate(), 100);
    res.status(204).send({ message: 'All events deleted' });
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}

export async function deletesEventById(req: Request, res: Response<MessageResponse | ErrorResponse>) {
  try {
    await deleteEvent(req.body.ids);
    setTimeout(() => supabaseAdapter.forceProjectUpdate(), 100);
    res.status(204).send({ message: 'Events deleted' });
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}
