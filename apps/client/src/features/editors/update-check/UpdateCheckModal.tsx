import ReactMarkdown from 'react-markdown';
import {
  Button,
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


export default function UpdateCheckModal() {
  const { hasUpdate, version, release_notes, download_url, error, estado, progresso, clearUpdateCheck } =
    useUpdateCheckStore();

  const isElectron = window.process?.type === 'renderer';

  /** O app se encarrega da troca — não há mais download manual. */
  const handleReiniciar = () => {
    if (!isElectron) return;
    // `ipcRenderer` está tipado no projeto só com `invoke`; referência larga
    // para não somar erro de tipo enquanto a declaração não é corrigida.
    const ipc = window.require('electron').ipcRenderer as unknown as {
      send: (canal: string) => void;
    };
    ipc.send('update-install-now');
  };

  const formatMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

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
              {/* Baixando: sem isto a tela ficava muda por vários minutos e a
                  leitura natural era "travou". */}
              {estado === 'baixando' && progresso && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <div
                    style={{
                      height: '6px',
                      borderRadius: '3px',
                      background: '#3a3a3a',
                      overflow: 'hidden',
                    }}
                    role='progressbar'
                    aria-valuenow={Math.round(progresso.percent)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label='Progresso do download'
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${progresso.percent}%`,
                        background: '#2b8bd8',
                        transition: 'width 200ms linear',
                      }}
                    />
                  </div>
                  <p
                    style={{
                      color: '#a5a5a5',
                      fontSize: 'calc(1rem - 3px)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    Baixando {Math.round(progresso.percent)}% · {formatMB(progresso.transferred)} de{' '}
                    {formatMB(progresso.total)}
                  </p>
                </div>
              )}

              {estado === 'pronto' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <p style={{ color: '#e2e2e2' }}>
                    Atualização baixada. A troca acontece ao reiniciar o app.
                  </p>
                  {/* O padrão é continuar: pode haver evento no ar. */}
                  <Button size='sm' variant='ontime-filled' onClick={handleReiniciar}>
                    Reiniciar agora
                  </Button>
                  <p style={{ color: '#a5a5a5', fontSize: 'calc(1rem - 3px)' }}>
                    Se houver evento no ar, feche esta janela — a atualização é aplicada sozinha
                    quando você encerrar o app.
                  </p>
                </div>
              )}

              {/* Só existe quando o updater automático não está no comando. */}
              {!estado && download_url && (
                <Button size='sm' variant='ontime-filled' onClick={handleDownload}>
                  Baixar atualização
                </Button>
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
