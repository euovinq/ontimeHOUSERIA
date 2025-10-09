import { useEffect, useState } from 'react';
import { Input, Button, useDisclosure } from '@chakra-ui/react';
import { IoRefresh, IoLink } from 'react-icons/io5';

import useProjectData, { useProjectDataMutation } from '../../../common/hooks-query/useProjectData';
import { generateProjectCode } from 'ontime-utils';
import { cx } from '../../../common/utils/styleUtils';
import ProjectLinksModal from './ProjectLinksModal';

import style from './InputRow.module.scss';

export default function ProjectCodeInput() {
  const { data: projectData } = useProjectData();
  const { mutateAsync: updateProjectData } = useProjectDataMutation();
  const { isOpen, onOpen, onClose } = useDisclosure();
  
  const [projectCode, setProjectCode] = useState(projectData?.projectCode || '');

  // Sync with external data
  useEffect(() => {
    if (projectData?.projectCode) {
      setProjectCode(projectData.projectCode);
    }
  }, [projectData?.projectCode]);

  const handleGenerateNewCode = async () => {
    const newCode = generateProjectCode();
    setProjectCode(newCode);
    
    if (projectData) {
      await updateProjectData({
        ...projectData,
        projectCode: newCode,
      });
    }
  };

  const handleCodeChange = async (newValue: string) => {
    // Only allow alphanumeric characters and limit to 5 characters
    const sanitizedValue = newValue.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 5);
    setProjectCode(sanitizedValue);
    
    if (projectData) {
      await updateProjectData({
        ...projectData,
        projectCode: sanitizedValue,
      });
    }
  };

  return (
    <>
      <div className={style.inputRow}>
        <label className={cx([style.label, style.active])} htmlFor="project-code">
          Project Code
        </label>
        <div className={style.inputItems}>
          <Input
            id="project-code"
            size="sm"
            variant="ontime-filled"
            value={projectCode}
            onChange={(e) => handleCodeChange(e.target.value)}
            placeholder="A1B2C"
            maxLength={5}
            textTransform="uppercase"
          />
          <Button
            size="sm"
            variant="ontime-subtle"
            onClick={handleGenerateNewCode}
            aria-label="Generate new project code"
            leftIcon={<IoRefresh size="14px" />}
          >
            New
          </Button>
        </div>
        {projectCode && (
          <div style={{ 
            marginTop: '8px', 
            display: 'flex', 
            justifyContent: 'flex-start' 
          }}>
            <Button
              size="xs"
              variant="ontime-subtle"
              onClick={onOpen}
              leftIcon={<IoLink size="12px" />}
              aria-label="Abrir links do projeto"
            >
              Links do Projeto
            </Button>
          </div>
        )}
      </div>
      
      <ProjectLinksModal 
        isOpen={isOpen} 
        onClose={onClose} 
        projectCode={projectCode} 
      />
    </>
  );
}
