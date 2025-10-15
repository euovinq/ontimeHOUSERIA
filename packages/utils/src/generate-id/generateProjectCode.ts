import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 5);

/**
 * Generates a unique 5-character project code with letters and numbers
 * Format: A1B2C (uppercase letters and numbers)
 */
export const generateProjectCode = (): string => nanoid();











































