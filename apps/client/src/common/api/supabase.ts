import axios from 'axios';

import { apiEntryUrl } from './constants';

interface SupabaseProjectResponse {
  project: any;
}

interface AuthHeadersResponse {
  userId: string | number | null;
  isAdmin: boolean;
}

/**
 * Obtém headers de autenticação do Electron (se disponível)
 * Usa o mesmo padrão que funciona em produção (ProjectPanel.tsx)
 */
async function getAuthHeaders(): Promise<{ 'x-user-id'?: string; 'x-is-admin'?: string }> {
  console.log('🔐 [getAuthHeaders] Iniciando obtenção de headers...');
  
  // Verifica se está rodando no Electron (mesmo padrão usado em ProjectPanel.tsx)
  const isElectron = typeof window !== 'undefined' && window.process?.type === 'renderer' && (window as any).require;
  console.log('🔐 [getAuthHeaders] isElectron:', isElectron);
  
  if (!isElectron) {
    console.warn('⚠️ [getAuthHeaders] Não está rodando no Electron');
    return {};
  }
  
  try {
    // Usa window.require('electron') que funciona tanto em dev quanto em produção
    const { ipcRenderer } = (window as any).require('electron');
    
    if (!ipcRenderer || !ipcRenderer.invoke) {
      console.warn('⚠️ [getAuthHeaders] ipcRenderer não disponível');
      return {};
    }
    
    console.log('🔐 [getAuthHeaders] Chamando IPC get-auth-headers...');
    const authData = (await ipcRenderer.invoke('get-auth-headers')) as AuthHeadersResponse;
    console.log('🔐 [getAuthHeaders] Resposta recebida:', authData);
    
    if (authData && authData.userId) {
      const headers = {
        'x-user-id': String(authData.userId),
        'x-is-admin': authData.isAdmin ? '1' : '0',
      };
      console.log('✅ [getAuthHeaders] Headers gerados:', headers);
      return headers;
    } else {
      console.warn('⚠️ [getAuthHeaders] authData inválido ou sem userId:', authData);
    }
  } catch (error) {
    console.error('❌ [getAuthHeaders] Erro ao obter headers de autenticação:', error);
  }
  
  return {};
}

/**
 * Busca dados de projeto armazenados no Supabase pelo código.
 * A tabela usada é `ontime_realtime` e o dado fica na coluna `data`.
 */
export async function fetchSupabaseProject(projectCode: string): Promise<SupabaseProjectResponse> {
  const sanitizedCode = projectCode.trim().toUpperCase();
  console.log('🔐 [fetchSupabaseProject] Buscando projeto:', sanitizedCode);
  
  // Obtém headers de autenticação do Electron
  const authHeaders = await getAuthHeaders();
  console.log('🔐 [fetchSupabaseProject] Headers obtidos:', authHeaders);
  
  const url = `${apiEntryUrl}/supabase/project/${sanitizedCode}`;
  console.log('🔐 [fetchSupabaseProject] Fazendo requisição para:', url);
  console.log('🔐 [fetchSupabaseProject] Headers sendo enviados:', authHeaders);
  
  const res = await axios.get(url, {
    withCredentials: true, // envia cookies de login para autorização no backend
    headers: {
      ...authHeaders,
    },
  });
  return res.data;
}

