/**
 * Express + Socket.IO 应用工厂
 *
 * 工厂函数 `createApp(config)` 返回 `{ app, io }`：
 * - `app` : Express 实例（含健康检查、欢迎页、错误处理）
 * - `io`  : 类型化 Socket.IO Server
 *
 * 设计原则：
 * - 工厂函数不直接启动 HTTP server（便于测试 + 灵活部署）
 * - 启动由 `index.ts` 中的 `bootstrap` 完成
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
import { HandlerRegistry, registerHandlers } from './transport/handlers.js';
import { EconomyService, Taxation, Bankruptcy, resolveOwnershipConfig, type TaxConfig, type OwnershipConfig } from './economy/index.js';
import { existsSync, readFileSync } from 'node:fs';
import { parseMapData, parseMapMeta } from '@game/shared';
import { DayNightCycle, DEFAULT_DAY_NIGHT_CONFIG } from './world/DayNightCycle.js';
import { TimeZoneManager } from './world/TimeZoneManager.js';
import { ProsperityManager, DEFAULT_PROSPERITY_CONFIG } from './world/ProsperityManager.js';
import { BehaviorEngine } from './behavior/index.js';
import { InMemoryPlayerStore, MongoPlayerStore, MongoUserStore, InMemoryWorldStore, FileWorldStore, type PlayerStore, type WorldStore } from './storage/index.js';
import { JWTService } from './auth/JWTService.js';
import { AuthService, type UserStore } from './auth/AuthService.js';
import { InMemoryUserStore } from './auth/InMemoryUserStore.js';
import { createAuthRouter } from './auth/authRoutes.js';

/**
 * Socket 管理器配置（不包含 world，由 createApp 注入）
 */
export type SocketManagerConfig = Omit<
  ConstructorParameters<typeof SocketManager>[1],
  'world'
>;

function resolveConfiguredPath(configuredPath: string): string {
  if (path.isAbsolute(configuredPath)) return configuredPath;
  const candidates = [
    path.resolve(process.cwd(), configuredPath),
    path.resolve(__dirname, '..', configuredPath),
    path.resolve(__dirname, '../..', 'server', configuredPath),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

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
  worldStore?: WorldStore;
  handlerRegistry?: HandlerRegistry;
  userStore?: UserStore;
  authService?: AuthService;
}

function readTaxConfig(mapMeta: ReturnType<typeof parseMapMeta>): TaxConfig {
  const raw = mapMeta.config?.taxConfig;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`地图 ${mapMeta.id} 缺少完整 config.taxConfig`);
  }

  const config = raw as Record<string, unknown>;
  const fields: Array<keyof TaxConfig> = [
    'wealthTaxRate',
    'propertyTaxRate',
    'investmentTaxRate',
    'minWealthForTax',
    'minPropertyValueForTax',
    'taxInterval',
  ];
  for (const field of fields) {
    const value = config[field];
    const invalidRate = field.endsWith('Rate') && (value as number) > 1;
    const invalidInterval = field === 'taxInterval' && (value as number) <= 0;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || invalidRate || invalidInterval) {
      throw new Error(`地图 ${mapMeta.id} 的 config.taxConfig.${field} 非法`);
    }
  }

  return config as unknown as TaxConfig;
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
    taxation: Taxation;
    bankruptcy: Bankruptcy;
  };
  /** 昼夜循环实例 */
  dayNightCycle?: DayNightCycle;
  /** 时区管理器实例 */
  timeZoneManager?: TimeZoneManager;
  /** 繁荣度管理器实例 */
  prosperityManager?: ProsperityManager;
  /** 行为执行引擎实例 */
  behaviorEngine?: BehaviorEngine;
  /** 玩家存储实例（FR-22 账号持久化） */
  playerStore?: PlayerStore;
  /** 用户存储实例 */
  userStore?: UserStore;
  worldStore?: WorldStore;
  handlerRegistry?: HandlerRegistry;
}

/**
 * 创建 Express + Socket.IO 应用
 *
 * @param config 服务端配置
 * @param deps 可选依赖（用于测试与扩展）
 */
