import { useEffect, useState } from 'react';
import { IoLink, IoRefresh, IoSettingsOutline } from 'react-icons/io5';
import { Button, Input, useDisclosure, useToast } from '@chakra-ui/react';

import { patchData } from '../../../common/api/db';
import { fetchSupabaseProject } from '../../../common/api/supabase';
import { invalidateAllCaches, maybeAxiosError } from '../../../common/api/utils';
import useProjectData from '../../../common/hooks-query/useProjectData';
import { cx } from '../../../common/utils/styleUtils';
import PowerPointControl from '../../app-settings/panel/general-panel/PowerPointControl';
import SupabaseControl from '../../app-settings/panel/general-panel/SupabaseControl';

import PowerPointConfigModal from './PowerPointConfigModal';
import ProjectLinksModal from './ProjectLinksModal';

import style from './InputRow.module.scss';

const PROJECT_CODE_MAX_LENGTH = 12;

export default function ProjectCodeInput() {
  const { data: projectData } = useProjectData();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const { isOpen: isConfigOpen, onOpen: onConfigOpen, onClose: onConfigClose } = useDisclosure();
  const toast = useToast();

  const [projectCode, setProjectCode] = useState(projectData?.projectCode || '');
  const [isLoadingProject, setIsLoadingProject] = useState(false);

  // Sync with external data
  useEffect(() => {
    if (projectData?.projectCode) {
      setProjectCode(projectData.projectCode);
    }
  }, [projectData?.projectCode]);

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
      if (supabaseData.settings) {
        patchPayload.settings = supabaseData.settings;
      }
      if (supabaseData.viewSettings) {
        patchPayload.viewSettings = supabaseData.viewSettings;
      }
      if (supabaseData.urlPresets) {
        patchPayload.urlPresets = supabaseData.urlPresets;
      }
      if (supabaseData.automation) {
        patchPayload.automation = supabaseData.automation;
      }

      await patchData(patchPayload as any);
      await invalidateAllCaches();

      const loadedCode = supabaseData.project?.projectCode || code;
      setProjectCode(loadedCode);

      toast({
        title: 'Projeto carregado',
        description: `Código ${code} carregado do Supabase`,
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
            size='sm'
            variant='ontime-subtle'
            onClick={handleLoadProject}
            aria-label='Carregar projeto pelo código'
            isLoading={isLoadingProject}
            isDisabled={!projectCode}
            leftIcon={<IoRefresh size='14px' />}
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
    </>
  );
}
