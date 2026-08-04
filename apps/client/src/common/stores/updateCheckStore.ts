import { create } from 'zustand';

export interface UpdateCheckPayload {
  hasUpdate: boolean;
  version?: string;
  release_notes?: string;
  download_url?: string | null;
  error?: string;
}

/**
 * Onde o download está. Antes o modal só informava "existe versão nova" e
 * mandava o usuário baixar à mão; agora o app baixa sozinho, e sem estado a
 * tela ficaria muda por vários minutos — o que se lê como travamento.
 */
export type UpdateEstado = 'baixando' | 'pronto' | null;

export interface UpdateProgresso {
  percent: number;
  transferred: number;
  total: number;
}

interface UpdateCheckStore {
  isOpen: boolean;
  hasUpdate: boolean;
  version: string | null;
  release_notes: string | null;
  download_url: string | null;
  error: string | null;
  estado: UpdateEstado;
  progresso: UpdateProgresso | null;
  setUpdateCheckResult: (payload: UpdateCheckPayload) => void;
  setProgresso: (progresso: UpdateProgresso) => void;
  setPronto: () => void;
  clearUpdateCheck: () => void;
}

export const useUpdateCheckStore = create<UpdateCheckStore>((set) => ({
  isOpen: false,
  hasUpdate: false,
  version: null,
  release_notes: null,
  download_url: null,
  error: null,
  estado: null,
  progresso: null,
  setUpdateCheckResult: (payload) =>
    set({
      isOpen: true,
      estado: null,
      progresso: null,
      hasUpdate: payload.hasUpdate,
      version: payload.version ?? null,
      release_notes: payload.release_notes ?? null,
      download_url: payload.download_url ?? null,
      error: payload.error ?? null,
    }),
  // Chega enquanto baixa. Abre o modal se estiver fechado: o usuário pode ter
  // fechado depois de aceitar, e some o único sinal de que algo acontece.
  setProgresso: (progresso) => set({ isOpen: true, estado: 'baixando', progresso }),
  setPronto: () => set({ isOpen: true, estado: 'pronto', progresso: null }),
  clearUpdateCheck: () =>
    set({
      isOpen: false,
      estado: null,
      progresso: null,
      hasUpdate: false,
      version: null,
      release_notes: null,
      download_url: null,
      error: null,
    }),
}));
