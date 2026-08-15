/**
 * 计税系统
 *
 * 负责：
 * - 昼夜计税（每过一个昼夜计税一次）
 * - 税率由棋盘配置定义
 * - 税收基于玩家财产和地产
 *
 * 设计原则：
 * - 昼夜周期由服务端配置决定（dayNightCycleMinutes）
 * - 税率由地图元数据配置（MapMeta.taxConfig）
 * - 税收计算考虑财产、地产、投资项目等资产
 */

import type { Player } from '@game/shared';
import { CellTypes, getExtra, normalizeCellType, getValueCurrent } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { GameWorld } from '../world/GameWorld.js';
import type { TypedServer } from '../transport/SocketManager.js';

/**
 * 税收配置
 */
export interface TaxConfig {
  /** 财产税率（小数比例） */
  wealthTaxRate: number;
  /** 地产税率（小数比例） */
  propertyTaxRate: number;
  /** 投资项目税率（小数比例） */
  investmentTaxRate: number;
  /** 最低财产（低于此值免税） */
  minWealthForTax: number;
  /** 最低地产价值（低于此值免税） */
  minPropertyValueForTax: number;
  /** 税收周期（毫秒，由昼夜周期决定） */
  taxInterval: number;
}

/**
 * 税收记录
 */
export interface TaxRecord {
  /** 税收 ID */
  id: string;
  /** 玩家 ID */
  playerId: string;
  /** 财产税 */
  wealthTax: number;
  /** 地产税 */
  propertyTax: number;
  /** 投资税 */
  investmentTax: number;
  /** 总税额 */
  totalTax: number;
  /** 计税时间 */
  timestamp: number;
}

/**
 * 计税结果
 */
export interface TaxResult {
  success: boolean;
  taxRecord?: TaxRecord;
  error?: string;
}

/**
 * 计税系统
 */
export class Taxation {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly config: TaxConfig;
  private readonly taxRecords: Map<string, TaxRecord[]> = new Map(); // playerId -> taxRecords
  private taxTimer: NodeJS.Timeout | null = null;
  private lastTaxTime: number = 0;

  constructor(io: TypedServer, world: GameWorld, config: TaxConfig) {
    this.io = io;
    this.world = world;
    this.config = config;
  }

  /**
   * 启动计税定时器
   *
   * 每过一个昼夜（taxInterval）计税一次
   */
  startTaxTimer(): void {
    if (this.taxTimer) {
      logger.warn('计税定时器已在运行');
      return;
    }

    this.taxTimer = setInterval(() => {
      this.executeTaxCycle();
    }, this.config.taxInterval);
    this.taxTimer.unref(); // 后台定时器：不阻止进程退出（生产环境由 HTTP 服务器保持存活）

    logger.info(`计税定时器已启动，周期 ${this.config.taxInterval} 毫秒`);
  }

  /**
   * 停止计税定时器
   */
  stopTaxTimer(): void {
    if (this.taxTimer) {
      clearInterval(this.taxTimer);
      this.taxTimer = null;
      logger.info('计税定时器已停止');
    }
  }

  /**
   * 执行一次计税周期
   *
   * 对所有活跃玩家进行计税
   */
  private executeTaxCycle(): void {
    this.lastTaxTime = Date.now();
    const players = this.world.getAllPlayers();

    logger.debug(`开始计税周期，共 ${players.length} 名玩家`);

    for (const player of players) {
      if (player.status !== 'normal') {
        // 破产、监狱、冻结状态不计税
        continue;
      }

      this.calculateAndCollectTax(player.id);
    }

    // 广播计税完成事件
    this.io.emit('server.taxCycleComplete', {
      timestamp: this.lastTaxTime,
      playerCount: players.length,
    });

    logger.debug('计税周期完成');
  }

  /**
   * 计算并收取玩家税收
   */
  calculateAndCollectTax(playerId: string): TaxResult {
    const player = this.world.getPlayer(playerId);
    if (!player) {
      return { success: false, error: '玩家不存在' };
    }

    // 1. 计算财产税
    const wealthTax = this.calculateWealthTax(player);

    // 2. 计算地产税
    const propertyTax = this.calculatePropertyTax(playerId);

    // 3. 计算投资税
    const investmentTax = this.calculateInvestmentTax(playerId);

    // 4. 计算总税额
    const totalTax = wealthTax + propertyTax + investmentTax;

    if (totalTax <= 0) {
      return { success: true, taxRecord: undefined };
    }

    // 5. 检查玩家财产是否足够支付
    const playerMoney = this.getPlayerMoney(player);
    const actualTax = Math.min(totalTax, playerMoney);

    // 6. 收取税收
    this.subtractPlayerMoney(player, actualTax);
    this.world.updatePlayer(player);

    // 7. 记录税收
    const taxRecord: TaxRecord = {
      id: `tax_${playerId}_${Date.now()}`,
      playerId,
      wealthTax,
      propertyTax,
      investmentTax,
      totalTax: actualTax,
      timestamp: Date.now(),
    };

    this.addTaxRecord(playerId, taxRecord);

    // 8. 广播税收事件
    this.io.emit('server.taxCollected', {
      playerId,
      wealthTax,
      propertyTax,
      investmentTax,
      totalTax: actualTax,
      timestamp: taxRecord.timestamp,
    });

    logger.debug(
      `玩家 ${playerId} 缴税 ${actualTax}（财产税 ${wealthTax}，地产税 ${propertyTax}，投资税 ${investmentTax})`,
    );

    return { success: true, taxRecord };
  }

