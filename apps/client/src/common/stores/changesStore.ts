import type {
  ChangeItem,
  OntimeChange,
  ProjectDataUpdatedNotification,
} from 'houseriaapp-types';
import { create } from 'zustand';

interface ChangesStore {
  changes: ChangeItem[];
  setChanges: (changes: ChangeItem[]) => void;
  clearChanges: () => void;
}

export const useChangesStore = create<ChangesStore>((set) => ({
  changes: [],
  setChanges: (changes) => set({ changes }),
  clearChanges: () => set({ changes: [] }),
}));

function generateId(): string {
  return `ch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Normaliza payload que pode vir como objeto único ou array (formato novo da web) */
function normalizeToChangeItems(raw: unknown): ChangeItem[] {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.flatMap((item) => normalizeToChangeItems(item));
  }

  const obj = raw as Record<string, unknown>;

  if (obj.type === 'project_data_updated') {
    const item: ProjectDataUpdatedNotification = {
      id: (obj.id as string) || generateId(),
      type: 'project_data_updated',
      message: obj.message as string | undefined,
      changes: Array.isArray(obj.changes) ? (obj.changes as string[]) : undefined,
      author: obj.author as string | undefined,
      authorName: obj.authorName as string | undefined,
      authorEmail: obj.authorEmail as string | undefined,
      createdAt: obj.createdAt as string | undefined,
    };
    return [item];
  }

  if (obj.field && obj.eventId && 'path' in obj) {
    return [obj as OntimeChange];
  }

  return [];
}

/** Set changes from outside React (e.g. when receiving ontime-changes event) */
export function setChangesFromEvent(raw: unknown): void {
  const changes = normalizeToChangeItems(raw);
  useChangesStore.getState().setChanges(changes);
}
