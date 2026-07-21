/**
 * 道具效果处理器（ItemEffects）
 *
 * 负责：
 * - 应用道具效果到玩家数值字段
 * - 处理查封令的格子禁用逻辑
 * - 处理复活令的玩家复活逻辑
 * - 管理查封令的自动恢复定时器
 * - 广播道具使用事件
 *
 * 设计原则：
 * - 道具效果复用 EventEffect
 * - 查封令禁用格子：禁用购买、升级、收取租金
 * - 复活令复活玩家：恢复玩家状态、财产、位置
 * - 道具持有数量上限：默认 5 个
 */

import { randomUUID } from 'node:crypto';
import type { EventEffect, Item, ItemDefinition, Player } from '@game/shared';
import { PlayerStatus as PlayerStatusEnum } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import type { ItemRegistry } from './ItemRegistry.js';
import type { Bank } from '../economy/Bank.js';

/**
 * 查封状态（用于管理被查封的格子）
 */
export interface SealState {
  /** 查封 ID */
  id: string;
  /** 被查封的格子 ID */
  cellId: number;
  /** 查封者玩家 ID */
  playerId: string;
  /** 查封开始时间（Unix 毫秒） */
  startTime: number;
  /** 查封持续时间（毫秒） */
  duration: number;
  /** 查封结束时间（Unix 毫秒） */
  endTime: number;
}

/**
 * 道具使用结果
 */
export interface ItemUseResult {
  /** 是否成功 */
  success: boolean;
  /** 错误消息（失败时） */
  error?: string;
  /** 道具实例 ID */
  itemId?: string;
  /** 道具类型 */
  itemType?: string;
  /** 道具名称 */
  itemName?: string;
  /** 效果结果列表 */
  effects?: ItemEffectResult[];
  /** 查封状态（使用查封令时） */
  sealState?: SealState;
  /** 复活的玩家 ID（使用复活令时） */
  revivedPlayerId?: string;
}

/**
 * 道具效果结果
 */
export interface ItemEffectResult {
  /** 受影响的玩家 ID */
  playerId: string;
  /** 受影响的字段 ID */
  fieldId: string;
  /** 变化前的值 */
  oldValue: number;
  /** 变化后的值 */
  newValue: number;
  /** 变化量 */
  delta: number;
  /** 效果消息 */
  message?: string;
}

/**
 * 道具效果处理器
 */
export class ItemEffectsHandler {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly registry: ItemRegistry;

