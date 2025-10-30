import { ErrorResponse, ProjectData } from 'houseriaapp-types';
import { getErrorMessage } from 'houseriaapp-utils';

import type { Request, Response } from 'express';

import { removeUndefined } from '../../utils/parserUtils.js';
import { failEmptyObjects } from '../../utils/routerUtils.js';
import { editCurrentProjectData } from '../../services/project-service/ProjectService.js';
import { supabaseAdapter } from '../../adapters/SupabaseAdapter.js';
import * as projectDao from './project.dao.js';

export function getProjectData(_req: Request, res: Response<ProjectData>) {
  res.json(projectDao.getProjectData());
}

export async function postProjectData(req: Request, res: Response<ProjectData | ErrorResponse>) {
  if (failEmptyObjects(req.body, res)) {
    return;
  }

  try {
    const newData: Partial<ProjectData> = removeUndefined({
      title: req.body?.title,
      description: req.body?.description,
      publicUrl: req.body?.publicUrl,
      publicInfo: req.body?.publicInfo,
      backstageUrl: req.body?.backstageUrl,
      backstageInfo: req.body?.backstageInfo,
      endMessage: req.body?.endMessage,
      projectLogo: req.body?.projectLogo,
      projectCode: req.body?.projectCode,
      directorWhatsapp: req.body?.directorWhatsapp,
      custom: req.body?.custom,
    });

    const updatedData = await editCurrentProjectData(newData);

    // Force Supabase update after saving project data
    // Small delay to ensure data is persisted
    setTimeout(() => {
      supabaseAdapter.forceProjectUpdate();
    }, 100);

    res.status(200).send(updatedData);
  } catch (error) {
    const message = getErrorMessage(error);
    res.status(400).send({ message });
  }
}
