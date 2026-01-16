import { useEffect, useState } from 'react';
import { IoSettingsOutline } from 'react-icons/io5';
import {
  Box,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Text,
  VStack,
} from '@chakra-ui/react';

import CopyTag from '../../../common/components/copy-tag/CopyTag';
import useInfo from '../../../common/hooks-query/useInfo';

interface PowerPointConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Componente auxiliar para criar CopyTag de rota
function RouteCopyTag({ url, label, displayText }: { url: string | null; label: string; displayText: string }) {
  if (!url) return null;
  return (
    <Box 
      width='100%' 
      overflow='hidden'
      sx={{
        '& > div, & > div > div': {
          width: '100% !important',
          maxWidth: '100% !important',
        },
        '& button[class*="chakra-button"]:first-of-type': {
          maxWidth: 'calc(100% - 40px) !important',
          overflow: 'hidden !important',
          whiteSpace: 'nowrap !important',
          textOverflow: 'ellipsis !important',
          textAlign: 'left !important',
          flex: '1 1 auto !important',
        },
        '& [role="group"]': {
          width: '100% !important',
          maxWidth: '100% !important',
        }
      }}
    >
      <CopyTag copyValue={url} label={label}>
        <Text 
          fontSize='xs' 
          color='gray.300' 
          style={{ 
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textAlign: 'left',
            maxWidth: '100%',
            display: 'block',
          }}
        >
          {displayText}
        </Text>
      </CopyTag>
    </Box>
  );
}

