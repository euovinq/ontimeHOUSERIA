import { useCallback, useEffect, useRef, useState } from 'react';
import { IoLink, IoRefresh, IoSettingsOutline,IoShuffle } from 'react-icons/io5';
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Button,
  Input,
  useDisclosure,
  useToast,
} from '@chakra-ui/react';
import { ProjectData } from 'houseriaapp-types';
import { generateProjectCode } from 'houseriaapp-utils';

import { CUSTOM_FIELDS, PROJECT_DATA, RUNDOWN } from '../../../common/api/constants';
import { patchData } from '../../../common/api/db';
import { postProjectData } from '../../../common/api/project';
import { fetchSupabaseProject } from '../../../common/api/supabase';
import { maybeAxiosError } from '../../../common/api/utils';
import useProjectData from '../../../common/hooks-query/useProjectData';
import { ontimeQueryClient } from '../../../common/queryClient';
import { socketSendJson } from '../../../common/utils/socket';
import { cx } from '../../../common/utils/styleUtils';
import PowerPointControl from '../../app-settings/panel/general-panel/PowerPointControl';
import SupabaseControl from '../../app-settings/panel/general-panel/SupabaseControl';

import PowerPointConfigModal from './PowerPointConfigModal';
import ProjectLinksModal from './ProjectLinksModal';

import style from './InputRow.module.scss';

const PROJECT_CODE_MAX_LENGTH = 12;

interface SupabaseStatus {
  connected: boolean;
  enabled: boolean;
}

