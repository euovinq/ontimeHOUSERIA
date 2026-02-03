import { LogOrigin, Playback, runtimeStorePlaceholder, SimpleDirection, SimplePlayback } from 'houseriaapp-types';

import 'dotenv/config';
import express from 'express';
import http, { type Server } from 'http';
import cors from 'cors';
import serverTiming from 'server-timing';
import cookieParser from 'cookie-parser';

// import utils
import { publicDir, srcDir as _srcDir } from './setup/index.js';
import { environment as _environment, isProduction } from './setup/environment.js';
import { updateRouterPrefix } from './externals.js';
import { ONTIME_VERSION } from './ONTIME_VERSION.js';
import { consoleSuccess, consoleHighlight, consoleError } from './utils/console.js';

// Import middleware configuration
import { bodyParser } from './middleware/bodyParser.js';
import { compressedStatic } from './middleware/staticGZip.js';
import { loginRouter, makeAuthenticateMiddleware } from './middleware/authenticate.js';
import { router as authRouter } from './api-data/auth/auth.router.js';

// Import Routers
import { appRouter } from './api-data/index.js';
import { integrationRouter } from './api-integration/integration.router.js';
import { publicRouter } from './api-integration/public.router.js';
import { publicTimerControlRouter } from './api-integration/public-timer-control.router.js';
import { publicDataRouter } from './api-data/public-data.router.js';

// Import adapters
import { socket } from './adapters/WebsocketAdapter.js';
import { getDataProvider } from './classes/data-provider/DataProvider.js';

// Services
import { logger } from './classes/Logger.js';
import { populateStyles } from './setup/loadStyles.js';
import { eventStore } from './stores/EventStore.js';
import { runtimeService } from './services/runtime-service/RuntimeService.js';
import { restoreService } from './services/RestoreService.js';
import * as messageService from './services/message-service/MessageService.js';
import { populateDemo } from './setup/loadDemo.js';
import { getState } from './stores/runtimeState.js';
import { initRundown } from './services/rundown-service/RundownService.js';
import { initialiseProject } from './services/project-service/ProjectService.js';
import { getShowWelcomeDialog } from './services/app-state-service/AppStateService.js';
import { oscServer } from './adapters/OscAdapter.js';
// Utilities
import { clearUploadfolder } from './utils/upload.js';
import { generateCrashReport } from './utils/generateCrashReport.js';
import { timerConfig } from './config/config.js';
import { serverTryDesiredPort, getNetworkInterfaces } from './utils/network.js';

import {reenviarRundown} from './scripts/dataSupabase.js';

consoleHighlight(`Starting Ontime version ${ONTIME_VERSION}`);

const _canLog = isProduction;

/**
 * When running in Ontime cloud, the client is not at the root segment
 * ie: https://cloud.getontime.com/client-hash/timer
 * This means:
 * - changing the base path in the index.html file
 * - prepending all express routes with the given prefix
 */
const prefix = updateRouterPrefix();

// Create express APP
const app = express();
if (!isProduction) {
  // log server timings to requests
  app.use(serverTiming());
}
app.disable('x-powered-by');

// Implement middleware
app.use(
  cors({
    origin: true, // reflect origin
    credentials: true, // allow cookies (auth_user_id / auth_is_admin)
  })
); // setup cors for all routes
app.options(
  '*',
  cors({
    origin: true,
    credentials: true,
  })
); // enable pre-flight cors

// Middleware de debug para todas as requisições
app.use((req, res, next) => {
  next();
});

app.use(bodyParser);
app.use(cookieParser());
const { authenticate, authenticateAndRedirect } = makeAuthenticateMiddleware(prefix);

// Implement route endpoints
app.use(`${prefix}/login`, loginRouter); // router for login flow (HTML antigo)
app.use(`${prefix}/auth`, authRouter); // router para autenticação via Supabase (sem cookie)
app.use(`${prefix}/api/public`, publicRouter); // router for public endpoints (Stream Deck) - SEM autenticação
app.use(`${prefix}/data`, publicDataRouter); // router público para leitura de dados (realtime, etc.) - SEM autenticação
app.use(`${prefix}/data`, authenticate, appRouter); // router for application data (outras rotas protegidas)
// Router público para controle básico do timer deve vir ANTES do router protegido
// para capturar as ações públicas (start, pause, stop, etc.)
app.use(`${prefix}/api`, publicTimerControlRouter); // router público para controle básico do timer (start, pause, stop, etc.) - SEM autenticação
app.use(`${prefix}/api`, authenticate, integrationRouter); // router for integrations (outras ações protegidas)

// serve static external files
app.use(`${prefix}/external`, express.static(publicDir.externalDir));
app.use(`${prefix}/external`, (req, res) => {
  // if the user reaches to the root, we show a 404
  res.status(404).send(`${req.originalUrl} not found`);
});
app.use(`${prefix}/user`, express.static(publicDir.userDir));

// Base route for static files
app.use(`${prefix}`, authenticateAndRedirect, compressedStatic);
app.use(`${prefix}/*`, authenticateAndRedirect, compressedStatic);

// Implement catch all para erros
app.use((error: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(`❌ [ERROR-HANDLER] Erro não tratado: ${error.message}`);
  console.error(`❌ [ERROR-HANDLER] Path: ${req.path} | Method: ${req.method}`);
  if (error.stack) {
    console.error(`❌ [ERROR-HANDLER] Stack: ${error.stack}`);
  }
  res.status(500).json({ error: 'Internal server error', message: error.message });
});

// Catch all para rotas não encontradas
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({ error: 'Route not found', path: req.path });
});

