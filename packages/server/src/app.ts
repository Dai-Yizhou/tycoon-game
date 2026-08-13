/**
 * Express + Socket.IO 应用工厂
 *
 * 工厂函数 `createApp(config)` 返回 `{ app, io }`：
 * - `app` : Express 实例（含健康检查、欢迎页、错误处理）
 * - `io`  : 类型化 Socket.IO Server
 *
 * 设计原则：
 * - 工厂函数不直接启动 HTTP server（便于测试 + 灵活部署）
 * - 启动由 `index.ts` 中的 `startServer` 完成
 * - 鉴权/限流/事件处理器由 SocketManager 与 HandlerRegistry 注入
 */

import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import type { ServerConfig } from '@game/shared';
import { isFeatureEnabled } from '@game/shared';
import { logger } from './utils/logger.js';
import { GameWorld } from './world/GameWorld.js';
import { SocketManager, type TypedServer } from './transport/SocketManager.js';
import { registerHandlers } from './transport/handlers.js';
import { Bank, Mortgage, Taxation, Bankruptcy } from './economy/index.js';
import { ItemEffectsHandler } from './items/index.js';
import { readFileSync } from 'node:fs';
import { parseMapData, parseMapMeta } from '@game/shared';
import { DayNightCycle, DEFAULT_DAY_NIGHT_CONFIG } from './world/DayNightCycle.js';
import { TimeZoneManager } from './world/TimeZoneManager.js';
import { ProsperityManager, DEFAULT_PROSPERITY_CONFIG } from './world/ProsperityManager.js';
import { BehaviorEngine } from './behavior/index.js';
import { EraManager } from './era/index.js';
import { InMemoryPlayerStore, MongoPlayerStore, InMemoryEraStore, type PlayerStore } from './storage/index.js';

/**
 * Socket 管理器配置（不包含 world，由 createApp 注入）
 */
export type SocketManagerConfig = Omit<
  ConstructorParameters<typeof SocketManager>[1],
  'world'
>;

/**
 * 应用依赖（可选注入）
 */
export interface AppDependencies {
  /** GameWorld 实例（默认创建新实例） */
  world?: GameWorld;
  /** SocketManager 配置（不传则不创建 SocketManager；不需提供 world） */
  socketManagerOptions?: SocketManagerConfig;
  /** 客户端静态资源目录（绝对路径），可选 */
  clientDistPath?: string;
}

/**
 * 创建的应用实例
 */
export interface CreatedApp {
  /** Express 应用 */
  app: Application;
  /** Socket.IO Server */
  io: TypedServer;
  /** 关联的 GameWorld */
  world: GameWorld;
  /** 关联的 SocketManager（如果创建了） */
  socketManager?: SocketManager;
  /** HTTP server（已绑定 app 与 io，但未 listen） */
  httpServer: http.Server;
  /** 经济系统实例 */
  economy?: {
    bank: Bank;
    mortgage: Mortgage;
    taxation: Taxation;
    bankruptcy: Bankruptcy;
  };
  /** 道具系统实例 */
  items?: {
    itemEffectsHandler: ItemEffectsHandler;
  };
  /** 昼夜循环实例 */
  dayNightCycle?: DayNightCycle;
  /** 时区管理器实例 */
  timeZoneManager?: TimeZoneManager;
  /** 繁荣度管理器实例 */
  prosperityManager?: ProsperityManager;
  /** 行为执行引擎实例 */
  behaviorEngine?: BehaviorEngine;
  /** 时代管理器实例（FR-19/FR-20） */
  eraManager?: EraManager;
  /** 玩家存储实例（FR-22 账号持久化） */
  playerStore?: PlayerStore;
}

/**
 * 创建 Express + Socket.IO 应用
 *
 * @param config 服务端配置
 * @param deps 可选依赖（用于测试与扩展）
 */
