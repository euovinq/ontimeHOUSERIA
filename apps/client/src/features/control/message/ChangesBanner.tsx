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
  const projectCode = projectData?.projectCode || '';
  const [selectedChange, setSelectedChange] = useState<ChangeItem | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const pendingChangeIdRef = useRef<string | null>(null);
  const isApplyingAllRef = useRef(false);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();

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

  // Request current changes when component mounts (catches items already in DB)
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

  /** Aplica todas as alterações: aprova cada OntimeChange e recarrega para ProjectDataUpdated */
  const handleApplyAll = useCallback(
    async () => {
      const currentChanges = useChangesStore.getState().changes;
      const projectUpdates = currentChanges.filter((c): c is ProjectDataUpdatedNotification => isProjectDataUpdated(c));
      if (projectUpdates.length > 0 && !projectCode) return;
      isApplyingAllRef.current = true;
      setIsLoading(true);
      try {
        const allChanges = useChangesStore.getState().changes;
        const ontimChanges = allChanges.filter((c): c is OntimeChange => !isProjectDataUpdated(c));
        const projUpdates = allChanges.filter((c): c is ProjectDataUpdatedNotification => isProjectDataUpdated(c));

        for (const c of ontimChanges) {
          socketSendJson('approve-change', { change: c });
        }
        await new Promise((r) => setTimeout(r, 300 + 150 * ontimChanges.length));

        if (ontimChanges.length > 0) {
          await Promise.all([
            ontimeQueryClient.invalidateQueries({ queryKey: RUNDOWN }),
            ontimeQueryClient.invalidateQueries({ queryKey: CUSTOM_FIELDS }),
            ontimeQueryClient.invalidateQueries({ queryKey: PROJECT_DATA }),
          ]);
        }

        if (projUpdates.length > 0 && projectCode) {
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
          for (const n of projUpdates) {
            socketSendJson('reject-change', { changeId: n.id });
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        setChanges([]);
        toast({ title: 'Todas as alterações aplicadas', status: 'success', duration: 3000, isClosable: true });
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
    [projectCode, setChanges, toast, onClose],
  );

  /**
   * Recarrega o projeto do Supabase (somente leitura - não envia dados locais).
   * Funciona mesmo sem clicar em Conectar.
   */
  const handleReloadProject = useCallback(
    async (_notification?: ProjectDataUpdatedNotification) => {
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
        const currentChanges = useChangesStore.getState().changes;
        const projectUpdateIds = currentChanges.filter(isProjectDataUpdated).map((c) => c.id);
        for (const id of projectUpdateIds) {
          socketSendJson('reject-change', { changeId: id });
        }
        setChanges(currentChanges.filter((c) => !isProjectDataUpdated(c)));
        toast({ title: 'Projeto recarregado', status: 'success', duration: 3000, isClosable: true });
      } catch (error) {
        toast({
          title: 'Erro ao recarregar',
          description: maybeAxiosError(error),
          status: 'error',
          duration: 4000,
          isClosable: true,
        });
      } finally {
        setIsLoading(false);
        onClose();
        setSelectedChange(null);
      }
    },
    [projectCode, setChanges, toast, onClose],
  );

  const openChangeModal = (change: ChangeItem) => {
    setSelectedChange(change);
    onOpen();
  };

  const handleApproveCurrent = useCallback(() => {
    const current = changes[Math.min(currentIndex, changes.length - 1)];
    if (!current) return;
    if (isProjectDataUpdated(current)) {
      handleReloadProject(current);
    } else {
      handleApprove(current as OntimeChange);
    }
  }, [changes, currentIndex, handleApprove, handleReloadProject]);

  useEffect(() => {
    setCurrentIndex((i) => Math.min(i, Math.max(0, changes.length - 1)));
  }, [changes.length]);

  if (changes.length === 0) return null;

  const safeIndex = Math.min(currentIndex, changes.length - 1);
  const currentChange = changes[safeIndex];
  const isProjectUpdate = currentChange && isProjectDataUpdated(currentChange);
  const currentMessage = isProjectUpdate
    ? (currentChange as ProjectDataUpdatedNotification).message ||
      'Projeto editado na web. Recarregue para ver as alterações.'
    : (currentChange as OntimeChange).field?.replace('custom.', '') || (currentChange as OntimeChange).eventId || 'Alteração';
  const currentChangesList = isProjectUpdate ? (currentChange as ProjectDataUpdatedNotification).changes : undefined;
  const currentAuthor =
    ('authorName' in currentChange && currentChange.authorName) ||
    ('authorEmail' in currentChange && currentChange.authorEmail) ||
    ('author' in currentChange && currentChange.author);

  const toastContent = (
    <Box
      className={style.toast}
      role="alert"
      sx={{ position: 'fixed', top: '16px', right: '16px', zIndex: 99999 }}
    >
      <Box className={style.toastHeader}>
        <span>{changes.length} alteração(ões) pendente(s)</span>
        <Badge className={style.toastBadge} colorScheme="orange">
          {safeIndex + 1} / {changes.length}
        </Badge>
      </Box>

      <Box className={style.toastNav}>
        <Button
          size="xs"
          variant="ontime-ghosted"
          aria-label="Anterior"
          onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          isDisabled={safeIndex <= 0}
        >
          <IoChevronBack size={18} />
        </Button>
        <Box className={style.toastMessage} flex={1}>
          <span>{currentMessage}</span>
          {currentAuthor && (
            <Box as="span" display="block" mt={1} fontSize="xs" opacity={0.85}>
              {currentAuthor}
            </Box>
          )}
          {currentChangesList && currentChangesList.length > 0 && (
            <Box className={style.toastChanges}>
              <ul>
                {currentChangesList.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </Box>
          )}
        </Box>
        <Button
          size="xs"
          variant="ontime-ghosted"
          aria-label="Próxima"
          onClick={() => setCurrentIndex((i) => Math.min(changes.length - 1, i + 1))}
          isDisabled={safeIndex >= changes.length - 1}
        >
          <IoChevronForward size={18} />
        </Button>
      </Box>

      <Box className={style.toastActions}>
        <Button
          size="sm"
          variant="ontime-filled"
          onClick={handleApproveCurrent}
          isLoading={isLoading}
          leftIcon={isProjectUpdate ? <IoRefresh size={14} /> : undefined}
        >
          {isProjectUpdate ? 'Aplicar' : 'Aprovar'}
        </Button>
        <Button
          size="sm"
          variant="ontime-outlined"
          onClick={handleApplyAll}
          isLoading={isLoading}
          leftIcon={<IoRefresh size={14} />}
        >
          Aplicar tudo
        </Button>
        <Button
          size="sm"
          variant="ontime-ghosted-white"
          onClick={() => openChangeModal(currentChange)}
        >
          Revisar
        </Button>
      </Box>
    </Box>
  );

  return (
    <>
      {createPortal(toastContent, document.body)}

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
                {(change as ProjectDataUpdatedNotification).changes &&
                  (change as ProjectDataUpdatedNotification).changes!.length > 0 && (
                    <Box as="ul" mt={2} pl={4}>
                      {(change as ProjectDataUpdatedNotification).changes!.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </Box>
                  )}
              </Box>
            ) : (
              <Box>
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
                {(change as OntimeChange).authorName && (
                  <p>
                    <strong>Autor:</strong> {(change as OntimeChange).authorName}
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
