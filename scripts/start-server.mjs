import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let activeChild = null;
let shuttingDown = false;

function stop(signal = 'SIGTERM') {
  shuttingDown = true;
  if (activeChild && !activeChild.killed) activeChild.kill(signal);
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

const build = spawn(npm, ['run', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VB_SINGLE_SERVER: '1' },
  shell: process.platform === 'win32',
});
activeChild = build;
build.on('error', error => {
  console.error('[VineBoom] Could not launch the build command:', error.message);
  process.exitCode = 1;
});
build.on('exit', code => {
  if (shuttingDown) return;
  if (code !== 0) {
    console.error(`[VineBoom] Build failed with exit code ${code}. The server was not started.`);
    process.exitCode = code || 1;
    return;
  }
  console.log('[VineBoom] Starting the single HTTP + WebSocket server…');
  const server = spawn(process.execPath, ['server/server.mjs'], { cwd: root, stdio: 'inherit', env: process.env });
  activeChild = server;
  server.on('error', error => {
    console.error('[VineBoom] Could not launch the game server:', error.message);
    process.exitCode = 1;
  });
  server.on('exit', (serverCode, signal) => {
    if (!shuttingDown) process.exitCode = serverCode ?? (signal ? 1 : 0);
  });
});
