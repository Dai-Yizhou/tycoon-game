/**
 * 时代管理器
 *
 * 管理时代切换、棋盘结算、纪念碑铭记等功能。
 *
 * 对应需求：
 * - FR-19：记载玩家游戏进展，成就跨棋盘保留，按各方面游戏进展计算天赋值，
 *          各方面表现出色的玩家被写入纪念碑。
 * - FR-20：每个时代结束时进行结算，结算基于所有启用的数值字段，
 *          结算后切换到下一个时代的棋盘，时代切换对应现实世界 3-6 个月。
 */

import type { CellType, EraInfo, MapData, MapMeta, MonumentRecord, Player, ValueField } from '@game/shared';
import { CellTypes, getExtra, normalizeCellType } from '@game/shared';
import type { EraStore } from '../storage/EraStore.js';
import type { GameWorld } from '../world/GameWorld.js';
import type { TypedServer } from '../transport/SocketManager.js';
import type { TalentRegistry } from '../talents/TalentRegistry.js';
import { logger } from '../utils/logger.js';

/**
 * 时代配置
 */
export interface EraConfig {
  /** 时代持续时长（毫秒），默认 90 天 */
  duration: number;
  /** 结算提前时间（毫秒），默认 7 天 */
  settlementAdvanceTime: number;
  /** 新地图 ID */
  newMapId: string;
  /** 新时代名称 */
  newEraName: string;
}

/**
 * 玩家结算数据
 */
export interface PlayerSettlement {
  /** 玩家 ID */
  playerId: string;
  /** 用户 ID */
  userId: string;
  /** 玩家用户名 */
  username: string;
  /** 结算时各数值字段的值 */
  values: Record<string, ValueField>;
  /** 持有地产数量 */
  propertyCount: number;
  /** 持有投资项目数量 */
  investmentCount: number;
  /** 综合评分（多维度归一化加和，不单一以财富论） */
  comprehensiveScore: number;
  /** 天赋值奖励 */
  talentPointsReward: number;
  /** 是否被写入纪念碑 */
  inMonument: boolean;
  /** 纪念碑类别 */
  monumentCategories: string[];
}

/**
 * 时代结算结果
 */
export interface EraSettlementResult {
  /** 结算的时代信息 */
  era: EraInfo;
  /** 所有玩家的结算数据 */
  players: PlayerSettlement[];
  /** 纪念碑铭记列表 */
  monumentRecords: MonumentRecord[];
  /** 结算时间 */
  settledAt: number;
}

/**
 * 时代切换配置（switchToNextEra 使用）
 */
export interface SwitchEraOptions {
  /** 新地图 ID */
  newMapId: string;
  /** 新时代名称 */
  newEraName: string;
  /** 新时代持续时长（毫秒），默认沿用 EraManagerOptions.defaultDuration */
  duration?: number;
  /** 新地图数据（可选，提供则加载到 GameWorld） */
  mapData?: MapData;
  /** 新地图元数据（可选，提供则加载到 GameWorld） */
  mapMeta?: MapMeta;
}

/**
 * 时代管理器可选依赖
 */
export interface EraManagerOptions {
  /** 默认时代持续时长（毫秒），默认 90 天（对应现实 3-6 个月） */
  defaultDuration?: number;
  /** 结算提前广播时间（毫秒），默认 7 天 */
  settlementAdvanceTime?: number;
  /** 天赋注册表（可选，提供则结算时发放天赋值奖励） */
  talentRegistry?: TalentRegistry;
}

/**
 * 时代管理器
 *
 * 负责：
 * - 时代计时与切换触发
 * - 棋盘结算逻辑（基于所有启用的数值字段）
 * - 纪念碑状态更新（各方面表现出色的玩家被铭记）
 * - 天赋值结算（综合多维度评价）
 * - 新棋盘加载与玩家迁移
 *
 * 构造函数接受可选的 GameWorld / TypedServer 依赖：
 * - 提供 GameWorld 时，结算从真实玩家数据计算；否则按空玩家列表结算。
 * - 提供 TypedServer 时，广播 `server.eraEndingSoon` / 结算通知等事件。
 *   `server.eraChanged` 由 GameWorld.setEra 触发，经 SocketManager 自动转发。
 */
