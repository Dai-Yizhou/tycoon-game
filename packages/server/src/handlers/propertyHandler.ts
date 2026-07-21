/**
 * 地产处理器
 *
 * 负责：
 * - 无主地产购买（buyProperty socket event）
 * - 自有地产升级（upgradeProperty event）
 * - 他人地产租金扣除（路过他人地产时）
 * - 合租机制（合租购买、持股比例计算）
 * - 所有金钱操作在服务端校验（防作弊）
 *
 * 设计原则：
 * - 所有数值从地图数据动态读取（price、upgradeCost、rent）
 * - 租金计算考虑等级加成（rent[level]）
 * - 合租持股比例：后到玩家支付金额 / (原主人购买金额 + 后到支付)
 * - 服务端权威校验所有金钱操作
 */

import type { AckResult, Cell, Player } from '@game/shared';
import { getExtra, normalizeCellType, CellTypes } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import { ErrorCodes, emitError } from '../transport/handlers.js';
import type { BehaviorEngine, BehaviorExecuteResult } from '../behavior/BehaviorEngine.js';

/**
 * 地产所有权信息
 */
export interface PropertyOwnership {
  /** 所有者玩家 ID */
  playerId: string;
  /** 持股比例（合租时使用） */
  share: number;
  /** 购买时支付的金额 */
  purchasePrice: number;
}

/**
 * 地产处理结果
 */
export interface PropertyResult {
  /** 格子数据（更新后） */
  cell: Cell;
  /** 玩家 ID */
  playerId: string;
  /** 操作类型 */
  action: 'buy' | 'upgrade' | 'rent';
  /** behavior 执行结果（当通过 behavior 配置触发时） */
  behaviorResult?: BehaviorExecuteResult;
}

/**
 * 购买结果
 */
export interface BuyResult {
  cell: Cell;
  ownership: PropertyOwnership;
  /** behavior 执行结果（可选） */
  behaviorResult?: BehaviorExecuteResult;
}

/**
 * 升级结果
 */
export interface UpgradeResult {
  cell: Cell;
  cost: number;
  newLevel: number;
}

/**
 * 租金结果
 */
export interface RentResult {
  rent: number;
  payerId: string;
  ownerId: string;
}

/**
 * 地产处理器
 */
export class PropertyHandler {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  /** 行为执行引擎（可选，由 app.ts 注入） */
  private behaviorEngine: BehaviorEngine | null = null;

  constructor(io: TypedServer, world: GameWorld) {
    this.io = io;
    this.world = world;
  }

  /**
   * 设置行为执行引擎（在 app.ts 中调用）
   *
   * @param engine 行为执行引擎实例
   */
  setBehaviorEngine(engine: BehaviorEngine): void {
    this.behaviorEngine = engine;
    logger.info('BehaviorEngine 已注入 PropertyHandler');
  }

  /**
   * 获取行为执行引擎
   */
  getBehaviorEngine(): BehaviorEngine | null {
    return this.behaviorEngine;
  }

  /**
   * 注册地产事件处理器
   */
  register(socket: TypedSocket): void {
    socket.on('client.buyProperty', (payload, ack) => {
      this.handleBuyProperty(socket, payload, ack);
    });

    socket.on('client.upgradeProperty', (payload, ack) => {
      this.handleUpgradeProperty(socket, payload, ack);
    });
  }

