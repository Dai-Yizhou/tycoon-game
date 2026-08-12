/**
 * 道具处理器（ItemHandler）
 *
 * 负责：
 * - 处理道具使用的 Socket 事件
 * - 验证道具使用权限
 * - 调用道具效果处理器
 * - 广播道具使用结果
 *
 * 设计原则：
 * - 道具使用通过 Socket 事件触发
 * - 道具效果在服务端权威执行
 * - 道具使用需要验证玩家状态
 */

import { PlayerStatus, type AckResult } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import type { ItemRegistry } from '../items/ItemRegistry.js';
import type { ItemEffectsHandler, ItemUseResult } from '../items/ItemEffects.js';
import type { JailHandler } from './jailHandler.js';
import { emitError, ErrorCodes } from '../transport/handlers.js';

/**
 * 道具使用事件载荷
 */
export interface UseItemPayload {
  /** 道具实例 ID */
  itemId: string;
  /** 目标格子 ID（查封令） */
  cellId?: number;
  /** 目标玩家 ID（复活令） */
  playerId?: string;
}

/**
 * 道具处理器
 */
export class ItemHandler {
  private readonly world: GameWorld;
  private readonly registry: ItemRegistry;
  private readonly effectsHandler: ItemEffectsHandler;
  private readonly jailHandler: JailHandler;

  constructor(
    _io: TypedServer,
    world: GameWorld,
    registry: ItemRegistry,
    effectsHandler: ItemEffectsHandler,
    jailHandler: JailHandler,
  ) {
    this.world = world;
    this.registry = registry;
    this.effectsHandler = effectsHandler;
    this.jailHandler = jailHandler;
  }

  /**
   * 注册 Socket 事件处理器
   *
   * @param socket Socket 连接
   */
  register(socket: TypedSocket): void {
    // 处理道具使用事件
    socket.on('client.useItem', (payload: UseItemPayload, ack) => {
      this.handleUseItem(socket, payload, ack);
    });

    // 处理道具列表查询事件
    socket.on('client.getItems', (payload, ack) => {
      this.handleGetItems(socket, payload, ack);
    });

    // 处理道具掉落查询事件（用于事件格掉落道具）
    socket.on('client.requestItemDrop', (payload, ack) => {
      this.handleRequestItemDrop(socket, payload, ack);
    });
  }

