/**
 * Socket.IO 管理器
 *
 * 职责：
 * 1. 接收并管理客户端连接
 * 2. 分层广播（全局 / 棋盘 / 区域 / 队伍 / 单玩家）
 * 3. 鉴权与限流中间件
 * 4. 与 GameWorld 集成：连接时绑定玩家，断开时解绑
 *
 * 房间命名约定：
 * - `map:<mapId>`          : 同一棋盘的房间
 * - `region:<mapId>:<regionId>` : 棋盘内某区域
 * - `team:<teamId>`        : 队伍房间
 * - `player:<playerId>`    : 单玩家私聊
 * - `all`                  : 全局（默认）
 *
 * 性能要点：
 * - Socket.IO 4.x 单实例支持 5000+ 并发；广播按房间切片避免无差别风暴
 * - 中间件鉴权 + 限流在握手阶段执行，失败即拒绝连接
 */

import type { Server as SocketIOServer, Socket } from 'socket.io';
import {
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketData,
  type Player,
  type ValueField,
  PlayerStatus,
} from '@game/shared';
import { logger } from '../utils/logger.js';
import type { GameWorld } from '../world/GameWorld.js';
import type { DayNightCycle } from '../world/DayNightCycle.js';
import type { PlayerStore } from '../storage/PlayerStore.js';
import type { TeamManager } from '../team/TeamManager.js';
import type { JWTService } from '../auth/JWTService.js';

/**
 * Socket.IO 类型化 Server
 */
export type TypedServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

/**
 * Socket.IO 类型化 Socket
 */
export type TypedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

/**
 * 限流配置
 */
export interface RateLimitConfig {
  /** 时间窗口（毫秒） */
  windowMs: number;
  /** 时间窗口内允许的最大事件数 */
  maxEvents: number;
}

/**
 * Socket 管理器配置
 */
export interface SocketManagerOptions {
  /** 关联的 GameWorld（必填） */
  world: GameWorld;
  /** 限流配置（默认 100 事件/10s） */
  rateLimit?: RateLimitConfig;
  /** 鉴权处理器；返回 null 表示通过，非 null 为 playerId */
  authenticate?: (socket: TypedSocket, handshake: unknown) =>
    | string
    | { playerId: string; guest?: boolean }
    | null
    | Promise<string | { playerId: string; guest?: boolean } | null>;
  jwtService?: JWTService;
  /** 是否自动绑定 GameWorld 事件到广播（默认 true） */
  autoWireWorldEvents?: boolean;
  /** 昼夜循环实例（用于登录时同步时间给客户端） */
  dayNightCycle?: DayNightCycle;
  /** 玩家存储（用于账号持久化；不传则不持久化） */
  playerStore?: PlayerStore;
  teamManager?: TeamManager;
}

/**
 * Socket 管理器
 */
export class SocketManager {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly rateLimit: RateLimitConfig;
  private readonly authenticate?: SocketManagerOptions['authenticate'];
  private readonly jwtService?: JWTService;
  private readonly autoWireWorldEvents: boolean;
  private dayNightCycle?: DayNightCycle;
  private playerStore?: PlayerStore;
  private teamManager?: TeamManager;

  /** socketId -> 已发事件计数（按时间窗口重置） */
  private readonly rateBuckets: Map<string, { count: number; windowStart: number }> = new Map();
  /** 玩家 ID -> socketId 集合（一个玩家可能多个连接） */
  private readonly playerSockets: Map<string, Set<string>> = new Map();

  constructor(io: TypedServer, options: SocketManagerOptions) {
    this.io = io;
    this.world = options.world;
    this.rateLimit = options.rateLimit ?? { windowMs: 10_000, maxEvents: 100 };
    this.authenticate = options.authenticate;
    this.jwtService = options.jwtService;
    this.autoWireWorldEvents = options.autoWireWorldEvents ?? true;
    this.dayNightCycle = options.dayNightCycle;
    this.playerStore = options.playerStore;
    this.teamManager = options.teamManager;

    if (!this.authenticate && !this.jwtService && process.env.NODE_ENV === 'production') {
      throw new Error('explicit socket authentication is required');
    }

    this.io.use((socket, next) => this.middleware(socket as TypedSocket, next));

    if (this.autoWireWorldEvents) {
      this.wireWorldEvents();
    }
  }

