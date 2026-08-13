import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const services = [
  { name: 'server', directory: 'packages/server' },
  { name: 'client', directory: 'packages/client' },
];
const children = new Map();
let shuttingDown = false;

function stopServices(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.values()) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 500);
}

function startService(service) {
  const directory = resolve(rootDir, service.directory);
  if (!existsSync(directory)) return;

  const child = spawn(npmCommand, ['run', 'dev'], {
    cwd: directory,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  children.set(service.name, child);
  child.once('error', () => stopServices(1));
  child.once('exit', (code, signal) => {
    if (!shuttingDown && (code !== 0 || signal)) stopServices(code ?? 1);
  });
}

for (const service of services) startService(service);

if (children.size === 0) {
  console.error('未找到可启动的服务目录');
  process.exit(1);
}

process.once('SIGINT', () => stopServices(0));
process.once('SIGTERM', () => stopServices(0));
