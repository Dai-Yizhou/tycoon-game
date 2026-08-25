/**
 * Socket 事件处理器
 *
 * 集中注册业务事件处理器：
 * - `client.rollDice`   : 掷骰子
 * - `client.choosePath` : 路径选择（多岔路）
 * - `client.chat`       : 聊天
 *
 * 错误处理：所有处理器用统一 try/catch 包装，向客户端发送 `server.error` 事件。
 *
 * 用法：
 * ```ts
 * registerHandlers(socketManager);
 * ```
 */

import { ChatChannels, type ChatChannel, type ChatMessage } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from './SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import { ChatManager } from '../chat/index.js';
import { Bankruptcy, EconomyService, resolveOwnershipConfig, type OwnershipConfig } from '../economy/index.js';
import { DiceHandler, MovementHandler, PropertyHandler, JailHandler, InvestmentHandler, TransportHandler, MonumentHandler, TeamHandler } from '../handlers/index.js';
import { TeamManager, DEFAULT_TEAM_CONFIG } from '../team/index.js';
import { EventHandler } from '../events/index.js';
import type { ProsperityManager } from '../world/ProsperityManager.js';
import type { TimeZoneManager } from '../world/TimeZoneManager.js';

/**
 * 错误码常量
 */
export const ErrorCodes = {
  NotAuthenticated: 'NOT_AUTHENTICATED',
  PlayerNotFound: 'PLAYER_NOT_FOUND',
  InvalidPayload: 'INVALID_PAYLOAD',
  RateLimit: 'RATE_LIMIT',
  InternalError: 'INTERNAL_ERROR',
  NotImplemented: 'NOT_IMPLEMENTED',
  InvalidOperation: 'INVALID_OPERATION',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * 向客户端发送错误
 */
function emitError(socket: TypedSocket, code: ErrorCode, message: string): void {
  socket.emit('server.error', { code, message });
}

/**
 * 通用 try/catch 包装
 */
function safeHandle(socket: TypedSocket, code: ErrorCode, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    logger.error(`socket handler error (${code})`, err);
    emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
  }
}

/**
 * 处理器注册器
 *
 * 维护一个 io 引用以便支持后续任务（如房间管理、玩家加入游戏流程）。
 * 当前注册骰子、移动、地产、起点、监狱、事件、投资、交通、纪念碑、组队和聊天处理器。
 */
export class HandlerRegistry {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly diceHandler: DiceHandler;
  private readonly movementHandler: MovementHandler;
  private readonly propertyHandler: PropertyHandler;
  private readonly jailHandler: JailHandler;
  private readonly eventHandler: EventHandler;
  private readonly investmentHandler: InvestmentHandler;
  private readonly transportHandler: TransportHandler;
  private readonly monumentHandler: MonumentHandler;
  private readonly teamManager: TeamManager;
  private readonly teamHandler: TeamHandler;
  private readonly chatManager: ChatManager;
  private bankruptcy: Bankruptcy | null = null;
  private timeZoneManager: TimeZoneManager | null = null;

