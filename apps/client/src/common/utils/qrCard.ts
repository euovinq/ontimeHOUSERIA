/**
 * Renderiza um "card" de QR code com a arte da houseria (wordmark, nome do link,
 * código do projeto e URL) num canvas, para ser baixado/compartilhado como PNG.
 */

export type QrCardTheme = 'dark' | 'light';

export interface QrCardOptions {
  /** Elemento <svg> do QR já renderizado (react-qr-code) */
  qrSvg: SVGElement;
  /** Título em destaque (ex.: nome do link) */
  title: string;
  /** Código do projeto exibido no badge */
  projectCode: string;
  /** URL exibida no rodapé */
  url: string;
  /** Rótulo pequeno acima do título (opcional) */
  eyebrow?: string;
  theme: QrCardTheme;
}

/** Logo "O" (anel headset) e wordmark completa da houseria (fundo transparente) */
const O_SRC = '/houseria-o.png';
const WORDMARK_SRC = '/houseria-wordmark.png';
const FONT_SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const PALETTE = {
  dark: {
    card: '#14121A',
    tile: '#ffffff',
    tileBorder: 'transparent',
    eyebrow: '#8A8794',
    title: '#ffffff',
    badgeBg: 'rgba(255,62,108,0.16)',
    badgeText: '#FF8FA8',
    caption: '#6F6C78',
    url: '#9B98A5',
    divider: 'rgba(255,255,255,0.10)',
  },
  light: {
    card: '#ffffff',
    tile: '#ffffff',
    tileBorder: '#ECE8E0',
    eyebrow: '#A8A49B',
    title: '#14121A',
    badgeBg: '#FDE7ED',
    badgeText: '#B3324F',
    caption: '#A8A49B',
    url: '#6F6C78',
    divider: '#ECE8E0',
  },
} as const;

const imageCache = new Map<string, Promise<HTMLImageElement>>();

/** Carrega (e cacheia) uma imagem. */
function loadImage(src: string): Promise<HTMLImageElement> {
  let promise = imageCache.get(src);
  if (!promise) {
    promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
      img.src = src;
    });
    imageCache.set(src, promise);
  }
  return promise;
}

