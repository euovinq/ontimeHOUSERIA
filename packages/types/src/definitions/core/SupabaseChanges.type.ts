/**
 * Tipos para a coluna changes da tabela ontime_realtime.
 * A web adiciona itens; o desktop processa (aprovar/rejeitar/recarregar).
 */

/** Tipo A - Alteração de custom action (para aprovar/rejeitar) */
export type OntimeChange = {
  id: string;
  path: string;
  eventId: string;
  field: string;
  before: unknown;
  after: unknown;
  author?: string;
  authorEmail?: string;
  authorName?: string;
  createdAt?: string;
  status?: string;
};

/** Tipo B - Notificação de projeto atualizado (para avisar recarregar) */
export type ProjectDataUpdatedNotification = {
  id: string;
  type: 'project_data_updated';
  author?: string;
  authorEmail?: string;
  authorName?: string;
  createdAt?: string;
  message?: string;
  /** Lista de alterações (ex: "Nome do evento X alterado") */
  changes?: string[];
};

/** Tipo união de itens no array changes */
export type ChangeItem = OntimeChange | ProjectDataUpdatedNotification;

/** Type guard para verificar se é notificação de projeto atualizado */
export function isProjectDataUpdated(c: ChangeItem): c is ProjectDataUpdatedNotification {
  return 'type' in c && (c as ProjectDataUpdatedNotification).type === 'project_data_updated';
}

/** Type guard para verificar se é OntimeChange (custom action) */
export function isOntimeChange(c: ChangeItem): c is OntimeChange {
  return 'path' in c && 'field' in c;
}
