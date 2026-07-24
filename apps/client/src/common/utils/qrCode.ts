/**
 * Utilitários para transformar o QR code (renderizado como SVG por react-qr-code)
 * em imagem PNG, permitindo baixar, copiar e compartilhar.
 */

/** Converte um elemento <svg> do QR em um Blob PNG. */
export async function qrSvgToPngBlob(svg: SVGElement, size = 512, padding = 32): Promise<Blob> {
  // Serializa o SVG e embute como data URL numa imagem
  const serialized = new XMLSerializer().serializeToString(svg);
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

  const image = new Image();
  image.crossOrigin = 'anonymous';

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Falha ao renderizar o QR code'));
    image.src = svgUrl;
  });

  const canvasSize = size + padding * 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas não suportado');

  // Fundo branco com padding (quiet zone) para garantir leitura
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasSize, canvasSize);
  ctx.drawImage(image, padding, padding, size, size);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Falha ao gerar PNG'));
    }, 'image/png');
  });
}

/** Nome de arquivo seguro para o QR a partir de um rótulo. */
export function qrFileName(label: string): string {
  const safe = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `qr-${safe || 'link'}.png`;
}

/** Dispara o download de um Blob como arquivo. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Copia um PNG para a área de transferência. Retorna false se não suportado. */
export async function copyPngToClipboard(blob: Blob): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compartilha o QR via Web Share API (com arquivo). Retorna:
 *  - 'shared' se abriu a folha de compartilhamento
 *  - 'unsupported' se o navegador não suporta compartilhar arquivos
 *  - 'cancelled' se o usuário cancelou
 */
export async function shareQrPng(
  blob: Blob,
  fileName: string,
  title: string,
  url: string,
): Promise<'shared' | 'unsupported' | 'cancelled'> {
  const file = new File([blob], fileName, { type: 'image/png' });

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: url });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      return 'unsupported';
    }
  }

  return 'unsupported';
}
