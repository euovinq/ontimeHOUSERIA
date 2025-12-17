/* eslint-disable no-console */
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { consoleHighlight, consoleError } from './utils/console.js';
import { initAssets, startIntegrations, startServer } from './app.js';
import { getAppDataPath } from './setup/index.js';

/**
 * Waits for login lock file to be created by Electron
 * This ensures the server only starts after user login
 */
async function waitForLogin(maxAttempts = 300) {
  const lockFilePath = join(getAppDataPath(), '.login-complete');
  let attempts = 0;

  // In production mode, don't wait (server is started by Electron after login)
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  console.log('\n');
  consoleHighlight('⏳ Aguardando login...');
  console.log('   (A janela de login deve aparecer no Electron)');
  console.log('   O servidor está pausado até que o login seja confirmado.');
  console.log('   As mensagens acima são apenas logs de inicialização de módulos.\n');

  return new Promise<void>((resolve, reject) => {
    const checkLock = () => {
      attempts++;
      
      if (existsSync(lockFilePath)) {
        console.log('✅ Login confirmado, iniciando servidor...\n');
        resolve();
        return;
      }

      if (attempts >= maxAttempts) {
        consoleError('❌ Timeout: Login não foi confirmado após 5 minutos');
        consoleError('   O servidor iniciará normalmente, mas isso não deveria acontecer.');
        consoleError('   Certifique-se de que o Electron está rodando e faça login.\n');
        // Em caso de timeout, continua mesmo assim (para não travar em desenvolvimento)
        resolve();
        return;
      }

      // Check every second
      setTimeout(checkLock, 1000);
    };

    checkLock();
  });
}

async function startHouseriaAPP() {
  try {
    // Wait for login before starting
    await waitForLogin();

    // Clean up lock file after login is confirmed
    const lockFilePath = join(getAppDataPath(), '.login-complete');
    try {
      if (existsSync(lockFilePath)) {
        unlinkSync(lockFilePath);
      }
    } catch (error) {
      // Ignore cleanup errors
    }

    console.log('\n');
    consoleHighlight('Request: Initialise assets...');
    await initAssets();

    console.log('\n');
    consoleHighlight('Request: Start server...');
    await startServer();

    console.log('\n');
    consoleHighlight('Request: Start integrations...');
    await startIntegrations();
  } catch (error) {
    consoleError(`Request failed: ${error}`);
  }
}

startHouseriaAPP();