  constructor(io: TypedServer, world: GameWorld, ownershipConfig?: OwnershipConfig, jailCooldownMs?: number, economy?: EconomyService) {
    this.io = io;
    this.world = world;

    const mapMeta = world.getMapMeta();
    const resolvedOwnershipConfig = ownershipConfig ?? resolveOwnershipConfig(undefined);

    const cooldownConfig = {
      normal: mapMeta?.dice.cooldownMs ?? 3000,
      diceMin: mapMeta?.dice.min ?? 1,
      diceMax: mapMeta?.dice.max ?? 6,
    };

    this.diceHandler = new DiceHandler(io, world, this, cooldownConfig);
    this.movementHandler = new MovementHandler(io, world, (playerId, cellId, socket) => {
      this.handleCellEvent(playerId, cellId, socket);
    }, (playerId, cellId, socket) => {
      this.handleBehaviorPass(playerId, cellId, socket);
    });
    // 初始化地产处理器
    this.propertyHandler = new PropertyHandler(io, world, resolvedOwnershipConfig, economy ?? new EconomyService(world));
    // 初始化监狱处理器
    this.jailHandler = new JailHandler(io, world, this, jailCooldownMs ?? 10_000, economy ?? null);
    // 初始化事件处理器
    this.eventHandler = new EventHandler(io, world);
    // 初始化投资项目处理器
    this.investmentHandler = new InvestmentHandler(io, world, resolvedOwnershipConfig, economy ?? new EconomyService(world));
    // 初始化交通枢纽处理器
    this.transportHandler = new TransportHandler(io, world, economy);
    // 初始化纪念碑处理器
    this.monumentHandler = new MonumentHandler(io, world, undefined, economy ?? new EconomyService(world));
    this.teamManager = new TeamManager(DEFAULT_TEAM_CONFIG);
    this.teamHandler = new TeamHandler(io, world, this.teamManager);
    this.chatManager = new ChatManager();
  }

  /**
   * 为单个 socket 注册事件处理器
   *
   * 暴露此方法便于在 SocketManager 之外使用（如测试中手动模拟连接）。
   */
  registerForSocket(socket: TypedSocket): void {
    // 使用新的 DiceHandler 和 MovementHandler
    this.diceHandler.register(socket);
    this.movementHandler.register(socket);
    // 使用 PropertyHandler
    this.propertyHandler.register(socket);
    // 使用 JailHandler
    this.jailHandler.register(socket);
    // 使用 InvestmentHandler
    this.investmentHandler.register(socket);
    // 使用 TransportHandler 和 MonumentHandler
    this.transportHandler.register(socket);
    this.monumentHandler.register(socket);
    // 注册组队处理器
    this.teamHandler.register(socket);
    this.handleChat(socket);
    this.handleBankruptRestart(socket);
  }

  cleanup(): void {
    this.jailHandler.cleanup();
  }

  /**
   * 获取 DiceHandler（用于外部调用）
   */
  getDiceHandler(): DiceHandler {
    return this.diceHandler;
  }

  /**
   * 获取 MovementHandler（用于外部调用）
   */
  getMovementHandler(): MovementHandler {
    return this.movementHandler;
  }

  /**
   * 获取 PropertyHandler（用于外部调用）
   */
  getPropertyHandler(): PropertyHandler {
    return this.propertyHandler;
  }

  /**
   * 获取 JailHandler（用于外部调用）
   */
  getJailHandler(): JailHandler {
    return this.jailHandler;
  }

  /**
   * 获取 InvestmentHandler（用于外部调用）
   */
  getInvestmentHandler(): InvestmentHandler {
    return this.investmentHandler;
  }

  /**
   * 获取 EventHandler（用于外部调用）
   */
  getEventHandler(): EventHandler {
    return this.eventHandler;
  }

  /**
   * 获取 TransportHandler（用于外部调用）
   */
  getTransportHandler(): TransportHandler {
    return this.transportHandler;
  }

  /**
   * 获取 MonumentHandler（用于外部调用）
   */
  getMonumentHandler(): MonumentHandler {
    return this.monumentHandler;
  }

  /** 注入 BehaviorEngine 到事件处理器 */
  setBehaviorEngine(behaviorEngine: any): void {
    this.eventHandler.setBehaviorEngine(behaviorEngine);
    logger.info('BehaviorEngine 已注入 EventHandler');
  }

  /**
   * 注入 ProsperityManager 到 MonumentHandler（在 app.ts 中 ProsperityManager 创建后调用）
   */
  setProsperityManager(prosperityManager: ProsperityManager): void {
    this.monumentHandler.setProsperityManager(prosperityManager);
    logger.info('ProsperityManager 已注入 MonumentHandler');
  }

