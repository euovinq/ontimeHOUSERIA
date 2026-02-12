const { app, BrowserWindow, Menu, globalShortcut, Tray, dialog, ipcMain, shell, Notification } = require('electron');
const path = require('path');

const { getApplicationMenu } = require('./menu/applicationMenu.js');
const { getTrayMenu } = require('./menu/trayMenu.js');

const electronConfig = require('./electron.config.js');
const {
  env,
  isProduction,
  isWindows,
  nodePath,
  getClientUrl,
  trayIcon,
  appIcon,
  getServerUrl,
  getAppDataPath,
} = require('./externals.js');
const authService = require('./services/AuthService.js');

if (!isProduction) {
  console.log(`Electron running in ${env} environment`);
  console.log(`HouseriaAPP server at ${nodePath}`);
  process.traceProcessWarnings = true;
}

/** Flag holds server loading state */
let loaded = 'HouseriaAPP starting';

/**
 * Flag whether user has requested a quit
 * Used to coordinate window closes without exit
 */
let isQuitting = false;

// initialise
let win;
let splash;
let loginWindow = null;
let tray = null;

/** Promise com a porta do backend (para evitar múltiplos startBackend em produção) */
let backendPortPromise = null;

/** Interval que verifica se o período de licença expirou (para encerrar o app) */
let licenseCheckIntervalId = null;

const LICENSE_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutos

/**
 * Mostra aviso de licença expirada e encerra o app.
 * @param {{ message?: string }} [payload]
 */
async function handleLicenseExpired(payload) {
  const messageBase =
    (payload && payload.message) ||
    'Seu período de acesso expirou ou foi alterado.';
  await dialog.showMessageBox({
    type: 'warning',
    buttons: ['OK'],
    defaultId: 0,
    title: 'Sessão expirada',
    message: messageBase,
    detail: 'Reabra o HouseriaAPP e faça login novamente para continuar usando o sistema.',
  });
  console.log('🔌 Shutting down app after license expiration...');
  appShutdown();
}

/**
 * Cria o arquivo .login-complete para sinalizar ao wait-for-login.js (dev) que o login foi feito.
 * Assim o Vite sobe e o Electron consegue conectar na porta 3000.
 */
function createLoginLockFile() {
  const fs = require('fs');
  try {
    const appDataPath = getAppDataPath();
    if (appDataPath) {
      if (!fs.existsSync(appDataPath)) {
        fs.mkdirSync(appDataPath, { recursive: true });
      }
      const lockFilePath = path.join(appDataPath, '.login-complete');
      fs.writeFileSync(
        lockFilePath,
        JSON.stringify({ timestamp: Date.now() }),
        'utf8'
      );
      console.log('✅ Login lock file created:', lockFilePath);
    } else {
      console.warn(
        '⚠️ Could not resolve AppDataPath when creating login lock file.'
      );
    }
  } catch (lockError) {
    console.error('❌ Error creating login lock file:', lockError);
  }
}

/**
 * Coordinates the node process startup
 * @returns {number} server port - the port at which the backend has been started at
 */
async function startBackend() {
  console.log('startBackend called, isProduction:', isProduction);
  // in dev mode, não iniciamos o servidor pelo Electron
  // Esperamos que o servidor (porta 4001) e o client (porta 3000) estejam rodando via scripts de dev
  if (!isProduction) {
    console.log('Dev mode - startBackend não inicia servidor (usando portas 3000/4001 externas)');
    return 3000; // Dev client port
  }

  try {
    console.log('Production mode - loading server from:', nodePath);
    
    // Verifica se o arquivo existe
    const fs = require('fs');
    if (!fs.existsSync(nodePath)) {
      const errorMsg = `Server file not found at: ${nodePath}`;
      console.error('ERROR:', errorMsg);
      escalateError(errorMsg, true);
      throw new Error(errorMsg);
    }
    
    console.log('Server file found, requiring...');
    const ontimeServer = require(nodePath);
    
    if (!ontimeServer) {
      throw new Error('Failed to load server module - module is null/undefined');
    }
    
    const { initAssets, startServer, startIntegrations } = ontimeServer;
    
    if (!initAssets || !startServer || !startIntegrations) {
      throw new Error(`Server module missing required exports. Found: ${Object.keys(ontimeServer).join(', ')}`);
    }

    console.log('Initializing assets...');
    await initAssets();

    console.log('Starting server...');
    const result = await startServer(escalateError);
    loaded = result.message;
    console.log('Server started, message:', loaded, 'port:', result.serverPort);

    console.log('Starting integrations...');
    await startIntegrations();

    console.log('Backend initialization complete, returning port:', result.serverPort);
    return result.serverPort;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error && error.stack ? error.stack : '';
    console.error('ERROR: Failed to start backend:', errorMsg);
    console.error('Stack:', errorStack);
    escalateError(`Failed to start backend: ${errorMsg}\n\nStack: ${errorStack}`, true);
    throw error;
  }
}