  /**
   * 处理道具使用事件
   *
   * @param socket Socket 连接
   * @param payload 事件载荷
   * @param ack 回应函数
   */
  private handleUseItem(
    socket: TypedSocket,
    payload: UseItemPayload,
    ack?: (result: AckResult<ItemUseResult>) => void,
  ): void {
    try {
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

      // 验证道具是否存在
      if (!payload || !payload.itemId) {
        emitError(socket, ErrorCodes.InvalidPayload, '道具 ID 不能为空');
        ack?.({ ok: false, error: 'invalid_payload' });
        return;
      }

      // 检查玩家是否持有该道具
      const itemInstance = player.items?.find(item => item.id === payload.itemId);
      if (!itemInstance) {
        emitError(socket, ErrorCodes.InvalidPayload, '道具不存在');
        ack?.({ ok: false, error: 'item_not_found' });
        return;
      }

      if (player.status === PlayerStatus.Jail) {
        const released = this.jailHandler.useItemToRelease(playerId, payload.itemId);
        if (!released) {
          emitError(socket, ErrorCodes.InvalidOperation, '监狱中只能使用允许的出狱道具');
          ack?.({ ok: false, error: 'jail_release_item_not_allowed' });
          return;
        }
        ack?.({ ok: true, data: { success: true, itemId: payload.itemId, itemType: itemInstance.type } });
        return;
      }

      // 使用道具
      const result = this.effectsHandler.useItem(
        playerId,
        payload.itemId,
        { cellId: payload.cellId, playerId: payload.playerId },
        socket,
      );

      if (result.success) {
        logger.info(`玩家 ${playerId} 使用道具 ${itemInstance.type} 成功`);
        ack?.({ ok: true, data: result });
      } else {
        logger.warn(`玩家 ${playerId} 使用道具失败: ${result.error}`);
        emitError(socket, ErrorCodes.InvalidPayload, result.error ?? '道具使用失败');
        ack?.({ ok: false, error: result.error ?? 'item_use_failed' });
      }
    } catch (err) {
      logger.error('道具使用处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : '内部错误');
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 处理道具列表查询事件
   *
   * @param socket Socket 连接
   * @param payload 事件载荷（可选）
   * @param ack 回应函数
   */
  private handleGetItems(
    socket: TypedSocket,
    _payload: unknown,
    ack?: (result: AckResult<{ items: Array<{ id: string; type: string; name: string; quantity: number }> }>) => void,
  ): void {
    try {
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

      const items = player.items?.map(item => ({
        id: item.id,
        type: item.type,
        name: item.name,
        quantity: item.quantity,
      })) ?? [];

      ack?.({ ok: true, data: { items } });
    } catch (err) {
      logger.error('道具列表查询错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : '内部错误');
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 处理道具掉落请求事件（用于事件格掉落道具）
   *
   * @param socket Socket 连接
   * @param payload 事件载荷
   * @param ack 回应函数
   */
  private handleRequestItemDrop(
    socket: TypedSocket,
    payload: { itemType?: string },
    ack?: (result: AckResult<{ success: boolean; itemType?: string }>) => void,
  ): void {
    try {
      const playerId = socket.data.playerId;
      if (!playerId) {
        emitError(socket, ErrorCodes.NotAuthenticated, '请先登录');
        ack?.({ ok: false, error: 'not_authenticated' });
        return;
      }

      // 随机掉落道具（如果未指定道具类型）
      const itemType = payload?.itemType ?? this.randomDropItemType();
      if (!itemType) {
        logger.warn('无可用道具类型掉落');
        ack?.({ ok: false, error: 'no_item_type' });
        return;
      }

      // 给玩家添加道具
      const success = this.effectsHandler.giveItemToPlayer(playerId, itemType);

      if (success) {
        logger.info(`玩家 ${playerId} 获得道具 ${itemType}`);
        ack?.({ ok: true, data: { success: true, itemType } });
      } else {
        logger.warn(`玩家 ${playerId} 获得道具失败`);
        ack?.({ ok: false, error: 'item_acquisition_failed' });
      }
    } catch (err) {
      logger.error('道具掉落处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : '内部错误');
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 随机掉落道具类型
   *
   * 简化实现：从内置道具列表中随机选择
   * 实际游戏可根据事件配置决定掉落
   *
   * @returns 道具类型或 null
   */
  private randomDropItemType(): string | null {
    const allItems = this.registry.getAll();
    if (allItems.length === 0) {
      return null;
    }

    // 随机选择一个道具类型
    const randomIndex = Math.floor(Math.random() * allItems.length);
    return allItems[randomIndex].id;
  }

  /**
   * 给玩家添加道具（供外部调用）
   *
   * @param playerId 玩家 ID
   * @param itemType 道具类型
   * @returns 是否成功
   */
  giveItemToPlayer(playerId: string, itemType: string): boolean {
    return this.effectsHandler.giveItemToPlayer(playerId, itemType);
  }

  /**
   * 检查格子是否被查封
   *
   * @param cellId 格子 ID
   * @returns 是否被查封
   */
  isCellSealed(cellId: number): boolean {
    return this.effectsHandler.isCellSealed(cellId);
  }

  /**
   * 获取道具注册表
   */
  getRegistry(): ItemRegistry {
    return this.registry;
  }

  /**
   * 获取道具效果处理器
   */
  getEffectsHandler(): ItemEffectsHandler {
    return this.effectsHandler;
  }
}

/**
 * 创建道具处理器
 */
export function createItemHandler(
  io: TypedServer,
  world: GameWorld,
  registry: ItemRegistry,
  effectsHandler: ItemEffectsHandler,
  jailHandler: JailHandler,
): ItemHandler {
  return new ItemHandler(io, world, registry, effectsHandler, jailHandler);
}