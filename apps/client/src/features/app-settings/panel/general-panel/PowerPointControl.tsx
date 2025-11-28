import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, useToast } from '@chakra-ui/react';

import { socketSendJson } from '../../../../common/utils/socket';

interface PowerPointStatus {
  enabled: boolean;
}

export default function PowerPointControl() {
  const [status, setStatus] = useState<PowerPointStatus>({ enabled: false }); // Inicia como false (vermelho/desabilitado)
  const [isLoading, setIsLoading] = useState(false);
  const [lastToggleTime, setLastToggleTime] = useState<number>(0);
  const toast = useToast();
  
  // Ref para acessar o estado atual sem criar dependência no useEffect
  const statusRef = useRef(status);
  statusRef.current = status;

  // Log do estado sempre que mudar
  useEffect(() => {
    console.log('PowerPointControl - Estado atualizado:', status.enabled);
  }, [status.enabled]);

  // Get real status from server
  const getRealStatus = useCallback(() => {
    socketSendJson('getpowerpointstatus');
  }, []);

  // Get initial status
  useEffect(() => {
    // Get real status after component mounts
    setTimeout(() => {
      getRealStatus();
    }, 500);
  }, [getRealStatus]);

  // Listen for PowerPoint status updates from WebSocket
  useEffect(() => {
    const handlePowerPointStatus = (event: CustomEvent) => {
      const { type, payload } = event.detail;

      console.log('PowerPointControl - Evento recebido:', { type, payload });

      if (type === 'togglepowerpoint' || type === 'getpowerpointstatus' || type === 'powerpoint-status') {
        if (payload && typeof payload === 'object') {
          if ('enabled' in payload) {
            const newEnabled = Boolean(payload.enabled);
            const currentEnabled = statusRef.current.enabled;
            console.log('PowerPointControl - Atualizando status:', {
              de: currentEnabled,
              para: newEnabled,
              tipo: type,
              payload: payload
            });
            
            // Só atualiza se realmente mudou
            if (currentEnabled !== newEnabled) {
              console.log('PowerPointControl - Estado mudou, atualizando...');
              // Força atualização usando função de atualização
              setStatus(prevStatus => {
                const newStatus = { enabled: newEnabled };
                console.log('PowerPointControl - setStatus chamado:', { prevStatus, newStatus });
                return newStatus;
              });
            } else {
              console.log('PowerPointControl - Estado não mudou, ignorando atualização');
            }
          }
          if ('error' in payload && payload.error) {
            console.error('PowerPointControl - Erro recebido:', payload.error);
            // Mostra toast de erro quando recebe erro
            toast({
              title: 'Conexão Necessária',
              description: payload.error || 'Não conectado ao app Python. Aguarde conexão automática ou verifique se o app Python está rodando.',
              status: 'error',
              duration: 4000,
              isClosable: true,
              position: 'top-right',
            });
          }
        } else {
          console.warn('PowerPointControl - Payload inválido:', payload);
        }
      }
    };

    // Add custom event listener
    window.addEventListener('powerpoint-status', handlePowerPointStatus as EventListener);
    
    console.log('PowerPointControl - Event listener registrado');

    return () => {
      window.removeEventListener('powerpoint-status', handlePowerPointStatus as EventListener);
      console.log('PowerPointControl - Event listener removido');
    };
  }, []); // Sem dependências - usa ref para acessar estado atual

  const handleToggle = () => {
    const now = Date.now();

    // Prevent rapid clicking
    if (now - lastToggleTime < 2000) {
      return;
    }

    setLastToggleTime(now);
    setIsLoading(true);

    const currentEnabled = status.enabled;
    console.log('PowerPointControl - Enviando toggle, status atual:', currentEnabled);

    // Atualiza estado otimisticamente (antes da resposta do servidor)
    setStatus({ enabled: !currentEnabled });

    // Send toggle command
    socketSendJson('togglepowerpoint');

    // Wait for server response and get real status
    setTimeout(() => {
      getRealStatus();
      setIsLoading(false);
    }, 1500);
  };

  return (
      <Button
        size='sm'
        variant='ontime-subtle'
        onClick={handleToggle}
        isLoading={isLoading}
        loadingText={!status.enabled ? 'Ativando...' : 'Desativando...'}
        leftIcon={
          <Box
            w='8px'
            h='8px'
            borderRadius='50%'
            bg={status.enabled ? 'green.400' : 'red.400'}
            animation={status.enabled ? 'pulse 2s infinite' : 'none'}
          key={`status-${status.enabled}`} // ✅ FORÇA RE-RENDER do ícone
            sx={{
              '@keyframes pulse': {
                '0%': { opacity: 1 },
                '50%': { opacity: 0.5 },
                '100%': { opacity: 1 },
              },
            }}
          />
        }
      title={status.enabled ? 'Enviando dados para Supabase' : 'Não enviando dados para Supabase'}
      >
        PPT
      </Button>
  );
}