  /**
   * 注入 TimeZoneManager 到 MovementHandler（在 app.ts 中 TimeZoneManager 创建后调用）
   */
  setTimeZoneManager(timeZoneManager: TimeZoneManager): void {
    this.timeZoneManager = timeZoneManager;
    this.movementHandler.setTimeZoneManager(timeZoneManager);
    logger.info('TimeZoneManager 已注入 MovementHandler');
  }

  /**
   * 获取 TimeZoneManager（用于外部调用）
   */
  getTimeZoneManager(): TimeZoneManager | null {
    return this.timeZoneManager;
  }

  /**
   * 获取 TeamManager（用于外部调用，如登录恢复队伍）
   */
  getTeamManager(): TeamManager {
    return this.teamManager;
  }

  /**
   * 设置 Bankruptcy 实例（在 app.ts 中调用）
   */
  setBankruptcy(bankruptcy: Bankruptcy): void {
    this.bankruptcy = bankruptcy;
    logger.info('Bankruptcy 已注入 HandlerRegistry');
  }

  /**
   * 处理掷骰后的移动（由 DiceHandler 调用）
   */
  handleMovement(playerId: string, steps: number, socket: TypedSocket): void {
    const result = this.movementHandler.handleMovement(playerId, steps, socket);
    if (!result) {
      logger.warn(`移动处理失败：玩家 ${playerId}，步数 ${steps}`);
      return;
    }

  }

  /**
   * 处理到达格子后的事件。
   */
  handleCellEvent(playerId: string, cellId: number, socket: TypedSocket): void {
    const cell = this.world.getMapIndex()?.getById(cellId);
    if (!cell) return;

    switch (cell.type) {
      case 'supply':
        this.handleBehaviorPass(playerId, cellId, socket);
        return;
      case 'event':
        this.eventHandler.handleEventCell(playerId, cellId, socket);
        this.investmentHandler.dispatchDomainEvent('any-player-lands-event');
        return;
      case 'jail':
        this.jailHandler.handleEnterJail(playerId, cellId);
        return;
      case 'transport':
        this.transportHandler.handleTransportCell(playerId, cellId, socket);
        return;
      case 'monument':
        this.monumentHandler.handleMonumentCell(playerId, cellId, socket);
        return;
      case 'property':
        this.handleRentPayment(playerId, cellId, socket);
        return;
      case 'investment':
      case 'empty':
        return;
    }
  }

  /**
   * 处理租金支付（由 MovementHandler 在到达格子后调用）
   */
  handleRentPayment(playerId: string, cellId: number, socket: TypedSocket): void {
    // 检查玩家是否在监狱中（监狱中无法收取租金）
    if (!this.jailHandler.canCollectRent(playerId)) {
      logger.debug(`玩家 ${playerId} 在监狱中，无法收取租金`);
      return;
    }

    const result = this.propertyHandler.handleRentPayment(playerId, cellId, socket);
    if (!result) {
      logger.debug(`玩家 ${playerId} 在格子 ${cellId} 无需支付租金`);
    }
  }

  /**
   * 触发经过 / 落地的 behaviorPass（供给格等）
   *
   * 由 MovementHandler 的 settlePass 回调以及落地结算（handleCellEvent）调用。
   */
  private handleBehaviorPass(playerId: string, cellId: number, socket: TypedSocket): void {
    const cell = this.world.getMapIndex()?.getById(cellId);
    const behaviorId = cell?.behaviorPass ?? '';
    if (!behaviorId) return;
    const player = this.world.getPlayer(playerId);
    if (!player || !cell) return;
    this.eventHandler.handleBehavior(playerId, behaviorId, player, cell, socket);
  }

