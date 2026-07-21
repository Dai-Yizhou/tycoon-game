/**
 * 天赋处理器
 *
 * 负责：
 * - 天赋学习/取消
 * - 天赋启用/禁用
 * - 天赋值管理
 * - 天赋效果应用
 *
 * 设计原则：
 * - 所有天赋操作在服务端校验（防作弊）
 * - 与 StartHandler 集成（起点处打开天赋界面）
 * - 与 VisionMaskRenderer 集成（视野天赋）
 * - 与 Bank/EventHandler 集成（机制开关天赋）
 */

import type { AckResult } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import { ErrorCodes, emitError } from '../transport/handlers.js';
import type { HandlerRegistry } from '../transport/handlers.js';
import {
  TalentRegistry,
  TalentEffects,
  createTalentRegistry,
  createTalentEffects,
  getBuiltinTalents,
} from '../talents/index.js';

/**
 * 天赋处理器
 */
export class TalentHandler {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly talentRegistry: TalentRegistry;
  private readonly talentEffects: TalentEffects;

  constructor(
    io: TypedServer,
    world: GameWorld,
    _registry: HandlerRegistry,
    talentRegistry?: TalentRegistry,
  ) {
    this.io = io;
    this.world = world;
    this.talentRegistry = talentRegistry ?? createTalentRegistry();
    this.talentEffects = createTalentEffects(this.talentRegistry);

    // 注册内置天赋
    this.talentRegistry.registerTalents(getBuiltinTalents());
  }

  /**
   * 注册天赋相关事件处理器
   */
  register(socket: TypedSocket): void {
    socket.on('client.learnTalent', (payload, ack) => {
      this.handleLearnTalent(socket, payload, ack);
    });

    socket.on('client.unlearnTalent', (payload, ack) => {
      this.handleUnlearnTalent(socket, payload, ack);
    });

    socket.on('client.toggleTalent', (payload, ack) => {
      this.handleToggleTalent(socket, payload, ack);
    });

    socket.on('client.getTalentInfo', (payload, ack) => {
      this.handleGetTalentInfo(socket, payload, ack);
    });
  }

  /**
   * 处理学习天赋请求
   */
  private handleLearnTalent(
    socket: TypedSocket,
    payload: { talentId: string },
    ack?: (result: AckResult<{ talentId: string; pointsRemaining: number }>) => void,
  ): void {
    const playerId = this.world.getPlayerManager().getPlayerIdBySocketId(socket.id);
    if (!playerId) {
      emitError(socket, ErrorCodes.NotAuthenticated, '未认证');
      ack?.({ ok: false, error: 'not_authenticated' });
      return;
    }

    const result = this.talentRegistry.learnTalent(playerId, payload.talentId);

    if (!result.success) {
      emitError(socket, ErrorCodes.InvalidOperation, result.error ?? '学习失败');
      ack?.({ ok: false, error: result.error ?? 'learn_failed' });
      return;
    }

    // 广播天赋学习事件
    this.io.emit('server.talentLearned', {
      playerId,
      talentId: payload.talentId,
      talent: result.talent!,
    });

    // 返回成功结果
    ack?.({
      ok: true,
      data: {
        talentId: payload.talentId,
        pointsRemaining: this.talentRegistry.getPlayerTalentPoints(playerId),
      },
    });

    logger.debug(`玩家 ${playerId} 学习天赋 ${payload.talentId}`);
  }

  /**
   * 处理取消学习天赋请求
   */
  private handleUnlearnTalent(
    socket: TypedSocket,
    payload: { talentId: string },
    ack?: (result: AckResult<{ talentId: string; refundedPoints: number; pointsRemaining: number }>) => void,
  ): void {
    const playerId = this.world.getPlayerManager().getPlayerIdBySocketId(socket.id);
    if (!playerId) {
      emitError(socket, ErrorCodes.NotAuthenticated, '未认证');
      ack?.({ ok: false, error: 'not_authenticated' });
      return;
    }

    const result = this.talentRegistry.unlearnTalent(playerId, payload.talentId);

    if (!result.success) {
      emitError(socket, ErrorCodes.InvalidOperation, result.error ?? '取消失败');
      ack?.({ ok: false, error: result.error ?? 'unlearn_failed' });
      return;
    }

    // 广播天赋取消事件
    this.io.emit('server.talentUnlearned', {
      playerId,
      talentId: payload.talentId,
      refundedPoints: result.refundedPoints!,
    });

    // 返回成功结果
    ack?.({
      ok: true,
      data: {
        talentId: payload.talentId,
        refundedPoints: result.refundedPoints!,
        pointsRemaining: this.talentRegistry.getPlayerTalentPoints(playerId),
      },
    });

    logger.debug(`玩家 ${playerId} 取消学习天赋 ${payload.talentId}`);
  }

