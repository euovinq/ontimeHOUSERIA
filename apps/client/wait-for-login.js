#!/usr/bin/env node
/**
 * Script wrapper que espera pelo login antes de iniciar o Vite
 * Isso garante que o servidor de desenvolvimento só inicie após o login
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Retorna o caminho do AppDataPath dependendo do OS
 */
function getAppDataPath() {
  if (process.env.ONTIME_DATA) {
    return join(process.env.ONTIME_DATA);
  }

  switch (process.platform) {
    case 'darwin': {
      return join(process.env.HOME, 'Library', 'Application Support', 'Ontime');
    }
    case 'win32': {
      return join(process.env.APPDATA, 'Ontime');
    }
    case 'linux': {
      return join(process.env.HOME, '.Ontime');
    }
    default: {
      throw new Error('Could not resolve public folder for platform');
    }
  }
}

/**
 * Espera pelo arquivo de lock do login
 */
async function waitForLogin(maxAttempts = 300) {
  const lockFilePath = join(getAppDataPath(), '.login-complete');
  let attempts = 0;

  // Em produção, não espera (o servidor é iniciado pelo Electron após o login)
  if (process.env.NODE_ENV === 'production') {
    return Promise.resolve();
  }

  console.log('\n');
  console.log('⏳ Aguardando login antes de iniciar o Vite...');
  console.log('   (A janela de login deve aparecer no Electron)');
  console.log('   O servidor de desenvolvimento está pausado até que o login seja confirmado.\n');

  return new Promise((resolve) => {
    const checkLock = () => {
      attempts++;

      if (existsSync(lockFilePath)) {
        // Evita reaproveitar lock antigo de sessões anteriores
        let isFresh = false;
        try {
          const raw = readFileSync(lockFilePath, 'utf8');
          const data = JSON.parse(raw);
          const ts = typeof data?.timestamp === 'number' ? data.timestamp : null;

          if (ts) {
            const ageMs = Date.now() - ts;
            // Considera válido apenas se o lock tiver menos de 5 minutos
            if (ageMs >= 0 && ageMs <= 5 * 60 * 1000) {
              isFresh = true;
            }
          }
        } catch {
          // Se der erro ao ler/parsear, tratamos como lock inválido
        }

        if (!isFresh) {
          // Lock antigo/inválido → remove e continua esperando
          try {
            unlinkSync(lockFilePath);
          } catch {
            // ignore
          }
        } else {
          console.log('✅ Login confirmado, iniciando Vite...\n');
          resolve();
          return;
        }
      }

      if (attempts >= maxAttempts) {
        console.log('⚠️  Timeout: Login não foi confirmado após 5 minutos');
        console.log('   Iniciando Vite mesmo assim (modo desenvolvimento)...\n');
        resolve();
        return;
      }

      // Verifica a cada segundo
      setTimeout(checkLock, 1000);
    };

    checkLock();
  });
}

/**
 * Inicia o Vite após o login
 */
async function startVite() {
  await waitForLogin();

  // Inicia o Vite com os argumentos passados
  // Usa npx para garantir que o vite está disponível
  const viteArgs = process.argv.slice(2);
  const viteProcess = spawn('npx', ['vite', ...viteArgs], {
    stdio: 'inherit',
    shell: true,
  });

  viteProcess.on('error', (error) => {
    console.error('Erro ao iniciar Vite:', error);
    process.exit(1);
  });

  viteProcess.on('exit', (code) => {
    process.exit(code || 0);
  });
}

startVite();

