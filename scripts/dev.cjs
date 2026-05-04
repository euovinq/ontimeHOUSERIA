const { spawn, spawnSync } = require('child_process');

// Force UTF-8 on this process's own stdio (so any log we emit ourselves doesn't crash either).
if (process.platform === 'win32') {
  for (const stream of [process.stdout, process.stderr]) {
    try {
      if (typeof stream.setDefaultEncoding === 'function') {
        stream.setDefaultEncoding('utf8');
      }
      const origWrite = stream.write.bind(stream);
      stream.write = (chunk, encoding, cb) => {
        try {
          let payload = chunk;
          if (Buffer.isBuffer(payload)) payload = payload.toString('utf8');
          if (typeof payload === 'string') {
            payload = Buffer.from(payload, 'utf8').toString('utf8');
          }
          return origWrite(payload, 'utf8', cb);
        } catch {
          if (typeof cb === 'function') cb();
          return true;
        }
      };
    } catch {
      // ignore
    }
  }
}

// Pass UTF-8 hints down to every child process so Node, Python, and tools like turbo
// emit UTF-8 by default regardless of the host shell's code page.
const utf8Env = {
  ...process.env,
  LANG: process.env.LANG || 'en_US.UTF-8',
  LC_ALL: process.env.LC_ALL || 'en_US.UTF-8',
  PYTHONIOENCODING: 'utf-8',
};

if (process.platform === 'win32') {
  // Free dev ports if anything was left over (avoids 3000/4001 collisions).
  spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      'foreach ($port in @(3000,4001)) { $ids = (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue).OwningProcess; if ($ids) { Stop-Process -Id $ids -Force -ErrorAction SilentlyContinue } }',
    ],
    { stdio: 'ignore' }
  );

  // Use shell:true so cmd.exe handles the chained `chcp && pnpm exec turbo` correctly.
  // `chcp 65001` puts the console in UTF-8 BEFORE turbo (and any child) starts writing,
  // so libuv won't crash on accented chars (ã, ç, ñ) or emojis in console.log calls.
  const child = spawn('chcp 65001 >nul 2>&1 && pnpm exec turbo run dev', {
    stdio: 'inherit',
    env: utf8Env,
    shell: true,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => {
    console.error('Failed to start dev:', err);
    process.exit(1);
  });
} else {
  const child = spawn('turbo', ['run', 'dev'], {
    stdio: 'inherit',
    shell: true,
    env: utf8Env,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}
