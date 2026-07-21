/**
 * 破产机制
 *
 * 负责：
 * - 破产判定（财产为负或为零一段时间）
 * - 复活期限（破产玩家可被复活令复活）
 * - 清除地产（未复活则清除所有地产，重回起点）
 * - 破产恢复（重置玩家状态）
 *
 * 设计原则：
 * - 破产判定：净资产连续低于或等于 0 超过一定时间
 * - 复活期限：破产玩家有一段时间可以被复活令复活（Task 15）
 * - 清除机制：超过复活期限，清除所有地产、贷款、税收记录，重回起点
 * - 状态标记：破产玩家状态为 PlayerStatus.Bankrupt
 */

import { PlayerStatus } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { GameWorld } from '../world/GameWorld.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { Bank } from './Bank.js';
import type { Mortgage } from './Mortgage.js';
import type { Taxation } from './Taxation.js';

/**
 * 破产状态记录
 */
export interface BankruptcyRecord {
  /** 破产 ID */
  id: string;
  /** 玩家 ID */
  playerId: string;
  /** 破产时间 */
  bankruptcyTime: number;
  /** 复活截止时间 */
  revivalDeadline: number;
  /** 破产原因 */
  reason: 'negative_net_worth' | 'debt_overdue' | 'manual';
  /** 破产时净资产 */
  netWorthAtBankruptcy: number;
  /** 状态 */
  status: 'pending_revival' | 'completed' | 'revived';
}

/**
 * 破产配置
 */
export interface BankruptcyConfig {
  /** 破产判定时间（净资产为负持续多久才破产，毫秒） */
  bankruptcyThresholdTime: number;
  /** 复活期限（毫秒） */
  revivalPeriod: number;
  /** 复活后初始财产 */
  revivalStartingMoney: number;
  /** 复活后初始信用值 */
  revivalStartingCredit: number;
  /** 破产检查周期（毫秒） */
  bankruptcyCheckInterval: number;
}

/**
 * 默认破产配置
 */
export const DEFAULT_BANKRUPTCY_CONFIG: BankruptcyConfig = {
  bankruptcyThresholdTime: 300000, // 5 分钟
  revivalPeriod: 600000, // 10 分钟
  revivalStartingMoney: 2000, // 复活后初始财产 2000（与客户端一致）
  revivalStartingCredit: 50, // 复活后初始信用值 50
  bankruptcyCheckInterval: 60000, // 每分钟检查一次
};

/**
 * 破产检查状态
 */
interface BankruptcyCheckState {
  /** 玩家 ID */
  playerId: string;
  /** 第一次检测到净资产为负的时间 */
  firstNegativeTime: number | null;
}

/**
 * 破产结果
 */
export interface BankruptcyResult {
  success: boolean;
  bankruptcyId?: string;
  error?: string;
}

/**
 * 复活结果
 */
export interface RevivalResult {
  success: boolean;
  startingMoney?: number;
  startingCredit?: number;
  error?: string;
}

/**
 * 破产机制
 */
export class Bankruptcy {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly bank: Bank;
  private readonly mortgage: Mortgage;
  private readonly taxation: Taxation;
  private readonly config: BankruptcyConfig;
  private readonly bankruptcyRecords: Map<string, BankruptcyRecord> = new Map(); // playerId -> record
  private readonly checkStates: Map<string, BankruptcyCheckState> = new Map(); // playerId -> checkState
  private readonly bankruptcyTimers: Map<string, NodeJS.Timeout> = new Map(); // playerId -> revivalTimer
  private bankruptcyCheckTimer: NodeJS.Timeout | null = null;

  constructor(
    io: TypedServer,
    world: GameWorld,
    bank: Bank,
    mortgage: Mortgage,
    taxation: Taxation,
    config: BankruptcyConfig = DEFAULT_BANKRUPTCY_CONFIG,
  ) {
    this.io = io;
    this.world = world;
    this.bank = bank;
    this.mortgage = mortgage;
    this.taxation = taxation;
    this.config = config;
  }

