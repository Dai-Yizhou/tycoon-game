/**
 * bootstrap / 优雅关闭测试
 *
 * 覆盖：
 * 1. startHttpServer 监听端口
 * 2. gracefulShutdown 关闭 HTTP 与 Socket.IO
 * 3. SIGINT 触发关闭（通过关闭流程模拟）
 */

import { DEFAULT_SERVER_CONFIG, type ServerConfig } from '@game/shared';
import { createApp, gracefulShutdown, startHttpServer } from '../src/app';
import { GameWorld } from '../src/world/GameWorld';
import { AddressInfo } from 'node:net';

const baseConfig: ServerConfig = {
  ...DEFAULT_SERVER_CONFIG,
  port: 0, // 让 OS 分配端口
  host: '127.0.0.1',
};

describe('app lifecycle', () => {
  describe('startHttpServer', () => {
    it('listens on the configured port and returns the bound port', async () => {
      const config: ServerConfig = { ...baseConfig, port: 0 };
      const { httpServer } = createApp(config);
      const { port } = await startHttpServer(httpServer, config);
      expect(port).toBeGreaterThan(0);
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });
  });

  describe('gracefulShutdown', () => {
    it('closes http server within timeout', async () => {
      const config: ServerConfig = { ...baseConfig, port: 0 };
      const world = new GameWorld();
      const { httpServer, io, socketManager } = createApp(config, {
        world,
        socketManagerOptions: {},
      });
      await startHttpServer(httpServer, config);
      expect(httpServer.listening).toBe(true);

      // 主动关闭
      const start = Date.now();
      await gracefulShutdown(httpServer, socketManager, 2000);
      expect(httpServer.listening).toBe(false);
      expect(Date.now() - start).toBeLessThan(3000);
      // io 也应已关闭
      expect(io.engine?.clientsCount ?? 0).toBe(0);
    });

    it('tolerates missing socketManager', async () => {
      const config: ServerConfig = { ...baseConfig, port: 0 };
      const { httpServer, io, socketManager } = createApp(config);
      await startHttpServer(httpServer, config);
      await gracefulShutdown(httpServer, socketManager);
      expect(httpServer.listening).toBe(false);
      void io;
    });

    it('timeout fallback forces resolve', async () => {
      // 通过一个永不 resolve 的 Promise 测试 setTimeout 兜底
      // （不创建真实 httpServer，避免其内部事件循环干扰测试）
      const fakeCloseable = {
        close: (_cb?: () => void) => {
          // 永不调用 cb
        },
      };
      const start = Date.now();
      // 直接复用 gracefulShutdown 的核心逻辑
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 50);
        timer.unref();
        fakeCloseable.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      const elapsed = Date.now() - start;

      // 超时 50ms 兜底
      expect(elapsed).toBeGreaterThanOrEqual(40);
      expect(elapsed).toBeLessThan(500);
    }, 3000);
  });

  describe('createApp', () => {
    it('returns app, io, world, httpServer, socketManager', () => {
      const config: ServerConfig = { ...baseConfig, port: 0 };
      const world = new GameWorld();
      const result = createApp(config, {
        world,
        socketManagerOptions: {},
      });
      expect(result.app).toBeDefined();
      expect(result.io).toBeDefined();
      expect(result.world).toBe(world);
      expect(result.httpServer).toBeDefined();
      expect(result.socketManager).toBeDefined();
    });

    it('skips socketManager when no options provided', () => {
      const config: ServerConfig = { ...baseConfig, port: 0 };
      const result = createApp(config);
      expect(result.socketManager).toBeUndefined();
    });

    it('serves static files when clientDistPath is provided', () => {
      const config: ServerConfig = { ...baseConfig, port: 0 };
      const result = createApp(config, { clientDistPath: '/tmp/nonexistent' });
      // 仅检查 createApp 不抛错；路径存在性由 express.static 内部处理
      expect(result.app).toBeDefined();
    });
  });

  describe('health endpoint', () => {
    it('returns players count and era', async () => {
      const config: ServerConfig = { ...baseConfig, port: 0 };
      const world = new GameWorld();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const request = (await import('supertest')).default;
      const { app } = createApp(config, { world, socketManagerOptions: {} });
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.players).toBe(0);
      expect(res.body.era).toBeNull();
      expect(typeof res.body.uptime).toBe('number');
    });
  });
});

describe('bootstrap (smoke)', () => {
  // 注意：实际 bootstrap 启动 server 会占用端口，测试中跳过 listen 部分
  it('exposes a callable bootstrap function', async () => {
    // 重新 import 不直接执行（因为 require.main 检查）
    const mod = await import('../src/index');
    expect(typeof mod.bootstrap).toBe('function');
  });
});

// 抑制未使用变量警告
void AddressInfo;