export function createApp(config: ServerConfig, deps: AppDependencies = {}): CreatedApp {
  const app = express();
  const httpServer = http.createServer(app);

  // 基础中间件
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  // 请求日志
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.debug(`${req.method} ${req.path} -> ${res.statusCode}`, {
        ms: Date.now() - start,
      });
    });
    next();
  });

  // GameWorld
  const world = deps.world ?? new GameWorld();

  // 加载地图数据与元数据（供 ProsperityManager、TimeZoneManager 等使用）
  try {
    const mapFilePath = path.resolve(process.cwd(), config.mapPath);
    const mapMetaFilePath = path.resolve(process.cwd(), config.mapMetaPath);
    const rawMap = JSON.parse(readFileSync(mapFilePath, 'utf-8'));
    const rawMeta = JSON.parse(readFileSync(mapMetaFilePath, 'utf-8'));
    const mapData = parseMapData(rawMap);
    const mapMeta = parseMapMeta(rawMeta);
    const result = world.loadMap(mapData, mapMeta);
    if (result.valid) {
      logger.info(`地图加载成功：${mapMeta.id} (${mapMeta.name})，${mapData.length} 个格子`);
    } else {
      logger.warn(`地图加载有校验错误：${result.errors.join('; ')}`);
    }
  } catch (err) {
    logger.warn('地图元数据加载失败，繁荣度/时区系统将不可用', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 健康检查
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      players: world.getPlayerCount(),
      era: world.getCurrentEra()?.id ?? null,
      timestamp: new Date().toISOString(),
    });
  });

  // 根路径
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'monopoly-io-game server',
      version: '0.1.0',
      mapLoaded: world.getMapMeta() !== null,
      currentMapId: world.getMapMeta()?.id ?? null,
      debugFeatures: {
        tutorial: isFeatureEnabled('tutorial'),
        onboarding: isFeatureEnabled('onboarding'),
      },
    });
  });

  // 地图数据 API（含区域配置和数值字段定义）
  app.get('/api/map', (_req: Request, res: Response) => {
    try {
      const mapPath = path.resolve(process.cwd(), config.mapPath);
      const mapMetaPath = path.resolve(process.cwd(), config.mapMetaPath);
      const raw = readFileSync(mapPath, 'utf-8');
      const mapData = parseMapData(JSON.parse(raw));

      // 尝试加载地图元数据（区域、时区、数值字段定义等）
      let regions: unknown[] = [];
      let valueFieldDefinitions: unknown[] = [];
      try {
        const rawMeta = JSON.parse(readFileSync(mapMetaPath, 'utf-8'));
        const mapMeta = parseMapMeta(rawMeta);
        regions = mapMeta.regions;
        valueFieldDefinitions = mapMeta.valueFieldDefinitions;
      } catch {
        // map-meta.json 不存在时使用空数组
      }

      res.json({ mapData, regions, valueFieldDefinitions });
    } catch (err) {
      logger.error('failed to load map', err);
      res.status(500).json({ error: 'Failed to load map data', detail: err instanceof Error ? err.message : String(err) });
    }
  });

  // 静态资源（开发模式挂载 client/dist）
  if (deps.clientDistPath) {
    app.use(express.static(deps.clientDistPath));
    logger.info(`static serving from ${deps.clientDistPath}`);
  }

  // 错误处理中间件（4 参数签名才能被识别为错误处理）
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('unhandled error', err);
    res.status(500).json({ error: 'Internal Server Error' });
  });

  // Socket.IO
  const io: TypedServer = new SocketIOServer<
    never,
    never,
    never,
    never
  >(httpServer, {
    cors: { origin: config.corsOrigin, credentials: true },
    pingTimeout: 30_000,
    pingInterval: 25_000,
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e6, // 1MB
  }) as TypedServer;

  // 创建 SocketManager（如提供配置）
  let socketManager: SocketManager | undefined;
  if (deps.socketManagerOptions) {
    socketManager = new SocketManager(io, {
      ...deps.socketManagerOptions,
      world,
    });
  }

  // 初始化经济系统
  const bank = new Bank(world);
  const mortgage = new Mortgage(io, world);
  const taxation = new Taxation(io, world, bank);
  const bankruptcy = new Bankruptcy(io, world, bank, mortgage, taxation);

  // 启动经济系统定时器
  taxation.startTaxTimer();
  bankruptcy.startBankruptcyCheck();

  logger.info('Economy system initialized (bank, mortgage, taxation, bankruptcy)');

  // 注册业务事件处理器（需要在经济系统初始化后）
  const handlerRegistry = registerHandlers(io, world);

  // 初始化道具系统
  handlerRegistry.setBank(bank);
  handlerRegistry.setBankruptcy(bankruptcy);
  handlerRegistry.setItemHandler(bank);
  const itemEffectsHandler = handlerRegistry.getItemEffectsHandler();

  logger.info('Item system initialized (registry, effects handler)');

  // 初始化昼夜循环（从服务器启动时开始计时）
  const dayNightCycle = new DayNightCycle(
    io,
    world,
    DEFAULT_DAY_NIGHT_CONFIG,
    taxation,
    handlerRegistry.getTransportHandler(),
  );
  dayNightCycle.start();
  logger.info(`DayNightCycle started (cycle=${DEFAULT_DAY_NIGHT_CONFIG.cycleMinutes}min)`);

  // 将 DayNightCycle 注入 SocketManager（供 login handler 同步时间）
  if (socketManager) {
    socketManager.setDayNightCycle(dayNightCycle);
  }

  // 初始化时区管理器（依赖 GameWorld 和 DayNightCycle）
  const timeZoneManager = new TimeZoneManager(world, dayNightCycle);
  logger.info(`TimeZoneManager initialized (${timeZoneManager.getTimezoneCount()} timezones)`);

  // 初始化繁荣度管理器（依赖 TimeZoneManager 和 DayNightCycle，FR-7/FR-12/FR-14）
  const prosperityManager = new ProsperityManager(
    io,
    world,
    timeZoneManager,
    dayNightCycle,
    DEFAULT_PROSPERITY_CONFIG,
  );
  prosperityManager.startUpdateTimer();
  logger.info(`ProsperityManager initialized (${prosperityManager.getRegionCount()} regions)`);

  // 将 ProsperityManager 注入 MonumentHandler（修缮纪念碑时增加区域繁荣度）
  handlerRegistry.setProsperityManager(prosperityManager);

  // 将 TimeZoneManager 注入 MovementHandler（移动时检测时区变化）
  handlerRegistry.setTimeZoneManager(timeZoneManager);

  // 初始化行为执行引擎（FR-1/FR-4）
  const behaviorEngine = new BehaviorEngine(io, world, {
    prosperityManager,
    itemEffectsHandler,
  });
  handlerRegistry.setBehaviorEngine(behaviorEngine);
  logger.info('BehaviorEngine initialized and injected into EventHandler and DebugHandler');

  // 初始化时代管理器（FR-19/FR-20）
  // 时代长度从配置读取（默认 90 天，对应现实 3-6 个月）
  const eraStore = new InMemoryEraStore();
  const eraManager = new EraManager(eraStore, world, io, {
    defaultDuration: config.eraLengthDays * 24 * 60 * 60 * 1000,
  });
  eraManager.initialize().catch((err) => {
    logger.error('EraManager initialize error:', err);
  });
  logger.info(`EraManager initialized (eraLengthDays=${config.eraLengthDays})`);

  // 注册手动触发时代结算事件（管理员调试用）
  const registerSettlementHandler = (socket: Parameters<typeof handlerRegistry.registerForSocket>[0]): void => {
    socket.on('client.triggerSettlement', (payload, ack) => {
      try {
        const currentEra = eraManager.getCurrentEra();
        if (!currentEra) {
          ack?.({ ok: false, error: 'no_active_era' });
          return;
        }

        if (payload?.switchEra && payload.newMapId && payload.newEraName) {
          // 结算并切换到新时代
          eraManager
            .switchToNextEra({
              newMapId: payload.newMapId,
              newEraName: payload.newEraName,
            })
            .then((newEra) => {
              ack?.({ ok: true, data: { settled: true, eraId: newEra.id } });
            })
            .catch((err) => {
              logger.error('triggerSettlement switchEra error:', err);
              ack?.({ ok: false, error: err instanceof Error ? err.message : String(err) });
            });
        } else {
          // 仅结算当前时代
          eraManager
            .performSettlement()
            .then((result) => {
              ack?.({ ok: true, data: { settled: true, eraId: result.era.id } });
            })
            .catch((err) => {
              logger.error('triggerSettlement error:', err);
              ack?.({ ok: false, error: err instanceof Error ? err.message : String(err) });
            });
        }
      } catch (err) {
        logger.error('triggerSettlement handler error:', err);
        ack?.({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  };

  io.on('connection', (socket) => {
    socketManager?.registerConnectionHandlers(socket);
    handlerRegistry.registerForSocket(socket);
    registerSettlementHandler(socket);
  });

  // 初始化玩家存储（FR-22 账号持久化）
  // 配置了 MongoDB 时使用 MongoPlayerStore，否则使用内存版
  const playerStore: PlayerStore = config.mongoUri
    ? new MongoPlayerStore(config.mongoUri)
    : new InMemoryPlayerStore();
  if (socketManager) {
    socketManager.setPlayerStore(playerStore);
  }
  logger.info(`PlayerStore initialized (${config.mongoUri ? 'MongoDB' : 'InMemory'})`);

  return {
    app,
    io,
    world,
    socketManager,
    httpServer,
    economy: { bank, mortgage, taxation, bankruptcy },
    items: { itemEffectsHandler },
    dayNightCycle,
    timeZoneManager,
    prosperityManager,
    behaviorEngine,
    eraManager,
    playerStore,
  };
}

/**
 * 启动 HTTP 服务（监听端口）
 *
 * @param httpServer 已通过 createApp 创建的 HTTP server
 * @param config 服务端配置
 * @returns Promise，在 listening 后 resolve
 */
export function startHttpServer(
  httpServer: http.Server,
  config: ServerConfig,
): Promise<{ port: number; host: string }> {
  return new Promise((resolve) => {
    httpServer.listen(config.port, config.host, () => {
      const addr = httpServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : config.port;
      logger.info(`server listening on http://${config.host}:${port}`, { port });
      resolve({ port, host: config.host });
    });
  });
}

/**
 * 优雅关闭
 *
 * - 关闭 HTTP server（不再接受新连接）
 * - 关闭 Socket.IO（断开所有客户端）
 * - 清理经济系统定时器
 * - 清理道具系统定时器
 * - 停止繁荣度更新定时器
 * - 兜底超时（默认 5s）
 *
 * @param httpServer HTTP server
 * @param socketManager Socket 管理器（可选）
 * @param economy 经济系统实例（可选）
 * @param items 道具系统实例（可选）
 * @param dayNightCycle 昼夜循环实例（可选）
 * @param prosperityManager 繁荣度管理器实例（可选）
 * @param eraManager 时代管理器实例（可选）
 * @param timeoutMs 兜底超时（毫秒）
 */
export async function gracefulShutdown(
  httpServer: http.Server,
  socketManager?: SocketManager,
  economy?: { taxation: Taxation; bankruptcy: Bankruptcy },
  items?: { itemEffectsHandler: ItemEffectsHandler },
  dayNightCycle?: DayNightCycle,
  prosperityManager?: ProsperityManager,
  eraManager?: EraManager,
  timeoutMs: number = 5000,
): Promise<void> {
  logger.info('graceful shutdown started');

  // 关闭时代管理器（清理定时器）
  if (eraManager) {
    try {
      eraManager.close();
      logger.info('EraManager stopped');
    } catch (err) {
      logger.error('error stopping eraManager', err);
    }
  }

  // 停止繁荣度更新定时器
  if (prosperityManager) {
    try {
      prosperityManager.stopUpdateTimer();
      logger.info('ProsperityManager stopped');
    } catch (err) {
      logger.error('error stopping prosperityManager', err);
    }
  }

  // 停止昼夜循环
  if (dayNightCycle) {
    try {
      dayNightCycle.stop();
      logger.info('DayNightCycle stopped');
    } catch (err) {
      logger.error('error stopping dayNightCycle', err);
    }
  }

  // 清理道具系统
  if (items) {
    try {
      items.itemEffectsHandler.cleanup();
      logger.info('Item system cleaned up');
    } catch (err) {
      logger.error('error cleaning up item system', err);
    }
  }

  // 清理经济系统
  if (economy) {
    try {
      economy.taxation.stopTaxTimer();
      economy.bankruptcy.cleanup();
      logger.info('Economy system cleaned up');
    } catch (err) {
      logger.error('error cleaning up economy system', err);
    }
  }

  if (socketManager) {
    try {
      await socketManager.close();
    } catch (err) {
      logger.error('error closing socket manager', err);
    }
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      logger.warn('shutdown timeout reached, forcing exit');
      resolve();
    }, timeoutMs);
    timer.unref();

    httpServer.close(() => {
      clearTimeout(timer);
      logger.info('http server closed');
      resolve();
    });
  });
}

/**
 * 解析静态资源路径（开发模式）
 */
export function resolveClientDistPath(): string | null {
  // 默认在 packages/server/../client/dist
  const candidate = path.resolve(__dirname, '../../client/dist');
  return candidate;
}