export default function PowerPointConfigModal({ isOpen, onClose }: PowerPointConfigModalProps) {
  // Informações do servidor para Stream Deck/Companion
  const { data: serverInfo } = useInfo();
  const [serverIp, setServerIp] = useState<string>('');
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [networkIp, setNetworkIp] = useState<string>(''); // IP da rede (informação adicional)

  // Atualiza informações do servidor quando modal abrir ou info mudar
  useEffect(() => {
    if (isOpen && serverInfo) {
      // Sempre usa localhost para URLs (já que Companion e servidor estão na mesma máquina)
      setServerIp('localhost');
      
      // Também obtém IP da rede para exibir como informação adicional
      const networkIpFound = serverInfo.networkInterfaces?.find(nif => nif.name !== 'localhost' && nif.address !== '127.0.0.1');
      if (networkIpFound) {
        setNetworkIp(networkIpFound.address);
      } else if (serverInfo.networkInterfaces?.length > 0) {
        setNetworkIp(serverInfo.networkInterfaces[0].address);
      } else {
        setNetworkIp('');
      }
      
      setServerPort(serverInfo.serverPort || null);
    }
  }, [isOpen, serverInfo]);

  // Constrói URLs para Stream Deck/Companion
  const baseUrl = serverIp && serverPort ? `http://${serverIp}:${serverPort}` : '';
  
  // Rotas principais de controle
  const startUrl = baseUrl ? `${baseUrl}/api/start` : '';
  const startNextUrl = baseUrl ? `${baseUrl}/api/start/next` : '';
  const startPreviousUrl = baseUrl ? `${baseUrl}/api/start/previous` : '';
  const pauseUrl = baseUrl ? `${baseUrl}/api/pause` : '';
  const stopUrl = baseUrl ? `${baseUrl}/api/stop` : '';
  const pollUrl = baseUrl ? `${baseUrl}/api/poll` : '';
  const loadUrl = baseUrl ? `${baseUrl}/api/load` : '';
  const loadNextUrl = baseUrl ? `${baseUrl}/api/load/next` : '';
  const rollUrl = baseUrl ? `${baseUrl}/api/roll` : '';
  const reloadUrl = baseUrl ? `${baseUrl}/api/reload` : '';
  
  // Toggles
  const powerPointUrl = baseUrl ? `${baseUrl}/api/public/powerpoint/toggle` : '';
  const supabaseUrl = baseUrl ? `${baseUrl}/api/public/supabase/toggle` : '';

  return (
    <Modal isOpen={isOpen} onClose={onClose} variant='ontime' size='md'>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <HStack>
            <IoSettingsOutline size='20px' />
            <Text>Rotas da API (Companion / Stream Deck)</Text>
          </HStack>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4} align='stretch'>
            {/* Informações do Servidor para Stream Deck/Companion */}
            <div
              style={{
                padding: '16px',
                border: '1px solid var(--chakra-colors-gray-600)',
                borderRadius: '8px',
                backgroundColor: 'var(--chakra-colors-gray-800)',
              }}
            >
              <VStack spacing={3} align='stretch'>
                <Text fontWeight='bold' fontSize='md' color='white' textAlign='center'>
                  Rotas Públicas da API
                </Text>
                <Text fontSize='sm' color='gray.300' textAlign='center'>
                  Use essas URLs para configurar no Stream Deck ou Companion
                </Text>
                
                {/* IP e Porta */}
                <VStack spacing={2} align='stretch'>
                  <HStack justify='space-between'>
                    <Text fontSize='sm' color='gray.300'>URL Base:</Text>
                    <Text fontSize='sm' fontWeight='bold' color='white'>{serverIp || 'Carregando...'}</Text>
                  </HStack>
                  <HStack justify='space-between'>
                    <Text fontSize='sm' color='gray.300'>Porta:</Text>
                    <Text fontSize='sm' fontWeight='bold' color='white'>{serverPort || 'Carregando...'}</Text>
                  </HStack>
                  {networkIp && (
                    <HStack justify='space-between'>
                      <Text fontSize='xs' color='gray.400' fontStyle='italic'>IP da Rede:</Text>
                      <Text fontSize='xs' color='gray.400' fontStyle='italic'>{networkIp}</Text>
                    </HStack>
                  )}
                </VStack>
                
                {/* URLs para copiar */}
                <VStack spacing={2} align='stretch' width='100%'>
                  <Text fontSize='xs' color='gray.400' fontWeight='bold'>Controles do Timer:</Text>
                  
                  <RouteCopyTag url={startUrl} label='Copiar URL Start' displayText={`Start: ${startUrl}`} />
                  <RouteCopyTag url={startNextUrl} label='Copiar URL Start Next' displayText={`Start Next: ${startNextUrl}`} />
                  <RouteCopyTag url={startPreviousUrl} label='Copiar URL Start Previous' displayText={`Start Previous: ${startPreviousUrl}`} />
                  <RouteCopyTag url={pauseUrl} label='Copiar URL Pause' displayText={`Pause: ${pauseUrl}`} />
                  <RouteCopyTag url={stopUrl} label='Copiar URL Stop' displayText={`Stop: ${stopUrl}`} />
                  <RouteCopyTag url={pollUrl} label='Copiar URL Poll' displayText={`Poll: ${pollUrl}`} />
                  <RouteCopyTag url={loadUrl} label='Copiar URL Load' displayText={`Load: ${loadUrl}`} />
                  <RouteCopyTag url={loadNextUrl} label='Copiar URL Load Next' displayText={`Load Next: ${loadNextUrl}`} />
                  <RouteCopyTag url={rollUrl} label='Copiar URL Roll' displayText={`Roll: ${rollUrl}`} />
                  <RouteCopyTag url={reloadUrl} label='Copiar URL Reload' displayText={`Reload: ${reloadUrl}`} />
                  
                  <Text fontSize='xs' color='gray.400' fontWeight='bold' mt={2}>Toggles:</Text>
                  
                  <RouteCopyTag url={powerPointUrl} label='Copiar URL PowerPoint Toggle' displayText={`PowerPoint Toggle: ${powerPointUrl}`} />
                  <RouteCopyTag url={supabaseUrl} label='Copiar URL Supabase Toggle' displayText={`Supabase Toggle: ${supabaseUrl}`} />
                  
                  {(!baseUrl) && (
                    <Text fontSize='xs' color='gray.500' textAlign='center' fontStyle='italic'>
                      Aguardando informações do servidor...
                    </Text>
                  )}
                </VStack>
              </VStack>
            </div>
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
