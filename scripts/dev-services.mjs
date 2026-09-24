import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// 开发环境一律接 MongoDB：不再回退文件存储。
// 未显式设置 MONGO_URI 时使用本地默认库；本地未运行则自动拉起一个 mongod。
const explicitMongoUri = process.env.MONGO_URI?.trim() ?? '';
const mongoUri = explicitMongoUri || 'mongodb://127.0.0.1:27017/monopoly_io';
const mongoDataDir = resolve(rootDir, '.mongo-data');

const services = [
  { name: 'server', directory: 'packages/server' },
  { name: 'client', directory: 'packages/client' },
];
const children = new Map();
let mongoProcess = null;
let shuttingDown = false;

/** 从 Mongo 连接串解析出 host/port（用于连通性探测，跳过认证信息） */
function parseMongoTarget(uri) {
  const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//, '');
  const hostPart = withoutScheme.split('/')[0].split('?')[0];
  const hostPort = hostPart.includes('@') ? hostPart.split('@').pop() : hostPart;
  const [host, port] = hostPort.split(':');
  return { host: host || '127.0.0.1', port: Number(port) || 27017 };
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 探测 Mongo 端口是否可连接 */
function isMongoReachable({ host, port }, timeoutMs = 1000) {
  return new Promise((done) => {
    const socket = net.createConnection({ host, port });
    const finish = (ok) => {
      socket.destroy();
      done(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * 启动前确保 MongoDB 可用。
 *
 * - 已在运行：直接使用。
 * - 未运行且用户指定了 MONGO_URI：视为外部依赖，连不上即失败退出（不静默降级）。
 * - 未运行且未指定 MONGO_URI：自动拉起本地 mongod（数据落在仓库 .mongo-data/）。
 */
async function ensureMongo() {
  const target = parseMongoTarget(mongoUri);

  if (await isMongoReachable(target)) {
    console.log(`[dev] MongoDB 已就绪（${target.host}:${target.port}）`);
    return;
  }

  if (explicitMongoUri) {
    console.error(`[dev] 无法连接 MONGO_URI 指定的 MongoDB：${mongoUri}`);
    process.exit(1);
  }

  mkdirSync(mongoDataDir, { recursive: true });
  console.log('[dev] 未检测到本地 MongoDB，正在启动 mongod...');

  mongoProcess = spawn(
    'mongod',
    [
      '--dbpath', mongoDataDir,
      '--bind_ip', target.host,
      '--port', String(target.port),
      '--logpath', resolve(mongoDataDir, 'mongod.log'),
    ],
    { stdio: 'ignore' },
  );

  let spawnFailed = false;
  mongoProcess.once('error', (err) => {
    spawnFailed = true;
    console.error(`[dev] 启动 mongod 失败：${err.message}`);
    console.error('[dev] 请先安装/启动 MongoDB，或通过 MONGO_URI 指向可用的实例。');
  });

  for (let i = 0; i < 60; i++) {
    if (spawnFailed) process.exit(1);
    if (await isMongoReachable(target)) {
      console.log(`[dev] MongoDB 已启动（${target.host}:${target.port}，数据目录 .mongo-data/）`);
      return;
    }
    await delay(500);
  }

  console.error('[dev] 等待 MongoDB 就绪超时，请检查 .mongo-data/mongod.log');
  process.exit(1);
}

function stopServices(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.values()) {
    if (!child.killed) child.kill('SIGTERM');
  }
  // 仅回收由本脚本拉起的 mongod；外部已在运行的实例保持不动
  if (mongoProcess && !mongoProcess.killed) mongoProcess.kill('SIGTERM');
  setTimeout(() => process.exit(exitCode), 500);
}

function startService(service) {
  const directory = resolve(rootDir, service.directory);
  if (!existsSync(directory)) return;

  const child = spawn(npmCommand, ['run', 'dev'], {
    cwd: directory,
    // 显式注入 MONGO_URI，保证 server 走 Mongo 存储（config.mongoUri 非空即启用）
    env: { ...process.env, MONGO_URI: mongoUri },
    stdio: 'inherit',
    shell: false,
  });
  children.set(service.name, child);
  child.once('error', () => stopServices(1));
  child.once('exit', (code, signal) => {
    if (!shuttingDown && (code !== 0 || signal)) stopServices(code ?? 1);
  });
}

await ensureMongo();

for (const service of services) startService(service);

if (children.size === 0) {
  console.error('未找到可启动的服务目录');
  stopServices(1);
}

process.once('SIGINT', () => stopServices(0));
process.once('SIGTERM', () => stopServices(0));