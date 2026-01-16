import axios from 'axios';

import { apiEntryUrl } from './constants';

interface SupabaseProjectResponse {
  project: any;
}

/**
 * Busca dados de projeto armazenados no Supabase pelo código.
 * A tabela usada é `ontime_realtime` e o dado fica na coluna `data`.
 */
export async function fetchSupabaseProject(projectCode: string): Promise<SupabaseProjectResponse> {
  const sanitizedCode = projectCode.trim().toUpperCase();
  const res = await axios.get(`${apiEntryUrl}/supabase/project/${sanitizedCode}`, {
    withCredentials: true, // envia cookies de login para autorização no backend
  });
  return res.data;
}