  /**
   * 启动破产检查定时器
   */
  startBankruptcyCheck(): void {
    if (this.bankruptcyCheckTimer) {
      logger.warn('破产检查定时器已在运行');
      return;
    }

    this.bankruptcyCheckTimer = setInterval(() => {
      this.executeBankruptcyCheck();
    }, this.config.bankruptcyCheckInterval);

    logger.info(`破产检查定时器已启动，周期 ${this.config.bankruptcyCheckInterval} 毫秒`);
  }

  /**
   * 停止破产检查定时器
   */
  stopBankruptcyCheck(): void {
    if (this.bankruptcyCheckTimer) {
      clearInterval(this.bankruptcyCheckTimer);
      this.bankruptcyCheckTimer = null;
      logger.info('破产检查定时器已停止');
    }
  }

  /**
   * 执行破产检查
   *
   * 检查所有玩家的净资产，记录连续为负的时间
   */
  private executeBankruptcyCheck(): void {
    const players = this.world.getAllPlayers();

    for (const player of players) {
      // 已破产玩家不再检查
      if (player.status === PlayerStatus.Bankrupt) {
        continue;
      }

      // 监狱玩家不检查（监狱中资产可能暂时为负）
      if (player.status === PlayerStatus.Jail) {
        continue;
      }

      const netWorth = this.bank.getPlayerNetWorth(player.id);

      // 检查净资产是否为负或为零（财产=0即破产）
      if (netWorth <= 0) {
        // 记录首次检测到负资产的时间
        const state = this.checkStates.get(player.id);
        if (!state || !state.firstNegativeTime) {
          this.checkStates.set(player.id, {
            playerId: player.id,
            firstNegativeTime: Date.now(),
          });
          logger.debug(`玩家 ${player.id} 资产为负，开始破产判定计时`);
        } else {
          // 检查是否超过破产判定时间
          const elapsed = Date.now() - state.firstNegativeTime;
          if (elapsed >= this.config.bankruptcyThresholdTime) {
            // 触发破产
            this.triggerBankruptcy(player.id, 'negative_net_worth');
          }
        }
      } else {
        // 资产恢复，清除检查状态
        const state = this.checkStates.get(player.id);
        if (state) {
          this.checkStates.delete(player.id);
          logger.debug(`玩家 ${player.id} 资产恢复为正，清除破产判定计时`);
        }
      }
    }
  }

  /**
   * 触发破产
   */
  triggerBankruptcy(playerId: string, reason: 'negative_net_worth' | 'debt_overdue' | 'manual'): BankruptcyResult {
    const player = this.world.getPlayer(playerId);
    if (!player) {
      return { success: false, error: '玩家不存在' };
    }

    // 1. 标记玩家状态为破产
    this.world.getPlayerManager().updateStatus(playerId, PlayerStatus.Bankrupt);

    // 2. 创建破产记录
    const bankruptcyId = `bankruptcy_${playerId}_${Date.now()}`;
    const netWorth = this.bank.getPlayerNetWorth(playerId);

    const record: BankruptcyRecord = {
      id: bankruptcyId,
      playerId,
      bankruptcyTime: Date.now(),
      revivalDeadline: Date.now() + this.config.revivalPeriod,
      reason,
      netWorthAtBankruptcy: netWorth,
      status: 'pending_revival',
    };

    this.bankruptcyRecords.set(playerId, record);

    // 3. 清除检查状态
    this.checkStates.delete(playerId);

    // 4. 设置复活截止定时器
    const timer = setTimeout(() => {
      this.executeLiquidation(playerId);
    }, this.config.revivalPeriod);
    this.bankruptcyTimers.set(playerId, timer);

    // 5. 广播破产事件
    this.io.emit('server.playerBankrupt', {
      playerId,
      bankruptcyId,
      bankruptcyTime: record.bankruptcyTime,
      revivalDeadline: record.revivalDeadline,
      reason,
      netWorthAtBankruptcy: netWorth,
    });

    logger.debug(`玩家 ${playerId} 已破产，原因：${reason}，复活截止时间：${record.revivalDeadline}`);

    return { success: true, bankruptcyId };
  }

