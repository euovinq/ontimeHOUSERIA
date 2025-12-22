import useScrollIntoView from '../../../../common/hooks/useScrollIntoView';
import type { PanelBaseProps } from '../../panel-list/PanelList';
import * as Panel from '../../panel-utils/PanelUtils';
import QuickStart from '../../quick-start/QuickStart';
import type { SettingsOptionId } from '../../useAppSettingsMenu';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { serverURL } from '../../../../externals';

import ManageProjects from './ManageProjects';
import ProjectData from './ProjectData';

interface ProjectPanelProps extends PanelBaseProps {
  setLocation: (location: SettingsOptionId) => void;
}

export default function ProjectPanel({ location, setLocation }: ProjectPanelProps) {
  const projectRef = useScrollIntoView<HTMLDivElement>('data', location);
  const manageRef = useScrollIntoView<HTMLDivElement>('manage', location);

  const [licenseLabel, setLicenseLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchLicense() {
      try {
        const res = await axios.get<{ licenseExpiresAt: string | null; isAdmin: boolean }>(
          `${serverURL}/auth/license`
        );

        if (cancelled) return;

        const { licenseExpiresAt, isAdmin } = res.data;

        if (isAdmin) {
          setLicenseLabel('Acesso admin (sem limite)');
          return;
        }

        if (!licenseExpiresAt) {
          setLicenseLabel(null);
          return;
        }

        // licenseExpiresAt vem do backend como 'YYYY-MM-DD'
        const datePart = licenseExpiresAt.includes('T')
          ? licenseExpiresAt.split('T')[0]
          : licenseExpiresAt;

        const [yearStr, monthStr, dayStr] = datePart.split('-');
        const year = Number(yearStr);
        const month = Number(monthStr);
        const day = Number(dayStr);

        if (!year || !month || !day) {
          setLicenseLabel(null);
          return;
        }

        const formatted = `${String(day).padStart(2, '0')}/${String(month).padStart(
          2,
          '0'
        )}/${year}`;

        setLicenseLabel(`Licença até ${formatted}`);
      } catch {
        if (!cancelled) {
          setLicenseLabel(null);
        }
      }
    }

    fetchLicense();

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
          <span style={{ marginLeft: '0.75rem', fontSize: '0.85em', opacity: 0.8 }}>
            {licenseLabel}
          </span>
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
