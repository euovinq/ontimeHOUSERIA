import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IoDownloadOutline,
  IoImageOutline,
  IoMoonOutline,
  IoQrCodeOutline,
  IoShareSocialOutline,
  IoSunnyOutline,
} from 'react-icons/io5';
import QRCode from 'react-qr-code';
import {
  Button,
  ButtonGroup,
  IconButton,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Text,
  Tooltip,
  useDisclosure,
  useToast,
  VStack,
} from '@chakra-ui/react';

import { QrCardTheme, renderQrCardToCanvas } from '../../utils/qrCard';
import { copyPngToClipboard, downloadBlob, qrFileName, shareQrPng } from '../../utils/qrCode';

interface QrShareButtonProps {
  url: string;
  /** Título em destaque no card (nome do link) */
  label: string;
  /** Código do projeto exibido no badge */
  projectCode: string;
  /** Rótulo pequeno acima do título (opcional) */
  eyebrow?: string;
  /** Tamanho do botão gatilho (default 'xs' para casar com os cards de link) */
  size?: 'xs' | 'sm' | 'md';
}

/**
 * Botão de QR code reutilizável: abre um popover com um preview do card da
 * houseria (logo + nome do link + QR) e ações de compartilhar, baixar e copiar.
 */
export default function QrShareButton({ url, label, projectCode, eyebrow, size = 'xs' }: QrShareButtonProps) {
  const toast = useToast();
  const { isOpen, onClose, onToggle } = useDisclosure();
  const qrHolderRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [theme, setTheme] = useState<QrCardTheme>('dark');

  const notify = (title: string, status: 'success' | 'error' | 'info') =>
    toast({ title, status, duration: 2500, isClosable: true, position: 'top' });

  /** Renderiza o card no canvas de preview. */
  const renderPreview = useCallback(async () => {
    const svg = qrHolderRef.current?.querySelector('svg');
    const canvas = previewRef.current;
    if (!svg || !canvas) return;
    try {
      await renderQrCardToCanvas(canvas, { qrSvg: svg, title: label, projectCode, url, eyebrow, theme });
    } catch {
      /* preview falhou silenciosamente */
    }
  }, [label, projectCode, url, eyebrow, theme]);

  // Renderiza quando o popover abre (conteúdo já montado) ou ao trocar tema/url
  useEffect(() => {
    if (isOpen) renderPreview();
  }, [isOpen, renderPreview]);

  /** Lê o PNG do canvas já renderizado. */
  const getPngBlob = async (): Promise<Blob | null> => {
    await renderPreview();
    const canvas = previewRef.current;
    if (!canvas) return null;
    return new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
  };

  const handleShare = async () => {
    const blob = await getPngBlob();
    if (!blob) {
      notify('Não foi possível gerar o card', 'error');
      return;
    }
    const result = await shareQrPng(blob, qrFileName(label), `Link ${label}`, url);
    if (result === 'unsupported') {
      // Fallback: baixa onde o compartilhamento nativo não existe (desktop)
      downloadBlob(blob, qrFileName(label));
      notify('Compartilhamento indisponível — card baixado', 'info');
    }
  };

  const handleDownload = async () => {
    const blob = await getPngBlob();
    if (!blob) {
      notify('Não foi possível gerar o card', 'error');
      return;
    }
    downloadBlob(blob, qrFileName(label));
    notify('Card baixado', 'success');
  };

  const handleCopyImage = async () => {
    const blob = await getPngBlob();
    if (!blob) {
      notify('Não foi possível gerar o card', 'error');
      return;
    }
    const ok = await copyPngToClipboard(blob);
    if (ok) {
      notify('Card copiado', 'success');
    } else {
      downloadBlob(blob, qrFileName(label));
      notify('Cópia indisponível — card baixado', 'info');
    }
  };

  return (
    <Popover placement='bottom' isLazy isOpen={isOpen} onClose={onClose}>
      <Tooltip label='QR code' hasArrow>
        <span>
          <PopoverTrigger>
            <IconButton
              size={size}
              variant='ontime-subtle'
              aria-label={`QR code de ${label}`}
              icon={<IoQrCodeOutline size='14px' />}
              onClick={onToggle}
            />
          </PopoverTrigger>
        </span>
      </Tooltip>
      <PopoverContent width='auto' bg='var(--chakra-colors-gray-800)' borderColor='var(--chakra-colors-gray-600)'>
        <PopoverArrow bg='var(--chakra-colors-gray-800)' />
        <PopoverCloseButton />
        <PopoverHeader borderColor='var(--chakra-colors-gray-600)'>
          <Text fontSize='sm' fontWeight='bold' color='white'>
            {label}
          </Text>
        </PopoverHeader>
        <PopoverBody>
          <VStack spacing={3}>
            {/* QR base (fora da tela) usado para compor o card */}
            <div
              ref={qrHolderRef}
              aria-hidden
              style={{
                position: 'absolute',
                width: 0,
                height: 0,
                overflow: 'hidden',
                opacity: 0,
                pointerEvents: 'none',
              }}
            >
              <QRCode size={480} value={url} level='H' bgColor='#ffffff' fgColor='#14121A' />
            </div>

            {/* Preview do card */}
            <canvas
              ref={previewRef}
              style={{ width: '210px', height: 'auto', borderRadius: '10px', display: 'block' }}
            />

            {/* Seletor de tema */}
            <ButtonGroup size='xs' isAttached variant='ontime-subtle'>
              <Button leftIcon={<IoMoonOutline />} onClick={() => setTheme('dark')} isActive={theme === 'dark'}>
                Escuro
              </Button>
              <Button leftIcon={<IoSunnyOutline />} onClick={() => setTheme('light')} isActive={theme === 'light'}>
                Claro
              </Button>
            </ButtonGroup>

            <VStack spacing={2} align='stretch' width='100%'>
              <Button size='sm' variant='ontime-filled' leftIcon={<IoShareSocialOutline />} onClick={handleShare}>
                Compartilhar
              </Button>
              <Button size='sm' variant='ontime-subtle' leftIcon={<IoDownloadOutline />} onClick={handleDownload}>
                Baixar card
              </Button>
              <Button size='sm' variant='ontime-subtle' leftIcon={<IoImageOutline />} onClick={handleCopyImage}>
                Copiar imagem
              </Button>
            </VStack>
          </VStack>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