export class EraManager {
  private readonly store: EraStore;
  private readonly world?: GameWorld;
  private readonly io?: TypedServer;
  private readonly talentRegistry?: TalentRegistry;
  private readonly defaultDuration: number;
  private readonly settlementAdvanceTime: number;
  private currentEra: EraInfo | null = null;
  private settlementTimer: NodeJS.Timeout | null = null;
  private endingSoonTimer: NodeJS.Timeout | null = null;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(store: EraStore, world?: GameWorld, io?: TypedServer, options?: EraManagerOptions) {
    this.store = store;
    this.world = world;
    this.io = io;
    this.talentRegistry = options?.talentRegistry;
    this.defaultDuration = options?.defaultDuration ?? 90 * 24 * 60 * 60 * 1000;
    this.settlementAdvanceTime = options?.settlementAdvanceTime ?? 7 * 24 * 60 * 60 * 1000;
  }

  /**
   * 初始化时代管理器
   *
   * 加载当前时代，设置定时器。
   */
  async initialize(): Promise<void> {
    this.currentEra = await this.store.loadCurrentEra();

    if (this.currentEra) {
      logger.info(`Era loaded: ${this.currentEra.name} (${this.currentEra.id})`);
      this.setupTimers();
    } else {
      logger.warn('No active era found');
    }
  }

  /**
   * 获取当前时代
   */
  getCurrentEra(): EraInfo | null {
    return this.currentEra;
  }

  /**
   * 创建新时代
   *
   * @param config 时代配置
   * @returns 新时代信息
   */
  async createNewEra(config: EraConfig): Promise<EraInfo> {
    const now = Date.now();

    const newEra: EraInfo = {
      id: `era_${now}`,
      name: config.newEraName,
      mapId: config.newMapId,
      startedAt: now,
      endsAt: now + config.duration,
      monumentRecords: [],
      settled: false,
    };

    await this.store.saveEra(newEra);

    this.currentEra = newEra;
    this.setupTimers();

    logger.info(`New era created: ${newEra.name} (${newEra.id})`);

    return newEra;
  }

  /**
   * 设置定时器
   *
   * - 结算提前广播定时器：到期前发送 `server.eraEndingSoon` 预告
   * - 结算定时器：到期时执行结算
   * - 定期检查：兜底，防止定时器漂移
   */
  private setupTimers(): void {
    // 清除旧定时器
    this.clearTimers();

    if (!this.currentEra) {
      return;
    }

    const now = Date.now();
    const endTime = this.currentEra.endsAt;
    const settlementTime = endTime - this.settlementAdvanceTime;

    // 时代即将结束预告
    if (settlementTime > now) {
      const endingSoonDelay = settlementTime - now;
      this.endingSoonTimer = setTimeout(() => {
        this.announceEraEndingSoon();
      }, endingSoonDelay);

      logger.info(`Era ending-soon announcement scheduled in ${endingSoonDelay / 1000 / 60 / 60} hours`);
    }

    // 设置结算定时器
    if (endTime > now) {
      const settlementDelay = endTime - now;
      this.settlementTimer = setTimeout(() => {
        this.performSettlement().catch((err) => {
          logger.error('Era settlement error:', err);
        });
      }, settlementDelay);

      logger.info(`Settlement scheduled in ${settlementDelay / 1000 / 60 / 60} hours`);
    }

    // 设置定期检查（每小时）
    this.checkInterval = setInterval(() => {
      this.checkEraStatus().catch((err) => {
        logger.error('Era check error:', err);
      });
    }, 60 * 60 * 1000);
  }