  /**
   * 处理启用/禁用天赋请求
   */
  private handleToggleTalent(
    socket: TypedSocket,
    payload: { talentId: string; enabled: boolean },
    ack?: (result: AckResult<{ talentId: string; enabled: boolean }>) => void,
  ): void {
    const playerId = this.world.getPlayerManager().getPlayerIdBySocketId(socket.id);
    if (!playerId) {
      emitError(socket, ErrorCodes.NotAuthenticated, '未认证');
      ack?.({ ok: false, error: 'not_authenticated' });
      return;
    }

    const result = this.talentRegistry.toggleTalent(playerId, payload.talentId, payload.enabled);

    if (!result.success) {
      emitError(socket, ErrorCodes.InvalidOperation, result.error ?? '切换失败');
      ack?.({ ok: false, error: result.error ?? 'toggle_failed' });
      return;
    }

    // 广播天赋切换事件
    this.io.emit('server.talentToggled', {
      playerId,
      talentId: payload.talentId,
      enabled: payload.enabled,
    });

    // 返回成功结果
    ack?.({
      ok: true,
      data: {
        talentId: payload.talentId,
        enabled: payload.enabled,
      },
    });

    logger.debug(`玩家 ${playerId} ${payload.enabled ? '启用' : '禁用'}天赋 ${payload.talentId}`);
  }

  /**
   * 处理获取天赋信息请求
   */
  private handleGetTalentInfo(
    socket: TypedSocket,
    _payload: {},
    ack?: (result: AckResult<{
      availableTalents: ReturnType<TalentRegistry['getAllTalents']>;
      learnedTalents: ReturnType<TalentRegistry['getPlayerTalents']>;
      talentPoints: number;
    }>) => void,
  ): void {
    const playerId = this.world.getPlayerManager().getPlayerIdBySocketId(socket.id);
    if (!playerId) {
      emitError(socket, ErrorCodes.NotAuthenticated, '未认证');
      ack?.({ ok: false, error: 'not_authenticated' });
      return;
    }

    const availableTalents = this.talentRegistry.getAllTalents();
    const learnedTalents = this.talentRegistry.getPlayerTalents(playerId);
    const talentPoints = this.talentRegistry.getPlayerTalentPoints(playerId);

    ack?.({
      ok: true,
      data: {
        availableTalents,
        learnedTalents,
        talentPoints,
      },
    });
  }

  /**
   * 初始化玩家天赋值
   *
   * 游戏开始时调用，给予初始天赋值
   */
  initializePlayerTalentPoints(playerId: string, initialPoints: number = 5): void {
    this.talentRegistry.setPlayerTalentPoints(playerId, initialPoints);
    logger.debug(`玩家 ${playerId} 初始化天赋值 ${initialPoints}`);
  }

  /**
   * 计算玩家视野半径（考虑天赋加成）
   */
  calculateVisionRadius(playerId: string, baseRadius: number): number {
    return this.talentEffects.calculateVisionRadius(playerId, baseRadius);
  }

  /**
   * 检查游戏机制是否启用（考虑天赋）
   */
  isFeatureEnabled(playerId: string, feature: 'bank' | 'items' | 'team' | 'credit' | 'alternateField', defaultEnabled?: boolean): boolean {
    return this.talentEffects.isFeatureEnabled(playerId, feature, defaultEnabled);
  }

  /**
   * 检查数值字段是否启用（考虑天赋）
   */
  isFieldEnabled(playerId: string, fieldId: string, defaultEnabled?: boolean): boolean {
    return this.talentEffects.isFieldEnabled(playerId, fieldId, defaultEnabled);
  }

  /**
   * 获取天赋注册表
   */
  getTalentRegistry(): TalentRegistry {
    return this.talentRegistry;
  }

  /**
   * 获取天赋效果处理器
   */
  getTalentEffects(): TalentEffects {
    return this.talentEffects;
  }
}

/**
 * 快速注册天赋处理器
 */
export function registerTalentHandler(
  io: TypedServer,
  world: GameWorld,
  registry: HandlerRegistry,
  talentRegistry?: TalentRegistry,
): TalentHandler {
  const handler = new TalentHandler(io, world, registry, talentRegistry);
  // 注册将在 HandlerRegistry.registerForSocket 中调用
  return handler;
}