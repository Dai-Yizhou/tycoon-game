/**
 * Socket 事件处理器
 *
 * 集中注册业务事件处理器：
 * - `client.ping`       : 心跳（已在 SocketManager 中处理，此处可重写）
 * - `client.rollDice`   : 掷骰子（Task 7 实现）
 * - `client.move`       : 移动（调试用）
 * - `client.choosePath` : 路径选择（多岔路）
 * - `client.chat`       : 聊天（占位；Task 19 完整化）
 *
 * 错误处理：所有处理器用统一 try/catch 包装，向客户端发送 `server.error` 事件。
 *
 * 用法：
 * ```ts
 * registerHandlers(socketManager);
 * ```
 */

import type { ChatMessage } from '@game/shared';
import { DebugFeatures, isFeatureEnabled } from '@game/shared';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from './SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import { DiceHandler, MovementHandler, PropertyHandler, StartHandler, JailHandler, InvestmentHandler, TransportHandler, MonumentHandler, ItemHandler, DebugHandler, AdminHandler, TeamHandler } from '../handlers/index.js';
import { TeamManager, DEFAULT_TEAM_CONFIG } from '../team/index.js';
import { EventHandler } from '../events/index.js';
import { ItemRegistry, ItemEffectsHandler, BUILTIN_ITEM_TEMPLATES } from '../items/index.js';
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
 * Task 7 新增：DiceHandler 和 MovementHandler
 * Task 9 新增：PropertyHandler
 * Task 10 新增：StartHandler 和 JailHandler
 * Task 11 新增：EventHandler
 * Task 12 新增：InvestmentHandler
 * Task 13 新增：TransportHandler 和 MonumentHandler
 * Task 15 新增：ItemHandler
 * FR-21 新增：DebugHandler（仅调试模式注册）
 */
export class HandlerRegistry {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly diceHandler: DiceHandler;
  private readonly movementHandler: MovementHandler;
  private readonly propertyHandler: PropertyHandler;
  private readonly startHandler: StartHandler;
  private readonly jailHandler: JailHandler;
  private readonly eventHandler: EventHandler;
  private readonly investmentHandler: InvestmentHandler;
  private readonly transportHandler: TransportHandler;
  private readonly monumentHandler: MonumentHandler;
  private readonly itemRegistry: ItemRegistry;
  private itemEffectsHandler: ItemEffectsHandler;
  private itemHandler: ItemHandler;
  private readonly debugHandler: DebugHandler;
  private readonly adminHandler: AdminHandler;
  private readonly teamManager: TeamManager;
  private readonly teamHandler: TeamHandler;
  private timeZoneManager: TimeZoneManager | null = null;

  constructor(io: TypedServer, world: GameWorld) {
    this.io = io;
    this.world = world;

    const mapMeta = world.getMapMeta();
    const diceConfig = mapMeta?.config ?? {};

    const cooldownConfig = {
      normal: ((diceConfig.diceCooldownSeconds as number) ?? 5) * 1000,
      jail: ((diceConfig.jailCooldownSeconds as number) ?? 10) * 1000,
      diceMin: (diceConfig.diceMin as number) ?? 1,
      diceMax: (diceConfig.diceMax as number) ?? 6,
    };

    this.diceHandler = new DiceHandler(io, world, this, cooldownConfig);
    this.movementHandler = new MovementHandler(io, world);
    // 初始化地产处理器
    this.propertyHandler = new PropertyHandler(io, world);
    // 初始化起点和监狱处理器
    this.startHandler = new StartHandler(io, world, this);
    this.jailHandler = new JailHandler(io, world, this);
    // 初始化事件处理器
    this.eventHandler = new EventHandler(io, world);
    // 初始化投资项目处理器
    this.investmentHandler = new InvestmentHandler(io, world);
    // 初始化交通枢纽处理器
    this.transportHandler = new TransportHandler(io, world);
    // 初始化纪念碑处理器
    this.monumentHandler = new MonumentHandler(io, world);
    // 初始化道具系统
    this.itemRegistry = new ItemRegistry();
    this.itemRegistry.registerBatch(BUILTIN_ITEM_TEMPLATES);
    // 注意：itemEffectsHandler 需要 Bank 实例，在 app.ts 中初始化
    this.itemEffectsHandler = null as any; // 占位，将在 app.ts 中设置
    this.itemHandler = null as any; // 占位，将在 app.ts 中设置
    // 初始化调试处理器
    this.debugHandler = new DebugHandler(io, world);
    // 初始化管理员处理器
    this.adminHandler = new AdminHandler(io, world);
    // 初始化组队系统（TeamManager 为纯数据层，TeamHandler 负责协议与 I/O）
    this.teamManager = new TeamManager(DEFAULT_TEAM_CONFIG);
    this.teamHandler = new TeamHandler(io, world, this.teamManager);
  }

