import { stringify } from 'csv-stringify/browser/esm/sync';

/**
 * @description Converts an array of arrays to a CSV file
 * @param {string[][]} arrayOfArrays
 * @param {string} delimiter optional delimiter (defaults to comma)
 * @return {string}
 */
export function makeCSVFromArrayOfArrays(arrayOfArrays: string[][], delimiter = ','): string {
  return stringify(arrayOfArrays, { delimiter });
}