/** Aplica uma cor sólida à silhueta (alpha) de uma imagem, retornando um canvas. */
function tintImage(img: HTMLImageElement, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

/** Converte o SVG do QR em uma imagem carregada. */
function svgToImage(svg: SVGElement): Promise<HTMLImageElement> {
  const serialized = new XMLSerializer().serializeToString(svg);
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Falha ao renderizar o QR'));
    img.src = svgUrl;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Desenha uma imagem dentro de uma caixa preservando a proporção (contain), centralizada. */
function drawContain(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  natW: number,
  natH: number,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
) {
  const scale = Math.min(boxW / natW, boxH / natH);
  const w = natW * scale;
  const h = natH * scale;
  ctx.drawImage(img, boxX + (boxW - w) / 2, boxY + (boxH - h) / 2, w, h);
}

/**
 * Desenha o card no canvas informado (definindo suas dimensões) usando
 * coordenadas lógicas em `scale`x para nitidez em telas retina.
 */
export async function renderQrCardToCanvas(canvas: HTMLCanvasElement, opts: QrCardOptions): Promise<void> {
  const { qrSvg, title, projectCode, url, eyebrow, theme } = opts;
  const c = PALETTE[theme];

  const [oImg, wordmarkImg, qrImg] = await Promise.all([
    loadImage(O_SRC).catch(() => null),
    loadImage(WORDMARK_SRC).catch(() => null),
    svgToImage(qrSvg),
  ]);

  // Layout em unidades lógicas
  const W = 320;
  const pad = 22;
  const scale = 3;

  const headerH = 22;
  const tileY = pad + headerH + 16;
  const tileSize = W - pad * 2;
  const tileInner = 16;
  const qrSize = tileSize - tileInner * 2;

  const titleTop = tileY + tileSize + 18;
  const H = titleTop + (eyebrow ? 16 : 0) + 30 + 28 + 60;

  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas não suportado');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';

  // Fundo do card
  ctx.fillStyle = c.card;
  roundRect(ctx, 0, 0, W, H, 20);
  ctx.fill();

  // Header: wordmark completa (tingida pela cor do tema)
  if (wordmarkImg) {
    const tinted = tintImage(wordmarkImg, c.title);
    drawContain(ctx, tinted, wordmarkImg.naturalWidth, wordmarkImg.naturalHeight, pad, pad, W - pad * 2, headerH);
  }

  // Tile branco do QR
  ctx.fillStyle = c.tile;
  roundRect(ctx, pad, tileY, tileSize, tileSize, 14);
  ctx.fill();
  if (c.tileBorder !== 'transparent') {
    ctx.strokeStyle = c.tileBorder;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  // QR
  ctx.drawImage(qrImg, pad + tileInner, tileY + tileInner, qrSize, qrSize);

  // "O" da houseria no centro do QR (com respiro branco)
  if (oImg) {
    const cx = pad + tileSize / 2;
    const cy = tileY + tileSize / 2;
    const ring = qrSize * 0.15;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, ring + 4, 0, Math.PI * 2);
    ctx.fill();
    const box = ring * 1.9;
    const tinted = tintImage(oImg, '#14121A');
    drawContain(ctx, tinted, oImg.naturalWidth, oImg.naturalHeight, cx - box / 2, cy - box / 2, box, box);
  }

  // Texto centralizado
  ctx.textAlign = 'center';
  const centerX = W / 2;
  let y = titleTop;

  if (eyebrow) {
    ctx.fillStyle = c.eyebrow;
    ctx.font = `500 11px ${FONT_SANS}`;
    ctx.fillText(eyebrow.toUpperCase(), centerX, y);
    y += 20;
  }

  // Título (encolhe se muito largo)
  ctx.fillStyle = c.title;
  let titleSize = 22;
  ctx.font = `500 ${titleSize}px ${FONT_SANS}`;
  while (ctx.measureText(title).width > W - pad * 2 && titleSize > 13) {
    titleSize -= 1;
    ctx.font = `500 ${titleSize}px ${FONT_SANS}`;
  }
  y += 4;
  ctx.fillText(title, centerX, y);
  y += 20;

  // Badge do código do projeto
  const badgeText = `Projeto ${projectCode}`;
  ctx.font = `500 12px ${FONT_SANS}`;
  const badgeW = ctx.measureText(badgeText).width + 24;
  const badgeH = 22;
  const badgeX = centerX - badgeW / 2;
  ctx.fillStyle = c.badgeBg;
  roundRect(ctx, badgeX, y, badgeW, badgeH, badgeH / 2);
  ctx.fill();
  ctx.fillStyle = c.badgeText;
  ctx.fillText(badgeText, centerX, y + 15);
  y += badgeH + 16;

  // Divisória
  ctx.strokeStyle = c.divider;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(W - pad, y);
  ctx.stroke();
  y += 16;

  // Rodapé: instrução + URL
  ctx.fillStyle = c.caption;
  ctx.font = `400 11px ${FONT_SANS}`;
  ctx.fillText('Aponte a câmera para acessar', centerX, y);
  y += 15;
  ctx.fillStyle = c.url;
  ctx.font = `400 10px ${FONT_MONO}`;
  const cleanUrl = url.replace(/^https?:\/\//, '');
  ctx.fillText(cleanUrl, centerX, y);
}

/** Renderiza o card e devolve um Blob PNG. */
export async function renderQrCardPng(opts: QrCardOptions): Promise<Blob> {
  const canvas = document.createElement('canvas');
  await renderQrCardToCanvas(canvas, opts);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Falha ao gerar PNG'));
    }, 'image/png');
  });
}
