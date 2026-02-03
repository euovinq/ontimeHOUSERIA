import { useRef } from 'react';
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Button,
  useDisclosure,
} from '@chakra-ui/react';

import { useElectronEvent } from '../../../../common/hooks/useElectronEvent';
import * as Panel from '../../panel-utils/PanelUtils';

export default function LogoutPanel() {
  const { isElectron, sendToElectron } = useElectronEvent();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const handleLogout = () => {
    sendToElectron('logout');
    onClose();
  };

  return (
    <>
      <Panel.Header>Deslogar</Panel.Header>
      <Panel.Section>
        <Panel.Paragraph>
          Encerra sua sessão nesta máquina. A janela será fechada e a tela de login será exibida. Você poderá entrar
          novamente com seu usuário e senha.
        </Panel.Paragraph>
        <Button colorScheme='red' onClick={onOpen} maxWidth='350px' isDisabled={!isElectron}>
          Deslogar
        </Button>
        {!isElectron && (
          <Panel.Description>Disponível apenas no aplicativo desktop (Electron).</Panel.Description>
        )}
        <AlertDialog variant='ontime' isOpen={isOpen} leastDestructiveRef={cancelRef} onClose={onClose}>
          <AlertDialogOverlay>
            <AlertDialogContent>
              <AlertDialogHeader fontSize='lg' fontWeight='bold'>
                Deslogar
              </AlertDialogHeader>
              <AlertDialogBody>
                Deseja encerrar sua sessão? A janela será fechada e a tela de login será exibida.
              </AlertDialogBody>
              <AlertDialogFooter>
                <Button ref={cancelRef} onClick={onClose} variant='ontime-ghosted-white'>
                  Cancelar
                </Button>
                <Button colorScheme='red' onClick={handleLogout} disabled={!isElectron}>
                  Deslogar
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialogOverlay>
        </AlertDialog>
      </Panel.Section>
    </>
  );
}