/**
 * Garante que o backend foi iniciado (apenas em produção)
 * Em dev, apenas devolve a porta 3000 para o client (servidor já deve estar rodando externamente)
 * @returns {Promise<number>} Porta do servidor HTTP
 */
function ensureBackendStarted() {
  if (backendPortPromise) {
    return backendPortPromise;
  }

  if (!isProduction) {
    backendPortPromise = Promise.resolve(3000);
    return backendPortPromise;
  }

  backendPortPromise = (async () => {
    console.log('ensureBackendStarted: iniciando backend em produção...');
    const port = await startBackend();
    console.log('ensureBackendStarted: backend iniciado na porta', port);
    return port;
  })();

  return backendPortPromise;
}

/**
 * @description utility function to create a notification
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 */
function showNotification(title, body) {
  new Notification({
    title,
    body,
    silent: true,
  }).show();
}

/**
 * Terminate node service and close electron app
 */
function appShutdown() {
  // terminate node service
  (async () => {
    const ontimeServer = require(nodePath);
    const { shutdown } = ontimeServer;
    await shutdown(electronConfig.appIni.shutdownCode);
  })();

  isQuitting = true;
  
  // Destruir tray se existir
  if (tray) {
    tray.destroy();
    tray = null;
  }
  
  // Destruir janela principal se existir
  if (win) {
    win.destroy();
    win = null;
  }
  
  app.quit();
}

/**
 * Sets Houseria window in focus
 */
function bringToFront() {
  if (win) {
    win.show();
    win.focus();
  }
}

/**
 * Coordinates the shutdown process
 */
function askToQuit() {
  if (win) {
    bringToFront();
    win.send('user-request-shutdown');
  }
}

/**
 * Allows processes to escalate errors to be shown in electron
 * @param {string} error
 */
function escalateError(error, unrecoverable = false) {
  if (unrecoverable) {
    dialog.showErrorBox('An unrecoverable error occurred', error);
    appShutdown();
  } else {
    dialog.showErrorBox('An error occurred', error);
  }
}

/**
 * Allows electron to ask the react app to redirect
 * @param {string} location
 */
function redirectWindow(location) {
  if (win) {
    win.webContents.send('request-editor-location', location);
  }
}

/**
 * Asks the react app to show a user dialog
 * @param {string} name
 */
function showDialog(name) {
  if (win) {
    win.webContents.send('dialog', name);
  }
}

// Ensure there isn't another instance of the app running already
const lock = app.requestSingleInstanceLock();
if (!lock) {
  dialog.showErrorBox('Multiple instances', 'An instance of the App is already running.');
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, we should focus our window.
    if (win) {
      if (win.isMinimized()) {
        win.restore();
      }
      bringToFront();
    }
  });
}

/**
 * Creates the login window
 */
function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 450,
    height: 550,
    minWidth: 400,
    minHeight: 500,
    backgroundColor: '#101010',
    icon: appIcon,
    show: false,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const loginPath = path.join('file://', __dirname, '/login/login.html');
  loginWindow.loadURL(loginPath);

  loginWindow.once('ready-to-show', () => {
    loginWindow.show();
    loginWindow.focus();
    
  });

  // Fechar o app se a janela de login for fechada
  loginWindow.on('closed', () => {
    if (!win) {
      app.quit();
    }
  });
}

/**
 * Coordinates creation of electron windows (splash and main)
 */