/***************  START SERVICES ***************/

/* Override config
 * ----------------
 *
 * Configuration of services comes from app general config
 * It can be overridden here by the settings in the db
 * It can also be overridden on call
 *
 * Start order
 * ----------------
 *
 * The services need to be started in a certain order,
 * the enum below enforces that
 */

enum OntimeStartOrder {
  Error,
  InitAssets,
  InitServer,
  InitIO,
}

let step = OntimeStartOrder.InitAssets;
let expressServer: Server | null = null;

const checkStart = (currentState: OntimeStartOrder) => {
  if (step !== currentState) {
    step = OntimeStartOrder.Error;
    throw new Error('Init order error: initAssets > startServer');
  } else {
    if (step === 1 || step === 2) {
      step = step + 1;
    }
  }
};

export const initAssets = async () => {
  checkStart(OntimeStartOrder.InitAssets);
  await clearUploadfolder();
  populateStyles();
  await populateDemo();
  const project = await initialiseProject();
  logger.info(LogOrigin.Server, `Initialised Ontime with ${project}`);
};

/**
 * Starts servers
 */
export const startServer = async (
  escalateErrorFn?: (error: string, unrecoverable: boolean) => void,
): Promise<{ message: string; serverPort: number }> => {
  checkStart(OntimeStartOrder.InitServer);
  // initialise logging service, escalateErrorFn only exists in electron
  logger.init(escalateErrorFn);
  const settings = getDataProvider().getSettings();
  const { serverPort: desiredPort } = settings;

  expressServer = http.createServer(app);

  // the express server must be started before the socket otherwise the on error event listener will not attach properly
  const resultPort = await serverTryDesiredPort(expressServer, desiredPort);
  await getDataProvider().setSettings({ ...settings, serverPort: resultPort });
  const showWelcome = await getShowWelcomeDialog();

  socket.init(expressServer, showWelcome, prefix);

  /**
   * Module initialises the services and provides initial payload for the store
   */
  const state = getState();
  eventStore.init({
    clock: state.clock,
    timer: state.timer,
    onAir: state.timer.playback !== Playback.Stop,
    message: { ...runtimeStorePlaceholder.message },
    runtime: state.runtime,
    eventNow: state.eventNow,
    currentBlock: {
      block: null,
      startedAt: null,
    },
    publicEventNow: state.publicEventNow,
    eventNext: state.eventNext,
    publicEventNext: state.publicEventNext,
    auxtimer1: {
      duration: timerConfig.auxTimerDefault,
      current: timerConfig.auxTimerDefault,
      playback: SimplePlayback.Stop,
      direction: SimpleDirection.CountDown,
    },
    ping: -1,
  });

  // initialise rundown service
  const persistedRundown = getDataProvider().getRundown();
  const persistedCustomFields = getDataProvider().getCustomFields();
  await initRundown(persistedRundown, persistedCustomFields);

  // initialise message service
  messageService.init(eventStore.set, eventStore.get);

  // load restore point if it exists
  const maybeRestorePoint = await restoreService.load();

  // TODO: pass event store to rundownservice
  runtimeService.init(maybeRestorePoint);

  const nif = getNetworkInterfaces();
  consoleSuccess(`Local: http://localhost:${resultPort}${prefix}/editor`);
  for (const key in nif) {
    const address = nif[key].address;
    consoleSuccess(`Network: http://${address}:${resultPort}${prefix}/editor`);
  }

  const returnMessage = `Ontime is listening on port ${resultPort}`;
  logger.info(LogOrigin.Server, returnMessage);

  return {
    message: returnMessage,
    serverPort: resultPort,
  };
};

/**
 * starts integrations
 */
export const startIntegrations = async () => {
  checkStart(OntimeStartOrder.InitIO);
  const { enabledOscIn, oscPortIn } = getDataProvider().getAutomation();
  if (enabledOscIn) {
    oscServer.init(oscPortIn);
  } else {
    logger.info(LogOrigin.Server, 'Skipping OSC integration');
  }
};

/**
 * @description clean shutdown app services
 * @param {number} exitCode
 * @return {Promise<void>}
 */
export const shutdown = async (exitCode = 0) => {
  consoleHighlight(`Ontime shutting down with code ${exitCode}`);

  // clear the restore file if it was a normal exit
  // 0 means it was a SIGNAL
  // 1 means crash -> keep the file
  // 2 means dev crash -> do nothing
  // 99 means there was a shutdown request from the UI
  if (exitCode === 0 || exitCode === 99) {
    await restoreService.clear();
  }

  expressServer?.close();
  runtimeService.shutdown();
  logger.shutdown();
  oscServer.shutdown();
  socket.shutdown();
  process.exit(exitCode);
};

process.on('exit', (code) => consoleHighlight(`Ontime shutdown with code: ${code}`));

process.on('unhandledRejection', async (error) => {
  if (!isProduction && error instanceof Error && error.stack) {
    consoleError(error.stack);
  }
  generateCrashReport(error);
  logger.crash(LogOrigin.Server, `Uncaught rejection | ${error}`);
  await shutdown(1);
});

process.on('uncaughtException', async (error) => {
  if (!isProduction && error instanceof Error && error.stack) {
    consoleError(error.stack);
  }
  generateCrashReport(error);
  logger.crash(LogOrigin.Server, `Uncaught exception | ${error}`);
  await shutdown(1);
});

// register shutdown signals
process.once('SIGHUP', async () => shutdown(0));
process.once('SIGINT', async () => shutdown(0));
process.once('SIGTERM', async () => shutdown(0));



reenviarRundown();
