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
  // A partir da integração com Supabase, o controle de login passa a ser feito
  // diretamente pelo Electron chamando o endpoint /auth/login.
  // Aqui não bloqueamos mais a inicialização do servidor em ambiente de desenvolvimento.
  // maxAttempts é mantido apenas para compatibilidade de assinatura.
  void maxAttempts;
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
