/**
 * 大富翁.io 服务端入口
 *
 * 启动流程：
 * 1. 加载配置（环境变量）
 * 2. 同步 logger 与配置
 * 3. 创建 GameWorld
 * 4. 创建 SocketManager
 * 5. 启动 HTTP server
 * 6. 注册 SIGINT/SIGTERM 优雅关闭
 *
 * 如需开发模式下挂载 client/dist，可通过环境变量 `SERVE_CLIENT=1` 启用。
 */

import type { ServerConfig } from '@game/shared';
import { loadConfig } from './config.js';
import { logger } from './utils/logger.js';
import { createApp, gracefulShutdown, startHttpServer } from './app.js';

/**
 * 启动服务端
 */
export async function bootstrap(config: ServerConfig = loadConfig()): Promise<void> {
  // 同步 logger 与配置
  logger.setMinLevel(config.debug ? 'debug' : 'info');
  logger.setDebug(config.debug);

  logger.info('starting monopoly-io-game server', {
    port: config.port,
    host: config.host,
    mapPath: config.mapPath,
    maxPlayers: config.maxPlayers,
    debug: config.debug,
  });

  // 解析 client/dist 路径（开发模式）
  let clientDistPath: string | undefined;
  if (process.env.SERVE_CLIENT === '1') {
    const path = await import('node:path');
    const fs = await import('node:fs');
    const candidate = path.resolve(__dirname, '../../client/dist');
    if (fs.existsSync(candidate)) {
      clientDistPath = candidate;
    } else {
      logger.warn(`client/dist not found at ${candidate}, skipping static serving`);
    }
  }

  // 创建应用
  const { httpServer, socketManager, economy, dayNightCycle, prosperityManager, eraManager, world } = createApp(config, {
    socketManagerOptions: {},
    clientDistPath,
  });

  // 启动 HTTP 服务
  try {
    await startHttpServer(httpServer, config);
  } catch (err) {
    logger.error('failed to start http server', err);
    process.exit(1);
  }

  // 注册信号处理
  const shutdown = (signal: string) => {
    logger.info(`received ${signal}`);
        gracefulShutdown(httpServer, socketManager, economy, dayNightCycle, prosperityManager, eraManager, 5000, world)
      .then(() => {
        process.exit(0);
      })
      .catch((err) => {
        logger.error('shutdown error', err);
        process.exit(1);
      });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// 当作为主入口运行时执行
if (require.main === module) {
  bootstrap().catch((err) => {
    logger.error('bootstrap failed', err);
    process.exit(1);
  });
}