export function createApp(config: ServerConfig, deps: AppDependencies = {}): CreatedApp {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET?.trim()) {
    throw new Error('JWT_SECRET is required in production');
  }
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
  const authJwt = deps.socketManagerOptions?.jwtService ?? (process.env.JWT_SECRET?.trim()
    ? new JWTService()
    : new JWTService({ secret: 'development-only-secret', expiresIn: 7 * 24 * 60 * 60 }));
  const userStore = deps.userStore ?? (config.mongoUri ? new MongoUserStore(config.mongoUri) : new InMemoryUserStore());
  const authService = deps.authService ?? new AuthService(userStore, authJwt);
  app.use('/api/auth', createAuthRouter(authService));

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
  const worldStore = deps.worldStore ?? (config.mongoUri ? new FileWorldStore(path.resolve(process.cwd(), 'data/world.json')) : new InMemoryWorldStore());
  const world = deps.world ?? new GameWorld({ worldStore });

  // 加载地图数据与元数据（供 ProsperityManager、TimeZoneManager 等使用）
  try {
    const mapFilePath = resolveConfiguredPath(config.mapPath);
    const mapMetaFilePath = resolveConfiguredPath(config.mapMetaPath);
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
      const mapPath = resolveConfiguredPath(config.mapPath);
      const mapMetaPath = resolveConfiguredPath(config.mapMetaPath);
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

  const restoredSnapshot = world.restoreSnapshot();

  // 初始化经济系统
  const mapMeta = world.getMapMeta();
  if (!mapMeta) {
    throw new Error('无法启动经济系统：地图元数据未加载');
  }
  const ownershipConfig: OwnershipConfig = resolveOwnershipConfig(mapMeta.config?.ownership);
  const economy = new EconomyService(world);
  const taxation = new Taxation(io, world, readTaxConfig(mapMeta), economy);
  const bankruptcy = new Bankruptcy(io, world, taxation);

  // 启动经济系统定时器
  taxation.startTaxTimer();

  logger.info('Economy system initialized (taxation, bankruptcy)');

  // 注册业务事件处理器（需要在经济系统初始化后）
  const handlerRegistry = registerHandlers(io, world, ownershipConfig, config.jailCooldownMs, economy);
  if (restoredSnapshot) taxation.restoreTaxRecords(restoredSnapshot.taxRecords);
  handlerRegistry.getJailHandler().restoreJailStates(restoredSnapshot?.jailStates);
  world.setSnapshotStateProvider(() => ({
    taxRecords: taxation.getAllTaxRecords(),
    jailStates: handlerRegistry.getJailHandler().getJailStates(),
  }));

  handlerRegistry.setBankruptcy(bankruptcy);

  let socketManager: SocketManager | undefined;
  if (deps.socketManagerOptions) {
    socketManager = new SocketManager(io, {
      ...deps.socketManagerOptions,
      world,
      jwtService: deps.socketManagerOptions.jwtService ?? authJwt,
      teamManager: handlerRegistry.getTeamManager(),
    });
  }

  // 初始化昼夜循环（从服务器启动时开始计时）
  const dayNightCycle = new DayNightCycle(
    io,
    DEFAULT_DAY_NIGHT_CONFIG,
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
    economy,
  });
  handlerRegistry.setBehaviorEngine(behaviorEngine);
  logger.info('BehaviorEngine initialized and injected into EventHandler');

  io.on('connection', (socket) => {
    socketManager?.registerConnectionHandlers(socket);
    handlerRegistry.registerForSocket(socket);
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
    economy: { taxation, bankruptcy },
    dayNightCycle,
    timeZoneManager,
    prosperityManager,
    behaviorEngine,
    playerStore,
    worldStore,
    handlerRegistry,
    userStore,
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
 * - 停止繁荣度更新定时器
 * - 兜底超时（默认 5s）
 *
 * @param httpServer HTTP server
 * @param socketManager Socket 管理器（可选）
 * @param economy 经济系统实例（可选）
 * @param dayNightCycle 昼夜循环实例（可选）
 * @param prosperityManager 繁荣度管理器实例（可选）
 * @param eraManager 时代管理器实例（可选）
 * @param timeoutMs 兜底超时（毫秒）
 */
export async function gracefulShutdown(
  httpServer: http.Server,
  socketManager?: SocketManager,
  economy?: { taxation: Taxation; bankruptcy: Bankruptcy },
  dayNightCycle?: DayNightCycle,
  prosperityManager?: ProsperityManager,
  timeoutMs: number = 5000,
  world?: GameWorld,
  handlerRegistry?: HandlerRegistry,
  userStore?: { close?: () => Promise<void> },
  playerStore?: PlayerStore,
): Promise<void> {
  logger.info('graceful shutdown started');
  if (world) world.saveSnapshot(economy?.taxation.getAllTaxRecords(), undefined);

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

  handlerRegistry?.cleanup();

  if (socketManager) {
    try {
      await socketManager.close();
    } catch (err) {
      logger.error('error closing socket manager', err);
    }
  }

  if (userStore?.close) {
    try {
      await userStore.close();
    } catch (err) {
      logger.error('error closing user store', err);
    }
  }

  if (playerStore?.close) {
    try {
      await playerStore.close();
    } catch (err) {
      logger.error('error closing player store', err);
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
