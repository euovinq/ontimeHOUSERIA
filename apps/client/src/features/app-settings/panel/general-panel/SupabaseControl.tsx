import { useState, useEffect, useCallback } from 'react';
import { Button, Box } from '@chakra-ui/react';

import { socketSendJson } from '../../../../common/utils/socket';

interface SupabaseStatus {
  connected: boolean;
  enabled: boolean;
}

export default function SupabaseControl() {
  const [status, setStatus] = useState<SupabaseStatus>({ connected: false, enabled: false });
  const [isLoading, setIsLoading] = useState(false);
  const [lastToggleTime, setLastToggleTime] = useState<number>(0);

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
      
      if (type === 'togglesupabase' || type === 'getsupabasestatus') {
        if (payload && typeof payload === 'object') {
          setStatus(payload);
        }
      }
    };

    // Add custom event listener
    window.addEventListener('supabase-status', handleSupabaseStatus as EventListener);
    
    return () => {
      window.removeEventListener('supabase-status', handleSupabaseStatus as EventListener);
    };
  }, []);

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
      leftIcon={
        <Box
          w='8px'
          h='8px'
          borderRadius='50%'
          bg={status.connected ? 'green.400' : 'red.400'}
          animation={status.connected ? 'pulse 2s infinite' : 'none'}
          sx={{
            '@keyframes pulse': {
              '0%': { opacity: 1 },
              '50%': { opacity: 0.5 },
              '100%': { opacity: 1 }
            }
          }}
        />
      }
    >
      {getStatusText()}
    </Button>
  );
}
