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
  const powerPointUrl = serverIp && serverPort ? `http://${serverIp}:${serverPort}/api/public/powerpoint/toggle` : '';
  const supabaseUrl = serverIp && serverPort ? `http://${serverIp}:${serverPort}/api/public/supabase/toggle` : '';
  const powerPointStatusUrl = serverIp && serverPort ? `http://${serverIp}:${serverPort}/api/public/powerpoint/status/complete` : '';

  return (
    <Modal isOpen={isOpen} onClose={onClose} variant='ontime' size='md'>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <HStack>
            <IoSettingsOutline size='20px' />
            <Text>Configuração PowerPoint</Text>
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
                  Informações do Servidor (Stream Deck / Companion)
                </Text>
                <Text fontSize='sm' color='gray.300' textAlign='center'>
                  Use essas URLs para configurar no Stream Deck ou Companion
                </Text>
                <Text fontSize='xs' color='gray.400' textAlign='center' fontStyle='italic' mt={-2}>
                  A conexão com o PowerPoint é automática via descoberta na rede
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
                  <Text fontSize='xs' color='gray.400' fontWeight='bold'>URLs para Stream Deck:</Text>
                  
                  {/* PowerPoint Toggle */}
                  {powerPointUrl && (
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
                      <CopyTag
                        copyValue={powerPointUrl}
                        label='Copiar URL PowerPoint Toggle'
                      >
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
                          PowerPoint Toggle: {powerPointUrl}
                        </Text>
                      </CopyTag>
                    </Box>
                  )}
                  
                  {/* Supabase Toggle */}
                  {supabaseUrl && (
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
                      <CopyTag
                        copyValue={supabaseUrl}
                        label='Copiar URL Supabase Toggle'
                      >
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
                          Supabase Toggle: {supabaseUrl}
                        </Text>
                      </CopyTag>
                    </Box>
                  )}
                  
                  {/* PowerPoint Status Completo */}
                  {powerPointStatusUrl && (
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
                      <CopyTag
                        copyValue={powerPointStatusUrl}
                        label='Copiar URL PowerPoint Status Completo'
                      >
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
                          PowerPoint Status: {powerPointStatusUrl}
                        </Text>
                      </CopyTag>
                    </Box>
                  )}
                  
                  {(!powerPointUrl || !supabaseUrl || !powerPointStatusUrl) && (
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