  /**
   * 执行清算（超过复活期限）
   *
   * 清除所有地产、贷款、税收记录，重回起点
   */
  private executeLiquidation(playerId: string): void {
    const player = this.world.getPlayer(playerId);
    if (!player) {
      logger.warn(`清算时玩家 ${playerId} 不存在`);
      return;
    }

    const record = this.bankruptcyRecords.get(playerId);
    if (!record || record.status !== 'pending_revival') {
      logger.warn(`玩家 ${playerId} 不处于待复活状态`);
      return;
    }

    logger.debug(`玩家 ${playerId} 超过复活期限，执行清算`);

    // 1. 清除所有地产所有权
    this.clearAllProperties(playerId);

    // 2. 清除所有贷款
    this.bank.clearPlayerLoans(playerId);

    // 3. 清除税收记录
    this.taxation.clearTaxRecords(playerId);

    // 4. 清理相关竞拍
    this.mortgage.clearAllAuctions();

    // 5. 更新破产记录状态
    record.status = 'completed';
    this.bankruptcyRecords.set(playerId, record);

    // 6. 清除定时器
    this.bankruptcyTimers.delete(playerId);

    // 7. 广播清算完成事件
    this.io.emit('server.playerLiquidated', {
      playerId,
      bankruptcyId: record.id,
      liquidationTime: Date.now(),
    });

    logger.debug(`玩家 ${playerId} 清算完成，已清除所有资产`);

    // 注意：此时玩家仍处于破产状态，需要手动移除或等待复活令
  }

  /**
   * 清除玩家所有地产所有权
   */
  private clearAllProperties(playerId: string): void {
    const mapData = this.world.getMapData();
    if (!mapData) return;

    for (const cell of mapData) {
      const owners = getExtra<string[]>(cell, 'owners', []);
      const ownerships = getExtra<Array<{ playerId: string; share: number }>>(cell, 'ownerships', []);

      // 移除玩家所有权
      if (owners.includes(playerId)) {
        const index = owners.indexOf(playerId);
        owners.splice(index, 1);
        cell.extra.owners = owners;
      }

      // 移除玩家持股信息
      const ownershipIndex = ownerships.findIndex(o => o.playerId === playerId);
      if (ownershipIndex >= 0) {
        ownerships.splice(ownershipIndex, 1);
        cell.extra.ownerships = ownerships;
      }

      // 如果地产无所有者，清除抵押状态
      if (owners.length === 0 && ownerships.length === 0) {
        cell.extra.isMortgaged = false;
        cell.extra.level = 0;
      }
    }
  }

  /**
   * 复活破产玩家（使用复活令）
   *
   * Task 15 将实现复活令道具，此处提供接口
   */
  revivePlayer(playerId: string, _socket: TypedSocket): RevivalResult {
    const player = this.world.getPlayer(playerId);
    if (!player) {
      return { success: false, error: '玩家不存在' };
    }

    // 1. 检查玩家是否处于破产状态
    if (player.status !== PlayerStatus.Bankrupt) {
      return { success: false, error: '玩家未破产' };
    }

    // 2. 检查破产记录
    const record = this.bankruptcyRecords.get(playerId);
    if (!record) {
      return { success: false, error: '无破产记录' };
    }

    // 3. 检查是否在复活期限内
    if (record.status !== 'pending_revival') {
      return { success: false, error: '已超过复活期限' };
    }

    // 4. 清除定时器（避免清算）
    const timer = this.bankruptcyTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.bankruptcyTimers.delete(playerId);
    }

    // 5. 重置玩家状态
    this.world.getPlayerManager().updateStatus(playerId, PlayerStatus.Normal);

