import ReactMarkdown from 'react-markdown';
import {
  Button,
  Kbd,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
} from '@chakra-ui/react';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

import { useUpdateCheckStore } from '../../../common/stores/updateCheckStore';
import { openLink } from '../../../common/utils/linkUtils';

import style from './UpdateCheckModal.module.scss';

const XATTR_COMMAND = 'xattr -cr /Applications/HouseriaAPP.app';
const isMac = typeof window !== 'undefined' && window.process?.platform === 'darwin';

export default function UpdateCheckModal() {
  const { hasUpdate, version, release_notes, download_url, error, clearUpdateCheck } = useUpdateCheckStore();

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(XATTR_COMMAND);
    } catch (_err) {
      /** clipboard not available */
    }
  };

  const handleDownload = () => {
    if (download_url) {
      openLink(download_url);
    }
  };

  return (
    <Modal isOpen onClose={clearUpdateCheck} variant='ontime' isCentered>
      <ModalOverlay />
      <ModalContent maxWidth='max(520px, 45vw)'>
        <ModalHeader>Verificar atualização</ModalHeader>
        <ModalCloseButton />
        <ModalBody display='flex' flexDirection='column' gap='1rem'>
          {error && <p style={{ color: '#e2e2e2' }}>{error}</p>}
          {!error && !hasUpdate && (
            <p style={{ color: '#e2e2e2' }}>Você está usando a versão mais atual do HouseriaAPP.</p>
          )}
          {!error && hasUpdate && (
            <>
              <p style={{ color: '#e2e2e2' }}>
                Uma nova versão está disponível: <strong>v{version}</strong>
              </p>
              {release_notes && (
                <>
                  <p style={{ color: '#e2e2e2', fontSize: 'calc(1rem - 2px)', marginBottom: '0.25rem' }}>
                    O que mudou:
                  </p>
                  <div className={style.releaseNotesBox}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                      components={{
                        a: ({ href, children }) => (
                          <a
                            href='#!'
                            onClick={(e) => {
                              e.preventDefault();
                              if (href) openLink(href);
                            }}
                          >
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {release_notes}
                    </ReactMarkdown>
                  </div>
                </>
              )}
              {download_url && (
                <Button size='sm' variant='ontime-filled' onClick={handleDownload}>
                  Baixar atualização
                </Button>
              )}
              {isMac && download_url && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <p style={{ color: '#e2e2e2', fontSize: 'calc(1rem - 2px)' }}>
                    Após instalar, execute no Terminal para remover a quarentena:
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Kbd
                      flex={1}
                      padding='0.5rem 0.75rem'
                      fontSize='calc(1rem - 2px)'
                      whiteSpace='nowrap'
                      overflow='hidden'
                      textOverflow='ellipsis'
                    >
                      {XATTR_COMMAND}
                    </Kbd>
                    <Button size='sm' variant='ontime-subtle' onClick={handleCopyCommand}>
                      Copiar
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant='ontime-subtle' onClick={clearUpdateCheck}>
            Fechar
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
