import { useCallback, useEffect, useState, useRef } from 'react';
import { Box, Button } from '@chakra-ui/react';

import { socketSendJson } from '../../../../common/utils/socket';

interface SupabaseStatus {
  connected: boolean;
  enabled: boolean;
}

export default function SupabaseControl() {
  const [status, setStatus] = useState<SupabaseStatus>({ connected: false, enabled: false });
  const [isLoading, setIsLoading] = useState(false);
  const [lastToggleTime, setLastToggleTime] = useState<number>(0);
  
  // Ref para acessar o estado atual sem criar dependência no useEffect
  const statusRef = useRef(status);
  statusRef.current = status;

  // Log do estado sempre que mudar
  useEffect(() => {
    console.log('SupabaseControl - Estado atualizado:', status.connected, status.enabled);
  }, [status.connected, status.enabled]);

  // Get real status from server
  const getRealStatus = useCallback(() => {
    socketSendJson('getsupabasestatus');
  }, []);

  // Get initial status - start disabled by default
  useEffect(() => {
    // Set initial status as disabled - user must enable manually
    setStatus({ connected: false, enabled: false });

    // Get real status after component mounts
    setTimeout(() => {
      getRealStatus();
    }, 500);
  }, [getRealStatus]);

  // Listen for Supabase status updates from WebSocket
  useEffect(() => {
    const handleSupabaseStatus = (event: CustomEvent) => {
      const { type, payload } = event.detail;

      console.log('SupabaseControl - Evento recebido:', { type, payload });

      if (type === 'togglesupabase' || type === 'getsupabasestatus') {
        if (payload && typeof payload === 'object') {
          const currentStatus = statusRef.current;
          const newStatus = {
            connected: Boolean(payload.connected),
            enabled: Boolean(payload.enabled ?? payload.connected),
          };
          
          console.log('SupabaseControl - Atualizando status:', {
            de: currentStatus,
            para: newStatus,
            tipo: type,
            payload: payload
          });
          
          // Só atualiza se realmente mudou
          if (currentStatus.connected !== newStatus.connected || currentStatus.enabled !== newStatus.enabled) {
            console.log('SupabaseControl - Estado mudou, atualizando...');
            // Força atualização usando função de atualização
            setStatus(prevStatus => {
              const updatedStatus = {
                connected: Boolean(payload.connected),
                enabled: Boolean(payload.enabled ?? payload.connected),
              };
              console.log('SupabaseControl - setStatus chamado:', { prevStatus, updatedStatus });
              return updatedStatus;
            });
          } else {
            console.log('SupabaseControl - Estado não mudou, ignorando atualização');
          }
        } else {
          console.warn('SupabaseControl - Payload inválido:', payload);
        }
      }
    };

    // Add custom event listener
    window.addEventListener('supabase-status', handleSupabaseStatus as EventListener);
    
    console.log('SupabaseControl - Event listener registrado');

    return () => {
      window.removeEventListener('supabase-status', handleSupabaseStatus as EventListener);
      console.log('SupabaseControl - Event listener removido');
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

    // Send toggle command
    socketSendJson('togglesupabase');

    // Wait for server response and get real status
    setTimeout(() => {
      getRealStatus();
      setIsLoading(false);
    }, 1500);
  };

  const getStatusText = () => {
    return status.connected ? 'Conectado' : 'Offline';
  };

  return (
    <Button
      size='sm'
      variant='ontime-subtle'
      onClick={handleToggle}
      isLoading={isLoading}
      loadingText={!status.connected ? 'Desconectando...' : 'Conectando...'}
      colorScheme={status.connected ? 'green' : 'red'}
      key={`supabase-btn-${status.connected}`} // ✅ FORÇA RE-RENDER do botão inteiro
      leftIcon={
        <Box
          w='8px'
          h='8px'
          borderRadius='50%'
          bg={status.connected ? 'green.400' : 'red.400'}
          animation={status.connected ? 'pulse 2s infinite' : 'none'}
          key={`supabase-status-${status.connected}`} // ✅ FORÇA RE-RENDER do ícone
          sx={{
            '@keyframes pulse': {
              '0%': { opacity: 1 },
              '50%': { opacity: 0.5 },
              '100%': { opacity: 1 },
            },
          }}
        />
      }
    >
      {getStatusText()}
    </Button>
  );
}