    // 6. 重置玩家财产和信用值
    player.values['money'] = {
      id: 'money',
      name: '财产',
      current: this.config.revivalStartingMoney,
      min: 0,
    };
    player.values['credit'] = {
      id: 'credit',
      name: '信用值',
      current: this.config.revivalStartingCredit,
      min: 0,
      max: 100,
    };

    // 7. 回到起点
    this.returnToStart(playerId);

    // 8. 更新破产记录状态
    record.status = 'revived';
    this.bankruptcyRecords.set(playerId, record);

    // 9. 更新玩家数据
    this.world.updatePlayer(player);

    // 10. 广播复活事件
    this.io.emit('server.playerRevived', {
      playerId,
      bankruptcyId: record.id,
      revivalTime: Date.now(),
      startingMoney: this.config.revivalStartingMoney,
      startingCredit: this.config.revivalStartingCredit,
    });

    logger.debug(
      `玩家 ${playerId} 已复活，初始财产 ${this.config.revivalStartingMoney}，初始信用值 ${this.config.revivalStartingCredit}`,
    );

    return {
      success: true,
      startingMoney: this.config.revivalStartingMoney,
      startingCredit: this.config.revivalStartingCredit,
    };
  }

  /**
   * 回到起点
   */
  private returnToStart(playerId: string): void {
    const mapData = this.world.getMapData();
    if (!mapData) return;

    // 找到起点格子
    const startCell = mapData.find(cell => {
      const type = getExtra<string>(cell, 'type', '');
      return type === 'start';
    });

    if (!startCell) {
      logger.warn('未找到起点格子');
      return;
    }

    this.world.getPlayerManager().updatePosition(playerId, startCell.id);
  }

  /**
   * 获取玩家的破产记录
   */
  getBankruptcyRecord(playerId: string): BankruptcyRecord | undefined {
    return this.bankruptcyRecords.get(playerId);
  }

  /**
   * 检查玩家是否处于破产状态
   */
  isPlayerBankrupt(playerId: string): boolean {
    const player = this.world.getPlayer(playerId);
    if (!player) return false;
    return player.status === PlayerStatus.Bankrupt;
  }

  /**
   * 检查玩家是否在复活期限内
   */
  isPlayerInRevivalPeriod(playerId: string): boolean {
    const record = this.bankruptcyRecords.get(playerId);
    if (!record) return false;
    return record.status === 'pending_revival';
  }

  /**
   * 获取玩家剩余复活时间（毫秒）
   */
  getRemainingRevivalTime(playerId: string): number {
    const record = this.bankruptcyRecords.get(playerId);
    if (!record || record.status !== 'pending_revival') return 0;

    const remaining = record.revivalDeadline - Date.now();
    return Math.max(0, remaining);
  }

  /**
   * 获取破产配置
   */
  getConfig(): BankruptcyConfig {
    return this.config;
  }

  /**
   * 手动触发破产（管理员或特殊事件）
   */
  manualBankruptcy(playerId: string): BankruptcyResult {
    return this.triggerBankruptcy(playerId, 'manual');
  }

  /**
   * 清理所有破产相关数据（服务器关闭时）
   */
  cleanup(): void {
    this.stopBankruptcyCheck();

    for (const timer of this.bankruptcyTimers.values()) {
      clearTimeout(timer);
    }
    this.bankruptcyTimers.clear();
    this.bankruptcyRecords.clear();
    this.checkStates.clear();

    logger.debug('破产系统已清理所有数据');
  }
}

/**
 * 快速创建破产实例
 */
export function createBankruptcy(
  io: TypedServer,
  world: GameWorld,
  bank: Bank,
  mortgage: Mortgage,
  taxation: Taxation,
  config?: BankruptcyConfig,
): Bankruptcy {
  return new Bankruptcy(io, world, bank, mortgage, taxation, config);
}

// 辅助函数
function getExtra<T>(cell: { extra: Record<string, unknown> }, key: string, defaultValue?: T): T {
  const value = cell.extra[key];
  return ((value as T) ?? defaultValue) as T;
}