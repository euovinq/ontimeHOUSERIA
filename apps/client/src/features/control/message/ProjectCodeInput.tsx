import { useEffect, useState } from 'react';
import { IoLink, IoArrowDown, IoSettingsOutline } from 'react-icons/io5';
import { Button, Input, useDisclosure, useToast } from '@chakra-ui/react';

import useProjectData, { useProjectDataMutation } from '../../../common/hooks-query/useProjectData';
import { cx } from '../../../common/utils/styleUtils';
import { loadProjectFromSupabase } from '../../../common/api/project';
import PowerPointControl from '../../app-settings/panel/general-panel/PowerPointControl';
import SupabaseControl from '../../app-settings/panel/general-panel/SupabaseControl';

import PowerPointConfigModal from './PowerPointConfigModal';
import ProjectLinksModal from './ProjectLinksModal';

import style from './InputRow.module.scss';

export default function ProjectCodeInput() {
  const { data: projectData, refetch: refetchProjectData } = useProjectData();
  const { mutateAsync: updateProjectData } = useProjectDataMutation();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const { isOpen: isConfigOpen, onOpen: onConfigOpen, onClose: onConfigClose } = useDisclosure();
  const toast = useToast();

  const [projectCode, setProjectCode] = useState(projectData?.projectCode || '');
  const [isLoading, setIsLoading] = useState(false);

  // Sync with external data
  useEffect(() => {
    if (projectData?.projectCode) {
      setProjectCode(projectData.projectCode);
    }
  }, [projectData?.projectCode]);

  const handleCodeChange = (newValue: string) => {
    // Only allow alphanumeric characters
    // Don't save automatically - only update local state
    const sanitizedValue = newValue
      .replace(/[^A-Z0-9]/gi, '')
      .toUpperCase();
    setProjectCode(sanitizedValue);
  };

  const handleLoadProject = async () => {
    if (!projectCode || projectCode.trim().length === 0) {
      toast({
        title: 'Código vazio',
        description: 'Por favor, digite um código de projeto',
        status: 'warning',
        duration: 3000,
        isClosable: true,
        position: 'top',
      });
      return;
    }

    setIsLoading(true);
    try {
      await loadProjectFromSupabase(projectCode);
      
      // Refetch project data to update the UI
      await refetchProjectData();

      toast({
        title: 'Projeto carregado!',
        description: `Projeto ${projectCode} carregado com sucesso`,
        status: 'success',
        duration: 3000,
        isClosable: true,
        position: 'top',
      });
    } catch (error: any) {
      const errorMessage = error?.response?.data?.error || error?.message || 'Erro ao carregar projeto';
      toast({
        title: 'Erro ao carregar',
        description: errorMessage,
        status: 'error',
        duration: 5000,
        isClosable: true,
        position: 'top',
      });
    } finally {
      setIsLoading(false);
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
            placeholder='Digite o código do projeto'
            textTransform='uppercase'
          />
          <Button
            size='sm'
            variant='ontime-subtle'
            onClick={handleLoadProject}
            aria-label='Carregar projeto do Supabase'
            leftIcon={<IoArrowDown size='14px' />}
            isLoading={isLoading}
            isDisabled={isLoading || !projectCode || projectCode.trim().length === 0}
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

      <ProjectLinksModal 
        isOpen={isOpen} 
        onClose={onClose} 
        projectCode={projectCode}
        projectData={projectData}
      />
      <PowerPointConfigModal 
        isOpen={isConfigOpen} 
        onClose={onConfigClose}
      />
    </>
  );
}
