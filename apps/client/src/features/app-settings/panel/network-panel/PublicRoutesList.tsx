import { useMemo,useState } from 'react';
import { IoCheckmark,IoCopy } from 'react-icons/io5';
import { IconButton, Tooltip } from '@chakra-ui/react';

import copyToClipboard from '../../../../common/utils/copyToClipboard';
import { serverURL } from '../../../../externals';
import { tooltipDelayFast } from '../../../../ontimeConfig';
import * as Panel from '../../panel-utils/PanelUtils';

import style from './PublicRoutesList.module.scss';

interface Route {
  method: string;
  path: string;
  description: string;
  category: string;
  usage?: string; // Exemplos de uso com parâmetros
}

const publicRoutes: Route[] = [
  // Controles Básicos
  { method: 'GET', path: '/api/start', description: 'Iniciar timer', category: 'Controles Básicos', usage: '/api/start/next (próximo evento)\n/api/start/previous (evento anterior)\n/api/start/index/1 (por índice)\n/api/start/id/abc123 (por ID)\n/api/start/cue/1 (por cue)' },
  { method: 'GET', path: '/api/pause', description: 'Pausar timer', category: 'Controles Básicos' },
  { method: 'GET', path: '/api/stop', description: 'Parar timer', category: 'Controles Básicos' },
  { method: 'GET', path: '/api/poll', description: 'Obter status atual do timer', category: 'Controles Básicos' },
  { method: 'GET', path: '/api/load', description: 'Carregar evento', category: 'Controles Básicos', usage: '/api/load/next (próximo evento)\n/api/load/previous (evento anterior)\n/api/load/index/1 (por índice)\n/api/load/id/abc123 (por ID)\n/api/load/cue/1 (por cue)' },
  { method: 'GET', path: '/api/roll', description: 'Roll (avançar para próximo evento)', category: 'Controles Básicos' },
  { method: 'GET', path: '/api/reload', description: 'Recarregar', category: 'Controles Básicos' },
  { method: 'GET', path: '/api/addtime', description: 'Adicionar tempo ao timer atual', category: 'Controles Básicos', usage: '/api/addtime/60 (adiciona 60 segundos)\n/api/addtime/-30 (remove 30 segundos)' },
  { method: 'GET', path: '/api/version', description: 'Versão da API', category: 'Controles Básicos' },
  { method: 'GET', path: '/api/', description: 'Health check da API', category: 'Controles Básicos' },

  // Controles Avançados
  { method: 'GET', path: '/api/start/next', description: 'Iniciar próximo evento', category: 'Controles Avançados' },
  { method: 'GET', path: '/api/start/previous', description: 'Iniciar evento anterior', category: 'Controles Avançados' },
  { method: 'GET', path: '/api/message', description: 'Controlar mensagens', category: 'Controles Avançados' },
  { method: 'GET', path: '/api/change', description: 'Modificar eventos', category: 'Controles Avançados' },
  { method: 'GET', path: '/api/auxtimer', description: 'Controlar timer auxiliar', category: 'Controles Avançados' },
  { method: 'GET', path: '/api/client', description: 'Controlar clientes', category: 'Controles Avançados' },
  { method: 'GET', path: '/api/offsetmode', description: 'Modo de offset', category: 'Controles Avançados' },

  // Rotas Públicas do Companion
  { method: 'GET', path: '/api/public/start', description: 'Iniciar timer', category: 'Rotas Públicas', usage: '/api/public/start/next (próximo evento)\n/api/public/start/previous (evento anterior)\n/api/public/start/index/1 (por índice)' },
  { method: 'GET', path: '/api/public/pause', description: 'Pausar timer', category: 'Rotas Públicas' },
  { method: 'GET', path: '/api/public/stop', description: 'Parar timer', category: 'Rotas Públicas' },
  { method: 'GET', path: '/api/public/poll', description: 'Obter status atual do timer', category: 'Rotas Públicas' },
  { method: 'GET', path: '/api/public/load', description: 'Carregar evento', category: 'Rotas Públicas', usage: '/api/public/load/next (próximo evento)\n/api/public/load/previous (evento anterior)\n/api/public/load/index/1 (por índice)' },
  { method: 'GET', path: '/api/public/roll', description: 'Roll', category: 'Rotas Públicas' },
  { method: 'GET', path: '/api/public/reload', description: 'Recarregar', category: 'Rotas Públicas' },
  { method: 'GET', path: '/api/public/addtime', description: 'Adicionar tempo', category: 'Rotas Públicas', usage: '/api/public/addtime/60 (adiciona 60 segundos)\n/api/public/addtime/-30 (remove 30 segundos)' },
  { method: 'GET', path: '/api/public/', description: 'Health check do router público', category: 'Rotas Públicas' },

  // PowerPoint
  { method: 'GET', path: '/api/public/powerpoint/toggle', description: 'Toggle PowerPoint', category: 'PowerPoint' },
  { method: 'POST', path: '/api/public/powerpoint/toggle', description: 'Toggle PowerPoint (POST)', category: 'PowerPoint' },
  { method: 'GET', path: '/api/public/powerpoint/toggle/status', description: 'Status do toggle do PowerPoint', category: 'PowerPoint' },
  { method: 'GET', path: '/api/public/powerpoint/status/complete', description: 'Status completo do PowerPoint', category: 'PowerPoint' },
  { method: 'GET', path: '/api/public/powerpoint/status/slide', description: 'Status do slide atual', category: 'PowerPoint' },
  { method: 'GET', path: '/api/public/powerpoint/status/slide/query', description: 'Status do slide com query params', category: 'PowerPoint' },
  { method: 'GET', path: '/api/public/powerpoint/status/video', description: 'Status do vídeo', category: 'PowerPoint' },
  { method: 'GET', path: '/api/public/togglepowerpoint', description: 'Toggle PowerPoint (alias)', category: 'PowerPoint' },
  { method: 'GET', path: '/api/public/getpowerpointstatus', description: 'Obter status do PowerPoint (alias)', category: 'PowerPoint' },
  { method: 'POST', path: '/api/public/powerpoint/osc/config', description: 'Configurar OSC do PowerPoint', category: 'PowerPoint' },
  { method: 'POST', path: '/api/public/powerpoint/osc/start', description: 'Iniciar OSC do PowerPoint', category: 'PowerPoint' },
  { method: 'POST', path: '/api/public/powerpoint/osc/stop', description: 'Parar OSC do PowerPoint', category: 'PowerPoint' },
  { method: 'GET', path: '/api/public/powerpoint/osc/status', description: 'Status do OSC do PowerPoint', category: 'PowerPoint' },

  // Supabase
  { method: 'GET', path: '/api/public/supabase/toggle', description: 'Toggle Supabase', category: 'Supabase' },
  { method: 'POST', path: '/api/public/supabase/toggle', description: 'Toggle Supabase (POST)', category: 'Supabase' },
  { method: 'GET', path: '/api/public/supabase/toggle/status', description: 'Status do toggle do Supabase', category: 'Supabase' },
  { method: 'GET', path: '/api/public/togglesupabase', description: 'Toggle Supabase (alias)', category: 'Supabase' },
  { method: 'GET', path: '/api/public/getsupabasestatus', description: 'Obter status do Supabase (alias)', category: 'Supabase' },

  // Dados em Tempo Real
  { method: 'GET', path: '/data/realtime', description: 'Dados em tempo real do timer', category: 'Dados' },
  { method: 'GET', path: '/data/rundown/normalised', description: 'Rundown normalizado (formato usado pelo Companion)', category: 'Dados' },
  { method: 'GET', path: '/data/rundown', description: 'Todos os eventos', category: 'Dados' },
  { method: 'GET', path: '/data/rundowns', description: 'Alias (plural) para compatibilidade', category: 'Dados' },
  { method: 'GET', path: '/data/rundowns/current', description: 'Rundown atual (alias para normalised)', category: 'Dados' },

  // Configurações e Projeto
  { method: 'GET', path: '/data/automations', description: 'Configurações de automação', category: 'Dados' },
  { method: 'GET', path: '/data/custom-fields', description: 'Campos customizados', category: 'Dados' },
  { method: 'GET', path: '/data/db', description: 'Download do projeto atual', category: 'Dados' },
  { method: 'GET', path: '/data/project', description: 'Dados do projeto', category: 'Dados' },
  { method: 'GET', path: '/data/settings', description: 'Configurações gerais', category: 'Dados' },
  { method: 'GET', path: '/data/view-settings', description: 'Configurações de visualização', category: 'Dados' },
  { method: 'GET', path: '/data/url-presets', description: 'Presets de URL', category: 'Dados' },
  { method: 'GET', path: '/data/session', description: 'Estatísticas de sessão', category: 'Dados' },
  { method: 'GET', path: '/data/session/info', description: 'Informações da sessão', category: 'Dados' },
  { method: 'GET', path: '/data/report', description: 'Relatórios', category: 'Dados' },

  // Autenticação
  { method: 'POST', path: '/auth/login', description: 'Login (se necessário)', category: 'Autenticação' },
  { method: 'GET', path: '/auth/license', description: 'Informações de licença', category: 'Autenticação' },
];

