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
import { DayNightValueChange } from './world/DayNightValueChange.js';
import { BehaviorEngine } from './behavior/index.js';
import { MongoUserStore, FileWorldStore, MongoWorldStore, type WorldStore } from './storage/index.js';
import { JWTService } from './auth/JWTService.js';
import { AuthService, type UserStore } from './auth/AuthService.js';
import { FileUserStore } from './auth/FileUserStore.js';
import { createAuthRouter } from './auth/authRoutes.js';
import { LeaderboardManager } from './ranking/index.js';
import { AchievementManager, FileAchievementStore, loadAchievementDefinitions, MongoAchievementStore, type AchievementStore } from './achievement/index.js';

/**
 * Socket 管理器配置（不包含 world，由 createApp 注入）
 */
export type SocketManagerConfig = Omit<
  ConstructorParameters<typeof SocketManager>[1],
  'world'
>;

function isGuestPlayer(username: string): boolean {
  return username.startsWith('guest_');
}

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
  achievementStore?: AchievementStore;
  handlerRegistry?: HandlerRegistry;
  userStore?: UserStore;
  authService?: AuthService;
}

function readTaxConfig(mapMeta: ReturnType<typeof parseMapMeta>): TaxConfig {
  return {
    baseTax: {
      rates: mapMeta.tax.baseTax.rates,
      exemptBelow: mapMeta.tax.baseTax.exemptBelow,
      taxInterval: mapMeta.tax.baseTax.taxInterval,
    },
    shareTax: {
      rates: mapMeta.tax.shareTax.rates,
      exemptBelow: mapMeta.tax.shareTax.exemptBelow,
      taxInterval: mapMeta.tax.shareTax.taxInterval,
    },
  };
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
  /** 昼夜 UCT 数值变化服务实例 */
  dayNightValueChange?: DayNightValueChange;
  /** 行为执行引擎实例 */
  behaviorEngine?: BehaviorEngine;
  /** 用户存储实例 */
  userStore?: UserStore;
  worldStore?: WorldStore;
  achievementStore?: AchievementStore;
  leaderboardManager?: LeaderboardManager;
  handlerRegistry?: HandlerRegistry;
}

/**
 * 创建 Express + Socket.IO 应用
 *
 * @param config 服务端配置
 * @param deps 可选依赖（用于测试与扩展）
 */