  /**
   * 处理购买地产请求
   */
  private handleBuyProperty(
    socket: TypedSocket,
    payload: { cellId: number },
    ack?: (result: AckResult<{ cell: Cell }>) => void,
  ): void {
    try {
      // 1. 验证玩家身份
      const playerId = socket.data.playerId;
      if (!playerId) {
        emitError(socket, ErrorCodes.NotAuthenticated, '请先登录');
        ack?.({ ok: false, error: 'not_authenticated' });
        return;
      }

      // 2. 获取玩家数据
      const player = this.world.getPlayer(playerId);
      if (!player) {
        emitError(socket, ErrorCodes.PlayerNotFound, '玩家不存在');
        ack?.({ ok: false, error: 'player_not_found' });
        return;
      }

      // 3. 获取地图数据
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        emitError(socket, ErrorCodes.InternalError, '地图未加载');
        ack?.({ ok: false, error: 'map_not_loaded' });
        return;
      }

      // 4. 获取格子数据
      const cell = mapIndex.getById(payload.cellId);
      if (!cell) {
        emitError(socket, ErrorCodes.InvalidPayload, `格子 ${payload.cellId} 不存在`);
        ack?.({ ok: false, error: 'cell_not_found' });
        return;
      }

      // 5. 验证格子类型
      const cellType = normalizeCellType(cell);
      if (cellType !== CellTypes.Property && cellType !== CellTypes.Investment) {
        emitError(socket, ErrorCodes.InvalidPayload, '该格子不可购买');
        ack?.({ ok: false, error: 'not_purchasable' });
        return;
      }

      // 6. 验证格子是否已被购买
      const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
      const ownerships = getExtra<PropertyOwnership[]>(cell, 'ownerships', []) ?? [];
      const alreadyOwned = owners.includes(playerId) || ownerships.some(o => o.playerId === playerId);
      
      if (alreadyOwned) {
        emitError(socket, ErrorCodes.InvalidPayload, '你已经拥有该地产');
        ack?.({ ok: false, error: 'already_owned' });
        return;
      }

      // 7. 获取价格
      const price = getExtra<number>(cell, 'price', 0) ?? 0;
      if (price <= 0) {
        emitError(socket, ErrorCodes.InvalidPayload, '该地产无价格信息');
        ack?.({ ok: false, error: 'no_price' });
        return;
      }

      // 8. 检查玩家财产是否足够
      const money = this.getPlayerMoney(player);
      if (money < price) {
        emitError(socket, ErrorCodes.InvalidPayload, `财产不足，需要 ${price}，当前 ${money}`);
        ack?.({ ok: false, error: 'insufficient_money' });
        return;
      }

      // 9. 执行购买
      const result = this.executeBuyProperty(player, cell, price);
      if (!result) {
        emitError(socket, ErrorCodes.InternalError, '购买失败');
        ack?.({ ok: false, error: 'buy_failed' });
        return;
      }

      // 10. 更新格子到地图数据
      this.updateCell(result.cell);

      // 11. 检查是否有 behavior 字段（作为额外效果）
      const behaviorId = getExtra<string>(cell, 'behavior', '') ?? '';
      if (behaviorId && this.behaviorEngine) {
        const behaviorResult = this.behaviorEngine.executeBehavior(behaviorId, player, {
          cellType: cellType,
          cell: cell,
          action: 'purchase',
        });
        if (behaviorResult) {
          result.behaviorResult = behaviorResult;
          logger.info(
            `玩家 ${playerId} 购买地产后触发 behavior ${behaviorId}: ${behaviorResult.event.msg}`,
          );
        }
      }

      // 12. 广播购买事件
      this.io.emit('server.propertyBought', {
        cell: result.cell,
        playerId,
      });

      // 13. 返回成功结果
      ack?.({ ok: true, data: { cell: result.cell } });
      logger.debug(`玩家 ${playerId} 购买了格子 ${payload.cellId}，价格 ${price}`);
    } catch (err) {
      logger.error('购买地产处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 处理升级地产请求
   */
  private handleUpgradeProperty(
    socket: TypedSocket,
    payload: { cellId: number },
    ack?: (result: AckResult<{ cell: Cell; cost: number }>) => void,
  ): void {
    try {
      // 1. 验证玩家身份
      const playerId = socket.data.playerId;
      if (!playerId) {
        emitError(socket, ErrorCodes.NotAuthenticated, '请先登录');
        ack?.({ ok: false, error: 'not_authenticated' });
        return;
      }

      // 2. 获取玩家数据
      const player = this.world.getPlayer(playerId);
      if (!player) {
        emitError(socket, ErrorCodes.PlayerNotFound, '玩家不存在');
        ack?.({ ok: false, error: 'player_not_found' });
        return;
      }

      // 3. 获取地图数据
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        emitError(socket, ErrorCodes.InternalError, '地图未加载');
        ack?.({ ok: false, error: 'map_not_loaded' });
        return;
      }

      // 4. 获取格子数据
      const cell = mapIndex.getById(payload.cellId);
      if (!cell) {
        emitError(socket, ErrorCodes.InvalidPayload, `格子 ${payload.cellId} 不存在`);
        ack?.({ ok: false, error: 'cell_not_found' });
        return;
      }

      // 5. 验证格子类型
      const cellType = normalizeCellType(cell);
      if (cellType !== CellTypes.Property) {
        emitError(socket, ErrorCodes.InvalidPayload, '该格子不可升级');
        ack?.({ ok: false, error: 'not_upgradeable' });
        return;
      }

      // 6. 验证所有权
      const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
      const ownerships = getExtra<PropertyOwnership[]>(cell, 'ownerships', []) ?? [];
      
      const isOwner = owners.includes(playerId) || ownerships.some(o => o.playerId === playerId);
      if (!isOwner) {
        emitError(socket, ErrorCodes.InvalidPayload, '你不是该地产的所有者');
        ack?.({ ok: false, error: 'not_owner' });
        return;
      }

      // 7. 获取当前等级和升级费用
      const currentLevel = getExtra<number>(cell, 'level', 0) ?? 0;
      const upgradeCosts = getExtra<number[]>(cell, 'upgradeCost', []) ?? [];
      
      // 验证是否可升级（等级上限检查）
      const maxLevel = upgradeCosts.length;
      if (currentLevel >= maxLevel) {
        emitError(socket, ErrorCodes.InvalidPayload, '已达最高等级');
        ack?.({ ok: false, error: 'max_level_reached' });
        return;
      }

      // 8. 获取升级费用
      const upgradeCost = upgradeCosts[currentLevel];
      if (upgradeCost <= 0) {
        emitError(socket, ErrorCodes.InvalidPayload, '升级费用无效');
        ack?.({ ok: false, error: 'invalid_upgrade_cost' });
        return;
      }

      // 9. 检查玩家财产是否足够
      const money = this.getPlayerMoney(player);
      if (money < upgradeCost) {
        emitError(socket, ErrorCodes.InvalidPayload, `财产不足，需要 ${upgradeCost}，当前 ${money}`);
        ack?.({ ok: false, error: 'insufficient_money' });
        return;
      }

      // 10. 执行升级
      const result = this.executeUpgradeProperty(player, cell, upgradeCost);
      if (!result) {
        emitError(socket, ErrorCodes.InternalError, '升级失败');
        ack?.({ ok: false, error: 'upgrade_failed' });
        return;
      }

      // 11. 更新格子到地图数据
      this.updateCell(result.cell);

      // 12. 广播升级事件
      this.io.emit('server.propertyUpgraded', {
        cell: result.cell,
        playerId,
        newLevel: result.newLevel,
        cost: result.cost,
      });

      // 13. 返回成功结果
      ack?.({ ok: true, data: { cell: result.cell, cost: result.cost } });
      logger.debug(`玩家 ${playerId} 升级格子 ${payload.cellId} 到等级 ${result.newLevel}，费用 ${result.cost}`);
    } catch (err) {
      logger.error('升级地产处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 处理租金扣除（路过他人地产时）
   *
   * 由 MovementHandler 在到达格子后调用
   */
  handleRentPayment(
    payerId: string,
    cellId: number,
    _socket: TypedSocket,
  ): RentResult | null {
    try {
      // 1. 获取玩家数据
      const payer = this.world.getPlayer(payerId);
      if (!payer) {
        logger.warn(`租金支付失败：玩家 ${payerId} 不存在`);
        return null;
      }

      // 2. 获取地图数据
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        logger.warn('租金支付失败：地图未加载');
        return null;
      }

      // 3. 获取格子数据
      const cell = mapIndex.getById(cellId);
      if (!cell) {
        logger.warn(`租金支付失败：格子 ${cellId} 不存在`);
        return null;
      }

      // 4. 验证格子类型
      const cellType = normalizeCellType(cell);
      if (cellType !== CellTypes.Property) {
        // 非 property 格子不收租
        return null;
      }

      // 5. 验证所有权
      const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
      const ownerships = getExtra<PropertyOwnership[]>(cell, 'ownerships', []) ?? [];
      
      // 空格子不收租
      if (owners.length === 0 && ownerships.length === 0) {
        return null;
      }

      // 自己的地产不收租
      const isOwner = owners.includes(payerId) || ownerships.some(o => o.playerId === payerId);
      if (isOwner) {
        return null;
      }

      // 6. 获取租金
      const level = getExtra<number>(cell, 'level', 0) ?? 0;
      const rentArray = getExtra<number[]>(cell, 'rent', []) ?? [];
      const rent = rentArray[level] ?? 0;

      if (rent <= 0) {
        return null;
      }

      // 7. 执行租金扣除
      const payerMoney = this.getPlayerMoney(payer);
      const actualRent = Math.min(rent, payerMoney); // 避免负数

      // 扣除路过玩家财产
      this.setPlayerMoney(payer, payerMoney - actualRent);

      // 增加所有者财产（按持股比例分配）
      this.distributeRentToOwners(cell, actualRent);

      // 8. 广播租金支付事件
      this.io.emit('server.valueChanged', {
        playerId: payerId,
        fieldId: 'money',
        current: payerMoney - actualRent,
        delta: -actualRent,
      });

      // 找出主要所有者用于返回
      const mainOwner = owners[0] ?? ownerships[0]?.playerId ?? '';

      logger.debug(`玩家 ${payerId} 向格子 ${cellId} 的所有者支付租金 ${actualRent}`);

      return {
        rent: actualRent,
        payerId,
        ownerId: mainOwner,
      };
    } catch (err) {
      logger.error('租金支付处理错误', err);
      return null;
    }
  }

  /**
   * 执行购买地产操作
   *
   * 支持：单买、合租
   */
  private executeBuyProperty(
    player: Player,
    cell: Cell,
    price: number,
  ): BuyResult | null {
    try {
      // 1. 扣除玩家财产
      const currentMoney = this.getPlayerMoney(player);
      this.setPlayerMoney(player, currentMoney - price);

      // 2. 更新格子所有权
      const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
      const ownerships = getExtra<PropertyOwnership[]>(cell, 'ownerships', []) ?? [];

      if (owners.length === 0 && ownerships.length === 0) {
        // 单买：第一个购买者
        const newOwnership: PropertyOwnership = {
          playerId: player.id,
          share: 1.0, // 100%
          purchasePrice: price,
        };
        
        cell.extra.ownerships = [newOwnership];
        cell.extra.owners = [player.id];
        cell.extra.level = 0;
      } else {
        // 合租：后续购买者
        // 计算持股比例：后到玩家支付金额 / (原主人购买金额 + 后到支付)
        const totalPreviousPrice = ownerships.reduce((sum, o) => sum + o.purchasePrice, 0);
        const newShare = price / (totalPreviousPrice + price);
        
        // 调整原所有者的持股比例
        for (const ownership of ownerships) {
          ownership.share = ownership.purchasePrice / (totalPreviousPrice + price);
        }

        // 添加新所有者
        const newOwnership: PropertyOwnership = {
          playerId: player.id,
          share: newShare,
          purchasePrice: price,
        };
        
        ownerships.push(newOwnership);
        owners.push(player.id);
        
        cell.extra.ownerships = ownerships;
        cell.extra.owners = owners;
      }

      // 3. 更新玩家数据
      this.world.updatePlayer(player);

      return {
        cell,
        ownership: {
          playerId: player.id,
          share: owners.length === 1 ? 1.0 : price / (ownerships.reduce((sum, o) => sum + o.purchasePrice, 0)),
          purchasePrice: price,
        },
      };
    } catch (err) {
      logger.error('购买地产执行错误', err);
      return null;
    }
  }

  /**
   * 执行升级地产操作
   */
  private executeUpgradeProperty(
    player: Player,
    cell: Cell,
    upgradeCost: number,
  ): UpgradeResult | null {
    try {
      // 1. 扣除玩家财产
      const currentMoney = this.getPlayerMoney(player);
      this.setPlayerMoney(player, currentMoney - upgradeCost);

      // 2. 增加格子等级
      const currentLevel = getExtra<number>(cell, 'level', 0) ?? 0;
      const newLevel = currentLevel + 1;
      cell.extra.level = newLevel;

      // 3. 更新玩家数据
      this.world.updatePlayer(player);

      return {
        cell,
        cost: upgradeCost,
        newLevel,
      };
    } catch (err) {
      logger.error('升级地产执行错误', err);
      return null;
    }
  }

  /**
   * 分配租金给所有者（按持股比例）
   */
  private distributeRentToOwners(cell: Cell, totalRent: number): void {
    const ownerships = getExtra<PropertyOwnership[]>(cell, 'ownerships', []) ?? [];
    
    if (ownerships.length === 0) {
      // 无 ownerships 信息，全部给第一个 owner
      const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
      if (owners.length > 0) {
        const owner = this.world.getPlayer(owners[0]);
        if (owner) {
          const currentMoney = this.getPlayerMoney(owner);
          const newMoney = currentMoney + totalRent;
          this.setPlayerMoney(owner, newMoney);
          this.world.updatePlayer(owner);
          this.io.emit('server.valueChanged', {
            playerId: owner.id,
            fieldId: 'money',
            current: newMoney,
            delta: totalRent,
          });
        }
      }
      return;
    }

    // 按持股比例分配
    for (const ownership of ownerships) {
      const owner = this.world.getPlayer(ownership.playerId);
      if (owner) {
        const shareRent = Math.floor(totalRent * ownership.share);
        const currentMoney = this.getPlayerMoney(owner);
        const newMoney = currentMoney + shareRent;
        this.setPlayerMoney(owner, newMoney);
        this.world.updatePlayer(owner);
        this.io.emit('server.valueChanged', {
          playerId: owner.id,
          fieldId: 'money',
          current: newMoney,
          delta: shareRent,
        });
      }
    }
  }

  /**
   * 更新格子到地图数据
   */
  private updateCell(cell: Cell): void {
    const mapData = this.world.getMapData();
    if (!mapData) return;

    const index = mapData.findIndex(c => c.id === cell.id);
    if (index >= 0) {
      mapData[index] = cell;
    }
  }

  /**
   * 获取玩家财产
   */
  private getPlayerMoney(player: Player): number {
    const moneyField = player.values['money'];
    return moneyField?.current ?? 0;
  }

  /**
   * 设置玩家财产
   */
  private setPlayerMoney(player: Player, value: number): void {
    if (player.values['money']) {
      player.values['money'].current = Math.max(0, value); // 防止负数
    } else {
      player.values['money'] = {
        id: 'money',
        name: '财产',
        current: Math.max(0, value),
        min: 0,
      };
    }
  }
}

/**
 * 快速注册地产处理器
 */
export function registerPropertyHandler(io: TypedServer, world: GameWorld): PropertyHandler {
  const handler = new PropertyHandler(io, world);
  // 注册将在 HandlerRegistry.registerForSocket 中调用
  return handler;
}