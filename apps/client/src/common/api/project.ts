import axios, { AxiosResponse } from 'axios';
import { ProjectData, ProjectLogoResponse, MessageResponse } from 'houseriaapp-types';

import { apiEntryUrl } from './constants';

const projectPath = `${apiEntryUrl}/project`;
const supabasePath = `${apiEntryUrl}/supabase`;

/**
 * HTTP request to fetch project data
 */
export async function getProjectData(): Promise<ProjectData> {
  const res = await axios.get(projectPath);
  return res.data;
}

/**
 * HTTP request to mutate project data
 */
export async function postProjectData(data: ProjectData): Promise<AxiosResponse<ProjectData>> {
  return axios.post(projectPath, data);
}

/**
 * HTTP request to upload a project logo
 */
export async function uploadProjectLogo(file: File): Promise<AxiosResponse<ProjectLogoResponse>> {
  const formData = new FormData();
  formData.append('image', file);
  const response = await axios.post(`${projectPath}/upload`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response;
}

/**
 * HTTP request to load a project from Supabase by project code
 */
export async function loadProjectFromSupabase(projectCode: string): Promise<MessageResponse> {
  const res = await axios.post(`${supabasePath}/load/${projectCode}`);
  return res.data;
}