  /**
   * 计算财产税
   *
   * 财产税 = max(0, 财产 - minWealth) * wealthTaxRate
   */
  private calculateWealthTax(player: Player): number {
    const money = this.getPlayerMoney(player);
    if (money < this.config.minWealthForTax) {
      return 0;
    }

    return Math.floor(money * this.config.wealthTaxRate);
  }

  /**
   * 计算地产税
   *
   * 地产税 = Σ(地产价值 * propertyTaxRate)
   */
  private calculatePropertyTax(playerId: string): number {
    const mapData = this.world.getMapData();
    if (!mapData) return 0;

    const player = this.world.getPlayer(playerId);
    if (!player) return 0;

    let totalPropertyValue = 0;

    for (const cell of mapData) {
      const cellType = normalizeCellType(cell);
      if (cellType !== CellTypes.Property) continue;

      const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
      if (!owners.includes(playerId)) continue;

      // 检查是否已抵押（抵押地产不收税）
      const isMortgaged = getExtra<boolean | number>(cell, 'isMortgaged', false);
      if (isMortgaged) continue;

      // 计算地产价值（价格 + 升级费用）
      const price = getExtra<number>(cell, 'price', 0) ?? 0;
      const level = getExtra<number>(cell, 'level', 0) ?? 0;
      const upgradeCosts = getExtra<number[]>(cell, 'upgradeCost', []) ?? [];
      const upgradeValue = upgradeCosts.slice(0, level).reduce((sum, cost) => sum + cost, 0);

      const propertyValue = price + upgradeValue;
      totalPropertyValue += propertyValue;
    }

    if (totalPropertyValue < this.config.minPropertyValueForTax) {
      return 0;
    }

    return Math.floor(totalPropertyValue * this.config.propertyTaxRate);
  }

  /**
   * 计算投资税
   *
   * 投资税 = Σ(投资价值 * investmentTaxRate)
   */
  private calculateInvestmentTax(playerId: string): number {
    const mapData = this.world.getMapData();
    if (!mapData) return 0;

    let totalInvestmentValue = 0;

    for (const cell of mapData) {
      const cellType = normalizeCellType(cell);
      if (cellType !== CellTypes.Investment) continue;

      const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
      if (!owners.includes(playerId)) continue;

      // 计算投资价值（价格）
      const price = getExtra<number>(cell, 'price', 0) ?? 0;
      totalInvestmentValue += price;
    }

    return Math.floor(totalInvestmentValue * this.config.investmentTaxRate);
  }

  /**
   * 获取玩家的税收记录
   */
  getPlayerTaxRecords(playerId: string): TaxRecord[] {
    return this.taxRecords.get(playerId) ?? [];
  }

  /**
   * 获取最近一次计税时间
   */
  getLastTaxTime(): number {
    return this.lastTaxTime;
  }

  /**
   * 手动触发计税（测试或特殊事件）
   */
  triggerManualTax(playerId: string): TaxResult {
    return this.calculateAndCollectTax(playerId);
  }

  /**
   * 添加税收记录
   */
  private addTaxRecord(playerId: string, record: TaxRecord): void {
    const records = this.taxRecords.get(playerId) ?? [];
    records.push(record);
    // 只保留最近 10 条记录
    if (records.length > 10) {
      records.shift();
    }
    this.taxRecords.set(playerId, records);
  }

  /**
   * 获取玩家财产
   */
  private getPlayerMoney(player: Player): number {
    return getValueCurrent(player, 'money', 0);
  }

  /**
   * 扣除玩家财产
   */
  private subtractPlayerMoney(player: Player, amount: number): void {
    if (player.values['money']) {
      player.values['money'].current = Math.max(0, player.values['money'].current - amount);
    }
  }

  /**
   * 获取税收配置
   */
  getConfig(): TaxConfig {
    return this.config;
  }

  /**
   * 清除所有税收记录（破产时使用）
   */
  clearTaxRecords(playerId: string): void {
    this.taxRecords.delete(playerId);
    logger.debug(`已清除玩家 ${playerId} 的税收记录`);
  }
}

/**
 * 快速创建计税实例
 */
export function createTaxation(
  io: TypedServer,
  world: GameWorld,
  config: TaxConfig,
): Taxation {
  return new Taxation(io, world, config);
}