  /**
   * 获取底层 Socket.IO Server
   */
  getIO(): TypedServer {
    return this.io;
  }

  registerConnectionHandlers(socket: TypedSocket): void {
    this.onConnection(socket);
  }

  // ---------------------------------------------------------------------------
  // 房间命名辅助
  // ---------------------------------------------------------------------------

  static mapRoom(mapId: string): string {
    return `map:${mapId}`;
  }

  static regionRoom(mapId: string, regionId: string): string {
    return `region:${mapId}:${regionId}`;
  }

  static teamRoom(teamId: string): string {
    return `team:${teamId}`;
  }

  static playerRoom(playerId: string): string {
    return `player:${playerId}`;
  }

  // ---------------------------------------------------------------------------
  // 广播分层
  // ---------------------------------------------------------------------------

  /**
   * 全局广播
   */
  broadcast<K extends keyof ServerToClientEvents>(
    event: K,
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
    this.io.emit(event, ...(args as Parameters<ServerToClientEvents[K]>));
  }

  /**
   * 棋盘内广播
   */
  broadcastToMap<K extends keyof ServerToClientEvents>(
    mapId: string,
    event: K,
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
    this.io.to(SocketManager.mapRoom(mapId)).emit(event, ...(args as Parameters<ServerToClientEvents[K]>));
  }

  /**
   * 区域内广播
   */
  broadcastToRegion<K extends keyof ServerToClientEvents>(
    mapId: string,
    regionId: string,
    event: K,
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
    this.io
      .to(SocketManager.regionRoom(mapId, regionId))
      .emit(event, ...(args as Parameters<ServerToClientEvents[K]>));
  }

  /**
   * 队伍内广播
   */
  broadcastToTeam<K extends keyof ServerToClientEvents>(
    teamId: string,
    event: K,
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
    this.io.to(SocketManager.teamRoom(teamId)).emit(event, ...(args as Parameters<ServerToClientEvents[K]>));
  }

