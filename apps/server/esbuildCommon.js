export const esbuildCommon = {
  logLevel: 'error',
  platform: 'node',
  target: ['node20'],
  format: 'cjs',
  bundle: true,
  minify: false,
  legalComments: 'external',
  dropLabels: ['DEV'],
};
