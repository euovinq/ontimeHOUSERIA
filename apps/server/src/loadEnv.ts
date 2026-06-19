/**
 * Carregamento das variáveis de ambiente.
 *
 * IMPORTANTE: este módulo precisa ser o PRIMEIRO import do app (antes de
 * qualquer módulo que leia process.env no topo, como auth.service ou
 * software.controller). O esbuild executa o corpo dos módulos importados na
 * ordem do grafo de imports, então só garantimos que o .env esteja disponível
 * a tempo se ele for carregado aqui, no módulo mais "raso" e sem dependências.
 *
 * - Em dev: lê o .env do diretório atual (cwd).
 * - Empacotado no Electron: lê o .env embarcado ao lado do bundle do server
 *   (extraResources/server/.env). dotenv não sobrescreve variáveis já
 *   definidas, então o cwd continua tendo prioridade em dev.
 */
import { config as loadDotenv } from 'dotenv';

loadDotenv();

declare const __dirname: string;
if (typeof __dirname !== 'undefined') {
  loadDotenv({ path: `${__dirname}/.env` });
}
