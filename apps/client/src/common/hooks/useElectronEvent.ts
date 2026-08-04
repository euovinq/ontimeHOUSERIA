import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { addDialog } from '../stores/dialogStore';
import type { UpdateCheckPayload, UpdateProgresso } from '../stores/updateCheckStore';
import { useUpdateCheckStore } from '../stores/updateCheckStore';

const isElectron = window.process?.type === 'renderer';
const ipcRenderer = isElectron ? window.require('electron').ipcRenderer : null;

export function useElectronEvent() {
  const sendToElectron = useCallback((channel: string, args?: string | Record<string, unknown>) => {
    if (isElectron && ipcRenderer) {
      ipcRenderer.send(channel, args);
    }
  }, []);

  return { isElectron, sendToElectron };
}

export function useElectronListener() {
  const navigate = useNavigate();
  const { isElectron } = useElectronEvent();

  // listen to requests to change the editor location
  useEffect(() => {
    if (isElectron) {
      ipcRenderer.on('request-editor-location', (_event: unknown, location: string) => {
        navigate(location, { relative: 'route' });
      });

      ipcRenderer.on('dialog', (_event: unknown, dialog: string) => {
        if (dialog === 'welcome') {
          addDialog('welcome');
        }
      });

      ipcRenderer.on('update-check-result', (_event: unknown, payload: UpdateCheckPayload) => {
        useUpdateCheckStore.getState().setUpdateCheckResult(payload);
      });

      // `ipcRenderer` está tipado aqui só com `invoke`; os listeners existentes
      // já convivem com isso. Uma referência larga evita somar mais erros de
      // tipo enquanto a declaração não é corrigida de vez.
      const ipc = ipcRenderer as unknown as {
        on: (canal: string, ouvinte: (evento: unknown, payload: never) => void) => void;
      };

      ipc.on('update-download-progress', (_evento: unknown, payload: never) => {
        useUpdateCheckStore.getState().setProgresso(payload as unknown as UpdateProgresso);
      });

      ipc.on('update-downloaded', () => {
        useUpdateCheckStore.getState().setPronto();
      });
    }

    // Clean the listener after the component is dismounted
    return () => {
      ipcRenderer?.removeAllListeners();
    };
  }, [isElectron, navigate]);
}
