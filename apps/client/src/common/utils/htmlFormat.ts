/**
 * Detecta se uma string contém HTML válido
 */
export function isHTML(str: string): boolean {
  if (!str || str.trim().length === 0) return false;

  const trimmed = str.trim();
  const htmlTagPattern = /<[a-z][\s\S]*>/i;

  if (!htmlTagPattern.test(trimmed)) return false;

  const openTags = (trimmed.match(/<[^/!][^>]*>/g) || []).length;
  const closeTags = (trimmed.match(/<\/[^>]+>/g) || []).length;
  const selfClosingTags = (trimmed.match(/<[^>]+\/>/g) || []).length;

  return openTags > 0 || closeTags > 0 || selfClosingTags > 0;
}

/**
 * Converte quebras de linha (\n) em <br /> para exibição HTML
 */
export function nl2br(html: string): string {
  return String(html ?? '').replace(/\n/g, '<br />');
}

/**
 * Converte HTML em texto puro com quebras de linha.
 * Útil para exibir em textarea quando o valor vem com tags (<p>, <br>, etc.).
 */
export function htmlToPlainText(html: string): string {
  if (!html || typeof html !== 'string') return '';
  return (
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
