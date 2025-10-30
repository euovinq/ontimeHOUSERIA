/**
 * Utilitários para formatação de números WhatsApp
 */

export interface Country {
  code: string;
  name: string;
  dialCode: string;
}

/**
 * Lista de países principais com código telefônico
 */
export const countries: Country[] = [
  { code: 'BR', name: 'Brasil', dialCode: '+55' },
  { code: 'US', name: 'Estados Unidos', dialCode: '+1' },
  { code: 'AR', name: 'Argentina', dialCode: '+54' },
  { code: 'CL', name: 'Chile', dialCode: '+56' },
  { code: 'CO', name: 'Colômbia', dialCode: '+57' },
  { code: 'MX', name: 'México', dialCode: '+52' },
  { code: 'PE', name: 'Peru', dialCode: '+51' },
  { code: 'PT', name: 'Portugal', dialCode: '+351' },
  { code: 'ES', name: 'Espanha', dialCode: '+34' },
  { code: 'FR', name: 'França', dialCode: '+33' },
  { code: 'DE', name: 'Alemanha', dialCode: '+49' },
  { code: 'IT', name: 'Itália', dialCode: '+39' },
  { code: 'GB', name: 'Reino Unido', dialCode: '+44' },
  { code: 'UY', name: 'Uruguai', dialCode: '+598' },
  { code: 'PY', name: 'Paraguai', dialCode: '+595' },
];

/**
 * País padrão (Brasil)
 */
export const DEFAULT_COUNTRY: Country = countries[0];

/**
 * Formata número de telefone brasileiro: XX XXXXX-XXXX (celular) ou XX XXXX-XXXX (fixo)
 * @param value - Valor numérico a ser formatado
 * @returns Número formatado (ex: "11 94203-5442" para celular ou "11 3344-5566" para fixo)
 */
export function formatBrazilianPhone(value: string): string {
  // Remove tudo que não é número
  const numbers = value.replace(/\D/g, '');
  
  // Limita a 11 dígitos (DDD + 9 dígitos para celular ou 8 dígitos para fixo)
  const limited = numbers.slice(0, 11);
  
  if (limited.length <= 2) {
    return limited;
  }
  
  if (limited.length <= 6) {
    return `${limited.slice(0, 2)} ${limited.slice(2)}`;
  }
  
  // Se tem 11 dígitos (celular): XX XXXXX-XXXX
  if (limited.length === 11) {
    return `${limited.slice(0, 2)} ${limited.slice(2, 7)}-${limited.slice(7)}`;
  }
  
  // Se tem 10 dígitos (fixo): XX XXXX-XXXX
  if (limited.length === 10) {
    return `${limited.slice(0, 2)} ${limited.slice(2, 6)}-${limited.slice(6)}`;
  }
  
  // Para 7-9 dígitos: XX XXXXX ou XX XXXXXX ou XX XXXXXXX
  if (limited.length >= 7) {
    return `${limited.slice(0, 2)} ${limited.slice(2)}`;
  }
  
  // Formato padrão: XX XXXX-XXXX
  return `${limited.slice(0, 2)} ${limited.slice(2, 6)}-${limited.slice(6)}`;
}

/**
 * Formata número de telefone genérico baseado no país
 * @param value - Valor numérico a ser formatado
 * @param country - País selecionado
 * @returns Número formatado
 */
export function formatPhoneNumber(value: string, country: Country): string {
  // Por enquanto, usa formatação brasileira para todos
  // Pode ser expandido para outros países no futuro
  return formatBrazilianPhone(value);
}

/**
 * Combina código do país + número formatado
 * @param country - País selecionado
 * @param phoneNumber - Número formatado (ex: "11 94343-4343")
 * @returns Número completo formatado (ex: "+55 11 94343-4343")
 */
export function formatCompleteWhatsApp(country: Country, phoneNumber: string): string {
  if (!phoneNumber) return '';
  return `${country.dialCode} ${phoneNumber}`;
}

/**
 * Extrai apenas os números de um WhatsApp formatado
 * @param formatted - Número formatado (ex: "+55 11 94343-4343")
 * @returns Apenas números (ex: "5511943434343")
 */
export function extractNumbers(formatted: string): string {
  return formatted.replace(/\D/g, '');
}

/**
 * Valida se o número está completo (tem DDD e número)
 * @param phoneNumber - Número formatado (ex: "11 94343-4343")
 * @returns true se completo, false caso contrário
 */
export function isValidPhoneNumber(phoneNumber: string): boolean {
  const numbers = extractNumbers(phoneNumber);
  // Mínimo: DDD (2 dígitos) + número (8 ou 9 dígitos) = 10 ou 11 dígitos
  return numbers.length >= 10 && numbers.length <= 11;
}

