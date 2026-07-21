/**
 * 管理员系统处理器
 *
 * 功能：
 * - 管理员登录验证（通过环境变量 ADMIN_TOKEN）
 * - 修改玩家数值
 * - 冻结/解冻玩家
 * - 踢出玩家
 * - 获取所有在线玩家列表
 *
 * 安全：
 * - 所有操作需要验证 ADMIN_TOKEN
 * - 修改操作记录审计日志
 */

import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import { logger } from '../utils/logger.js';

/**
 * 管理员会话状态
 */
interface AdminSession {
  socketId: string;
  loginTime: number;
  lastActiveTime: number;
}

/**
 * 管理员操作审计日志
 */
interface AdminAuditLog {
  timestamp: number;
  action: string;
  targetPlayerId?: string;
  details?: Record<string, unknown>;
}

/**
 * 管理员处理器配置
 */
export interface AdminHandlerConfig {
  /** 管理员令牌（从环境变量读取） */
  adminToken?: string;
  /** 操作审计日志保留时间（毫秒） */
  auditLogRetention?: number;
}

const DEFAULT_CONFIG: AdminHandlerConfig = {
  adminToken: process.env.ADMIN_TOKEN,
  auditLogRetention: 24 * 60 * 60 * 1000, // 24小时
};

/**
 * 管理员系统处理器
 */
export class AdminHandler {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly config: AdminHandlerConfig;
  private readonly adminSessions: Map<string, AdminSession> = new Map();
  private readonly auditLogs: AdminAuditLog[] = [];

