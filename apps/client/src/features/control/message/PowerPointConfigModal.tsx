import { useEffect, useState } from 'react';
import { IoSettingsOutline } from 'react-icons/io5';
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Input,
  VStack,
  Text,
  useToast,
  HStack,
  Box,
} from '@chakra-ui/react';
import { apiEntryUrl } from '../../../common/api/constants';
import useInfo from '../../../common/hooks-query/useInfo';
import CopyTag from '../../../common/components/copy-tag/CopyTag';

interface PowerPointConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface WindowsServiceStatus {
  url: string;
  isPolling: boolean;
  isConnected: boolean;
  lastUpdate?: number;
}

const STORAGE_KEY = 'powerpoint-windows-config';

export default function PowerPointConfigModal({ isOpen, onClose }: PowerPointConfigModalProps) {
  const toast = useToast();
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingStatus, setIsFetchingStatus] = useState(false);
  
  // Informações do servidor para Stream Deck/Companion
  const { data: serverInfo } = useInfo();
  const [serverIp, setServerIp] = useState<string>('');
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [networkIp, setNetworkIp] = useState<string>(''); // IP da rede (informação adicional)
  
  // Carrega do sessionStorage ao montar
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const config = JSON.parse(saved);
        if (config.ip) setIp(config.ip);
        if (config.port) setPort(config.port);
      }
    } catch (e) {
      // Ignora erros
    }
  }, []);

  // Buscar status atual quando modal abrir
  useEffect(() => {
    if (isOpen) {
      fetchCurrentStatus();
    } else {
      // Quando fecha, reseta para vazio
      setIp('');
      setPort('');
    }
  }, [isOpen]);

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

  const fetchCurrentStatus = async () => {
    setIsFetchingStatus(true);
    try {
      // Primeiro tenta carregar do sessionStorage
      try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
          const config = JSON.parse(saved);
          if (config.ip) setIp(config.ip);
          if (config.port) setPort(config.port);
        }
      } catch (e) {
        // Ignora erros do sessionStorage
      }
      
      // Depois tenta buscar do servidor (sobrescreve sessionStorage se conseguir)
      const response = await fetch(`${apiEntryUrl}/powerpoint/windows/status`);
      if (response.ok) {
        const text = await response.text();
        if (text && text.trim() !== '') {
          const data = JSON.parse(text);
          // Sempre mostra IP e Porta (mesmo que vazios)
          // Se não tiver config, mostra vazio
          if (data.ip) {
            setIp(data.ip);
            // Atualiza sessionStorage com valores do servidor
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ip: data.ip, port: data.port || '' }));
          } else {
            setIp('');
          }
          
          if (data.port) {
            setPort(data.port);
          } else {
            setPort('');
          }
        }
      }
    } catch (error) {
      console.error('Erro ao buscar status:', error);
      // Em caso de erro, usa sessionStorage se tiver
      try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
          const config = JSON.parse(saved);
          if (config.ip) setIp(config.ip);
          if (config.port) setPort(config.port);
        } else {
          setIp('');
          setPort('');
        }
      } catch (e) {
        setIp('');
        setPort('');
      }
    } finally {
      setIsFetchingStatus(false);
    }
  };

  const handleApply = async () => {
    // Permite enviar vazio para limpar configuração
    // Se ambos estiverem vazios, limpa a configuração
    const ipValue = ip.trim();
    const portValue = port.trim();
    
    // Se um dos dois estiver preenchido, o outro também deve estar
    if ((ipValue && !portValue) || (!ipValue && portValue)) {
      toast({
        title: 'Campos incompletos',
        description: 'Preencha ambos IP e Porta, ou deixe ambos vazios para limpar',
        status: 'error',
        duration: 3000,
        isClosable: true,
        position: 'top',
      });
      return;
    }
    
    // Se ambos vazios, permite limpar (pula validações)
    if (!ipValue && !portValue) {
      // Continua para enviar vazio e limpar
    } else {

      // Validação de IP
      const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (!ipRegex.test(ipValue)) {
        toast({
          title: 'IP inválido',
          description: 'Por favor, informe um IP válido (ex: 192.168.0.240)',
          status: 'error',
          duration: 3000,
          isClosable: true,
          position: 'top',
        });
        return;
      }

      // Validação de porta
      const portNum = parseInt(portValue, 10);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        toast({
          title: 'Porta inválida',
          description: 'Por favor, informe uma porta válida (1-65535)',
          status: 'error',
          duration: 3000,
          isClosable: true,
          position: 'top',
        });
        return;
      }
    }

    setIsLoading(true);
    try {
      // Salva no sessionStorage primeiro (fallback)
      if (ipValue && portValue) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ip: ipValue, port: portValue }));
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
      
      const url = `${apiEntryUrl}/powerpoint/windows/config`;
      const bodyData = { ip: ipValue, port: portValue };
      
      console.log('🚀 [CLIENT] Enviando requisição para:', url);
      console.log('🚀 [CLIENT] Body:', bodyData);
      console.log('🚀 [CLIENT] Window location:', window.location.href);
      console.log('🚀 [CLIENT] apiEntryUrl:', apiEntryUrl);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyData),
      });

      console.log('🔍 [CLIENT] Response status:', response.status);
      console.log('🔍 [CLIENT] Response statusText:', response.statusText);
      console.log('🔍 [CLIENT] Response headers:', response.headers);
      console.log('🔍 [CLIENT] Response ok:', response.ok);

      // Verifica se a resposta está ok antes de tentar parsear JSON
      const text = await response.text();
      console.log('🔍 [CLIENT] Response text (raw):', text);
      console.log('🔍 [CLIENT] Response text (length):', text.length);
      
      if (!text || text.trim() === '') {
        console.error('❌ [CLIENT] Resposta vazia do servidor!');
        // Se resposta vazia mas tem valores, usa sessionStorage
        if (ipValue && portValue) {
          toast({
            title: 'Configuração salva localmente',
            description: `IP e Porta salvos no navegador. Servidor não respondeu, mas configuração foi salva.`,
            status: 'warning',
            duration: 5000,
            isClosable: true,
            position: 'top',
          });
          onClose();
          return;
        }
        throw new Error('Resposta vazia do servidor');
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error('Erro ao parsear JSON:', text);
        // Se falhar ao parsear mas tem valores, usa sessionStorage
        if (ipValue && portValue) {
          toast({
            title: 'Configuração salva localmente',
            description: `IP e Porta salvos no navegador. Erro ao processar resposta do servidor.`,
            status: 'warning',
            duration: 5000,
            isClosable: true,
            position: 'top',
          });
          onClose();
          return;
        }
        throw new Error(`Erro ao processar resposta do servidor: ${text.substring(0, 100)}`);
      }

      if (response.ok && data.success) {
        // Atualiza sessionStorage com sucesso do servidor
        if (ipValue && portValue) {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ip: ipValue, port: portValue }));
        } else {
          sessionStorage.removeItem(STORAGE_KEY);
        }
        
        if (!ipValue && !portValue) {
          toast({
            title: 'Configuração removida',
            description: 'IP e Porta foram limpos',
            status: 'success',
            duration: 3000,
            isClosable: true,
            position: 'top',
          });
        } else {
          toast({
            title: 'Configuração aplicada!',
            description: `PowerPoint Windows configurado para ${data.url}`,
            status: 'success',
            duration: 3000,
            isClosable: true,
            position: 'top',
          });
        }
        onClose();
      } else {
        throw new Error(data.error || 'Erro ao aplicar configuração');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      console.error('❌ [CLIENT] Erro:', error);
      
      // Se erro mas tem valores, mantém no sessionStorage
      if (ipValue && portValue) {
        toast({
          title: 'Configuração salva localmente',
          description: `IP e Porta foram salvos no navegador. Erro: ${errorMessage}`,
          status: 'warning',
          duration: 5000,
          isClosable: true,
          position: 'top',
        });
      } else {
        toast({
          title: 'Erro ao aplicar configuração',
          description: errorMessage,
          status: 'error',
          duration: 5000,
          isClosable: true,
          position: 'top',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} variant='ontime' size='md'>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <HStack>
            <IoSettingsOutline size='20px' />
            <Text>Configuração PowerPoint Windows</Text>
          </HStack>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4} align='stretch'>
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
                  Configuração de Conexão
                </Text>
                <Text fontSize='sm' color='gray.300' textAlign='center'>
                  Informe o IP e a porta do app Windows PowerPoint
                </Text>
                <VStack spacing={3} align='stretch'>
                  <div>
                    <Text fontSize='sm' mb={2} fontWeight='medium' color='white'>
                      IP do App Windows
                    </Text>
                    <Input
                      placeholder='192.168.0.240'
                      value={ip}
                      onChange={(e) => setIp(e.target.value)}
                      isDisabled={isFetchingStatus || isLoading}
                      variant='ontime-filled'
                      bg='var(--chakra-colors-gray-700)'
                      borderColor='var(--chakra-colors-gray-600)'
                      color='white'
                      _hover={{
                        bg: 'var(--chakra-colors-gray-650)',
                        borderColor: 'var(--chakra-colors-gray-500)',
                      }}
                      _focus={{
                        bg: 'var(--chakra-colors-gray-700)',
                        borderColor: 'var(--chakra-colors-gray-500)',
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleApply();
                        }
                      }}
                    />
                  </div>
                  <div>
                    <Text fontSize='sm' mb={2} fontWeight='medium' color='white'>
                      Porta
                    </Text>
                    <Input
                      placeholder='7800'
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      type='number'
                      isDisabled={isFetchingStatus || isLoading}
                      variant='ontime-filled'
                      bg='var(--chakra-colors-gray-700)'
                      borderColor='var(--chakra-colors-gray-600)'
                      color='white'
                      _hover={{
                        bg: 'var(--chakra-colors-gray-650)',
                        borderColor: 'var(--chakra-colors-gray-500)',
                      }}
                      _focus={{
                        bg: 'var(--chakra-colors-gray-700)',
                        borderColor: 'var(--chakra-colors-gray-500)',
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleApply();
                        }
                      }}
                    />
                  </div>
                  {isFetchingStatus && (
                    <Text fontSize='xs' color='gray.400' textAlign='center'>
                      Carregando configuração atual...
                    </Text>
                  )}
                </VStack>
                
                {/* Botões de ação */}
                <HStack spacing={3} justify='flex-end' mt={4}>
                  <Button variant='ontime-subtle' onClick={onClose} isDisabled={isLoading}>
                    Cancelar
                  </Button>
                  <Button
                    variant='ontime-filled'
                    onClick={handleApply}
                    isLoading={isLoading || isFetchingStatus}
                    loadingText='Aplicando...'
                  >
                    Aplicar
                  </Button>
                </HStack>
              </VStack>
            </div>

            {/* Nova seção: Informações do Servidor para Stream Deck/Companion */}
            <div
              style={{
                padding: '16px',
                border: '1px solid var(--chakra-colors-gray-600)',
                borderRadius: '8px',
                backgroundColor: 'var(--chakra-colors-gray-800)',
                marginTop: '16px',
              }}
            >
              <VStack spacing={3} align='stretch'>
                <Text fontWeight='bold' fontSize='md' color='white' textAlign='center'>
                  Informações do Servidor (Stream Deck / Companion)
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