  // 查封状态管理
  private readonly sealedCells: Map<string, SealState> = new Map();
  private readonly sealTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    io: TypedServer,
    world: GameWorld,
    registry: ItemRegistry,
    _bank: Bank,
  ) {
    this.io = io;
    this.world = world;
    this.registry = registry;
  }

  /**
   * 使用道具
   *
   * @param playerId 使用者玩家 ID
   * @param itemInstanceId 道具实例 ID
   * @param target 目标（格子 ID 或玩家 ID）
   * @param socket Socket 连接
   * @returns 使用结果
   */
  useItem(
    playerId: string,
    itemInstanceId: string,
    target: { cellId?: number; playerId?: string },
    socket: TypedSocket,
  ): ItemUseResult {
    const player = this.world.getPlayer(playerId);
    if (!player) {
      return { success: false, error: '玩家不存在' };
    }

    // 查找道具实例
    const itemInstance = player.items?.find(item => item.id === itemInstanceId);
    if (!itemInstance) {
      return { success: false, error: '道具不存在' };
    }

    // 获取道具定义
    const itemDef = this.registry.getByType(itemInstance.type);
    if (!itemDef) {
      return { success: false, error: '道具类型未注册' };
    }

    // 根据道具类型处理
    let result: ItemUseResult;
    switch (itemInstance.type) {
      case 'seal':
        result = this.useSealOrder(playerId, itemInstanceId, target.cellId ?? 0, socket);
        break;
      case 'revive':
        result = this.useReviveOrder(playerId, itemInstanceId, target.playerId ?? '', socket);
        break;
      default:
        // 默认：应用道具效果
        result = this.useGenericItem(player, itemInstance, itemDef, socket);
    }

    // 如果成功，移除道具（数量减 1）
    if (result.success) {
      this.removeItemFromPlayer(player, itemInstanceId);
      this.world.updatePlayer(player);
    }

    return result;
  }

  /**
   * 使用查封令
   *
   * @param playerId 使用者玩家 ID
   * @param itemInstanceId 道具实例 ID
   * @param targetCellId 目标格子 ID
   * @param socket Socket 连接
   * @returns 使用结果
   */
  private useSealOrder(
    playerId: string,
    itemInstanceId: string,
    targetCellId: number,
    socket: TypedSocket,
  ): ItemUseResult {
    // 验证目标格子
    const mapIndex = this.world.getMapIndex();
    if (!mapIndex) {
      return { success: false, error: '地图未加载' };
    }

    const cell = mapIndex.getById(targetCellId);
    if (!cell) {
      return { success: false, error: '目标格子不存在' };
    }

    // 检查格子是否已被查封
    const existingSeal = this.getSealStateByCellId(targetCellId);
    if (existingSeal) {
      return { success: false, error: '目标格子已被查封' };
    }

    // 获取玩家
    const player = this.world.getPlayer(playerId);
    if (!player) {
      return { success: false, error: '玩家不存在' };
    }

    // 检查信用值是否足够
    const creditCost = this.registry.getSealCreditCost();
    const creditField = player.values?.['credit'];
    if (creditField && creditField.current < creditCost) {
      return { success: false, error: '信用值不足' };
    }

    // 创建查封状态
    const sealId = randomUUID();
    const duration = this.registry.getSealDuration();
    const startTime = Date.now();
    const endTime = startTime + duration;

    const sealState: SealState = {
      id: sealId,
      cellId: targetCellId,
      playerId,
      startTime,
      duration,
      endTime,
    };

    // 应用查封
    this.sealedCells.set(sealId, sealState);

    // 设置自动恢复定时器
    const timer = setTimeout(() => {
      this.unsealCell(sealId);
    }, duration);
    this.sealTimers.set(sealId, timer);

    // 扣除信用值
    const effects: ItemEffectResult[] = [];
    if (creditField) {
      const oldValue = creditField.current;
      const newValue = oldValue - creditCost;
      creditField.current = newValue;
      effects.push({
        playerId,
        fieldId: 'credit',
        oldValue,
        newValue,
        delta: -creditCost,
        message: '使用查封令，信用值降低',
      });
    }

    // 更新玩家数据
    this.world.updatePlayer(player);

    // 广播事件
    this.broadcastSealEvent(player, sealState, effects, socket);

    logger.info(`玩家 ${playerId} 使用查封令查封格子 ${targetCellId}，持续时间 ${duration / 1000} 秒`);

    return {
      success: true,
      itemId: itemInstanceId,
      itemType: 'seal',
      itemName: '查封令',
      effects,
      sealState,
    };
  }

  /**
   * 使用复活令
   *
   * @param playerId 使用者玩家 ID
   * * @param itemInstanceId 道具实例 ID
   * @param targetPlayerId 目标玩家 ID（破产玩家）
   * @param socket Socket 连接
   * @returns 使用结果
   */
  private useReviveOrder(
    playerId: string,
    itemInstanceId: string,
    targetPlayerId: string,
    socket: TypedSocket,
  ): ItemUseResult {
    // 验证目标玩家
    const targetPlayer = this.world.getPlayer(targetPlayerId);
    if (!targetPlayer) {
      return { success: false, error: '目标玩家不存在' };
    }

    // 检查目标玩家是否破产
    if (targetPlayer.status !== PlayerStatusEnum.Bankrupt) {
      return { success: false, error: '目标玩家未破产' };
    }

    // 获取使用者玩家
    const userPlayer = this.world.getPlayer(playerId);
    if (!userPlayer) {
      return { success: false, error: '使用者不存在' };
    }

    // 获取复活令奖励配置
    const creditBonus = this.registry.getReviveCreditBonus();

    // 复活玩家
    const effects: ItemEffectResult[] = [];

    // 恢复目标玩家状态为正常
    targetPlayer.status = PlayerStatusEnum.Normal;

    // 恢复目标玩家位置到起点（默认为格子 0）
    const startCellId = this.getStartCellId();
    targetPlayer.position = { cellId: startCellId };

    // 恢复目标玩家财产（使用 Bank 的初始财产配置）
    const initialWealth = this.getInitialWealth();
    if (targetPlayer.values?.['money']) {
      const oldValue = targetPlayer.values['money'].current;
      const newValue = initialWealth;
      targetPlayer.values['money'].current = newValue;
      effects.push({
        playerId: targetPlayerId,
        fieldId: 'money',
        oldValue,
        newValue,
        delta: newValue - oldValue,
        message: '复活玩家，财产恢复',
      });
    }

    // 增加信用值
    const creditField = targetPlayer.values?.['credit'];
    if (creditField) {
      const oldValue = creditField.current;
      const newValue = oldValue + creditBonus;
      creditField.current = newValue;
      effects.push({
        playerId: targetPlayerId,
        fieldId: 'credit',
        oldValue,
        newValue,
        delta: creditBonus,
        message: '使用复活令，信用值增加',
      });
    }

    // 更新目标玩家数据
    this.world.updatePlayer(targetPlayer);

    // 广播事件
    this.broadcastReviveEvent(userPlayer, targetPlayer, effects, socket);

    logger.info(`玩家 ${playerId} 使用复活令复活玩家 ${targetPlayerId}`);

    return {
      success: true,
      itemId: itemInstanceId,
      itemType: 'revive',
      itemName: '复活令',
      effects,
      revivedPlayerId: targetPlayerId,
    };
  }

  /**
   * 使用通用道具
   *
   * @param player 使用者
   * @param itemInstance 道具实例
   * @param itemDef 道具定义
   * @param socket Socket 连接
   * @returns 使用结果
   */
  private useGenericItem(
    player: Player,
    itemInstance: Item,
    itemDef: ItemDefinition,
    _socket: TypedSocket,
  ): ItemUseResult {
    const effects: ItemEffectResult[] = [];

    // 应用道具效果
    for (const effect of itemDef.effects) {
      const result = this.applyEffect(player, effect);
      if (result) {
        effects.push(result);
      }
    }

    // 更新玩家数据
    this.world.updatePlayer(player);

    // 广播效果
    this.broadcastEffects(effects);

    logger.info(`玩家 ${player.id} 使用道具 ${itemDef.name}`);

    return {
      success: true,
      itemId: itemInstance.id,
      itemType: itemInstance.type,
      itemName: itemDef.name,
      effects,
    };
  }

  /**
   * 应用道具效果
   *
   * @param player 玩家
   * @param effect 道具效果
   * @returns 效果结果或 null
   */
  private applyEffect(player: Player, effect: EventEffect): ItemEffectResult | null {
    const field = player.values?.[effect.field];
    if (!field) {
      logger.warn(`玩家 ${player.id} 字段 ${effect.field} 不存在`);
      return null;
    }

    const oldValue = field.current;
    const newValue = this.applyValueChange(field, effect.delta);

    return {
      playerId: player.id,
      fieldId: effect.field,
      oldValue,
      newValue,
      delta: effect.delta,
      message: effect.message,
    };
  }

  /**
   * 应用数值变化（考虑边界）
   *
   * @param field 数值字段
   * @param delta 变化量
   * @returns 新值
   */
  private applyValueChange(field: { current: number; min?: number; max?: number }, delta: number): number {
    let newValue = field.current + delta;

    if (field.min !== undefined) {
      newValue = Math.max(newValue, field.min);
    }
    if (field.max !== undefined) {
      newValue = Math.min(newValue, field.max);
    }

    field.current = newValue;
    return newValue;
  }

  /**
   * 从玩家移除道具
   *
   * @param player 玩家
   * @param itemInstanceId 道具实例 ID
   */
  private removeItemFromPlayer(player: Player, itemInstanceId: string): void {
    if (!player.items) return;

    const index = player.items.findIndex(item => item.id === itemInstanceId);
    if (index === -1) return;

    const item = player.items[index];
    if (item.quantity > 1) {
      // 数量大于 1，减少数量
      item.quantity -= 1;
    } else {
      // 数量为 1，移除道具
      player.items.splice(index, 1);
    }
  }

  /**
   * 查封格子自动恢复
   *
   * @param sealId 查封 ID
   */
  private unsealCell(sealId: string): void {
    const sealState = this.sealedCells.get(sealId);
    if (!sealState) return;

    // 移除查封状态
    this.sealedCells.delete(sealId);

    // 清理定时器
    const timer = this.sealTimers.get(sealId);
    if (timer) {
      clearTimeout(timer);
      this.sealTimers.delete(sealId);
    }

    // 广播恢复事件
    this.io.emit('server.cellUnsealed', {
      cellId: sealState.cellId,
      sealId,
      unsealedAt: Date.now(),
    });

    logger.info(`格子 ${sealState.cellId} 查封已恢复`);
  }

  /**
   * 获取格子查封状态
   *
   * @param cellId 格子 ID
   * @returns 查封状态或 null
   */
  getSealStateByCellId(cellId: number): SealState | null {
    for (const state of this.sealedCells.values()) {
      if (state.cellId === cellId) {
        return state;
      }
    }
    return null;
  }

  /**
   * 检查格子是否被查封
   *
   * @param cellId 格子 ID
   * @returns 是否被查封
   */
  isCellSealed(cellId: number): boolean {
    return this.getSealStateByCellId(cellId) !== null;
  }

  /**
   * 获取起点格子 ID
   *
   * @returns 起点格子 ID（默认 0）
   */
  private getStartCellId(): number {
    const mapIndex = this.world.getMapIndex();
    if (!mapIndex) return 0;

    // 从地图元数据获取起点格子 ID（默认 0）
    const mapMeta = this.world.getMapMeta();
    return mapMeta?.startCellId ?? 0;
  }

  /**
   * 获取初始财产
   *
   * @returns 初始财产金额
   */
  private getInitialWealth(): number {
    // 从银行配置获取初始财产
    const mapMeta = this.world.getMapMeta();
    return (mapMeta?.config?.startBonus as number | undefined) ?? 2000;
  }

  /**
   * 广播查封事件
   *
   * @param player 使用者
   * @param sealState 查封状态
   * @param effects 效果结果
   * @param socket Socket 连接
   */
  private broadcastSealEvent(
    player: Player,
    sealState: SealState,
    effects: ItemEffectResult[],
    socket: TypedSocket,
  ): void {
    // 发送给使用者
    socket.emit('server.itemUsed', {
      success: true,
      itemType: 'seal',
      itemName: '查封令',
      effects,
      sealState,
    });

    // 广播给所有玩家
    this.io.emit('server.cellSealed', {
      cellId: sealState.cellId,
      playerId: player.id,
      playerName: player.username,
      duration: sealState.duration,
      endTime: sealState.endTime,
    });

    // 广播数值变化
    this.broadcastEffects(effects);
  }

  /**
   * 广播复活事件
   *
   * @param userPlayer 使用者
   * @param targetPlayer 目标玩家
   * @param effects 效果结果
   * @param socket Socket 连接
   */
  private broadcastReviveEvent(
    userPlayer: Player,
    targetPlayer: Player,
    effects: ItemEffectResult[],
    socket: TypedSocket,
  ): void {
    // 发送给使用者
    socket.emit('server.itemUsed', {
      success: true,
      itemType: 'revive',
      itemName: '复活令',
      effects,
      revivedPlayerId: targetPlayer.id,
    });

    // 广播给所有玩家
    this.io.emit('server.playerRevived', {
      targetPlayerId: targetPlayer.id,
      targetPlayerName: targetPlayer.username,
      revivedBy: userPlayer.id,
      revivedByName: userPlayer.username,
    });

    // 广播数值变化
    this.broadcastEffects(effects);

    // 发送给目标玩家
    const targetSocketId = this.world.getPlayerManager().getSocketId(targetPlayer.id);
    if (targetSocketId) {
      const targetSocket = this.io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('server.notification', {
          id: `revive-${Date.now()}`,
          type: 'success',
          title: '复活成功',
          content: `您已被玩家 ${userPlayer.username} 复活！`,
          durationMs: 5000,
        });
      }
    }
  }

  /**
   * 批量广播效果结果
   *
   * @param results 效果结果列表
   */
  private broadcastEffects(results: ItemEffectResult[]): void {
    for (const result of results) {
      this.io.emit('server.valueChanged', {
        playerId: result.playerId,
        fieldId: result.fieldId,
        current: result.newValue,
        delta: result.delta,
      });
    }
  }

  /**
   * 给玩家添加道具（供外部调用）
   *
   * @param playerId 玩家 ID
   * @param itemType 道具类型
   * @returns 是否成功添加
   */
  giveItemToPlayer(playerId: string, itemType: string): boolean {
    const player = this.world.getPlayer(playerId);
    if (!player) {
      logger.warn(`玩家 ${playerId} 不存在，无法添加道具`);
      return false;
    }

    // 检查持有上限
    const maxItems = this.registry.getMaxItemsPerPlayer();
    if (!player.items) {
      player.items = [];
    }

    // 计算当前道具数量
    const currentItemCount = player.items.reduce((sum, item) => sum + item.quantity, 0);
    if (currentItemCount >= maxItems) {
      logger.warn(`玩家 ${playerId} 道具持有已达上限 (${maxItems})`);
      return false;
    }

    // 获取道具定义
    const itemDef = this.registry.getByType(itemType);
    if (!itemDef) {
      logger.warn(`道具类型 ${itemType} 未注册`);
      return false;
    }

    // 查找是否已持有同类道具（支持叠加）
    const existingItem = player.items.find(item => item.type === itemType);
    if (existingItem) {
      // 检查叠加上限
      const maxStack = itemDef.maxStack ?? 1;
      if (existingItem.quantity >= maxStack) {
        logger.warn(`道具 ${itemType} 已达叠加上限 (${maxStack})`);
        return false;
      }
      // 增加数量
      existingItem.quantity += 1;
    } else {
      // 创建新道具实例
      const newItem: Item = {
        id: randomUUID(),
        type: itemType,
        name: itemDef.name,
        quantity: 1,
        acquiredAt: Date.now(),
      };
      player.items.push(newItem);
    }

    // 更新玩家数据
    this.world.updatePlayer(player);

    // 广播道具获得事件
    this.io.emit('server.itemAcquired', {
      playerId,
      itemType,
      itemName: itemDef.name,
      quantity: 1,
    });

    logger.info(`玩家 ${playerId} 获得道具 ${itemDef.name}`);

    return true;
  }

  /**
   * 清理所有查封定时器
   *
   * 用于服务器关闭时清理资源
   */
  cleanup(): void {
    for (const timer of this.sealTimers.values()) {
      clearTimeout(timer);
    }
    this.sealTimers.clear();
    this.sealedCells.clear();
    logger.info('道具系统定时器已清理');
  }

  /**
   * 获取所有查封状态
   *
   * 用于调试或管理
   */
  getAllSealStates(): SealState[] {
    return Array.from(this.sealedCells.values());
  }
}

/**
 * 创建道具效果处理器
 */
export function createItemEffectsHandler(
  io: TypedServer,
  world: GameWorld,
  registry: ItemRegistry,
  bank: Bank,
): ItemEffectsHandler {
  return new ItemEffectsHandler(io, world, registry, bank);
}