  private handleChat(socket: TypedSocket): void {
    socket.on('client.chat', (payload, ack) => {
      safeHandle(socket, ErrorCodes.InternalError, () => {
        if (!payload || typeof payload.content !== 'string' || payload.content.length === 0) {
          emitError(socket, ErrorCodes.InvalidPayload, '消息内容不能为空');
          ack?.({ ok: false, error: 'invalid_payload' });
          return;
        }
        const content = payload.content.replace(/<[^>]*>/g, '');
        const channel = payload.channel as ChatChannel;
        if (channel !== ChatChannels.Global && channel !== ChatChannels.Team && channel !== ChatChannels.Region) {
          emitError(socket, ErrorCodes.InvalidPayload, '不支持的聊天频道');
          ack?.({ ok: false, error: 'invalid_channel' });
          return;
        }
        const playerId = socket.data.playerId;
        if (!playerId) {
          emitError(socket, ErrorCodes.NotAuthenticated, '请先登录');
          ack?.({ ok: false, error: 'not_authenticated' });
          return;
        }
        const player = this.world.getPlayer(playerId);
        if (!player) {
          emitError(socket, ErrorCodes.PlayerNotFound, '玩家不存在');
          ack?.({ ok: false, error: 'player_not_found' });
          return;
        }

        const metadata = channel === ChatChannels.Team
          ? { ...payload.metadata, teamId: player.teamId }
          : channel === ChatChannels.Region
            ? { ...payload.metadata, regionId: this.getPlayerRegionId(player.position.cellId) }
            : payload.metadata;
        const message = this.chatManager.sendMessage(
          channel,
          player.id,
          player.username,
          content,
          metadata,
        );
        if (!message) {
          ack?.({ ok: false, error: 'invalid_payload' });
          return;
        }

        this.broadcastChat(channel, playerId, { message });
        ack?.({ ok: true, data: { message } });
      });
    });
  }

  private broadcastChat(channel: ChatChannel, senderId: string, payload: { message: ChatMessage }): void {
    if (channel === ChatChannels.Global) {
      this.io.emit('server.chat', payload);
      return;
    }
    const sender = this.world.getPlayer(senderId);
    if (!sender) return;
    const regionId = this.getPlayerRegionId(sender.position.cellId);
    for (const target of this.io.sockets.sockets.values()) {
      const targetPlayerId = target.data.playerId;
      const targetPlayer = targetPlayerId ? this.world.getPlayer(targetPlayerId) : undefined;
      if (!targetPlayer) continue;
      const matches = channel === ChatChannels.Team
        ? Boolean(sender.teamId && targetPlayer.teamId === sender.teamId)
        : Boolean(regionId && this.getPlayerRegionId(targetPlayer.position.cellId) === regionId);
      if (matches) target.emit('server.chat', payload);
    }
  }


  /**
   * 破产重开处理器（由客户端 handleBankruptRestart 调用）
   */
  private handleBankruptRestart(socket: TypedSocket): void {
    socket.on('client.bankruptRestart', (_payload, ack) => {
      safeHandle(socket, ErrorCodes.InternalError, () => {
        const playerId = socket.data.playerId;
        if (!playerId) {
          ack?.({ ok: false, error: 'not_authenticated' });
          return;
        }
        if (!this.bankruptcy) {
          ack?.({ ok: false, error: 'bankruptcy_system_not_available' });
          return;
        }
        const result = this.bankruptcy.restartBankruptPlayer(playerId, socket);
        ack?.({ ok: result.success, error: result.error });
      });
    });
  }

  private getPlayerRegionId(cellId: number): string | null {
    return this.world.getMapIndex()?.getById(cellId)?.regionId ?? null;
  }
}

/**
 * 快速注册：创建 HandlerRegistry 并注册全部事件
 */
export function registerHandlers(io: TypedServer, world: GameWorld, ownershipConfig?: OwnershipConfig, jailCooldownMs?: number, economy?: EconomyService): HandlerRegistry {
  const registry = new HandlerRegistry(io, world, ownershipConfig, jailCooldownMs, economy);
  return registry;
}

// -----------------------------------------------------------------------------
// 辅助函数
// -----------------------------------------------------------------------------

/**
 * 导出 emitError 供其他处理器使用
 */
export { emitError };