  /**
   * 清除定时器
   */
  private clearTimers(): void {
    if (this.settlementTimer) {
      clearTimeout(this.settlementTimer);
      this.settlementTimer = null;
    }
    if (this.endingSoonTimer) {
      clearTimeout(this.endingSoonTimer);
      this.endingSoonTimer = null;
    }
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * 检查时代状态
   */
  private async checkEraStatus(): Promise<void> {
    if (!this.currentEra) {
      return;
    }

    const now = Date.now();

    // 时代已结束
    if (now >= this.currentEra.endsAt && !this.currentEra.settled) {
      await this.performSettlement();
    }
  }

  /**
   * 广播时代即将结束预告（FR-20）
   */
  private announceEraEndingSoon(): void {
    if (!this.currentEra || !this.io) {
      return;
    }

    this.io.emit('server.eraEndingSoon', {
      eraId: this.currentEra.id,
      endsAt: this.currentEra.endsAt,
    });

    logger.info(`Era ending soon announcement sent: ${this.currentEra.name}`);
  }

  /**
   * 执行时代结算
   *
   * 结算基于所有启用的数值字段（财产、信用值、备选数值等），
   * 计算每个玩家的综合评分（多维度归一化，不单一以财富论），
   * 将各方面表现出色的玩家写入纪念碑，并更新天赋值。
   *
   * @returns 结算结果
   */
  async performSettlement(): Promise<EraSettlementResult> {
    if (!this.currentEra) {
      throw new Error('No active era to settle');
    }

    if (this.currentEra.settled) {
      throw new Error('Era already settled');
    }

    logger.info(`Starting era settlement: ${this.currentEra.name}`);

    const now = Date.now();

    // 从 GameWorld 获取所有真实玩家数据；未注入 GameWorld 时按空列表结算
    const players: Player[] = this.world ? this.world.getAllPlayers() : [];

    // 计算玩家结算数据
    const playerSettlements = this.calculatePlayerSettlements(players);

    // 生成纪念碑铭记
    const monumentRecords = this.generateMonumentRecords(playerSettlements);

    // 更新玩家天赋值（基于综合评价）
    this.applyTalentRewards(playerSettlements);

    // 更新时代信息
    this.currentEra.settled = true;
    this.currentEra.settledAt = now;
    this.currentEra.monumentRecords = monumentRecords;

    await this.store.saveEra(this.currentEra);

    // 广播结算通知
    this.broadcastSettlement(playerSettlements, monumentRecords);

    logger.info(
      `Era settled: ${this.currentEra.name}, ${playerSettlements.length} players, ${monumentRecords.length} monument records`,
    );

    return {
      era: this.currentEra,
      players: playerSettlements,
      monumentRecords,
      settledAt: now,
    };
  }

  /**
   * 计算玩家结算数据
   *
   * 综合评分 = Σ（各启用数值字段的归一化值），归一化采用该字段在全体玩家中的最大值。
   * 这保证评价是多维度的：财产、信用值、环保值等各字段权重相同，不单一以财富论。
   */
  private calculatePlayerSettlements(players: Player[]): PlayerSettlement[] {
    // 启用的数值字段（来自地图元数据 valueFieldDefinitions）
    const enabledFieldIds = this.getEnabledValueFieldIds();

    // 预计算每个字段在全体玩家中的最大值（用于归一化）
    const maxByField: Record<string, number> = {};
    for (const fieldId of enabledFieldIds) {
      maxByField[fieldId] = players.reduce((max, p) => {
        const v = p.values[fieldId]?.current ?? 0;
        return v > max ? v : max;
      }, 0);
    }

    return players.map((player) => {
      const propertyCount = this.countPlayerProperties(player.id);
      const investmentCount = this.countPlayerInvestments(player.id);

      // 综合评分：各启用字段归一化值之和
      let comprehensiveScore = 0;
      for (const fieldId of enabledFieldIds) {
        const value = player.values[fieldId]?.current ?? 0;
        const max = maxByField[fieldId] ?? 0;
        comprehensiveScore += max > 0 ? value / max : 0;
      }

      // 天赋值奖励：基于综合评分 + 纪念碑加成 + 地产/投资加成
      const talentPointsReward = this.calculateTalentReward(
        comprehensiveScore,
        propertyCount,
        investmentCount,
      );

      return {
        playerId: player.id,
        userId: player.id, // 简化，实际应该从账号系统获取
        username: player.username,
        values: player.values,
        propertyCount,
        investmentCount,
        comprehensiveScore,
        talentPointsReward,
        inMonument: false,
        monumentCategories: [],
      };
    });
  }

  /**
   * 获取所有启用的数值字段 ID
   *
   * 从地图元数据的 valueFieldDefinitions 读取；未加载地图时回退到默认字段。
   */
  private getEnabledValueFieldIds(): string[] {
    const definitions = this.world?.getMapMeta()?.valueFieldDefinitions;
    if (definitions && definitions.length > 0) {
      return definitions.map((d) => d.id);
    }
    // 回退默认字段
    return ['money', 'credit'];
  }

  /**
   * 计算天赋值奖励（综合多维度评价）
   */
  private calculateTalentReward(
    comprehensiveScore: number,
    propertyCount: number,
    investmentCount: number,
  ): number {
    // 基础奖励：综合评分（每分 2 点，向上取整）
    let reward = Math.floor(comprehensiveScore * 2);

    // 地产规模加成
    if (propertyCount >= 6) {
      reward += 2;
    } else if (propertyCount >= 3) {
      reward += 1;
    }

    // 投资规模加成
    if (investmentCount >= 2) {
      reward += 1;
    }

    return reward;
  }

  /**
   * 生成纪念碑铭记
   *
   * 为每个启用的数值字段找出表现最出色的玩家，生成 `highest_<fieldId>` 类别的铭记；
   * 另外铭记地产最多与投资最多的玩家。
   * 各方面表现出色的玩家都会被写入纪念碑（FR-19）。
   */
  private generateMonumentRecords(settlements: PlayerSettlement[]): MonumentRecord[] {
    const records: MonumentRecord[] = [];

    if (settlements.length === 0) {
      return records;
    }

    const enabledFieldIds = this.getEnabledValueFieldIds();
    const now = Date.now();

    // 各数值字段最高玩家
    for (const fieldId of enabledFieldIds) {
      const top = this.findTopPlayer(settlements, fieldId);
      if (top && (top.values[fieldId]?.current ?? 0) > 0) {
        const category = `highest_${fieldId}`;
        records.push({
          category,
          playerId: top.playerId,
          value: top.values[fieldId]?.current ?? 0,
          achievedAt: now,
        });
        top.inMonument = true;
        top.monumentCategories.push(category);
      }
    }

    // 最多地产
    const mostProperties = settlements.reduce((max, s) =>
      s.propertyCount > (max?.propertyCount ?? 0) ? s : max,
      settlements[0],
    );
    if (mostProperties && mostProperties.propertyCount > 0) {
      records.push({
        category: 'most_properties',
        playerId: mostProperties.playerId,
        value: mostProperties.propertyCount,
        achievedAt: now,
      });
      mostProperties.inMonument = true;
      mostProperties.monumentCategories.push('most_properties');
    }

    // 最多投资
    const mostInvestments = settlements.reduce((max, s) =>
      s.investmentCount > (max?.investmentCount ?? 0) ? s : max,
      settlements[0],
    );
    if (mostInvestments && mostInvestments.investmentCount > 0) {
      records.push({
        category: 'most_investments',
        playerId: mostInvestments.playerId,
        value: mostInvestments.investmentCount,
        achievedAt: now,
      });
      mostInvestments.inMonument = true;
      mostInvestments.monumentCategories.push('most_investments');
    }

    return records;
  }

  /**
   * 找到某数值最高的玩家
   */
  private findTopPlayer(
    settlements: PlayerSettlement[],
    fieldId: string,
  ): PlayerSettlement | null {
    if (settlements.length === 0) {
      return null;
    }

    return settlements.reduce((max, s) => {
      const currentValue = s.values[fieldId]?.current ?? 0;
      const maxValue = max?.values[fieldId]?.current ?? 0;
      return currentValue > maxValue ? s : max;
    });
  }

  /**
   * 统计玩家持有的地产数量
   *
   * 扫描地图数据中类型为 property 的格子，检查 owners / ownerships 是否包含该玩家。
   */
  private countPlayerProperties(playerId: string): number {
    return this.countPlayerOwnedCells(playerId, CellTypes.Property);
  }

  /**
   * 统计玩家持有的投资项目数量
   */
  private countPlayerInvestments(playerId: string): number {
    return this.countPlayerOwnedCells(playerId, CellTypes.Investment);
  }

  /**
   * 统计玩家持有指定类型的格子数量
   */
  private countPlayerOwnedCells(playerId: string, cellType: CellType): number {
    const mapData = this.world?.getMapData();
    if (!mapData) {
      return 0;
    }

    let count = 0;
    for (const cell of mapData) {
      if (normalizeCellType(cell) !== cellType) {
        continue;
      }
      const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
      if (owners.includes(playerId)) {
        count++;
        continue;
      }
      const ownerships = getExtra<Array<{ playerId: string }>>(cell, 'ownerships', []) ?? [];
      if (ownerships.some((o) => o.playerId === playerId)) {
        count++;
      }
    }
    return count;
  }

  /**
   * 应用天赋值奖励
   *
   * 若注入了 TalentRegistry，则将奖励发放到玩家账户；否则仅记录在结算数据中。
   */
  private applyTalentRewards(settlements: PlayerSettlement[]): void {
    if (!this.talentRegistry) {
      return;
    }

    for (const s of settlements) {
      if (s.talentPointsReward > 0) {
        this.talentRegistry.addTalentPoints(s.playerId, s.talentPointsReward);
      }
    }
  }

  /**
   * 广播结算结果
   */
  private broadcastSettlement(
    settlements: PlayerSettlement[],
    monumentRecords: MonumentRecord[],
  ): void {
    if (!this.io) {
      return;
    }

    // 结算通知
    this.io.emit('server.notification', {
      id: `era_settlement_${Date.now()}`,
      type: 'success',
      title: '时代结算完成',
      content: `本时代共有 ${settlements.length} 名玩家参与结算，${monumentRecords.length} 项纪念碑铭记已生成。`,
      durationMs: 0,
    });

    // 纪念碑铭记广播（通过通用通知 + 纪念碑状态）
    for (const record of monumentRecords) {
      this.io.emit('server.notification', {
        id: `monument_${record.category}_${Date.now()}`,
        type: 'info',
        title: '纪念碑铭记',
        content: `类别 ${record.category}：玩家 ${record.playerId} 以 ${record.value} 被写入纪念碑。`,
        durationMs: 5000,
      });
    }
  }

  /**
   * 切换到下一个时代（FR-20）
   *
   * 流程：
   * 1. 广播 `server.eraEndingSoon` 预告
   * 2. 结算当前时代
   * 3. 创建新时代
   * 4. 加载新棋盘（若提供 mapData / mapMeta）
   * 5. 通过 GameWorld.setEra 更新时代状态，触发 `server.eraChanged` 广播
   *
   * @param options 切换配置
   * @returns 新时代信息
   */
  async switchToNextEra(options: SwitchEraOptions): Promise<EraInfo> {
    // 1. 时代即将结束预告
    this.announceEraEndingSoon();

    // 2. 结算当前时代（若未结算）
    if (this.currentEra && !this.currentEra.settled) {
      await this.performSettlement();
    }

    const duration = options.duration ?? this.defaultDuration;

    // 3. 创建新时代
    const newEra = await this.createNewEra({
      duration,
      settlementAdvanceTime: this.settlementAdvanceTime,
      newMapId: options.newMapId,
      newEraName: options.newEraName,
    });

    // 4. 加载新棋盘（若提供地图数据）
    if (this.world && options.mapData && options.mapMeta) {
      const result = this.world.loadMap(options.mapData, options.mapMeta);
      if (result.valid) {
        logger.info(`新棋盘加载成功：${options.mapMeta.id} (${options.mapMeta.name})`);
      } else {
        logger.warn(`新棋盘加载有校验错误：${result.errors.join('; ')}`);
      }
    }

    // 5. 更新 GameWorld 时代状态
    // GameWorld.setEra 会触发 'eraChanged' 世界事件，
    // 由 SocketManager.wireWorldEvents 自动转发为 `server.eraChanged` 广播
    // （包含 previousEraId、newEraId、newMapId）。
    if (this.world) {
      this.world.setEra(newEra);
    }

    logger.info(`Switched to next era: ${newEra.name} (map: ${options.newMapId})`);

    return newEra;
  }

  /**
   * 切换到新地图
   *
   * @param newMapId 新地图 ID
   * @param newEraName 新时代名称
   */
  async switchToNewMap(newMapId: string, newEraName: string): Promise<void> {
    // 先结算当前时代
    if (this.currentEra && !this.currentEra.settled) {
      await this.performSettlement();
    }

    // 创建新时代
    await this.createNewEra({
      duration: this.defaultDuration,
      settlementAdvanceTime: this.settlementAdvanceTime,
      newMapId,
      newEraName,
    });

    // 更新 GameWorld 时代状态（触发 server.eraChanged 广播）
    if (this.world && this.currentEra) {
      this.world.setEra(this.currentEra);
    }

    logger.info(`Switched to new map: ${newMapId}, new era: ${newEraName}`);
  }

  /**
   * 关闭时代管理器
   */
  close(): void {
    this.clearTimers();
    logger.info('Era manager closed');
  }
}