  /**
   * 单玩家推送
   *
   * - 一个玩家可能多端在线，全部推送
   * - 未找到玩家时静默
   */
  emitToPlayer<K extends keyof ServerToClientEvents>(
    playerId: string,
    event: K,
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
    const sockets = this.playerSockets.get(playerId);
    if (!sockets || sockets.size === 0) return;
    for (const sid of sockets) {
      const target = this.io.sockets.sockets.get(sid);
      if (target) {
        target.emit(event, ...(args as Parameters<ServerToClientEvents[K]>));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 中间件
  // ---------------------------------------------------------------------------

  private async middleware(
    socket: TypedSocket,
    next: (err?: Error) => void,
  ): Promise<void> {
    try {
      // 1. 鉴权
      if (this.jwtService) {
        const auth = socket.handshake.auth as { token?: unknown } | undefined;
        const token = typeof auth?.token === 'string' ? auth.token : undefined;
        const payload = token ? this.jwtService.verifyToken(token) : null;
        if (!payload || typeof payload.playerId !== 'string') {
          next(new Error('authentication_failed'));
          return;
        }
        socket.data.playerId = payload.playerId;
        socket.data.guest = payload.isGuest;
        socket.data.username = payload.username;
        socket.data.authenticated = true;
      } else if (this.authenticate) {
        const identity = await this.authenticate(socket, socket.handshake);
        if (typeof identity === 'string' && identity.length > 0) {
          socket.data.playerId = identity;
          socket.data.authenticated = true;
        } else if (typeof identity === 'object' && identity !== null && identity.playerId.length > 0) {
          socket.data.playerId = identity.playerId;
          socket.data.guest = identity.guest;
          socket.data.authenticated = true;
        } else {
          next(new Error('authentication_failed'));
          return;
        }
      } else {
        next(new Error('authentication_required'));
        return;
      }

      // 2. 限流（仅在握手阶段粗粒度限制；详细速率在 onConnection 内做）
      const ip = socket.handshake.address;
      socket.data.remoteAddress = ip;

      next();
    } catch (err) {
      next(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // ---------------------------------------------------------------------------
  // 连接生命周期
  // ---------------------------------------------------------------------------

  private onConnection(socket: TypedSocket): void {
    logger.info(`socket connected: ${socket.id}`, { remote: socket.data.remoteAddress });

    // 绑定玩家（如已鉴权）
    const playerId = socket.data.playerId;
    if (playerId) {
      this.trackPlayerSocket(playerId, socket.id);
      const player = this.world.getPlayer(playerId);
      if (player) {
        this.world.getPlayerManager().connectPlayer(playerId, socket.id);
      } else {
        logger.warn(`socket authenticated with unknown player: ${playerId}`);
      }
    }

    // 限流：每连接维护一个桶
    this.rateBuckets.set(socket.id, { count: 0, windowStart: Date.now() });

    // 任意事件触发限流计数（使用 socket.onAny）
    socket.use((_, next) => {
      if (!this.consumeRate(socket)) {
        next(new Error('rate_limit_exceeded'));
        return;
      }
      next();
    });

    // 业务事件：客户端不需传 socketId，使用连接级 socket
    this.registerCoreHandlers(socket);

    socket.on('disconnect', (reason) => this.onDisconnect(socket, reason));
  }

  private onDisconnect(socket: TypedSocket, reason: string): void {
    logger.info(`socket disconnected: ${socket.id} (${reason})`);
    const playerId = socket.data.playerId;
    if (playerId) {
      // 保存玩家状态到 PlayerStore（非游客模式且有存储时）
      // 在冻结之前保存，确保存储中的状态是真实游戏状态而非 frozen
      if (!socket.data.guest && this.playerStore) {
        const player = this.world.getPlayer(playerId);
        if (player) {
          this.playerStore.savePlayer(player).catch((err) => {
            logger.error(`failed to save player ${playerId} on disconnect`, err);
          });
        }
      }

      const set = this.playerSockets.get(playerId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          this.playerSockets.delete(playerId);
          // 全部连接断开时冻结玩家
          this.world.getPlayerManager().disconnectPlayer(playerId);
        }
      }
    }
    this.rateBuckets.delete(socket.id);
  }

  // ---------------------------------------------------------------------------
  // 限流
  // ---------------------------------------------------------------------------

  private consumeRate(socket: TypedSocket): boolean {
    const bucket = this.rateBuckets.get(socket.id);
    if (!bucket) return false;
    const now = Date.now();
    if (now - bucket.windowStart >= this.rateLimit.windowMs) {
      bucket.windowStart = now;
      bucket.count = 0;
    }
    bucket.count += 1;
    if (bucket.count > this.rateLimit.maxEvents) {
      socket.emit('server.error', { code: 'RATE_LIMIT', message: 'Too many events' });
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // 玩家 socket 跟踪
  // ---------------------------------------------------------------------------

  private trackPlayerSocket(playerId: string, socketId: string): void {
    let set = this.playerSockets.get(playerId);
    if (!set) {
      set = new Set();
      this.playerSockets.set(playerId, set);
    }
    set.add(socketId);
  }

  /**
   * 主动断开某玩家的全部连接（用于踢人/封禁）
   */
  disconnectPlayer(playerId: string, reason: string = 'server_kick'): void {
    const set = this.playerSockets.get(playerId);
    if (!set) return;
    for (const sid of set) {
      const sock = this.io.sockets.sockets.get(sid);
      if (sock) {
        sock.emit('server.error', { code: 'KICKED', message: reason });
        sock.disconnect(true);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 核心事件处理器（心跳 + 鉴权 + 房间加入）
  // ---------------------------------------------------------------------------

  /**
   * 注入昼夜循环实例（供登录时同步时间给客户端）
   */
  setDayNightCycle(dayNightCycle: DayNightCycle): void {
    this.dayNightCycle = dayNightCycle;
  }

  /**
   * 注入玩家存储实例（供登录恢复账号与断开时保存状态）
   */
  setPlayerStore(playerStore: PlayerStore): void {
    this.playerStore = playerStore;
  }

  private registerCoreHandlers(socket: TypedSocket): void {
    // 心跳
    socket.on('client.ping', (payload, ack) => {
      const response = {
        timestamp: payload?.timestamp ?? Date.now(),
        serverTime: Date.now(),
      };
      if (typeof ack === 'function') {
        ack(response);
      } else {
        socket.emit('server.pong', response);
      }
    });

    // 登录/加入游戏
    socket.on('client.login', async (payload, ack) => {
      try {
        if (!payload || typeof payload !== 'object' || typeof payload.username !== 'string') {
          ack?.({ ok: false, error: 'invalid_payload' });
          return;
        }
        const authenticatedUsername = socket.data.username;
        if (socket.data.authenticated !== true || !socket.data.playerId) {
          ack?.({ ok: false, error: 'not_authenticated' });
          return;
        }
        const requestedUsername = payload.username.trim();
        if (authenticatedUsername && requestedUsername !== authenticatedUsername) {
          ack?.({ ok: false, error: 'identity_mismatch' });
          return;
        }
        const username = (authenticatedUsername || requestedUsername).trim();
        if (!username || username.length < 2) {
          ack?.({ ok: false, error: '用户名至少需要2个字符' });
          return;
        }

        const isGuest = socket.data.guest === true;
        const now = Date.now();

        let player: Player;
        let isNewPlayer = false;

        if (isGuest) {
          // 游客模式：创建临时玩家，不持久化
          const playerId = socket.data.playerId || `guest_${now}_${Math.random().toString(36).slice(2, 8)}`;
          player = SocketManager.createDefaultPlayer(playerId, username, now);
          socket.data.guest = true;
        } else if (this.playerStore) {
          const authenticatedPlayerId = socket.data.playerId;
          const existingById = authenticatedPlayerId
            ? await this.playerStore.loadPlayer(authenticatedPlayerId)
            : null;
          const existing = existingById ?? (this.playerStore.loadPlayerByUsername
            ? await this.playerStore.loadPlayerByUsername(username)
            : null);
          if (existing) {
            // 恢复已有玩家状态
            player = existing;
            player.username = username;
            player.lastActiveAt = now;
          } else {
            // 新玩家
            const playerId = socket.data.playerId || `p_${now}_${Math.random().toString(36).slice(2, 8)}`;
            player = SocketManager.createDefaultPlayer(playerId, username, now);
            isNewPlayer = true;
          }
        } else {
          // 无 PlayerStore：创建新玩家（保持原有行为）
          const playerId = socket.data.playerId || `p_${now}_${Math.random().toString(36).slice(2, 8)}`;
          player = SocketManager.createDefaultPlayer(playerId, username, now);
        }

        // 检查玩家是否已在游戏世界中（可能是冻结状态的重连）
        const existingInWorld = this.world.getPlayer(player.id);
        if (existingInWorld) {
          // 玩家已在世界中（重连），更新数据并解冻
          this.world.updatePlayer(player);
          this.world.getPlayerManager().connectPlayer(player.id, socket.id);
        } else {
          // 添加到游戏世界
          const added = this.world.addPlayer(player, socket.id);
          if (!added) {
            ack?.({ ok: false, error: '玩家已存在' });
            return;
          }
        }

        const restoredTeam = this.teamManager?.ensurePlayerTeam(player.id, player.username);
        if (restoredTeam && player.teamId !== restoredTeam.id) {
          player.teamId = restoredTeam.id;
          this.world.updatePlayer(player);
        }

        // 绑定 playerId 到 socket
        socket.data.playerId = player.id;
        this.trackPlayerSocket(player.id, socket.id);

        // 保存到 PlayerStore（非游客模式且有存储时）
        if (!isGuest && this.playerStore) {
          try {
            await this.playerStore.savePlayer(player);
          } catch (err) {
            logger.error(`failed to save player ${player.id}`, err);
          }
        }

        // 获取昼夜周期信息
        const cycleStartTime = this.dayNightCycle?.getCycleStartTime() ?? now;
        const cycleMinutes = this.dayNightCycle?.getConfig().cycleMinutes ?? 15;

        logger.info(
          `player logged in: ${username} (${player.id})` +
            `${isGuest ? ' [guest]' : ''}${isNewPlayer ? ' [new]' : ''}`,
        );

        // 获取已有玩家列表（排除当前玩家）
        const existingPlayers = this.world.getAllPlayers().filter(p => p.id !== player.id);

        ack?.({
          ok: true,
          data: {
            player,
            serverTime: now,
            cycleStartTime,
            cycleMinutes,
            existingPlayers,
          },
        });

        socket.emit('server.gameState', {
          player,
          team: this.teamManager?.getPlayerTeam(player.id) ?? null,
          members: this.teamManager?.getPlayerTeam(player.id)?.memberIds.map((memberId) => {
            const member = this.world.getPlayer(memberId);
            const values = member?.values ?? {};
            return {
              id: memberId,
              username: member?.username ?? '未知玩家',
              money: values.money?.current ?? 0,
              credit: values.credit?.current ?? 0,
              env: values.environment?.current ?? values.env?.current ?? 0,
              status: member?.status ?? 'normal',
            };
          }) ?? [],
          serverTime: now,
        });

      } catch (err) {
        logger.error('login error', err);
        ack?.({ ok: false, error: '登录失败' });
      }
    });

    // 注：组队相关事件（inviteToTeam / respondToTeamInvite / leaveTeam /
    // kickTeamMember / getTeamState）由 TeamHandler 统一处理（服务端权威），
    // 注册见 HandlerRegistry.registerForSocket。此处不再保留旧实现，避免
    // 双重注册导致的状态不一致。
  }

  /**
   * 创建默认玩家对象
   *
   * 包含初始数值字段（金钱 2000、信用值 50），位置在起点。
   */
  private static createDefaultPlayer(playerId: string, username: string, now: number): Player {
    const values: Record<string, ValueField> = {
      money: { id: 'money', name: '财产', current: 2000, min: 0 },
      credit: { id: 'credit', name: '信用值', current: 50, min: 0, max: 100 },
    };

    return {
      id: playerId,
      username,
      teamId: null,
      position: { cellId: 0 },
      values,
      status: PlayerStatus.Normal,
      createdAt: now,
      lastActiveAt: now,
    };
  }

  // ---------------------------------------------------------------------------
  // GameWorld 事件自动转发
  // ---------------------------------------------------------------------------

  private wireWorldEvents(): void {
    this.world.on('playerAdded', ({ player }: { player: import('@game/shared').Player }) => {
      this.broadcast('server.playerJoined', player);
    });

    this.world.on('playerRemoved', ({ playerId }: { playerId: string }) => {
      this.broadcast('server.playerLeft', { playerId });
    });

    this.world.on('playerUpdated', ({ player }: { player: import('@game/shared').Player }) => {
      this.broadcast('server.playerMoved', { playerId: player.id, cellId: player.position.cellId });
    });

    this.world.on('eraChanged', ({ previousEraId, newEra }: { previousEraId: string | null; newEra: import('@game/shared').EraInfo }) => {
      this.broadcast('server.eraChanged', {
        previousEraId,
        newEraId: newEra.id,
        newMapId: newEra.mapId,
      });
    });
  }

  /**
   * 关闭管理器
   *
   * 关闭所有连接并清理资源。
   */
  async close(): Promise<void> {
    this.rateBuckets.clear();
    this.playerSockets.clear();
    await new Promise<void>((resolve) => {
      this.io.close(() => resolve());
    });
  }
}
