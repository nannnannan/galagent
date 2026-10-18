import { spawn } from 'node:child_process';
const build = spawn(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
build.on('exit', code => {
  if (code) process.exit(code);
  const electron = spawn(process.platform === 'win32' ? 'node_modules/electron/dist/electron.exe' : 'node_modules/.bin/electron', ['.'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  electron.on('exit', status => process.exit(status ?? 0));
});