  constructor(io: TypedServer, world: GameWorld, config: AdminHandlerConfig = {}) {
    this.io = io;
    this.world = world;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 注册事件处理器
   */
  register(socket: TypedSocket): void {
    socket.on('client.adminLogin', (payload, ack) => this.handleLogin(socket, payload, ack));
    socket.on('client.adminSetPlayerValue', (payload, ack) => this.handleSetPlayerValue(socket, payload, ack));
    socket.on('client.adminFreezePlayer', (payload, ack) => this.handleFreezePlayer(socket, payload, ack));
    socket.on('client.adminUnfreezePlayer', (payload, ack) => this.handleUnfreezePlayer(socket, payload, ack));
    socket.on('client.adminKickPlayer', (payload, ack) => this.handleKickPlayer(socket, payload, ack));
    socket.on('client.adminGetPlayers', (payload, ack) => this.handleGetPlayers(socket, payload, ack));
  }

  /**
   * 验证管理员权限
   */
  private isAdmin(socket: TypedSocket): boolean {
    const session = this.adminSessions.get(socket.id);
    if (!session) return false;

    // 检查会话是否过期（24小时）
    const SESSION_TIMEOUT = 24 * 60 * 60 * 1000;
    if (Date.now() - session.loginTime > SESSION_TIMEOUT) {
      this.adminSessions.delete(socket.id);
      return false;
    }

    return true;
  }

  /**
   * 记录审计日志
   */
  private logAudit(action: string, targetPlayerId?: string, details?: Record<string, unknown>): void {
    this.auditLogs.push({
      timestamp: Date.now(),
      action,
      targetPlayerId,
      details,
    });

    // 清理过期日志
    const cutoff = Date.now() - (this.config.auditLogRetention || DEFAULT_CONFIG.auditLogRetention!);
    while (this.auditLogs.length > 0 && this.auditLogs[0].timestamp < cutoff) {
      this.auditLogs.shift();
    }

    logger.info('[Admin] Audit log', { action, targetPlayerId, details });
  }

  /**
   * 处理管理员登录
   */
  private handleLogin(
    socket: TypedSocket,
    payload: { token: string },
    ack?: (result: { ok: boolean; error?: string; data?: { sessionTimeout: number } }) => void,
  ): void {
    try {
      const { token } = payload;

      // 检查是否配置了管理员令牌
      if (!this.config.adminToken) {
        logger.warn('[Admin] ADMIN_TOKEN not configured');
        ack?.({ ok: false, error: 'ADMIN_TOKEN_NOT_CONFIGURED' });
        return;
      }

      // 验证令牌
      if (token !== this.config.adminToken) {
        logger.warn('[Admin] Invalid admin token attempt', { socketId: socket.id });
        ack?.({ ok: false, error: 'INVALID_TOKEN' });
        return;
      }

      // 创建会话
      const session: AdminSession = {
        socketId: socket.id,
        loginTime: Date.now(),
        lastActiveTime: Date.now(),
      };
      this.adminSessions.set(socket.id, session);

      logger.info('[Admin] Admin logged in', { socketId: socket.id });
      this.logAudit('admin_login');

      ack?.({
        ok: true,
        data: {
          sessionTimeout: 24 * 60 * 60 * 1000, // 24小时
        },
      });
    } catch (err) {
      logger.error('[Admin] Login error', err);
      ack?.({ ok: false, error: 'INTERNAL_ERROR' });
    }
  }

  /**
   * 处理修改玩家数值
   */
  private handleSetPlayerValue(
    socket: TypedSocket,
    payload: { playerId: string; fieldId: string; value: number },
    ack?: (result: { ok: boolean; error?: string }) => void,
  ): void {
    try {
      if (!this.isAdmin(socket)) {
        ack?.({ ok: false, error: 'NOT_AUTHORIZED' });
        return;
      }

      const { playerId, fieldId, value } = payload;

      // 检查玩家是否存在
      const player = this.world.getPlayer(playerId);
      if (!player) {
        ack?.({ ok: false, error: 'PLAYER_NOT_FOUND' });
        return;
      }

      // 修改数值
      const oldValue = player.values[fieldId]?.current;
      if (player.values[fieldId]) {
        player.values[fieldId].current = value;
      } else {
        ack?.({ ok: false, error: 'INVALID_FIELD' });
        return;
      }

      logger.info('[Admin] Player value modified', {
        playerId,
        fieldId,
        oldValue,
        newValue: value,
      });

      this.logAudit('set_player_value', playerId, { fieldId, oldValue, newValue: value });

      // 广播数值变化
      this.io.emit('server.valueChanged', {
        playerId,
        fieldId,
        current: value,
        delta: value - (oldValue || 0),
      });

      ack?.({ ok: true });
    } catch (err) {
      logger.error('[Admin] Set player value error', err);
      ack?.({ ok: false, error: 'INTERNAL_ERROR' });
    }
  }

  /**
   * 处理冻结玩家
   */
  private handleFreezePlayer(
    socket: TypedSocket,
    payload: { playerId: string },
    ack?: (result: { ok: boolean; error?: string }) => void,
  ): void {
    try {
      if (!this.isAdmin(socket)) {
        ack?.({ ok: false, error: 'NOT_AUTHORIZED' });
        return;
      }

      const { playerId } = payload;
      const player = this.world.getPlayer(playerId);
      if (!player) {
        ack?.({ ok: false, error: 'PLAYER_NOT_FOUND' });
        return;
      }

      // 设置冻结状态（使用特殊 status）
      player.status = 'frozen' as any; // 扩展状态

      logger.info('[Admin] Player frozen', { playerId });
      this.logAudit('freeze_player', playerId);

      // 广播状态变化
      this.io.emit('server.playerStatusChanged', {
        playerId,
        status: player.status,
      });

      ack?.({ ok: true });
    } catch (err) {
      logger.error('[Admin] Freeze player error', err);
      ack?.({ ok: false, error: 'INTERNAL_ERROR' });
    }
  }

  /**
   * 处理解冻玩家
   */
  private handleUnfreezePlayer(
    socket: TypedSocket,
    payload: { playerId: string },
    ack?: (result: { ok: boolean; error?: string }) => void,
  ): void {
    try {
      if (!this.isAdmin(socket)) {
        ack?.({ ok: false, error: 'NOT_AUTHORIZED' });
        return;
      }

      const { playerId } = payload;
      const player = this.world.getPlayer(playerId);
      if (!player) {
        ack?.({ ok: false, error: 'PLAYER_NOT_FOUND' });
        return;
      }

      // 恢复正常状态
      player.status = 'normal';

      logger.info('[Admin] Player unfrozen', { playerId });
      this.logAudit('unfreeze_player', playerId);

      // 广播状态变化
      this.io.emit('server.playerStatusChanged', {
        playerId,
        status: 'normal',
      });

      ack?.({ ok: true });
    } catch (err) {
      logger.error('[Admin] Unfreeze player error', err);
      ack?.({ ok: false, error: 'INTERNAL_ERROR' });
    }
  }

  /**
   * 处理踢出玩家
   */
  private handleKickPlayer(
    socket: TypedSocket,
    payload: { playerId: string; reason?: string },
    ack?: (result: { ok: boolean; error?: string }) => void,
  ): void {
    try {
      if (!this.isAdmin(socket)) {
        ack?.({ ok: false, error: 'NOT_AUTHORIZED' });
        return;
      }

      const { playerId, reason } = payload;
      const player = this.world.getPlayer(playerId);
      if (!player) {
        ack?.({ ok: false, error: 'PLAYER_NOT_FOUND' });
        return;
      }

      logger.info('[Admin] Player kicked', { playerId, reason });
      this.logAudit('kick_player', playerId, { reason });

      // 发送踢出通知
      this.io.emit('server.notification', {
        id: `admin-kick-${Date.now()}`,
        type: 'warning',
        title: '被管理员踢出',
        content: reason || '您已被管理员踢出游戏',
        durationMs: 0,
      });

      // 从世界移除玩家
      this.world.removePlayer(playerId);

      // 广播玩家离开
      this.io.emit('server.playerLeft', { playerId });

      ack?.({ ok: true });
    } catch (err) {
      logger.error('[Admin] Kick player error', err);
      ack?.({ ok: false, error: 'INTERNAL_ERROR' });
    }
  }

  /**
   * 处理获取所有在线玩家列表
   */
  private handleGetPlayers(
    socket: TypedSocket,
    _payload: {},
    ack?: (result: {
      ok: boolean;
      error?: string;
      data?: {
        players: Array<{
          id: string;
          username: string;
          status: string;
          position: { cellId: number };
          values: Record<string, { id: string; name: string; current: number }>;
          teamId: string | null;
          lastActiveAt: number;
        }>;
        count: number;
      };
    }) => void,
  ): void {
    try {
      if (!this.isAdmin(socket)) {
        ack?.({ ok: false, error: 'NOT_AUTHORIZED' });
        return;
      }

      const players = this.world.getAllPlayers();
      const playerList = players.map((p) => ({
        id: p.id,
        username: p.username,
        status: p.status,
        position: p.position,
        values: p.values,
        teamId: p.teamId,
        lastActiveAt: p.lastActiveAt,
      }));

      this.logAudit('get_players');

      ack?.({
        ok: true,
        data: {
          players: playerList,
          count: playerList.length,
        },
      });
    } catch (err) {
      logger.error('[Admin] Get players error', err);
      ack?.({ ok: false, error: 'INTERNAL_ERROR' });
    }
  }

  /**
   * 清理管理员会话（socket断开时调用）
   */
  cleanupSession(socketId: string): void {
    const session = this.adminSessions.get(socketId);
    if (session) {
      logger.info('[Admin] Admin session closed', { socketId });
      this.logAudit('admin_logout');
      this.adminSessions.delete(socketId);
    }
  }
}

/**
 * 创建管理员处理器
 */
export function createAdminHandler(
  io: TypedServer,
  world: GameWorld,
  config?: AdminHandlerConfig,
): AdminHandler {
  return new AdminHandler(io, world, config);
}