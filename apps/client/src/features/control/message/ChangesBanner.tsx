import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IoChevronBack, IoChevronForward, IoRefresh } from 'react-icons/io5';
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Badge,
  Box,
  Button,
  useDisclosure,
  useToast,
} from '@chakra-ui/react';
import type {
  ChangeItem,
  OntimeChange,
  ProjectDataUpdatedNotification,
} from 'houseriaapp-types';
import { isProjectDataUpdated } from 'houseriaapp-types';

import { CUSTOM_FIELDS, PROJECT_DATA, RUNDOWN } from '../../../common/api/constants';
import { patchData } from '../../../common/api/db';
import { fetchSupabaseProject } from '../../../common/api/supabase';
import { maybeAxiosError } from '../../../common/api/utils';
import useProjectData from '../../../common/hooks-query/useProjectData';
import useRundown from '../../../common/hooks-query/useRundown';
import { ontimeQueryClient } from '../../../common/queryClient';
import { setChangesFromEvent, useChangesStore } from '../../../common/stores/changesStore';
import { socketSendJson } from '../../../common/utils/socket';

import style from './ChangesBanner.module.scss';

function nl2br(html: string): string {
  return String(html ?? '').replace(/\n/g, '<br />');
}

export default function ChangesBanner() {
  const changes = useChangesStore((s) => s.changes);
  const setChanges = useChangesStore((s) => s.setChanges);
  const { data: projectData } = useProjectData();
  const { data: rundownData } = useRundown();
  const projectCode = projectData?.projectCode || '';
  const [selectedChange, setSelectedChange] = useState<ChangeItem | null>(null);
  const [syncIndex, setSyncIndex] = useState(0);
  const [approveIndex, setApproveIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const pendingChangeIdRef = useRef<string | null>(null);
  const isApplyingAllRef = useRef(false);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();

  const projectUpdates = changes.filter((c): c is ProjectDataUpdatedNotification => isProjectDataUpdated(c));
  const ontimChanges = changes.filter((c): c is OntimeChange => !isProjectDataUpdated(c));
  const hasSync = projectUpdates.length > 0;
  const hasApprove = ontimChanges.length > 0;

  // Listen for ontime-changes events from WebSocket
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.changes && Array.isArray(detail.changes)) {
        setChangesFromEvent(detail.changes);
      }
    };
    window.addEventListener('ontime-changes', handler);
    return () => window.removeEventListener('ontime-changes', handler);
  }, []);

  // Request current changes when component mounts
  useEffect(() => {
    if (!projectCode) return;
    const t = setTimeout(() => socketSendJson('get-changes'), 500);
    return () => clearTimeout(t);
  }, [projectCode]);

  // Listen for approve/reject response from server
  useEffect(() => {
    const handler = (e: Event) => {
      if (isApplyingAllRef.current) return;
      const { type, payload } = (e as CustomEvent).detail;
      const changeId = pendingChangeIdRef.current;
      pendingChangeIdRef.current = null;
      if (payload === 'success' && changeId) {
        setChanges(useChangesStore.getState().changes.filter((c) => c.id !== changeId));
        toast({
          title: type === 'approve-change' ? 'Alteração aprovada' : 'Alteração rejeitada',
          status: 'success',
          duration: 3000,
          isClosable: true,
        });
      } else if (payload === 'error') {
        toast({
          title: 'Erro ao processar',
          status: 'error',
          duration: 4000,
          isClosable: true,
        });
      }
      setIsLoading(false);
      onClose();
      setSelectedChange(null);
    };
    window.addEventListener('change-action-response', handler);
    return () => window.removeEventListener('change-action-response', handler);
  }, [setChanges, toast, onClose]);

  const handleApprove = useCallback(
    (change: OntimeChange) => {
      setIsLoading(true);
      pendingChangeIdRef.current = change.id;
      socketSendJson('approve-change', { change });
    },
    [],
  );

  const handleReject = useCallback(
    (change: ChangeItem) => {
      setIsLoading(true);
      pendingChangeIdRef.current = change.id;
      socketSendJson('reject-change', { changeId: change.id });
    },
    [],
  );

  const handleApplyAll = useCallback(
    async () => {
      if (projectUpdates.length > 0 && !projectCode) return;
      isApplyingAllRef.current = true;
      setIsLoading(true);
      try {
        const allChanges = useChangesStore.getState().changes;
        const ontim = allChanges.filter((c): c is OntimeChange => !isProjectDataUpdated(c));
        const proj = allChanges.filter((c): c is ProjectDataUpdatedNotification => isProjectDataUpdated(c));

        let appliedResult: { applied: number; failed: number; total: number } | null = null;
        if (ontim.length > 0) {
          appliedResult = await new Promise<{ applied: number; failed: number; total: number }>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout ao aplicar alterações')), 60000 + ontim.length * 2000);
            const handler = (e: Event) => {
              clearTimeout(timeout);
              window.removeEventListener('approve-all-changes-response', handler);
              resolve((e as CustomEvent).detail);
            };
            window.addEventListener('approve-all-changes-response', handler);
            socketSendJson('approve-all-changes', { changes: ontim });
          });
        }

        if (ontim.length > 0) {
          await Promise.all([
            ontimeQueryClient.invalidateQueries({ queryKey: RUNDOWN }),
            ontimeQueryClient.invalidateQueries({ queryKey: CUSTOM_FIELDS }),
            ontimeQueryClient.invalidateQueries({ queryKey: PROJECT_DATA }),
          ]);
        }

        if (proj.length > 0 && projectCode) {
          const response = await fetchSupabaseProject(projectCode);
          const supabaseData = response?.project;
          if (!supabaseData) throw new Error('Projeto não encontrado');
          const patchPayload: Record<string, unknown> = {};
          if (supabaseData.project) patchPayload.project = supabaseData.project;
          if (supabaseData.cuesheet?.rundown) patchPayload.rundown = supabaseData.cuesheet.rundown;
          if (supabaseData.cuesheet?.customFields) patchPayload.customFields = supabaseData.cuesheet.customFields;
          if (supabaseData.viewSettings) patchPayload.viewSettings = supabaseData.viewSettings;
          if (supabaseData.urlPresets) patchPayload.urlPresets = supabaseData.urlPresets;
          await patchData(patchPayload as any);
          await Promise.all([
            ontimeQueryClient.invalidateQueries({ queryKey: RUNDOWN }),
            ontimeQueryClient.invalidateQueries({ queryKey: CUSTOM_FIELDS }),
            ontimeQueryClient.invalidateQueries({ queryKey: PROJECT_DATA }),
          ]);
          socketSendJson('reject-project-data-updates', { projectCode });
          await new Promise((r) => setTimeout(r, 300));
        }

        setChanges([]);
        const failed = appliedResult?.failed ?? 0;
        toast({
          title: failed > 0 ? `${appliedResult?.applied ?? 0} aplicadas, ${failed} falharam` : 'Todas as alterações aplicadas',
          status: failed > 0 ? 'warning' : 'success',
          duration: 3000,
          isClosable: true,
        });
      } catch (error) {
        toast({
          title: 'Erro ao aplicar',
          description: maybeAxiosError(error),
          status: 'error',
          duration: 4000,
          isClosable: true,
        });
      } finally {
        isApplyingAllRef.current = false;
        setIsLoading(false);
        onClose();
        setSelectedChange(null);
      }
    },
    [projectCode, setChanges, toast, onClose, projectUpdates.length],
  );

  const handleReloadProject = useCallback(
    async () => {
      if (!projectCode) return;
      setIsLoading(true);
      try {
        const response = await fetchSupabaseProject(projectCode);
        const supabaseData = response?.project;
        if (!supabaseData) throw new Error('Projeto não encontrado');
        const patchPayload: Record<string, unknown> = {};
        if (supabaseData.project) patchPayload.project = supabaseData.project;
        if (supabaseData.cuesheet?.rundown) patchPayload.rundown = supabaseData.cuesheet.rundown;
        if (supabaseData.cuesheet?.customFields) patchPayload.customFields = supabaseData.cuesheet.customFields;
        if (supabaseData.viewSettings) patchPayload.viewSettings = supabaseData.viewSettings;
        if (supabaseData.urlPresets) patchPayload.urlPresets = supabaseData.urlPresets;
        await patchData(patchPayload as any);
        await Promise.all([
          ontimeQueryClient.invalidateQueries({ queryKey: RUNDOWN }),
          ontimeQueryClient.invalidateQueries({ queryKey: CUSTOM_FIELDS }),
          ontimeQueryClient.invalidateQueries({ queryKey: PROJECT_DATA }),
        ]);
        socketSendJson('reject-project-data-updates', { projectCode });
        setChanges(useChangesStore.getState().changes.filter((c) => !isProjectDataUpdated(c)));
        toast({ title: 'Projeto sincronizado com a nuvem', status: 'success', duration: 3000, isClosable: true });
      } catch (error) {
        toast({
          title: 'Erro ao sincronizar',
          description: maybeAxiosError(error),
          status: 'error',
          duration: 4000,
          isClosable: true,
        });
      } finally {
        setIsLoading(false);
        setSelectedChange(null);
      }
    },
    [projectCode, setChanges, toast],
  );

  const openChangeModal = (change: ChangeItem) => {
    setSelectedChange(change);
    onOpen();
  };

  useEffect(() => {
    setSyncIndex((i) => Math.min(i, Math.max(0, projectUpdates.length - 1)));
  }, [projectUpdates.length]);

  useEffect(() => {
    setApproveIndex((i) => Math.min(i, Math.max(0, ontimChanges.length - 1)));
  }, [ontimChanges.length]);

  if (!hasSync && !hasApprove) return null;

  const safeSyncIndex = Math.min(syncIndex, projectUpdates.length - 1);
  const safeApproveIndex = Math.min(approveIndex, ontimChanges.length - 1);
  const currentSync = projectUpdates[safeSyncIndex];
  const currentApprove = ontimChanges[safeApproveIndex];

  const stackContent = (
    <Box className={style.stack} role="group" aria-label="Alterações pendentes">
      {/* Card 1: Sincronizar com a nuvem (project_data_updated) */}
      {hasSync && (
        <Box className={style.card}>
          <Box className={style.cardHeader}>
            <span className={style.cardTitle}>Precisa sincronizar com a nuvem</span>
            <Badge className={style.toastBadge} colorScheme="orange">
              {projectUpdates.length > 0 ? `${safeSyncIndex + 1} / ${projectUpdates.length}` : '0'}
            </Badge>
          </Box>
          <Box className={style.cardNav}>
            <Button
              size="xs"
              variant="ontime-ghosted"
              aria-label="Anterior"
              onClick={() => setSyncIndex((i) => Math.max(0, i - 1))}
              isDisabled={safeSyncIndex <= 0}
            >
              <IoChevronBack size={18} />
            </Button>
            <Box className={style.cardMessage} flex={1}>
              {currentSync && (
                <>
                  <span>
                    {(currentSync as ProjectDataUpdatedNotification).message ||
                      'Projeto atualizado na web. Sincronize para ver as alterações.'}
                  </span>
                  {((currentSync as ProjectDataUpdatedNotification).authorName ||
                    (currentSync as ProjectDataUpdatedNotification).authorEmail ||
                    (currentSync as ProjectDataUpdatedNotification).author) && (
                    <Box as="span" display="block" mt={1} fontSize="xs" opacity={0.85}>
                      {(currentSync as ProjectDataUpdatedNotification).authorName ||
                        (currentSync as ProjectDataUpdatedNotification).authorEmail ||
                        (currentSync as ProjectDataUpdatedNotification).author}
                    </Box>
                  )}
                  {(currentSync as ProjectDataUpdatedNotification).changes?.length ? (
                    <Box className={style.toastChanges}>
                      <ul>
                        {(currentSync as ProjectDataUpdatedNotification).changes!.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </Box>
                  ) : null}
                </>
              )}
            </Box>
            <Button
              size="xs"
              variant="ontime-ghosted"
              aria-label="Próxima"
              onClick={() => setSyncIndex((i) => Math.min(projectUpdates.length - 1, i + 1))}
              isDisabled={safeSyncIndex >= projectUpdates.length - 1}
            >
              <IoChevronForward size={18} />
            </Button>
          </Box>
          <Box className={style.cardActions}>
            <Button
              size="sm"
              variant="ontime-filled"
              leftIcon={<IoRefresh size={14} />}
              onClick={handleReloadProject}
              isLoading={isLoading}
            >
              Sincronizar
            </Button>
          </Box>
        </Box>
      )}

      {/* Card 2: Aprovar alterações (OntimeChange) */}
      {hasApprove && (
        <Box className={style.card}>
          <Box className={style.cardHeader}>
            <span className={style.cardTitle}>{ontimChanges.length} alteração(ões) para aprovar</span>
            <Badge className={style.toastBadge} colorScheme="orange">
              {safeApproveIndex + 1} / {ontimChanges.length}
            </Badge>
          </Box>
          <Box className={style.cardNav}>
            <Button
              size="xs"
              variant="ontime-ghosted"
              aria-label="Anterior"
              onClick={() => setApproveIndex((i) => Math.max(0, i - 1))}
              isDisabled={safeApproveIndex <= 0}
            >
              <IoChevronBack size={18} />
            </Button>
            <Box className={style.cardMessage} flex={1}>
              {currentApprove && (() => {
                const ch = currentApprove as OntimeChange;
                const event = ch.eventId ? rundownData?.rundown?.[ch.eventId] : null;
                const eventLabel = event
                  ? 'cue' in event && 'title' in event
                    ? `${(event as { cue: string }).cue} - ${(event as { title: string }).title}`
                    : 'title' in event
                      ? (event as { title: string }).title
                      : ch.eventId
                  : ch.eventId;
                return (
                  <>
                    <span>
                      {ch.field?.replace('custom.', '') || 'Alteração'}
                    </span>
                    {eventLabel && (
                      <Box as="span" display="block" mt={0.5} fontSize="xs" opacity={0.9}>
                        Evento: {eventLabel}
                      </Box>
                    )}
                    {(ch.authorName || ch.authorEmail || ch.author) && (
                      <Box as="span" display="block" mt={1} fontSize="xs" opacity={0.85}>
                        {ch.authorName && ch.authorEmail
                          ? `${ch.authorName} (${ch.authorEmail})`
                          : ch.authorEmail || ch.authorName || ch.author}
                      </Box>
                    )}
                  </>
                );
              })()}
            </Box>
            <Button
              size="xs"
              variant="ontime-ghosted"
              aria-label="Próxima"
              onClick={() => setApproveIndex((i) => Math.min(ontimChanges.length - 1, i + 1))}
              isDisabled={safeApproveIndex >= ontimChanges.length - 1}
            >
              <IoChevronForward size={18} />
            </Button>
          </Box>
          <Box className={style.cardActions}>
            <Button
              size="sm"
              variant="ontime-filled"
              onClick={() => currentApprove && handleApprove(currentApprove)}
              isLoading={isLoading}
            >
              Aprovar
            </Button>
            <Button
              size="sm"
              variant="ontime-outlined"
              onClick={() => currentApprove && handleReject(currentApprove)}
              isLoading={isLoading}
            >
              Rejeitar
            </Button>
            <Button
              size="sm"
              variant="ontime-ghosted-white"
              onClick={() => currentApprove && openChangeModal(currentApprove)}
            >
              Revisar
            </Button>
            {(ontimChanges.length > 1 || hasSync) && (
              <Button
                size="sm"
                variant="ontime-outlined"
                onClick={handleApplyAll}
                isLoading={isLoading}
                leftIcon={<IoRefresh size={14} />}
                ml="auto"
              >
                Aplicar tudo
              </Button>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );

  return (
    <>
      {createPortal(stackContent, document.body)}

      {selectedChange && (
        <ChangeModal
          change={selectedChange}
          isOpen={isOpen}
          onClose={() => {
            onClose();
            setSelectedChange(null);
          }}
          isLoading={isLoading}
          onApprove={handleApprove}
          onReject={handleReject}
          onReload={handleReloadProject}
        />
      )}
    </>
  );
}

interface ChangeModalProps {
  change: ChangeItem;
  isOpen: boolean;
  onClose: () => void;
  isLoading: boolean;
  onApprove: (c: OntimeChange) => void;
  onReject: (c: ChangeItem) => void;
  onReload: (c?: ProjectDataUpdatedNotification) => void;
}

function ChangeModal({
  change,
  isOpen,
  onClose,
  isLoading,
  onApprove,
  onReject,
  onReload,
}: ChangeModalProps) {
  const isProjectUpdate = isProjectDataUpdated(change);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { data: rundownData } = useRundown();

  const ontimChange = isProjectUpdate ? null : (change as OntimeChange);
  const event = ontimChange?.eventId ? rundownData?.rundown?.[ontimChange.eventId] : null;
  const eventLabel = event
    ? 'cue' in event && 'title' in event
      ? `${(event as { cue: string }).cue} - ${(event as { title: string }).title}`
      : 'title' in event
        ? (event as { title: string }).title
        : ontimChange?.eventId
    : null;

  return (
    <AlertDialog variant="ontime" isOpen={isOpen} onClose={onClose} leastDestructiveRef={cancelRef}>
      <AlertDialogOverlay>
        <AlertDialogContent>
          <AlertDialogHeader>
            {isProjectUpdate
              ? 'Projeto atualizado na web'
              : 'Alteração de custom action pendente'}
          </AlertDialogHeader>
          <AlertDialogBody>
            {isProjectUpdate ? (
              <Box>
                <p>
                  <span
                    dangerouslySetInnerHTML={{
                      __html: nl2br(
                        (change as ProjectDataUpdatedNotification).message ||
                          'Projeto editado na web. Recarregue para ver as alterações.',
                      ),
                    }}
                  />
                </p>
                {((change as ProjectDataUpdatedNotification).authorName ||
                  (change as ProjectDataUpdatedNotification).authorEmail ||
                  (change as ProjectDataUpdatedNotification).author) && (
                  <p>
                    <strong>Autor:</strong>{' '}
                    {(change as ProjectDataUpdatedNotification).authorName ||
                      (change as ProjectDataUpdatedNotification).authorEmail ||
                      (change as ProjectDataUpdatedNotification).author}
                  </p>
                )}
                {(change as ProjectDataUpdatedNotification).changes?.length ? (
                  <Box as="ul" mt={2} pl={4}>
                    {(change as ProjectDataUpdatedNotification).changes!.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </Box>
                ) : null}
              </Box>
            ) : (
              <Box>
                {eventLabel && (
                  <p>
                    <strong>Evento:</strong> {eventLabel}
                  </p>
                )}
                <p>
                  <strong>Campo:</strong> {(change as OntimeChange).field?.replace('custom.', '')}
                </p>
                <p>
                  <strong>Antes:</strong>{' '}
                  <span
                    dangerouslySetInnerHTML={{
                      __html: nl2br(String((change as OntimeChange).before ?? '')),
                    }}
                  />
                </p>
                <p>
                  <strong>Depois:</strong>{' '}
                  <span
                    dangerouslySetInnerHTML={{
                      __html: nl2br(String((change as OntimeChange).after ?? '')),
                    }}
                  />
                </p>
                {((change as OntimeChange).authorName ||
                  (change as OntimeChange).authorEmail ||
                  (change as OntimeChange).author) && (
                  <p>
                    <strong>Autor:</strong>{' '}
                    {(change as OntimeChange).authorName && (change as OntimeChange).authorEmail
                      ? `${(change as OntimeChange).authorName} (${(change as OntimeChange).authorEmail})`
                      : (change as OntimeChange).authorEmail ||
                        (change as OntimeChange).authorName ||
                        (change as OntimeChange).author}
                  </p>
                )}
                {(change as OntimeChange).createdAt && (
                  <p>
                    <strong>Data:</strong>{' '}
                    {new Date((change as OntimeChange).createdAt!).toLocaleString()}
                  </p>
                )}
              </Box>
            )}
          </AlertDialogBody>
          <AlertDialogFooter>
            <Button ref={cancelRef} onClick={onClose} isDisabled={isLoading} variant="ontime-ghosted-white">
              Fechar
            </Button>
            {isProjectUpdate ? (
              <Button
                colorScheme="blue"
                onClick={() => onReload(change as ProjectDataUpdatedNotification)}
                isLoading={isLoading}
                ml={3}
              >
                Aplicar
              </Button>
            ) : (
              <>
                <Button
                  colorScheme="red"
                  onClick={() => onReject(change)}
                  isLoading={isLoading}
                  ml={3}
                >
                  Rejeitar
                </Button>
                <Button
                  colorScheme="green"
                  onClick={() => onApprove(change as OntimeChange)}
                  isLoading={isLoading}
                  ml={3}
                >
                  Aprovar
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogOverlay>
    </AlertDialog>
  );
}
