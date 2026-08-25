/**
 * 计税系统
 *
 * 负责：
 * - 昼夜计税（每过一个昼夜计税一次）
 * - 税率由棋盘配置定义
 * - 基础税与股份税均按 UCT 逐字段征收
 *
 * 设计原则（UCT）：
 * - 税基 = 玩家 UCT 各 player 字段，逐字段计税，不写死 `money`。
 * - 基础税：某个字段未在 `baseTax.rates.player` 列出则不征；
 *   若 `exemptBelow[field]` 存在且当前值低于该阈值亦免；
 *   应征字段税额 = floor(当前值 × 税率)，以负增量 `+=` 应用到该字段，
 *   且不低于字段的 `min`（由 EconomyService 截断）。
 * - 股份税：按每股 `shareTax.rates.player[fieldId]` 逐字段计税，
 *   税基为该玩家在全部格子的累计持股比例；总持股低于 `exemptBelow` 免股份税。
 * - 不再有基于持股资产的"地产/投资资产税"。
 */

import type { Player, Uct } from '@game/shared';
import { CellTypes, normalizeCellType, getValueCurrent, participatesInEconomy } from '@game/shared';
import { getOwnerships } from './Ownership.js';
import { logger } from '../utils/logger.js';
import type { GameWorld } from '../world/GameWorld.js';
import type { TypedServer } from '../transport/SocketManager.js';
import { EconomyService } from './EconomyService.js';

/**
 * 计税配置（与地图元数据 tax 段同构）
 */
export interface TaxConfig {
  /** 基础税 */
  baseTax: {
    /** 逐字段税率（player 字段，未列字段不征） */
    rates: Uct;
    /** 逐字段免税阈值（低于阈值不征） */
    exemptBelow?: Uct;
    /** 计税周期（毫秒） */
    taxInterval: number;
  };
  /** 股份税 */
  shareTax: {
    /** 每股应税额（player 字段） */
    rates: Uct;
    /** 总持股量低于该值免股份税 */
    exemptBelow?: number;
    /** 计税周期（毫秒） */
    taxInterval: number;
  };
}

/**
 * 税收记录（保存完整 UCT，避免恢复 money 专用字段）
 */