function createWindow() {
  splash = new BrowserWindow({
    width: 333,
    height: 333,
    transparent: true,
    icon: appIcon,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
  });
  splash.setIgnoreMouseEvents(true);
  const splashPath = path.join('file://', __dirname, '/splash/splash.html');
  splash.loadURL(splashPath);

  win = new BrowserWindow({
    width: 1920,
    height: 1000,
    minWidth: 525,
    minHeight: 405,
    backgroundColor: '#101010', // $gray-1350
    icon: appIcon,
    show: false,
    textAreasAreResizable: false,
    enableWebSQL: false,
    darkTheme: true,
    webPreferences: {
      preload: path.join(__dirname, './preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (win) {
    win.setMenu(null);
  }
}

/**
 * Waits for the server to be ready (only in dev mode)
 */
async function waitForServer(port, maxAttempts = 60) {
  if (isProduction) {
    return Promise.resolve();
  }

  const http = require('http');
  let attempts = 0;

  return new Promise((resolve, reject) => {
    const checkServer = () => {
      attempts++;
      console.log(`Checking if server is ready on port ${port} (attempt ${attempts}/${maxAttempts})...`);
      
      const req = http.get(`http://localhost:${port}`, () => {
        req.destroy(); // Close the request
        console.log(`Server is ready on port ${port}`);
        resolve();
      });

      req.on('error', () => {
        req.destroy(); // Close the request
        if (attempts >= maxAttempts) {
          reject(new Error(`Server did not start after ${maxAttempts} attempts`));
        } else {
          setTimeout(checkServer, 1000); // Wait 1 second before retrying
        }
      });

      req.setTimeout(2000, () => {
        req.destroy();
        if (attempts >= maxAttempts) {
          reject(new Error(`Server did not start after ${maxAttempts} attempts`));
        } else {
          setTimeout(checkServer, 1000);
        }
      });
    };

    checkServer();
  });
}

/**
 * Starts the application flow after login
 */
function startApplication() {
  createWindow();
  
  // In dev mode, wait for server to be ready before continuing
  const initializeApp = async () => {
    let port;

    if (!isProduction) {
      console.log('Waiting for dev client (React) on port 3000...');
      try {
        await waitForServer(3000);
        console.log('Dev client is ready, continuing...');
        port = 3000;
      } catch (error) {
        console.error('ERROR: Dev client did not start:', error);
        escalateError(
          'Dev client did not start. Please ensure the React dev server is running on port 3000.',
          false
        );
        return;
      }
    } else {
      try {
        port = await ensureBackendStarted();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('ERROR: Backend failed to start in production', errorMsg);
        escalateError(`Failed to start backend: ${errorMsg}`, true);
        return;
      }
    }

    const clientUrl = getClientUrl(port);
    const serverUrl = getServerUrl(port);
    console.log('Client URL:', clientUrl);
    console.log('Server URL:', serverUrl);
    
    const menu = getApplicationMenu(
      askToQuit,
      clientUrl,
      serverUrl,
      redirectWindow,
      showDialog,
      (url) => {
        if (win) {
          win.webContents.downloadURL(url);
        }
      },
    );
    Menu.setApplicationMenu(menu);

    console.log('Loading URL:', `${clientUrl}/editor`);
    win
      .loadURL(`${clientUrl}/editor`)
      .then(() => {
        console.log('URL loaded successfully');
        if (win) {
          win.webContents.setBackgroundThrottling(false);
          win.show();
          win.focus();
        }

        splash.destroy();

        if (typeof loaded === 'string') {
          tray.setToolTip(loaded);
        } else {
          tray.setToolTip('Initialising error: please restart Houseria');
        }

        // Verificação periódica: se o período de licença (licenseExpiresAt) expirou, encerra o app
        if (licenseCheckIntervalId) clearInterval(licenseCheckIntervalId);
        licenseCheckIntervalId = setInterval(() => {
          if (authService.isLicenseExpired()) {
            if (licenseCheckIntervalId) {
              clearInterval(licenseCheckIntervalId);
              licenseCheckIntervalId = null;
            }
            handleLicenseExpired({ message: 'Seu período de acesso expirou.' });
          }
        }, LICENSE_CHECK_INTERVAL_MS);
      })
      .catch((error) => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('ERROR: Houseria failed to reach server', errorMsg);
        escalateError(`Failed to load client: ${errorMsg}`, false);
      });
  };

  initializeApp();

  /**
   * recreate window if no others open
   */
  app.on('activate', () => {
    if (win) {
      win.show();
    }
  });

  /**
   * Hide on close
   */
  win.on('close', function (event) {
    // Se não está quitando, prevenir fechamento e esconder janela
    if (!isQuitting && win) {
      event.preventDefault();
      showNotification('Window Closed', 'App running in background');
      win.hide();
    }
    // Se isQuitting é true, permitir fechamento normal (não prevenir)
  });

  // create tray and set its context menu
  tray = new Tray(trayIcon);
  const trayContextMenu = getTrayMenu(bringToFront, askToQuit);
  tray.setContextMenu(trayContextMenu);
}

/**
 * Handles login submission
 * Valida login no servidor (Supabase via backend) antes de iniciar o app
 * Agora usa AuthService para gerenciar tokens JWT
 */
ipcMain.on('login-submit', async (event, credentials) => {
  const { username, password } = credentials || {};
  console.log(
    '🔐 Login submitted:',
    username ? `for user "${username}"` : 'without username'
  );

  if (!username || !password) {
    event.sender.send('login-error', 'Preencha usuário e senha.');
    return;
  }

  try {
    // Obter porta do servidor se necessário
    let port = null;
    if (isProduction) {
      port = await ensureBackendStarted();
    }

    console.log('🔐 Iniciando processo de login...');
    
    // Usar AuthService para fazer login
    const loginResult = await authService.login(username, password, port);
    
    console.log('📥 Resultado do login recebido:', {
      hasResult: !!loginResult,
      success: loginResult?.success,
      hasToken: !!loginResult?.token,
      hasUser: !!loginResult?.user,
      hasSession: !!loginResult?.session,
      keys: loginResult ? Object.keys(loginResult) : [],
    });

    if (loginResult && loginResult.success) {
      console.log('✅ Login successful. Token armazenado com segurança.');
      console.log(`📊 Máquinas ativas: ${loginResult.session.activeSessions}/${loginResult.session.maxLimit}`);
      
      // Enviar sucesso com dados completos
      event.sender.send('login-success', {
        user: loginResult.user,
        session: loginResult.session,
        licenseExpiresAt: loginResult.licenseExpiresAt,
      });

      createLoginLockFile();

      // Fechar janela de login
      if (loginWindow) {
        console.log('🔒 Closing login window after successful login...');
        loginWindow.close();
        loginWindow = null;
      }

      // Iniciar aplicação normalmente
      console.log('🚀 Starting application...');
      startApplication();
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    console.error('❌ Error during login:', errorMsg);
    console.error('❌ Error stack:', errorStack);
    console.error('❌ Error completo:', error);
    
    // Tratar erros específicos
    let friendlyMessage = errorMsg;
    
    // Se for erro de limite de máquinas, enviar detalhes adicionais
    if (error.code === 'max_sessions_reached' && error.details) {
      event.sender.send('login-error', {
        message: friendlyMessage,
        code: 'max_sessions_reached',
        details: error.details,
      });
    } else {
      event.sender.send('login-error', friendlyMessage);
    }
  }
});

/**
 * Handles logout request
 * Faz logout via API e limpa dados locais
 */
ipcMain.on('logout', async () => {
  try {
    console.log('🔓 Logout requested...');
    
    // Obter porta do servidor se necessário
    let port = null;
    if (isProduction) {
      try {
        port = await ensureBackendStarted();
      } catch (error) {
        console.warn('⚠️ Could not get server port for logout, continuing anyway');
      }
    }

    if (licenseCheckIntervalId) {
      clearInterval(licenseCheckIntervalId);
      licenseCheckIntervalId = null;
    }
    await authService.logout(port);
    console.log('✅ Logout realizado com sucesso');

    // Fechar janela principal
    if (win) {
      win.close();
      win = null;
    }

    // Mostrar janela de login novamente
    if (!loginWindow) {
      createLoginWindow();
    } else {
      loginWindow.show();
      loginWindow.focus();
    }
  } catch (error) {
    console.error('❌ Erro ao fazer logout:', error);
    // Mesmo se logout falhar, limpar estado local
    if (win) {
      win.close();
      win = null;
    }
    if (!loginWindow) {
      createLoginWindow();
    }
  }
});

/**
 * Handler para requisições autenticadas
 * Permite que o renderer faça requisições autenticadas via IPC
 */
ipcMain.handle('get-license-info', async () => {
  return authService.getLicenseInfo();
});

/**
 * Retorna dados de autenticação do usuário para uso em headers de requisições
 */
ipcMain.handle('get-auth-headers', async () => {
  console.log('🔐 [get-auth-headers] Handler chamado');
  const userData = authService.getUserData();
  console.log('🔐 [get-auth-headers] userData:', userData ? { hasId: !!userData.id, hasUserId: !!userData.userId, isAdmin: userData.isAdmin } : 'null');
  
  if (!userData) {
    console.warn('⚠️ [get-auth-headers] userData não encontrado');
    return { userId: null, isAdmin: false };
  }
  
  // userId pode estar em userData.id ou userData.userId
  const userId = userData.id || userData.userId || null;
  const isAdmin = Boolean(userData.isAdmin);
  
  console.log('✅ [get-auth-headers] Retornando:', { userId, isAdmin });
  return { userId, isAdmin };
});

ipcMain.handle('authenticated-fetch', async (_event, url, options = {}) => {
  try {
    const response = await authService.authenticatedFetch(url, options);
    const data = await response.json();
    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  } catch (error) {
    // Se erro 401, fazer logout automático
    if (error.message.includes('Sessão expirada') || error.message.includes('Token inválido')) {
      await authService.logout();
      if (win) {
        win.close();
        win = null;
      }
      if (!loginWindow) {
        createLoginWindow();
      }
    }
    throw error;
  }
});

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  // Set app title in windows
  if (isWindows) {
    app.setAppUserModelId(app.name);
  }

  // Tentar carregar token salvo
  console.log('📱 Electron ready, verificando token salvo...');
  const hasStoredToken = await authService.loadStoredToken();
  
  if (hasStoredToken && authService.isAuthenticated()) {
    console.log('✅ Token válido encontrado, iniciando aplicação diretamente...');
    createLoginLockFile();
    startApplication();
  } else {
    console.log('📱 Nenhum token válido encontrado, mostrando janela de login...');
    // Criar e mostrar janela de login
    createLoginWindow();
  }
});

/**
 * Handler para quando o usuário realmente quer fechar o app
 * (ex: Cmd+Q, menu Dock "Encerrar", etc.)
 */
app.on('before-quit', () => {
  if (!isQuitting) {
    isQuitting = true;
    console.log('🛑 Usuário solicitou fechamento do app');
  }
});

/**
 * Unregister shortcuts before quitting
 */
app.once('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Ask for main window reload
// Test message
ipcMain.on('reload', () => {
  win?.reload();
});

// Terminate
ipcMain.on('shutdown', () => {
  console.log('Electron got IPC shutdown');
  appShutdown();
});

/**
 * Força logout quando o servidor indicar que a licença/período expirou.
 * Evento originado do cliente React via window.ipcRenderer.send('auth-license-expired', ...)
 * Ou disparado pela verificação periódica de licenseExpiresAt no token.
 */
ipcMain.on('auth-license-expired', async (_event, payload) => {
  try {
    console.log('🔒 Auth license expired IPC received:', payload);
    if (licenseCheckIntervalId) {
      clearInterval(licenseCheckIntervalId);
      licenseCheckIntervalId = null;
    }
    await handleLicenseExpired(payload);
  } catch (error) {
    console.error(
      '❌ Unexpected error handling auth-license-expired IPC:',
      error instanceof Error ? error.message : String(error)
    );
    appShutdown();
  }
});

/**
 * Handles requests to set window properties
 */
ipcMain.on('set-window', (_event, arg) => {
  if (!win) return;
  switch (arg) {
    case 'show-dev':
      win.webContents.openDevTools({ mode: 'detach' });
      break;
    default:
      console.log('Electron unhandled window request', arg);
  }
});

/**
 * Handles requests to open external links
 */
ipcMain.on('send-to-link', (_event, arg) => {
  try {
    shell.openExternal(arg);
  } catch (_error) {
    /** unhandled error */
  }
});
