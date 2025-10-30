import { IoCopy, IoLink } from 'react-icons/io5';
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
} from '@chakra-ui/react';
import { HStack, IconButton, Text, Tooltip, useToast, VStack } from '@chakra-ui/react';

interface ProjectLinksModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectCode: string;
}

export default function ProjectLinksModal({ isOpen, onClose, projectCode }: ProjectLinksModalProps) {
  const toast = useToast();

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