export interface TaxRecord {
  /** 税收 ID */
  id: string;
  /** 玩家 ID */
  playerId: string;
  /** 基础税（逐字段税额） */
  baseTax: Uct;
  /** 股份税（逐字段税额） */
  shareTax: Uct;
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

/** 对 UCT player 字段求和 */
function sumPlayerUct(uct: Uct): number {
  return Object.values(uct.player ?? {}).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

/** 深拷贝玩家 UCT 字段快照，供扣款失败时回滚 */
function clonePlayerValues(player: Player): Player['values'] {
  return Object.fromEntries(Object.entries(player.values).map(([fieldId, value]) => [fieldId, { ...value }]));
}

/**
 * 计税系统
 */
export class Taxation {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly config: TaxConfig;
  private readonly economy: EconomyService;
  private readonly taxRecords: Map<string, TaxRecord[]> = new Map(); // playerId -> taxRecords
  private taxTimer: NodeJS.Timeout | null = null;
  private lastTaxTime: number = 0;

  constructor(io: TypedServer, world: GameWorld, config: TaxConfig, economy: EconomyService = new EconomyService(world)) {
    this.io = io;
    this.world = world;
    this.config = config;
    this.economy = economy;
  }

  /**
   * 启动计税定时器
   *
   * 每过一个昼夜（baseTax.taxInterval）计税一次
   */
  startTaxTimer(): void {
    if (this.taxTimer) {
      logger.warn('计税定时器已在运行');
      return;
    }

    this.taxTimer = setInterval(() => {
      this.executeTaxCycle();
    }, this.config.baseTax.taxInterval);
    this.taxTimer.unref(); // 后台定时器：不阻止进程退出（生产环境由 HTTP 服务器保持存活）

    logger.info(`计税定时器已启动，周期 ${this.config.baseTax.taxInterval} 毫秒`);
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
      if (!participatesInEconomy(player.status)) {
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
    if (!participatesInEconomy(player.status)) {
      return { success: false, error: '当前状态玩家不计税' };
    }

    // 1. 计算基础税（逐字段）
    const baseTax = this.calculateBaseTax(player);

    // 2. 计算股份税（逐字段，按持股量）
    const shareTax = this.calculateShareTax(player);

    // 3. 计算总税额
    const totalTax = sumPlayerUct(baseTax) + sumPlayerUct(shareTax);

    if (totalTax <= 0) {
      return { success: true, taxRecord: undefined };
    }

    // 4. 逐字段扣税（统一 `+=` 负增量，由 EconomyService 保证不低于 min）
    // 事务式扣款：先快照玩家税前状态；任一步扣款失败则回滚已扣字段，不写税收记录、不广播成功。
    // createIfMissing = false：被征税字段必须先存在于玩家，缺失当作配置/状态不一致而失败，而非静默补建。
    const rollbackSnapshot: Player = { ...player, values: clonePlayerValues(player) };
    for (const [fieldId, amount] of Object.entries(baseTax.player ?? {})) {
      const result = this.economy.changeValue(playerId, fieldId, -amount, 'tax', false);
      if (!result.ok) {
        this.world.updatePlayer(rollbackSnapshot);
        logger.warn(`玩家 ${playerId} 基础税扣款失败（${fieldId}）：${result.error ?? '未知错误'}，已回滚`);
        return { success: false, error: `基础税扣款失败（${fieldId}）：${result.error ?? '未知错误'}` };
      }
    }
    for (const [fieldId, amount] of Object.entries(shareTax.player ?? {})) {
      const result = this.economy.changeValue(playerId, fieldId, -amount, 'share-tax', false);
      if (!result.ok) {
        this.world.updatePlayer(rollbackSnapshot);
        logger.warn(`玩家 ${playerId} 股份税扣款失败（${fieldId}）：${result.error ?? '未知错误'}，已回滚`);
        return { success: false, error: `股份税扣款失败（${fieldId}）：${result.error ?? '未知错误'}` };
      }
    }

    const taxRecord: TaxRecord = {
      id: `tax_${playerId}_${Date.now()}`,
      playerId,
      baseTax,
      shareTax,
      totalTax,
      timestamp: Date.now(),
    };

    this.addTaxRecord(playerId, taxRecord);

    // 5. 广播税收事件
    this.io.emit('server.taxCollected', {
      playerId,
      baseTax,
      shareTax,
      totalTax,
      timestamp: taxRecord.timestamp,
    });

    logger.debug(`玩家 ${playerId} 缴税 ${totalTax}（基础税 ${sumPlayerUct(baseTax)}，股份税 ${sumPlayerUct(shareTax)}）`);

    return { success: true, taxRecord };
  }

  /**
   * 计算基础税
   *
   * 对每个已在 `baseTax.rates.player` 声明的字段：
   * 税额 = floor(current × rate)，若 `exemptBelow[field]` 存在且当前值低于阈值则免征。
   */
  private calculateBaseTax(player: Player): Uct {
    const result: Uct = {};
    const rates = this.config.baseTax.rates.player ?? {};
    const exemptBelow = this.config.baseTax.exemptBelow?.player ?? {};

    for (const [fieldId, rate] of Object.entries(rates)) {
      if (!Number.isFinite(rate)) continue;
      const current = getValueCurrent(player, fieldId, 0);
      const threshold = exemptBelow[fieldId];
      if (threshold !== undefined && current < threshold) continue;
      const tax = Math.floor(current * rate);
      if (tax <= 0) continue;
      result.player = result.player ?? {};
      result.player[fieldId] = tax;
    }

    return result;
  }

  /**
   * 计算股份税
   *
   * 税基 = 玩家在全部格子的累计持股比例；总持股低于 `exemptBelow` 免股份税。
   * 对每个 `shareTax.rates.player[fieldId]`：税额 = floor(总持股 × 每股税额)。
   */
  private calculateShareTax(player: Player): Uct {
    const result: Uct = {};
    const rates = this.config.shareTax.rates.player ?? {};
    if (Object.keys(rates).length === 0) return result;

    const totalShares = this.calculateTotalShares(player.id);
    const exemptBelow = this.config.shareTax.exemptBelow ?? 0;
    if (totalShares <= exemptBelow) return result;

    for (const [fieldId, ratePerShare] of Object.entries(rates)) {
      if (!Number.isFinite(ratePerShare)) continue;
      const tax = Math.floor(totalShares * ratePerShare);
      if (tax <= 0) continue;
      result.player = result.player ?? {};
      result.player[fieldId] = tax;
    }

    return result;
  }

  /**
   * 计算玩家在全部产权/投资格子的累计持股比例
   */
  private calculateTotalShares(playerId: string): number {
    const mapData = this.world.getMapData();
    if (!mapData) return 0;
    let total = 0;
    for (const cell of mapData) {
      const cellType = normalizeCellType(cell);
      if (cellType !== CellTypes.Property && cellType !== CellTypes.Investment) continue;
      const ownership = getOwnerships(cell, this.world.getRuntimeState()).find((current) => current.playerId === playerId);
      if (ownership) total += ownership.share;
    }
    return total;
  }

  /**
   * 获取玩家的税收记录
   */
  getPlayerTaxRecords(playerId: string): TaxRecord[] {
    return [...(this.taxRecords.get(playerId) ?? [])];
  }

  getAllTaxRecords(): Record<string, TaxRecord[]> {
    return Object.fromEntries(Array.from(this.taxRecords.entries(), ([playerId, records]) => [playerId, [...records]]));
  }

  restoreTaxRecords(records: Record<string, TaxRecord[]>): void {
    this.taxRecords.clear();
    for (const [playerId, playerRecords] of Object.entries(records)) this.taxRecords.set(playerId, playerRecords.slice(-10));
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
   * 获取计税配置
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
  economy: EconomyService = new EconomyService(world),
): Taxation {
  return new Taxation(io, world, config, economy);
}