export async function createApp(config: ServerConfig, deps: AppDependencies = {}): Promise<CreatedApp> {
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
  const userStore = deps.userStore ?? (config.mongoUri
    ? new MongoUserStore(config.mongoUri)
    : new FileUserStore(resolveConfiguredPath(config.userDataPath)));
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
  const worldId = config.worldId ?? `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const temporaryWorld = config.worldId === null;
  const worldExpiry = temporaryWorld ? Date.now() + config.worldSnapshotTtlMs : undefined;
  const worldStore = deps.worldStore ?? (config.mongoUri
    ? new MongoWorldStore(config.mongoUri, { worldId, namespace: config.worldNamespace, temporary: temporaryWorld, expiresAt: worldExpiry })
    : new FileWorldStore(resolveConfiguredPath(`${config.worldDataPath}.${worldId}`)));
  if (worldStore instanceof MongoWorldStore) {
    await worldStore.ready;
  }
  if (config.mongoUri && !deps.userStore && userStore instanceof MongoUserStore) {
    await userStore.loadUserById('__connection_probe__');
  }
  const world = deps.world ?? new GameWorld({
    worldStore,
    worldIdentity: { worldId, namespace: config.worldNamespace, temporary: temporaryWorld, expiresAt: worldExpiry },
  });

  // 加载地图数据与元数据（供 GameWorld、TimeZoneManager 等使用）
  try {
    const mapFilePath = resolveConfiguredPath(config.mapPath);
    const mapMetaFilePath = resolveConfiguredPath(config.mapMetaPath);
    const rawMap = JSON.parse(readFileSync(mapFilePath, 'utf-8'));
    const rawMeta = JSON.parse(readFileSync(mapMetaFilePath, 'utf-8'));
    const mapData = parseMapData(rawMap);
    const mapMeta = parseMapMeta(rawMeta);
    const result = world.loadMap(mapData, mapMeta);
    if (result.valid) {
      logger.info('地图加载成功', { mapId: mapMeta.id, mapName: mapMeta.name, cellCount: mapData.length });
    } else {
      logger.warn(`地图加载有校验错误：${result.errors.join('; ')}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('server startup failed: map loading error', { error: message });
    throw new Error(`server startup failed: map loading error: ${message}`);
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
  const ownershipConfig: OwnershipConfig = resolveOwnershipConfig(undefined);
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
  bankruptcy.setOwnershipChangedHandler((playerId, guest) => handlerRegistry.refreshOwnedCells(playerId, guest));
  bankruptcy.setDomainEventDispatcher((eventName) => {
    handlerRegistry.getInvestmentHandler().dispatchDomainEvent(eventName);
  });

  let socketManager: SocketManager | undefined;
  const achievementStore = deps.achievementStore ?? (config.mongoUri
    ? new MongoAchievementStore(config.mongoUri)
    : new FileAchievementStore(resolveConfiguredPath(config.userDataPath + '.achievements')));
  if (achievementStore instanceof MongoAchievementStore) {
    await achievementStore.connect();
  }
  const achievementDefinitions = loadAchievementDefinitions(resolveConfiguredPath(config.achievementConfigPath));
  const achievementManager = new AchievementManager(
    achievementDefinitions,
    achievementStore,
    (payload) => socketManager?.emitToPlayer(payload.playerId, 'server.achievementUnlocked', payload),
  );
  handlerRegistry.setAchievementManager(achievementManager, (playerId, guest) => ({ accountId: playerId, guest }));
  economy.setPlayerValueChangedHandler((player) => {
    const currentPlayer = world.getPlayer(player.id);
    if (!currentPlayer) return;
    void achievementManager.recordUct({ accountId: currentPlayer.id, guest: isGuestPlayer(currentPlayer.username) }, mapMeta.id, currentPlayer).catch((error) => logger.error('achievement UCT update failed', error));
  });
  const leaderboardManager = new LeaderboardManager({
    worldId: world.getWorldIdentity()?.worldId ?? mapMeta.id,
    mapMeta,
    getPlayers: () => world.getAllPlayers(),
    getRegionId: (cellId) => world.getRegionId(cellId),
    getRegionValue: (regionId, fieldId) => world.getRegionValue(regionId, fieldId),
    broadcast: (snapshot) => {
      if (socketManager) {
        socketManager.broadcastLeaderboard(snapshot);
      }
    },
  });
  if (deps.socketManagerOptions) {
    socketManager = new SocketManager(io, {
      ...deps.socketManagerOptions,
      world,
      jwtService: deps.socketManagerOptions.jwtService ?? authJwt,
      teamManager: handlerRegistry.getTeamManager(),
      leaderboardManager,
      achievementManager,
      achievementOwner: (playerId, guest) => ({ accountId: playerId, guest }),
    });
  }
  world.on('playerAdded', () => leaderboardManager.markDirty());
  world.on('playerRemoved', () => leaderboardManager.markDirty());
  world.on('playerUpdated', () => leaderboardManager.markDirty());
  world.on('playerPositionChanged', () => leaderboardManager.markDirty());
  world.on('playerStatusChanged', () => leaderboardManager.markDirty());
  world.on('regionValueChanged', () => leaderboardManager.markDirty());
  leaderboardManager.subscribe((snapshot) => {
    for (const player of world.getAllPlayers()) {
      const personalized = leaderboardManager.getCurrentSnapshot(player.id, snapshot.generatedAt);
      const rank = personalized?.currentPlayer?.rank ?? null;
      void achievementManager.recordRanking({ accountId: player.id, guest: isGuestPlayer(player.username) }, rank).catch((error) => logger.error('achievement ranking update failed', error));
    }
  });
  leaderboardManager.markDirty();

  // 初始化昼夜循环（从服务器启动时开始计时），周期时长以 mapMeta.dayNightCycle 为准
  const cycleMinutes = mapMeta.dayNightCycle > 0 ? mapMeta.dayNightCycle : DEFAULT_DAY_NIGHT_CONFIG.cycleMinutes;
  const dayNightCycle = new DayNightCycle(
    io,
    { ...DEFAULT_DAY_NIGHT_CONFIG, cycleMinutes },
    handlerRegistry.getTransportHandler(),
  );
  dayNightCycle.start();
  logger.info(`DayNightCycle started (cycle=${cycleMinutes}min)`);

  // 将 DayNightCycle 注入 SocketManager（供 login handler 同步时间）
  if (socketManager) {
    socketManager.setDayNightCycle(dayNightCycle);
  }

  // 初始化时区管理器（依赖 GameWorld 和 DayNightCycle）
  const timeZoneManager = new TimeZoneManager(world, dayNightCycle);
  logger.info(`TimeZoneManager initialized (${timeZoneManager.getTimezoneCount()} timezones)`);

  // 初始化昼夜驱动的区域 UCT 数值变化服务（进入白天/夜晚时对配置的区域字段施加增量）
  const dayNightValueChange = new DayNightValueChange(world, dayNightCycle);
  if (world.getMapMeta()?.dayNight) {
    logger.info('DayNightValueChange initialized (region UCT changes on day/night)');
  }

  // 统一广播区域 UCT 数值变化（无论来自昼夜切换或纪念碑修缮，均由 GameWorld 单一权威点触发）
  world.on('regionValueChanged', (payload: { regionId: string; fieldId: string; value: number; delta: number }) => {
    io.emit('server.regionValueChanged', {
      regionId: payload.regionId,
      fieldId: payload.fieldId,
      value: payload.value,
      delta: payload.delta,
      reason: 'region_value_change',
      timestamp: Date.now(),
    });
  });

  // 将 TimeZoneManager 注入 MovementHandler（移动时检测时区变化）
  handlerRegistry.setTimeZoneManager(timeZoneManager);

  // 初始化行为执行引擎（FR-1/FR-4）
  const behaviorEngine = new BehaviorEngine(io, world, {
    economy,
  });
  handlerRegistry.setBehaviorEngine(behaviorEngine);
  logger.info('BehaviorEngine initialized and injected into EventHandler');

  io.on('connection', (socket) => {
    socketManager?.registerConnectionHandlers(socket);
    handlerRegistry.registerForSocket(socket);
  });

  return {
    app,
    io,
    world,
    socketManager,
    httpServer,
    economy: { taxation, bankruptcy },
    dayNightCycle,
    timeZoneManager,
    dayNightValueChange,
    behaviorEngine,
    worldStore,
    handlerRegistry,
    userStore,
    achievementStore,
    leaderboardManager,
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
  return new Promise((resolve, reject) => {
    const handleError = (error: Error): void => {
      httpServer.off('listening', handleListening);
      reject(error);
    };
    const handleListening = (): void => {
      httpServer.off('error', handleError);
      const addr = httpServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : config.port;
      logger.info(`server listening on http://${config.host}:${port}`, { port });
      resolve({ port, host: config.host });
    };
    httpServer.once('error', handleError);
    httpServer.once('listening', handleListening);
    httpServer.listen(config.port, config.host);
  });
}

/**
 * 优雅关闭
 *
 * - 关闭 HTTP server（不再接受新连接）
 * - 关闭 Socket.IO（断开所有客户端）
 * - 清理经济系统定时器
 * - 停止昼夜 UCT 数值变化服务
 * - 兜底超时（默认 5s）
 *
 * @param httpServer HTTP server
 * @param socketManager Socket 管理器（可选）
 * @param economy 经济系统实例（可选）
 * @param dayNightCycle 昼夜循环实例（可选）
 * @param dayNightValueChange 昼夜 UCT 数值变化服务实例（可选）
 * @param eraManager 时代管理器实例（可选）
 * @param timeoutMs 兜底超时（毫秒）
 */
export async function gracefulShutdown(
  httpServer: http.Server,
  socketManager?: SocketManager,
  economy?: { taxation: Taxation; bankruptcy: Bankruptcy },
  dayNightCycle?: DayNightCycle,
  dayNightValueChange?: DayNightValueChange,
  timeoutMs: number = 5000,
  world?: GameWorld,
  handlerRegistry?: HandlerRegistry,
  userStore?: { close?: () => Promise<void> },
  worldStore?: { close?: () => Promise<void> },
  achievementStore?: { close?: () => Promise<void> },
  io?: TypedServer,
): Promise<void> {
  logger.info('graceful shutdown started');

  if (io && !socketManager) {
    try {
      io.close();
    } catch (err) {
      logger.error('error closing Socket.IO server', err);
    }
  }
  if (world) {
    try {
      await world.flushPersistence(
        economy?.taxation.getAllTaxRecords(),
        handlerRegistry?.getJailHandler().getJailStates(),
      );
    } catch (err) {
      logger.error('world persistence failed during shutdown', err);
    }
  }

  // 停止昼夜 UCT 数值变化服务
  if (dayNightValueChange) {
    try {
      dayNightValueChange.stop();
      logger.info('DayNightValueChange stopped');
    } catch (err) {
      logger.error('error stopping dayNightValueChange', err);
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

  if (worldStore?.close) {
    try {
      await worldStore.close();
    } catch (err) {
      logger.error('error closing world store', err);
    }
  }

  if (achievementStore?.close) {
    try {
      await achievementStore.close();
    } catch (err) {
      logger.error('error closing achievement store', err);
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
