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
  
  // Ref para controlar debounce de toasts de erro (evita múltiplos toasts)
  const lastErrorToastTime = useRef<number>(0);
  const ERROR_TOAST_DEBOUNCE_MS = 2000; // 2 segundos entre toasts de erro

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

      if (type === 'togglepowerpoint' || type === 'getpowerpointstatus' || type === 'powerpoint-status') {
        if (payload && typeof payload === 'object') {
          // Se há erro, SEMPRE força enabled para false (desconectado)
          if ('error' in payload && payload.error) {
            const _currentEnabled = statusRef.current.enabled;
            
            // SEMPRE força desabilitar (vermelho) quando há erro, mesmo se já estava false
            // Isso garante que o estado visual seja atualizado
            setStatus({ enabled: false });
            
            // Mostra toast de erro apenas se passou tempo suficiente desde o último toast
            // Isso evita múltiplos toasts quando togglepowerpoint e getpowerpointstatus retornam erro
            const now = Date.now();
            const timeSinceLastToast = now - lastErrorToastTime.current;
            
            if (timeSinceLastToast >= ERROR_TOAST_DEBOUNCE_MS) {
              lastErrorToastTime.current = now;
              toast({
                title: 'Conexão Necessária',
                description: payload.error || 'Não conectado ao HouseriaPPT. Aguarde conexão automática ou verifique se o HouseriaPPT está rodando.',
                status: 'error',
                duration: 4000,
                isClosable: true,
                position: 'top-right',
              });
            }
            
            // Se há erro, não processa enabled do payload (erro tem prioridade)
            return;
          }
          
          // Atualiza enabled se presente no payload (apenas se não houver erro)
          if ('enabled' in payload) {
            const newEnabled = Boolean(payload.enabled);
            const currentEnabled = statusRef.current.enabled;
            
            // Só atualiza se realmente mudou
            if (currentEnabled !== newEnabled) {
              // Força atualização usando função de atualização
              setStatus(_prevStatus => {
                const newStatus = { enabled: newEnabled };
                return newStatus;
              });
            }
          }
        } else {
          console.warn('PowerPointControl - Payload inválido:', payload);
        }
      }
    };

    // Add custom event listener
    window.addEventListener('powerpoint-status', handlePowerPointStatus as EventListener);

    return () => {
      window.removeEventListener('powerpoint-status', handlePowerPointStatus as EventListener);
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
