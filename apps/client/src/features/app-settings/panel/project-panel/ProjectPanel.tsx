import { useEffect, useState } from 'react';
import axios from 'axios';

import useScrollIntoView from '../../../../common/hooks/useScrollIntoView';
import { serverURL } from '../../../../externals';
import type { PanelBaseProps } from '../../panel-list/PanelList';
import * as Panel from '../../panel-utils/PanelUtils';
import QuickStart from '../../quick-start/QuickStart';
import type { SettingsOptionId } from '../../useAppSettingsMenu';

import ManageProjects from './ManageProjects';
import ProjectData from './ProjectData';

interface ProjectPanelProps extends PanelBaseProps {
  setLocation: (location: SettingsOptionId) => void;
}

interface LicenseInfo {
  licenseExpiresAt: string | null;
  isAdmin: boolean;
}

function formatLicenseLabel(data: LicenseInfo): string | null {
  const { licenseExpiresAt, isAdmin } = data;
  if (isAdmin) return 'Acesso admin (sem limite)';
  if (!licenseExpiresAt) return null;
  const datePart = licenseExpiresAt.includes('T') ? licenseExpiresAt.split('T')[0] : licenseExpiresAt;
  const [yearStr, monthStr, dayStr] = datePart.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!year || !month || !day) return null;
  const formatted = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  return `Licença até ${formatted}`;
}

declare global {
  interface Window {
    require?: (module: string) => { ipcRenderer: { invoke: (channel: string) => Promise<LicenseInfo> } };
    process?: { type?: string };
  }
}

export default function ProjectPanel({ location, setLocation }: ProjectPanelProps) {
  const projectRef = useScrollIntoView<HTMLDivElement>('data', location);
  const manageRef = useScrollIntoView<HTMLDivElement>('manage', location);

  const [licenseLabel, setLicenseLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchFromServer() {
      try {
        const res = await axios.get<LicenseInfo>(`${serverURL}/auth/license`);
        if (cancelled) return;
        setLicenseLabel(formatLicenseLabel(res.data));
      } catch {
        if (!cancelled) setLicenseLabel(null);
      }
    }

    async function loadLicense() {
      const isElectron = typeof window !== 'undefined' && window.process?.type === 'renderer' && window.require;
      if (isElectron) {
        try {
          const { ipcRenderer } = window.require('electron');
          const data = await ipcRenderer.invoke('get-license-info');
          if (cancelled) return;
          if (data && typeof data === 'object') {
            setLicenseLabel(formatLicenseLabel(data as LicenseInfo));
            return;
          }
        } catch {
          // fallback to server
        }
      }
      await fetchFromServer();
    }

    loadLicense();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleQuickClose = () => {
    setLocation('project');
  };

  return (
    <>
      <Panel.Header>
        Project
        {licenseLabel && (
          <span style={{ marginLeft: '0.75rem', fontSize: '0.85em', opacity: 0.8 }}>{licenseLabel}</span>
        )}
      </Panel.Header>
      <QuickStart isOpen={location === 'create'} onClose={handleQuickClose} />
      <div ref={projectRef}>
        <ProjectData />
      </div>
      <div ref={manageRef}>
        <ManageProjects />
      </div>
    </>
  );
}
