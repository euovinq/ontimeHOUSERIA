import { useCallback, useEffect, useState } from 'react';
import { IoCheckmark, IoCopy, IoLink, IoRefresh } from 'react-icons/io5';
import {
  Button,
  HStack as ChakraHStack,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  SimpleGrid,
  Spinner,
  Text,
  Tooltip,
  useToast,
  VStack,
} from '@chakra-ui/react';
import { ProjectData } from 'houseriaapp-types';

import { fetchSupabaseProject } from '../../../common/api/supabase';
import useCustomFields from '../../../common/hooks-query/useCustomFields';
import { useProjectDataMutation } from '../../../common/hooks-query/useProjectData';
import {
  type Country,
  countries,
  DEFAULT_COUNTRY,
  formatCompleteWhatsApp,
  formatPhoneNumber,
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
  const { data: customFields } = useCustomFields();

  // Links de edição vindos do Supabase (edit_access_codes em tempo real)
  const [editAccessCodes, setEditAccessCodes] = useState<Record<string, string>>({});
  const [editCodesLoading, setEditCodesLoading] = useState(false);
  const [selectedEditField, setSelectedEditField] = useState<string>('');

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
        const country = countries.find((c) => c.dialCode === dialCode) || DEFAULT_COUNTRY;
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

  // Ao abrir o modal, buscar edit_access_codes do Supabase (dados em tempo real)
  const loadEditAccessCodes = useCallback(async () => {
    if (!isOpen || !projectCode) return;
    setEditCodesLoading(true);
    try {
      const res = await fetchSupabaseProject(projectCode);
      const codes = res.edit_access_codes;
      setEditAccessCodes(codes && typeof codes === 'object' ? codes : {});
    } catch {
      setEditAccessCodes({});
    } finally {
      setEditCodesLoading(false);
    }
  }, [isOpen, projectCode]);

  useEffect(() => {
    loadEditAccessCodes();
  }, [loadEditAccessCodes]);

  // Ao carregar edit_access_codes ou customFields, selecionar primeiro campo disponível
  useEffect(() => {
    if (!isOpen || !customFields) return;
    const keys = Object.keys(customFields);
    if (keys.length === 0) return;
    setSelectedEditField((prev) => {
      if (keys.includes(prev)) return prev;
      const withCode = keys.find((k) => editAccessCodes[k]);
      return withCode ?? keys[0] ?? '';
    });
  }, [isOpen, customFields, editAccessCodes]);

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
    const country = countries.find((c) => c.code === countryCode) || DEFAULT_COUNTRY;
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

  const baseUrl = 'https://houseriasite.vercel.app';
  const links = [
    { label: 'Cliente', url: `${baseUrl}/cliente/${projectCode}`, description: 'Visualização principal: eventos e timers' },
    { label: 'Cliente TV', url: `${baseUrl}/cliente-tv/${projectCode}`, description: 'Exibição em TV ou tela grande' },
    { label: 'Equipe', url: `${baseUrl}/equipe/${projectCode}`, description: 'Visualização para equipe técnica' },
    { label: 'Leitura', url: `${baseUrl}/leitura/${projectCode}`, description: 'Leitura e consulta rápida' },
    { label: 'Notas', url: `${baseUrl}/notes/${projectCode}`, description: 'Notas do slide PowerPoint' },
    { label: 'A&B', url: `${baseUrl}/AB/${projectCode}`, description: 'Visualização alternativa (AB)' },
  ];

  /** Converte key do custom field para formato da URL (lowercase, underscores) */
  const fieldKeyToUrl = (key: string) => key.toLowerCase().replace(/\s+/g, '_');

  /** Gera link de edição com código de acesso do Supabase */
  const buildEditLink = (fieldKey: string, code: string) =>
    `${baseUrl}/edit/${fieldKeyToUrl(fieldKey)}/${projectCode}?code=${encodeURIComponent(code)}`;

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
    <Modal isOpen={isOpen} onClose={onClose} variant='ontime' size='lg'>
      <ModalOverlay />
      <ModalContent maxW='5xl'>
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
                      <option
                        key={country.code}
                        value={country.code}
                        style={{ backgroundColor: '#2D3748', color: 'white' }}
                      >
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

            <SimpleGrid columns={[1, 2, 3, 4]} spacing={4}>
              {links.map((link, index) => (
                <div
                  key={index}
                  style={{
                    padding: '12px',
                    border: '1px solid var(--chakra-colors-gray-600)',
                    borderRadius: '8px',
                    backgroundColor: 'var(--chakra-colors-gray-800)',
                  }}
                >
                  <VStack spacing={2} align='stretch'>
                    <HStack justify='space-between'>
                      <Text fontWeight='bold' fontSize='sm' color='white'>
                        {link.label}
                      </Text>
                      <HStack spacing={1}>
                        <Tooltip label='Abrir link' hasArrow>
                          <IconButton
                            size='xs'
                            variant='ontime-subtle'
                            aria-label={`Abrir ${link.label}`}
                            icon={<IoLink size='14px' />}
                            onClick={() => openLink(link.url)}
                          />
                        </Tooltip>
                        <Tooltip label='Copiar link' hasArrow>
                          <IconButton
                            size='xs'
                            variant='ontime-subtle'
                            aria-label={`Copiar ${link.label}`}
                            icon={<IoCopy size='14px' />}
                            onClick={() => copyToClipboard(link.url, link.label)}
                          />
                        </Tooltip>
                      </HStack>
                    </HStack>
                    <Text fontSize='xs' color='gray.300' noOfLines={2}>
                      {link.description}
                    </Text>
                    <Text
                      color='gray.400'
                      fontFamily='mono'
                      wordBreak='break-all'
                      backgroundColor='var(--chakra-colors-gray-900)'
                      padding='6px'
                      borderRadius='4px'
                      border='1px solid var(--chakra-colors-gray-600)'
                      fontSize='10px'
                    >
                      {link.url}
                    </Text>
                  </VStack>
                </div>
              ))}

              {/* Card Editar: select para escolher custom field + link com código do Supabase */}
              <div
                style={{
                  padding: '12px',
                  border: '1px solid var(--chakra-colors-gray-600)',
                  borderRadius: '8px',
                  backgroundColor: 'var(--chakra-colors-gray-800)',
                }}
              >
                <VStack spacing={2} align='stretch'>
                  <HStack justify='space-between'>
                    <Text fontWeight='bold' fontSize='sm' color='white'>
                      Editar
                    </Text>
                    {editCodesLoading && (
                      <Spinner size='xs' color='gray.400' />
                    )}
                    {!editCodesLoading && Object.keys(editAccessCodes).length > 0 && (
                      <Tooltip label='Recarregar'>
                        <IconButton
                          size='xs'
                          variant='ontime-subtle'
                          aria-label='Recarregar links de edição'
                          icon={<IoRefresh size='14px' />}
                          onClick={loadEditAccessCodes}
                        />
                      </Tooltip>
                    )}
                  </HStack>
                  <Text fontSize='xs' color='gray.300' noOfLines={2}>
                    Editar campo customizado no houseriasite (com código de acesso)
                  </Text>
                  <Select
                    size='sm'
                    value={selectedEditField}
                    onChange={(e) => setSelectedEditField(e.target.value)}
                    placeholder={Object.keys(customFields ?? {}).length === 0 ? 'Nenhum campo configurado' : 'Selecione o campo'}
                    isDisabled={!customFields || Object.keys(customFields).length === 0}
                    bg='var(--chakra-colors-gray-700)'
                    borderColor='var(--chakra-colors-gray-600)'
                    color='white'
                    _hover={{ borderColor: 'var(--chakra-colors-gray-500)' }}
                    _focus={{ borderColor: 'var(--chakra-colors-gray-500)' }}
                  >
                    {customFields && Object.entries(customFields).map(([key, { label }]) => (
                      <option key={key} value={key} style={{ backgroundColor: '#2D3748', color: 'white' }}>
                        {label}
                      </option>
                    ))}
                  </Select>
                  {selectedEditField && (() => {
                    const code = editAccessCodes[selectedEditField];
                    const label = customFields?.[selectedEditField]?.label ?? selectedEditField;
                    if (!code) {
                      return (
                        <Text fontSize='xs' color='gray.500'>
                          Sincronize o projeto com o Supabase para gerar o código deste campo.
                        </Text>
                      );
                    }
                    const editUrl = buildEditLink(selectedEditField, code);
                    return (
                      <>
                        <HStack spacing={1}>
                          <Tooltip label='Abrir link' hasArrow>
                            <IconButton
                              size='xs'
                              variant='ontime-subtle'
                              aria-label={`Abrir Editar ${label}`}
                              icon={<IoLink size='14px' />}
                              onClick={() => openLink(editUrl)}
                            />
                          </Tooltip>
                          <Tooltip label='Copiar link' hasArrow>
                            <IconButton
                              size='xs'
                              variant='ontime-subtle'
                              aria-label={`Copiar Editar ${label}`}
                              icon={<IoCopy size='14px' />}
                              onClick={() => copyToClipboard(editUrl, `Editar ${label}`)}
                            />
                          </Tooltip>
                        </HStack>
                        <Text
                          color='gray.400'
                          fontFamily='mono'
                          wordBreak='break-all'
                          backgroundColor='var(--chakra-colors-gray-900)'
                          padding='6px'
                          borderRadius='4px'
                          border='1px solid var(--chakra-colors-gray-600)'
                          fontSize='10px'
                        >
                          {editUrl}
                        </Text>
                      </>
                    );
                  })()}
                </VStack>
              </div>
            </SimpleGrid>
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