  /**
   * 注册所有基础事件处理器
   *
   * 使用 `io.on('connection', ...)` 包裹，因此每个新连接都会执行。
   */
  registerAll(): void {
    this.io.on('connection', (socket) => {
      this.registerForSocket(socket as TypedSocket);
    });
  }

  /**
   * 为单个 socket 注册事件处理器
   *
   * 暴露此方法便于在 SocketManager 之外使用（如测试中手动模拟连接）。
   */
  registerForSocket(socket: TypedSocket): void {
    this.handlePing(socket);
    // 使用新的 DiceHandler 和 MovementHandler
    this.diceHandler.register(socket);
    this.movementHandler.register(socket);
    // 使用 PropertyHandler
    this.propertyHandler.register(socket);
    // 使用 StartHandler 和 JailHandler
    this.startHandler.register(socket);
    this.jailHandler.register(socket);
    // 使用 InvestmentHandler
    this.investmentHandler.register(socket);
    // 使用 TransportHandler 和 MonumentHandler
    this.transportHandler.register(socket);
    this.monumentHandler.register(socket);
    // 使用 ItemHandler（如果已初始化）
    if (this.itemHandler) {
      this.itemHandler.register(socket);
    }
    // 注册调试处理器（仅在调试功能启用时）
    if (
      isFeatureEnabled(DebugFeatures.QuickReset) ||
      isFeatureEnabled(DebugFeatures.InjectTestData)
    ) {
      this.debugHandler.register(socket);
    }
    // 注册管理员处理器
    this.adminHandler.register(socket);
    // 注册组队处理器
    this.teamHandler.register(socket);
    this.handleChat(socket);
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
   * 获取 StartHandler（用于外部调用）
   */
  getStartHandler(): StartHandler {
    return this.startHandler;
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

  /**
   * 注入 BehaviorEngine 到 EventHandler 和 DebugHandler
   */
  setBehaviorEngine(behaviorEngine: any): void {
    this.eventHandler.setBehaviorEngine(behaviorEngine);
    this.debugHandler.setBehaviorEngine(behaviorEngine);
    logger.info('BehaviorEngine 已注入 EventHandler 和 DebugHandler');
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
   * 获取 ItemRegistry（用于外部调用）
   */
  getItemRegistry(): ItemRegistry {
    return this.itemRegistry;
  }

  /**
   * 获取 ItemEffectsHandler（用于外部调用）
   */
  getItemEffectsHandler(): ItemEffectsHandler {
    return this.itemEffectsHandler;
  }

  /**
   * 获取 ItemHandler（用于外部调用）
   */
  getItemHandler(): ItemHandler {
    return this.itemHandler;
  }

  /**
   * 获取 DebugHandler（用于外部调用）
   */
  getDebugHandler(): DebugHandler {
    return this.debugHandler;
  }

  /**
   * 获取 AdminHandler（用于外部调用）
   */
  getAdminHandler(): AdminHandler {
    return this.adminHandler;
  }

  /**
   * 获取 TeamManager（用于外部调用，如离线清理、数值同步）
   */
  getTeamManager(): TeamManager {
    return this.teamManager;
  }

  /**
   * 设置 ItemEffectsHandler 和 ItemHandler（在 app.ts 中调用）
   *
   * @param bank 银行实例
   */
  setItemHandler(bank: any): void {
    this.itemEffectsHandler = new ItemEffectsHandler(this.io, this.world, this.itemRegistry, bank);
    this.itemHandler = new ItemHandler(this.io, this.world, this.itemRegistry, this.itemEffectsHandler);
    logger.info('ItemHandler 已初始化');
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

    // Task 10: 移动后触发起点和监狱逻辑
    this.handleCellEvent(playerId, result.finalCellId, socket);
  }

  /**
   * 处理到达格子后的事件（Task 10 + Task 11 + Task 13）
   *
   * 包括：
   * - 起点格：发放补充资金
   * - 监狱格：进入监狱
   * - 地产格：租金支付（已有 PropertyHandler）
   * - 事件格：随机触发事件（Task 11）
   * - 交通枢纽：付费传送（Task 13）
   * - 纪念碑：修缮（Task 13）
   */
  handleCellEvent(playerId: string, cellId: number, socket: TypedSocket): void {
    // 处理起点格（经过起点发放补充资金）
    this.startHandler.handlePassStart(playerId, cellId);

    // 处理监狱格（踩中监狱进入监狱状态）
    this.jailHandler.handleEnterJail(playerId, cellId);

    // 处理事件格（踩中事件格触发随机事件）
    this.eventHandler.handleEventCell(playerId, cellId, socket);

    // 处理交通枢纽（付费传送）
    this.transportHandler.handleTransportCell(playerId, cellId, socket);

    // 处理纪念碑（修缮）
    this.monumentHandler.handleMonumentCell(playerId, cellId, socket);

    // 处理租金支付（已有 PropertyHandler）
    this.handleRentPayment(playerId, cellId, socket);
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

    // 检查格子是否被查封（查封后无法收取租金）
    if (this.itemEffectsHandler && this.itemEffectsHandler.isCellSealed(cellId)) {
      logger.debug(`格子 ${cellId} 已被查封，无法收取租金`);
      socket.emit('server.notification', {
        id: `seal-block-${Date.now()}`,
        type: 'warning',
        title: '格子已被查封',
        content: '该格子已被查封，无法进行任何操作',
        durationMs: 3000,
      });
      return;
    }

    const result = this.propertyHandler.handleRentPayment(playerId, cellId, socket);
    if (!result) {
      logger.debug(`玩家 ${playerId} 在格子 ${cellId} 无需支付租金`);
    }
  }

  /**
   * 处理游戏开始时的启动资金发放（Task 10）
   */
  handleGameStart(playerId: string): void {
    this.startHandler.handleGameStart(playerId);
  }

  /**
   * 心跳响应（与 SocketManager 中的轻量实现保持兼容）
   */
  private handlePing(socket: TypedSocket): void {
    socket.on('client.ping', (payload, ack) => {
      safeHandle(socket, ErrorCodes.InternalError, () => {
        const response = {
          timestamp: payload?.timestamp ?? Date.now(),
          serverTime: Date.now(),
        };
        if (typeof ack === 'function') {
          ack(response);
        }
        socket.emit('server.pong', response);
      });
    });
  }

  /**
   * 聊天（占位实现）
   *
   * - system 频道：仅服务端可发，客户端发也回包为系统消息
   * - team/global 频道：直接广播（占位）
   * - region 频道：需要知道玩家所在区域（占位，下版本完整化）
   */
  private handleChat(socket: TypedSocket): void {
    socket.on('client.chat', (payload, ack) => {
      safeHandle(socket, ErrorCodes.InternalError, () => {
        if (!payload || typeof payload.content !== 'string' || payload.content.length === 0) {
          emitError(socket, ErrorCodes.InvalidPayload, '消息内容不能为空');
          ack?.({ ok: false, error: 'invalid_payload' });
          return;
        }
        const content = payload.content.slice(0, 500); // 简单限长
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

        const message: ChatMessage = {
          id: randomUUID(),
          channel: payload.channel,
          senderId: player.id,
          senderName: player.username,
          content,
          timestamp: Date.now(),
          metadata: payload.metadata,
        };

        // 占位广播：直接全局广播；后续按频道分发
        this.io.emit('server.chat', { message });
        ack?.({ ok: true, data: { message } });
      });
    });
  }
}

/**
 * 快速注册：创建 HandlerRegistry 并注册全部事件
 */
export function registerHandlers(io: TypedServer, world: GameWorld): HandlerRegistry {
  const registry = new HandlerRegistry(io, world);
  registry.registerAll();
  return registry;
}

// -----------------------------------------------------------------------------
// 辅助函数
// -----------------------------------------------------------------------------

/**
 * 导出 emitError 供其他处理器使用
 */
export { emitError };