export default function ProjectCodeInput() {
  const { data: projectData } = useProjectData();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const { isOpen: isConfigOpen, onOpen: onConfigOpen, onClose: onConfigClose } = useDisclosure();
  const { isOpen: isConfirmOpen, onOpen: onConfirmOpen, onClose: onConfirmClose } = useDisclosure();
  const toast = useToast();
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const [projectCode, setProjectCode] = useState(projectData?.projectCode || '');
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [supabaseStatus, setSupabaseStatus] = useState<SupabaseStatus>({ connected: false, enabled: false });
  
  // Ref para acessar o estado atual sem criar dependência no useEffect
  const supabaseStatusRef = useRef(supabaseStatus);
  supabaseStatusRef.current = supabaseStatus;

  // Sync with external data
  useEffect(() => {
    if (projectData?.projectCode) {
      setProjectCode(projectData.projectCode);
    }
  }, [projectData?.projectCode]);

  // Get real Supabase status from server
  const getRealSupabaseStatus = useCallback(() => {
    socketSendJson('getsupabasestatus');
  }, []);

  // Get initial Supabase status
  useEffect(() => {
    // Set initial status as disabled
    setSupabaseStatus({ connected: false, enabled: false });

    // Get real status after component mounts
    setTimeout(() => {
      getRealSupabaseStatus();
    }, 500);
  }, [getRealSupabaseStatus]);

  // Listen for Supabase status updates from WebSocket
  useEffect(() => {
    const handleSupabaseStatus = (event: CustomEvent) => {
      const { type, payload } = event.detail;

      if (type === 'togglesupabase' || type === 'getsupabasestatus') {
        if (payload && typeof payload === 'object') {
          const currentStatus = supabaseStatusRef.current;
          const newStatus = {
            connected: Boolean(payload.connected),
            enabled: Boolean(payload.enabled ?? payload.connected),
          };
          
          // Só atualiza se realmente mudou
          if (currentStatus.connected !== newStatus.connected || currentStatus.enabled !== newStatus.enabled) {
            setSupabaseStatus(() => {
              const updatedStatus = {
                connected: Boolean(payload.connected),
                enabled: Boolean(payload.enabled ?? payload.connected),
              };
              return updatedStatus;
            });
          }
        }
      }
    };

    // Add custom event listener
    window.addEventListener('supabase-status', handleSupabaseStatus as EventListener);

    return () => {
      window.removeEventListener('supabase-status', handleSupabaseStatus as EventListener);
    };
  }, []);

  const handleLoadProject = async () => {
    const code = (projectCode || '').trim().toUpperCase();
    if (!code) {
      toast({
        title: 'Informe o código do projeto',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setIsLoadingProject(true);

    try {
      const response = await fetchSupabaseProject(code);
      const supabaseData = response?.project;

      if (!supabaseData) {
        throw new Error('Projeto não encontrado no Supabase');
      }

      const patchPayload: Record<string, unknown> = {};

      if (supabaseData.project) {
        patchPayload.project = supabaseData.project;
      }
      if (supabaseData.cuesheet?.rundown) {
        patchPayload.rundown = supabaseData.cuesheet.rundown;
      }
      if (supabaseData.cuesheet?.customFields) {
        patchPayload.customFields = supabaseData.cuesheet.customFields;
      }
      // Não atualizar settings e automation para não parar o timer
      // Esses campos podem afetar o comportamento do timer em execução
      // if (supabaseData.settings) {
      //   patchPayload.settings = supabaseData.settings;
      // }
      if (supabaseData.viewSettings) {
        patchPayload.viewSettings = supabaseData.viewSettings;
      }
      if (supabaseData.urlPresets) {
        patchPayload.urlPresets = supabaseData.urlPresets;
      }
      // if (supabaseData.automation) {
      //   patchPayload.automation = supabaseData.automation;
      // }

      await patchData(patchPayload as any);
      
      // Invalidar apenas caches relacionados ao projeto e cuesheet (não timer/runtime)
      await Promise.all([
        ontimeQueryClient.invalidateQueries({ queryKey: RUNDOWN }),
        ontimeQueryClient.invalidateQueries({ queryKey: CUSTOM_FIELDS }),
        ontimeQueryClient.invalidateQueries({ queryKey: PROJECT_DATA }),
      ]);

      const loadedCode = supabaseData.project?.projectCode || code;
      setProjectCode(loadedCode);

      toast({
        title: 'Projeto carregado',
        description: `Código ${code} carregado do Supabase (timers preservados)`,
        status: 'success',
        duration: 3500,
        isClosable: true,
      });
    } catch (error) {
      toast({
        title: 'Erro ao carregar projeto',
        description: maybeAxiosError(error),
        status: 'error',
        duration: 4500,
        isClosable: true,
      });
    } finally {
      setIsLoadingProject(false);
    }
  };

  const handleCodeChange = (newValue: string) => {
    // Only allow alphanumeric characters and limit to max length
    const sanitizedValue = newValue
      .replace(/[^A-Z0-9]/gi, '')
      .toUpperCase()
      .slice(0, PROJECT_CODE_MAX_LENGTH);
    setProjectCode(sanitizedValue);
  };

  const handleGenerateNewCode = async () => {
    onConfirmClose();
    setIsGeneratingCode(true);

    try {
      // Generate new project code
      const newCode = generateProjectCode();
      
      // Update local state immediately for better UX
      setProjectCode(newCode);

      // Update project data on server
      // postProjectData already calls forceProjectUpdate() on the server if Supabase is connected
      if (!projectData) {
        throw new Error('Dados do projeto não disponíveis');
      }

      const updatedProjectData: ProjectData = {
        ...projectData,
        projectCode: newCode,
      };

      await postProjectData(updatedProjectData);

      // Invalidate project data cache to refresh UI
      await ontimeQueryClient.invalidateQueries({ queryKey: PROJECT_DATA });

      // Show success toast with sync status
      const isConnected = supabaseStatusRef.current.connected;
      toast({
        title: 'Novo código gerado',
        description: isConnected 
          ? `Código ${newCode} gerado e sincronizado com Supabase`
          : `Código ${newCode} gerado localmente. Conecte ao Supabase para sincronizar.`,
        status: 'success',
        duration: 4000,
        isClosable: true,
      });
    } catch (error) {
      // Revert to previous code on error
      if (projectData?.projectCode) {
        setProjectCode(projectData.projectCode);
      }
      
      toast({
        title: 'Erro ao gerar novo código',
        description: maybeAxiosError(error),
        status: 'error',
        duration: 4500,
        isClosable: true,
      });
    } finally {
      setIsGeneratingCode(false);
    }
  };

  return (
    <>
      <div className={style.inputRow}>
        <label className={cx([style.label, style.active])} htmlFor='project-code'>
          Project Code
        </label>
        <div className={style.inputItems}>
          <Input
            id='project-code'
            size='sm'
            variant='ontime-filled'
            value={projectCode}
            onChange={(e) => handleCodeChange(e.target.value)}
            placeholder='A1B2C3D4E5F6'
            maxLength={PROJECT_CODE_MAX_LENGTH}
            textTransform='uppercase'
          />
          <Button
            size='xs'
            variant='ontime-subtle'
            onClick={onConfirmOpen}
            aria-label='Gerar novo código do projeto'
            isLoading={isGeneratingCode}
            isDisabled={supabaseStatus.connected}
            leftIcon={<IoShuffle size='12px' />}
          >
            Gerar Novo
          </Button>
          <Button
            size='xs'
            variant='ontime-subtle'
            onClick={handleLoadProject}
            aria-label='Carregar projeto pelo código'
            isLoading={isLoadingProject}
            isDisabled={!projectCode}
            leftIcon={<IoRefresh size='12px' />}
          >
            Carregar
          </Button>
        </div>
        {projectCode && (
          <div
            style={{
              marginTop: '4px',
              display: 'flex',
              flexDirection: 'row',
              gap: '8px',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Button
              size='sm'
              variant='ontime-subtle'
              onClick={onConfigOpen}
              leftIcon={<IoSettingsOutline size='12px' />}
              aria-label='Configurar PowerPoint Windows'
            >
              Config
            </Button>
            <Button
              size='sm'
              variant='ontime-subtle'
              onClick={onOpen}
              leftIcon={<IoLink size='12px' />}
              aria-label='Abrir links do projeto'
            >
              Links do Projeto
            </Button>
            <SupabaseControl />
            <PowerPointControl />
          </div>
        )}
      </div>

      <ProjectLinksModal isOpen={isOpen} onClose={onClose} projectCode={projectCode} projectData={projectData} />
      <PowerPointConfigModal isOpen={isConfigOpen} onClose={onConfigClose} />

      <AlertDialog variant='ontime' isOpen={isConfirmOpen} leastDestructiveRef={cancelRef} onClose={onConfirmClose}>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize='lg' fontWeight='bold'>
              Gerar Novo Código do Projeto
            </AlertDialogHeader>
            <AlertDialogBody>
              Você deseja realmente gerar um novo código para este projeto? <br />
              O código atual será substituído por um novo código aleatório.
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={onConfirmClose} variant='ontime-ghosted-white'>
                Cancelar
              </Button>
              <Button colorScheme='blue' onClick={handleGenerateNewCode} ml={4}>
                Confirmar
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </>
  );
}
