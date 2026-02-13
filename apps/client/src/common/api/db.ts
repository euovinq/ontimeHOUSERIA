import axios, { AxiosResponse } from 'axios';
import {
  DatabaseModel,
  MessageResponse,
  ProjectData,
  ProjectFileListResponse,
  QuickStartData,
} from 'houseriaapp-types';

import { makeTable } from '../../views/cuesheet/cuesheet.utils';
import { makeCSVFromArrayOfArrays } from '../utils/csv';

import { apiEntryUrl } from './constants';
import { createBlob, downloadBlob } from './utils';

const dbPath = `${apiEntryUrl}/db`;

/**
 * HTTP request to the current DB
 */
export function getDb(filename: string): Promise<AxiosResponse<DatabaseModel>> {
  return axios.post(`${dbPath}/download`, { filename });
}

/**
 * Request download of the current project file
 * @param fileName
 */
export async function downloadProject(filename: string, shouldDownload = true) {
  try {
    const { data, name } = await fileDownload(filename);

    const fileContent = JSON.stringify(data, null, 2);

    if (!shouldDownload) {
      const fileNameToSave = name.endsWith('.json') ? name : `${name}.json`;
      return { fileContent, fileNameToSave };
    }

    const blob = createBlob(fileContent, 'application/json;charset=utf-8;');
    const fileNameToSave = name.endsWith('.json') ? name : `${name}.json`;
    downloadBlob(blob, fileNameToSave);
    return undefined;
  } catch (error) {
    console.error(error);
    return undefined;
  }
}

/**
 * Request download of the current rundown as a CSV file
 * @param fileName
 */
export async function downloadCSV(filename: string = 'rundown'): Promise<void> {
  try {
    const { data, name } = await fileDownload(filename);
    const { project, rundown, customFields } = data;

    const sheetData = makeTable(project, rundown, customFields);
    const fileContent = makeCSVFromArrayOfArrays(sheetData);

    const blob = createBlob(fileContent, 'text/csv;charset=utf-8;');
    downloadBlob(blob, `${name}.csv`);
  } catch (error) {
    console.error(error);
  }
}

/**
 * HTTP request to upload project file
 */
export async function uploadProjectFile(file: File): Promise<MessageResponse> {
  const formData = new FormData();
  formData.append('project', file);
  const response = await axios.post(`${dbPath}/upload`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
}

/**
 * Make patch changes to the objects in the db
 */
export async function patchData(patchDb: Partial<DatabaseModel>): Promise<AxiosResponse<DatabaseModel>> {
  return await axios.patch(dbPath, patchDb);
}

/**
 * HTTP request to create a project file
 */
export async function createProject(
  project: Partial<
    ProjectData & {
      filename: string;
    }
  >,
): Promise<MessageResponse> {
  const res = await axios.post(`${dbPath}/new`, project);
  return res.data;
}

/**
 * HTTP request to create a project file
 */
export async function quickProject(data: QuickStartData): Promise<MessageResponse> {
  const res = await axios.post(`${dbPath}/quick`, data);
  return res.data;
}

/**
 * Duplicates the current project with a new project code.
 * Keeps the original file unchanged - creates a new file for the new code.
 * Used when generating new code offline so the new project can sync to cloud when online.
 */
export async function duplicateWithNewCode(newProjectCode: string): Promise<{ filename: string }> {
  const res = await axios.post(`${dbPath}/duplicate-with-new-code`, { newProjectCode });
  return res.data;
}

/**
 * Creates a project file from Supabase data and loads it locally.
 * Saves the project so it appears in the recent projects list.
 */
export async function createProjectFromSupabaseData(
  filename: string,
  data: Partial<DatabaseModel> & { cuesheet?: { rundown?: unknown[]; customFields?: Record<string, unknown> } },
): Promise<{ filename: string }> {
  const res = await axios.post(`${dbPath}/save-from-supabase`, { filename, data });
  return res.data;
}

/**
 * HTTP request to get the list of available project files
 */
export async function getProjects(): Promise<ProjectFileListResponse> {
  const res = await axios.get(`${dbPath}/all`);
  return res.data;
}

/**
 * HTTP request to load a project file
 */
export async function loadProject(filename: string): Promise<MessageResponse> {
  const res = await axios.post(`${dbPath}/load`, {
    filename,
  });
  return res.data;
}

/**
 * HTTP request to load the demo project file
 */
export async function loadDemo(): Promise<MessageResponse> {
  const res = await axios.post(`${dbPath}/demo`);
  return res.data;
}

/**
 * HTTP request to duplicate a project file
 */
export async function duplicateProject(filename: string, newFilename: string): Promise<MessageResponse> {
  const url = `${dbPath}/${filename}/duplicate`;
  const decodedUrl = decodeURIComponent(url);
  const res = await axios.post(decodedUrl, {
    newFilename,
  });
  return res.data;
}

/**
 * HTTP request to rename a project file
 */
export async function renameProject(filename: string, newFilename: string): Promise<MessageResponse> {
  const url = `${dbPath}/${filename}/rename`;
  const decodedUrl = decodeURIComponent(url);
  const res = await axios.put(decodedUrl, {
    newFilename,
  });
  return res.data;
}

/**
 * HTTP request to delete a project file
 */
export async function deleteProject(filename: string): Promise<MessageResponse> {
  const url = `${dbPath}/${filename}`;
  const decodedUrl = decodeURIComponent(url);
  const res = await axios.delete(decodedUrl);
  return res.data;
}

/**
 * Utility function gets project from db
 * @param fileName
 * @returns
 */
async function fileDownload(fileName: string): Promise<{ data: DatabaseModel; name: string }> {
  const response = await getDb(fileName);

  const headerLine = response.headers['Content-Disposition'];

  // try and get the filename from the response
  let name = fileName;
  if (headerLine != null) {
    // Extract filename from Content-Disposition header
    // Format: attachment; filename="filename.json"
    const filenameMatch = headerLine.match(/filename="([^"]+)"/);
    if (filenameMatch && filenameMatch[1]) {
      name = filenameMatch[1];
    }
  }

  return { data: response.data, name };
}