function RouteItem({ route, index }: { route: Route; index: number }) {
  const [copied, setCopied] = useState(false);
  const [showExample, setShowExample] = useState(false);

  const fullUrl = (path: string) => {
    const baseUrl = serverURL.replace(/\/$/, ''); // Remove trailing slash if exists
    return `${baseUrl}${path}`;
  };

  const url = fullUrl(route.path);

  const handleCopy = async () => {
    await copyToClipboard(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const getCompanionExample = () => {
    const baseUrl = serverURL.replace(/\/$/, '');
    const urlObj = new URL(baseUrl);
    const host = urlObj.hostname;
    const port = urlObj.port || '4001';
    const pathOnly = route.path;
    
    let exampleText = `No Companion, configure assim:

1. Adicione uma ação "HTTP Request"
2. Configure:
   - Type: HTTP Request
   - Method: ${route.method}
   - URL: ${pathOnly}`;
    
    if (route.usage) {
      const usageExamples = route.usage.split('\n').filter(line => line.trim());
      exampleText += `\n\nExemplos de URL com parâmetros:`;
      usageExamples.forEach(example => {
        const examplePath = example.split(' ')[0];
        exampleText += `\n   - ${examplePath}`;
      });
    }
    
    exampleText += `
   - Host: ${host}
   - Port: ${port}
   - Protocol: http
   - Headers: (deixe vazio)
   - Body: (deixe vazio)
   - E-mail: (deixe vazio)
   - Senha: (deixe vazio)

URL completa: ${url}`;
    
    return exampleText;
  };

  const getCurlExample = () => {
    const baseUrl = serverURL.replace(/\/$/, '');
    let exampleText = '';
    
    if (route.method === 'GET') {
      exampleText = `curl "${url}"`;
    } else if (route.method === 'POST') {
      exampleText = `curl -X POST "${url}"`;
    } else {
      exampleText = `curl -X ${route.method} "${url}"`;
    }
    
    if (route.usage) {
      const usageExamples = route.usage.split('\n').filter(line => line.trim());
      exampleText += '\n\nExemplos com parâmetros:';
      usageExamples.forEach(example => {
        const examplePath = example.split(' ')[0];
        const fullExampleUrl = `${baseUrl}${examplePath}`;
        if (route.method === 'GET') {
          exampleText += `\ncurl "${fullExampleUrl}"`;
        } else if (route.method === 'POST') {
          exampleText += `\ncurl -X POST "${fullExampleUrl}"`;
        } else {
          exampleText += `\ncurl -X ${route.method} "${fullExampleUrl}"`;
        }
      });
    }
    
    return exampleText;
  };

  return (
    <div className={style.routeItem}>
      <div className={style.routeMethod}>{route.method}</div>
      <div className={style.routePath}>
        <code>{url}</code>
      </div>
      <Tooltip label={copied ? 'Copiado!' : 'Copiar URL'} openDelay={tooltipDelayFast}>
        <IconButton
          aria-label={copied ? 'Copiado!' : 'Copiar URL'}
          icon={copied ? <IoCheckmark /> : <IoCopy />}
          variant='ontime-subtle'
          size='xs'
          onClick={handleCopy}
          className={style.copyButton}
        />
      </Tooltip>
      <div className={style.routeDescription}>{route.description}</div>
      {route.usage && (
        <div className={style.usageSection}>
          <div className={style.usageLabel}>Exemplos de uso:</div>
          <code className={style.usageCode}>{route.usage}</code>
        </div>
      )}
      <div className={style.exampleSection}>
        <button
          type='button'
          onClick={() => setShowExample(!showExample)}
          className={style.exampleToggle}
        >
          {showExample ? 'Ocultar' : 'Mostrar'} exemplo
        </button>
        {showExample && (
          <div className={style.exampleContent}>
            <div className={style.exampleBlock}>
              <div className={style.exampleLabel}>Companion (Stream Deck):</div>
              <code className={style.exampleCode}>{getCompanionExample()}</code>
            </div>
            <div className={style.exampleBlock}>
              <div className={style.exampleLabel}>cURL (Terminal):</div>
              <code className={style.exampleCode}>{getCurlExample()}</code>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PublicRoutesList() {
  const routesByCategory = useMemo(() => {
    const grouped: Record<string, Route[]> = {};
    publicRoutes.forEach((route) => {
      if (!grouped[route.category]) {
        grouped[route.category] = [];
      }
      grouped[route.category].push(route);
    });
    return grouped;
  }, []);

  return (
    <Panel.Section>
      <Panel.Card>
        <Panel.SubHeader>Rotas Públicas da API</Panel.SubHeader>
        <Panel.Divider />
        <Panel.Paragraph>
          Todas as rotas abaixo são públicas e não requerem autenticação. Use-as para integração com Companion, Stream Deck ou outras ferramentas.
        </Panel.Paragraph>
        <div className={style.routesContainer}>
          {Object.entries(routesByCategory).map(([category, routes]) => (
            <div key={category} className={style.categorySection}>
              <Panel.Title className={style.categoryTitle}>{category}</Panel.Title>
              <div className={style.routesList}>
                {routes.map((route, index) => (
                  <RouteItem key={`${route.method}-${route.path}-${index}`} route={route} index={index} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel.Card>
    </Panel.Section>
  );
}
