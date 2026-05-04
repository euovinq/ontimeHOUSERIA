const { spawnSync } = require('child_process');
const path = require('path');

if (process.platform === 'win32') {
  // Kill any leftover processes holding dev ports so Vite gets port 3000
  spawnSync('powershell.exe', [
    '-Command',
    'foreach ($port in @(3000,4001)) { $ids = (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue).OwningProcess; if ($ids) { Stop-Process -Id $ids -Force -ErrorAction SilentlyContinue } }',
  ], { stdio: 'ignore' });

  const turbo = path.join(__dirname, '..', 'node_modules', '.bin', 'turbo.cmd');
  // chcp 65001 forces UTF-8 so turbo doesn't crash on Portuguese accented chars (ã, ç, etc.)
  spawnSync('cmd.exe', ['/c', `chcp 65001 >nul 2>&1 && ${turbo} run dev`], {
    stdio: 'inherit',
    env: process.env,
  });
} else {
  spawnSync('turbo', ['run', 'dev'], {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
}
