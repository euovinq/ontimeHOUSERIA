import { create } from 'zustand';

export interface UpdateCheckPayload {
  hasUpdate: boolean;
  version?: string;
  release_notes?: string;
  download_url?: string | null;
  error?: string;
}

interface UpdateCheckStore {
  isOpen: boolean;
  hasUpdate: boolean;
  version: string | null;
  release_notes: string | null;
  download_url: string | null;
  error: string | null;
  setUpdateCheckResult: (payload: UpdateCheckPayload) => void;
  clearUpdateCheck: () => void;
}

export const useUpdateCheckStore = create<UpdateCheckStore>((set) => ({
  isOpen: false,
  hasUpdate: false,
  version: null,
  release_notes: null,
  download_url: null,
  error: null,
  setUpdateCheckResult: (payload) =>
    set({
      isOpen: true,
      hasUpdate: payload.hasUpdate,
      version: payload.version ?? null,
      release_notes: payload.release_notes ?? null,
      download_url: payload.download_url ?? null,
      error: payload.error ?? null,
    }),
  clearUpdateCheck: () =>
    set({
      isOpen: false,
      hasUpdate: false,
      version: null,
      release_notes: null,
      download_url: null,
      error: null,
    }),
}));
