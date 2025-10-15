import type { QuickStartData } from 'houseriaapp-types';

export const quickStartDefaults: QuickStartData = {
  project: {
    title: '',
  },
  settings: {
    timeFormat: '24',
    language: 'en',
  },
  viewSettings: {
    freezeEnd: false,
    endMessage: '',
  },
};
