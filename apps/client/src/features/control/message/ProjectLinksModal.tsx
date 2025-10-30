import { useEffect, useState } from 'react';
import { IoCopy, IoLink, IoCheckmark } from 'react-icons/io5';
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Input,
  Select,
  HStack as ChakraHStack,
} from '@chakra-ui/react';
import { HStack, IconButton, Text, Tooltip, useToast, VStack } from '@chakra-ui/react';
import { ProjectData } from 'houseriaapp-types';

import { useProjectDataMutation } from '../../../common/hooks-query/useProjectData';
import {
  countries,
  DEFAULT_COUNTRY,
  formatPhoneNumber,
  formatCompleteWhatsApp,
  type Country,
} from '../../../common/utils/whatsappUtils';

interface ProjectLinksModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectCode: string;
  projectData: ProjectData | undefined;
}

export default function ProjectLinksModal({ isOpen, onClose, projectCode, projectData }: ProjectLinksModalProps) {
  const toast = useToast();
  const { mutateAsync: updateProjectData, isPending: isSaving } = useProjectDataMutation();
  
  // WhatsApp states
  const [selectedCountry, setSelectedCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [savedWhatsApp, setSavedWhatsApp] = useState<string>('');
  const [hasChanges, setHasChanges] = useState(false);

  // Sync WhatsApp data when modal opens or projectData changes
  useEffect(() => {
    if (projectData?.directorWhatsapp) {
      const whatsapp = projectData.directorWhatsapp;
      setSavedWhatsApp(whatsapp);
      // Extrair código do país do WhatsApp salvo
      const dialCodeMatch = whatsapp.match(/^(\+\d+)\s/);
      if (dialCodeMatch) {
        const dialCode = dialCodeMatch[1];
        const country = countries.find(c => c.dialCode === dialCode) || DEFAULT_COUNTRY;
        setSelectedCountry(country);
        // Extrair número (tudo após o código do país + espaço)
        const numberPart = whatsapp.replace(/^\+\d+\s/, '');
        setPhoneNumber(numberPart);
      } else {
        // Se não tem código, assume padrão
        setPhoneNumber(whatsapp);
      }
    } else {
      setPhoneNumber('');
      setSavedWhatsApp('');
      setSelectedCountry(DEFAULT_COUNTRY);
    }
    setHasChanges(false);
  }, [projectData?.directorWhatsapp, isOpen]);

  const handleSaveWhatsApp = async () => {
    if (!projectData) return;
    
    // Validar se o campo está vazio
    const cleanPhoneNumber = phoneNumber.replace(/\D/g, '');
    if (!cleanPhoneNumber || cleanPhoneNumber.length < 10) {
      toast({
        title: 'Campo vazio',
        description: 'Por favor, informe um número de WhatsApp válido',
        status: 'error',
        duration: 3000,
        isClosable: true,
        position: 'top',
      });
      return;
    }
    
    try {
      const formattedWhatsApp = formatCompleteWhatsApp(selectedCountry, phoneNumber);
      
      await updateProjectData({
        ...projectData,
        directorWhatsapp: formattedWhatsApp,
      });
      
      // Atualizar o WhatsApp salvo e desabilitar botão
      setSavedWhatsApp(formattedWhatsApp);
      setHasChanges(false);
      
      toast({
        title: 'WhatsApp salvo!',
        description: 'O WhatsApp do diretor foi salvo com sucesso',
        status: 'success',
        duration: 2000,
        isClosable: true,
        position: 'top',
      });
    } catch (error) {
      toast({
        title: 'Erro ao salvar',
        description: 'Não foi possível salvar o WhatsApp',
        status: 'error',
        duration: 3000,
        isClosable: true,
        position: 'top',
      });
    }
  };

  const handleCountryChange = (countryCode: string) => {
    const country = countries.find(c => c.code === countryCode) || DEFAULT_COUNTRY;
    setSelectedCountry(country);
    // Verificar se houve mudança
    const currentFormatted = formatCompleteWhatsApp(country, phoneNumber);
    setHasChanges(currentFormatted !== savedWhatsApp);
  };

  const handlePhoneChange = (value: string) => {
    // Aplicar formatação
    const formatted = formatPhoneNumber(value, selectedCountry);
    setPhoneNumber(formatted);
    // Verificar se houve mudança comparando com o salvo
    const currentFormatted = formatCompleteWhatsApp(selectedCountry, formatted);
    setHasChanges(currentFormatted !== savedWhatsApp);
  };

  const links = [
    {
      label: 'A&B',
      url: `https://houseriasite.vercel.app/AB/${projectCode}`,
      description: 'Acesso ao site A&B do projeto',
    },
    {
      label: 'Equipe',
      url: `https://houseriasite.vercel.app/equipe/${projectCode}`,
      description: 'Área da equipe do projeto',
    },
    {
      label: 'Cliente',
      url: `https://houseriasite.vercel.app/cliente/${projectCode}`,
      description: 'Área do cliente do projeto',
    },
    {
      label: 'Cliente TV',
      url: `https://houseriasite.vercel.app/cliente-tv/${projectCode}`,
      description: 'Versão TV para o cliente do projeto',
    },
  ];

  const copyToClipboard = async (url: string, label: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: 'Link copiado!',
        description: `${label} foi copiado para a área de transferência`,
        status: 'success',
        duration: 2000,
        isClosable: true,
        position: 'top',
      });
    } catch (error) {
      toast({
        title: 'Erro ao copiar',
        description: 'Não foi possível copiar o link',
        status: 'error',
        duration: 3000,
        isClosable: true,
        position: 'top',
      });
    }
  };

  const openLink = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} variant='ontime' size='md'>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <HStack>
            <IoLink size='20px' />
            <Text>Links do Projeto {projectCode}</Text>
          </HStack>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4} align='stretch'>
            {/* WhatsApp do Diretor */}
            <div
              style={{
                padding: '16px',
                border: '1px solid var(--chakra-colors-gray-600)',
                borderRadius: '8px',
                backgroundColor: '#4F46E5',
              }}
            >
              <VStack spacing={3} align='stretch'>
                <Text fontWeight='bold' fontSize='md' color='white' textAlign='center'>
                  WhatsApp do Diretor
                </Text>
                <Text fontWeight='bold' fontSize='sm' color='white' textAlign='center'>
                  Informe o WhatsApp do diretor responsável pelo projeto
                </Text>
                <ChakraHStack spacing={2}>
                  <Select
                    id='country-select'
                    size='sm'
                    variant='ontime-filled'
                    value={selectedCountry.code}
                    onChange={(e) => handleCountryChange(e.target.value)}
                    minW='70px'
                    maxW='90px'
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
                  >
                    {countries.map((country) => (
                      <option key={country.code} value={country.code} style={{ backgroundColor: '#2D3748', color: 'white' }}>
                        {country.dialCode}
                      </option>
                    ))}
                  </Select>
                  <Input
                    id='director-whatsapp'
                    size='sm'
                    variant='ontime-filled'
                    value={phoneNumber}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    placeholder='11 94242-4242'
                    maxLength={15}
                    flex={1}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSaveWhatsApp();
                      }
                    }}
                  />
                  <Button
                    size='sm'
                    variant='ontime-filled'
                    onClick={handleSaveWhatsApp}
                    isLoading={isSaving}
                    isDisabled={!hasChanges}
                    leftIcon={<IoCheckmark size='14px' />}
                    aria-label='Salvar WhatsApp'
                    bg='#10B981'
                    color='white'
                    _hover={{
                      bg: '#059669',
                    }}
                    _disabled={{
                      bg: '#6B7280',
                      opacity: 0.6,
                    }}
                  >
                    Salvar
                  </Button>
                </ChakraHStack>
              </VStack>
            </div>

            {links.map((link, index) => (
              <div
                key={index}
                style={{
                  padding: '16px',
                  border: '1px solid var(--chakra-colors-gray-600)',
                  borderRadius: '8px',
                  backgroundColor: 'var(--chakra-colors-gray-800)',
                }}
              >
                <VStack spacing={2} align='stretch'>
                  <HStack justify='space-between'>
                    <Text fontWeight='bold' fontSize='md' color='white'>
                      {link.label}
                    </Text>
                    <HStack spacing={2}>
                      <Tooltip label='Abrir link' hasArrow>
                        <IconButton
                          size='sm'
                          variant='ontime-subtle'
                          aria-label={`Abrir ${link.label}`}
                          icon={<IoLink size='16px' />}
                          onClick={() => openLink(link.url)}
                        />
                      </Tooltip>
                      <Tooltip label='Copiar link' hasArrow>
                        <IconButton
                          size='sm'
                          variant='ontime-subtle'
                          aria-label={`Copiar ${link.label}`}
                          icon={<IoCopy size='16px' />}
                          onClick={() => copyToClipboard(link.url, link.label)}
                        />
                      </Tooltip>
                    </HStack>
                  </HStack>
                  <Text fontSize='sm' color='gray.300'>
                    {link.description}
                  </Text>
                  <Text
                    fontSize='xs'
                    color='gray.400'
                    fontFamily='mono'
                    wordBreak='break-all'
                    backgroundColor='var(--chakra-colors-gray-900)'
                    padding='8px'
                    borderRadius='4px'
                    border='1px solid var(--chakra-colors-gray-600)'
                  >
                    {link.url}
                  </Text>
                </VStack>
              </div>
            ))}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant='ontime-subtle' onClick={onClose}>
            Fechar
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
