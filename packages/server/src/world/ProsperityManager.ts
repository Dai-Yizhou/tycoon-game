/**
 * 繁荣度管理器
 *
 * 负责：
 * - 区域繁荣度计算与管理
 * - 繁荣度昼夜调节（夜晚降低，白天恢复）
 * - 繁荣度对地产收益的影响
 * - 繁荣度对事件概率的影响
 * - 繁荣度广播通知
 *
 * 设计原则：
 * - 繁荣度由纪念碑和时区调节驱动
 * - 夜晚繁荣度降低，白天恢复
 * - 繁荣度影响该区域内的地产收益（租金乘数）
 * - 繁荣度影响该区域内的事件概率
 * - 繁荣度数值范围为 0-100
 */

import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger.js';
import type { TypedServer } from '../transport/SocketManager.js';
import type { GameWorld } from './GameWorld.js';
import type { TimeZoneManager } from './TimeZoneManager.js';
import type { DayNightCycle } from './DayNightCycle.js';
import type { Region } from '@game/shared';

/**
 * 繁荣度事件类型
 */
export const ProsperityEvents = {
  ProsperityChanged: 'prosperityChanged',
  ProsperityUpdated: 'prosperityUpdated',
} as const;

export type ProsperityEventName = (typeof ProsperityEvents)[keyof typeof ProsperityEvents];

/**
 * 繁荣度配置
 */
export interface ProsperityConfig {
  /** 夜晚繁荣度降低系数（0-1，默认 0.3） */
  nightDecayFactor: number;
  /** 白天繁荣度恢复系数（0-1，默认 0.2） */
  dayRecoveryFactor: number;
  /** 繁荣度最小值（默认 0） */
  minProsperity: number;
  /** 繁荣度最大值（默认 100） */
  maxProsperity: number;
  /** 繁荣度更新间隔（毫秒，默认 60000，即 1 分钟） */
  updateInterval: number;
  /** 是否广播繁荣度变化 */
  broadcastChanges: boolean;
  /** 繁荣度对租金的影响系数（默认 0.5，即繁荣度 100 时租金 +50%） */
  rentImpactFactor: number;
  /** 繁荣度对事件概率的影响系数（默认 0.3） */
  eventProbImpactFactor: number;
}

/**
 * 默认繁荣度配置
 */
export const DEFAULT_PROSPERITY_CONFIG: ProsperityConfig = {
  nightDecayFactor: 0.3,
  dayRecoveryFactor: 0.2,
  minProsperity: 0,
  maxProsperity: 100,
  updateInterval: 60000,
  broadcastChanges: true,
  rentImpactFactor: 0.5,
  eventProbImpactFactor: 0.3,
};

/**
 * 区域繁荣度状态
 */
export interface RegionProsperityState {
  /** 区域 ID */
  regionId: string;
  /** 区域显示名 */
  regionName: string;
  /** 当前繁荣度 */
  prosperity: number;
  /** 上次更新时间 */
  lastUpdateTime: number;
  /** 属于该区域的格子 ID 列表 */
  cellIds: number[];
  /** 所属时区 ID（可选） */
  timezoneId?: string;
}

/**
 * 繁荣度变化记录
 */
export interface ProsperityChangeRecord {
  /** 区域 ID */
  regionId: string;
  /** 变化前繁荣度 */
  previous: number;
  /** 变化后繁荣度 */
  current: number;
  /** 变化量 */
  delta: number;
  /** 变化原因 */
  reason: 'night_decay' | 'day_recovery' | 'monument_repair' | 'value_field_changed' | 'manual';
  /** 变化时间 */
  timestamp: number;
}

/**
 * 繁荣度管理器
 */
export class ProsperityManager extends EventEmitter {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly timeZoneManager: TimeZoneManager;
  private readonly dayNightCycle: DayNightCycle;
  private readonly config: ProsperityConfig;

  /** 区域繁荣度映射 */
  private readonly regionProsperities: Map<string, RegionProsperityState> = new Map();
  /** 繁荣度更新定时器 */
  private updateTimer: NodeJS.Timeout | null = null;

  constructor(
    io: TypedServer,
    world: GameWorld,
    timeZoneManager: TimeZoneManager,
    dayNightCycle: DayNightCycle,
    config: ProsperityConfig = DEFAULT_PROSPERITY_CONFIG,
  ) {
    super();
    this.io = io;
    this.world = world;
    this.timeZoneManager = timeZoneManager;
    this.dayNightCycle = dayNightCycle;
    this.config = config;
    this.initializeRegions();

    // 监听昼夜事件，自动调节繁荣度
    this.dayNightCycle.on('dayStarted', () => this.onDayStarted());
    this.dayNightCycle.on('nightStarted', () => this.onNightStarted());
  }

  /**
   * 初始化区域繁荣度
   */
  private initializeRegions(): void {
    const mapMeta = this.world.getMapMeta();
    if (!mapMeta) {
      logger.warn('地图元数据未加载，无法初始化区域繁荣度');
      return;
    }

    // 从 MapMeta.regions 加载区域配置
    const regions = mapMeta.regions;
    if (!regions || regions.length === 0) {
      logger.debug('无区域配置，繁荣度系统暂不启用');
      return;
    }

    // 初始化所有区域
    for (const region of regions) {
      this.regionProsperities.set(region.id, {
        regionId: region.id,
        regionName: region.name,
        prosperity: region.prosperity ?? this.config.maxProsperity,
        lastUpdateTime: Date.now(),
        cellIds: region.cellIds,
        timezoneId: this.inferRegionTimezone(region),
      });
    }

    logger.info(`区域繁荣度初始化完成：${this.regionProsperities.size} 个区域`);
  }

  /**
   * 推断区域所属时区
   */
  private inferRegionTimezone(region: Region): string | undefined {
    // 如果区域格子属于同一时区，返回该时区
    if (region.cellIds.length > 0) {
      const firstCellId = region.cellIds[0];
      const tz = this.timeZoneManager.getCellTimezone(firstCellId);
      return tz?.id;
    }
    return undefined;
  }

  /**
   * 重新初始化区域（地图切换时）
   */
  reinitialize(): void {
    this.regionProsperities.clear();
    this.initializeRegions();
    logger.info('区域繁荣度已重新初始化');
  }

  /**
   * 启动繁荣度更新定时器
   */
  startUpdateTimer(): void {
    if (this.updateTimer) {
      logger.warn('繁荣度更新定时器已在运行');
      return;
    }

    this.updateTimer = setInterval(() => {
      this.updateAllProsperities();
    }, this.config.updateInterval);

    logger.info(`繁荣度更新定时器已启动，间隔 ${this.config.updateInterval} 毫秒`);
  }

  /**
   * 停止繁荣度更新定时器
   */
  stopUpdateTimer(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
      logger.info('繁荣度更新定时器已停止');
    }
  }

  /**
   * 更新所有区域繁荣度
   */
  private updateAllProsperities(): void {
    for (const regionId of this.regionProsperities.keys()) {
      this.updateRegionProsperity(regionId);
    }
  }

  /**
   * 更新单个区域繁荣度
   */
  private updateRegionProsperity(regionId: string): void {
    const state = this.regionProsperities.get(regionId);
    if (!state) return;

    // 判断区域是否处于夜晚（基于所属时区）
    const isNight = this.isRegionInNight(state);

    // 计算繁荣度变化
    const previous = state.prosperity;
    let delta = 0;

    if (isNight) {
      // 夜晚繁荣度降低
      delta = -Math.floor(previous * this.config.nightDecayFactor);
    } else {
      // 白天繁荣度恢复
      const recoveryTarget = this.config.maxProsperity;
      const gap = recoveryTarget - previous;
      delta = Math.min(Math.floor(gap * this.config.dayRecoveryFactor), gap);
    }

    // 应用变化
    const current = Math.max(this.config.minProsperity, Math.min(this.config.maxProsperity, previous + delta));

    if (current !== previous) {
      state.prosperity = current;
      state.lastUpdateTime = Date.now();

      // 广播变化
      this.broadcastProsperityChange(regionId, current, delta, isNight ? 'night_decay' : 'day_recovery');

      // 发出事件
      this.emit(ProsperityEvents.ProsperityChanged, {
        regionId,
        previous,
        current,
        delta,
        reason: isNight ? 'night_decay' : 'day_recovery',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 判断区域是否处于夜晚
   */
  private isRegionInNight(state: RegionProsperityState): boolean {
    if (state.timezoneId) {
      const localTime = this.timeZoneManager.getLocalTime(state.timezoneId);
      return localTime.isNight;
    }

    // 如果没有时区，使用全局昼夜状态
    return this.dayNightCycle.isNight();
  }

  /**
   * 白天开始事件
   */
  private onDayStarted(): void {
    logger.debug('白天开始，繁荣度开始恢复');
    // 立即更新一次繁荣度
    this.updateAllProsperities();
  }

  /**
   * 夜晚开始事件
   */
  private onNightStarted(): void {
    logger.debug('夜晚开始，繁荣度开始降低');
    // 立即更新一次繁荣度
    this.updateAllProsperities();
  }

  /**
   * 手动增加区域繁荣度（纪念碑修缮等）
   */
  increaseProsperity(regionId: string, amount: number, reason: 'monument_repair' | 'value_field_changed' | 'manual' = 'manual'): void {
    const state = this.regionProsperities.get(regionId);
    if (!state) {
      logger.warn(`区域 ${regionId} 不存在`);
      return;
    }

    const previous = state.prosperity;
    const current = Math.min(this.config.maxProsperity, previous + amount);
    const delta = current - previous;

    state.prosperity = current;
    state.lastUpdateTime = Date.now();

    // 广播变化
    this.broadcastProsperityChange(regionId, current, delta, reason);

    // 发出事件
    this.emit(ProsperityEvents.ProsperityChanged, {
      regionId,
      previous,
      current,
      delta,
      reason,
      timestamp: Date.now(),
    });

    logger.debug(`区域 ${regionId} 繁荣度增加 ${delta}，当前 ${current}`);
  }

  /**
   * 手动减少区域繁荣度
   */
  decreaseProsperity(regionId: string, amount: number, reason: 'value_field_changed' | 'manual' = 'manual'): void {
    const state = this.regionProsperities.get(regionId);
    if (!state) {
      logger.warn(`区域 ${regionId} 不存在`);
      return;
    }

    const previous = state.prosperity;
    const current = Math.max(this.config.minProsperity, previous - amount);
    const delta = current - previous;

    state.prosperity = current;
    state.lastUpdateTime = Date.now();

    // 广播变化
    this.broadcastProsperityChange(regionId, current, delta, reason);

    // 发出事件
    this.emit(ProsperityEvents.ProsperityChanged, {
      regionId,
      previous,
      current,
      delta,
      reason,
      timestamp: Date.now(),
    });

    logger.debug(`区域 ${regionId} 繁荣度减少 ${-delta}，当前 ${current}`);
  }

  /**
   * 备选数值字段变化时联动区域繁荣度
   *
   * 当区域内的备选数值（如环保值）变化时，影响区域繁荣度：
   * - 数值升高（delta > 0）→ 繁荣度升高
   * - 数值降低（delta < 0）→ 繁荣度降低
   *
   * 可被 EventEffects 或 PropertyHandler 调用。
   *
   * @param regionId 区域 ID
   * @param fieldId 数值字段 ID（如 'environmental'）
   * @param delta 变化量（正数为增加，负数为减少）
   */
  onValueFieldChanged(regionId: string, fieldId: string, delta: number): void {
    if (delta === 0) return;

    logger.debug(
      `区域 ${regionId} 数值字段 ${fieldId} 变化 ${delta}，联动繁荣度`,
    );

    if (delta > 0) {
      this.increaseProsperity(regionId, delta, 'value_field_changed');
    } else {
      this.decreaseProsperity(regionId, -delta, 'value_field_changed');
    }
  }

  /**
   * 获取区域繁荣度
   */
  getProsperity(regionId: string): number {
    const state = this.regionProsperities.get(regionId);
    return state?.prosperity ?? this.config.maxProsperity;
  }

  /**
   * 获取格子所属区域的繁荣度
   */
  getCellProsperity(cellId: number): number {
    // 查找格子所属区域
    for (const state of this.regionProsperities.values()) {
      if (state.cellIds.includes(cellId)) {
        return state.prosperity;
      }
    }
    // 默认繁荣度
    return this.config.maxProsperity;
  }

  /**
   * 计算繁荣度对租金的影响
   *
   * 租金乘数 = 1 + (prosperity / 100) * rentImpactFactor
   */
  getRentMultiplier(regionId: string): number {
    const prosperity = this.getProsperity(regionId);
    return 1 + (prosperity / 100) * this.config.rentImpactFactor;
  }

  /**
   * 计算繁荣度对事件概率的影响
   *
   * 高繁荣度区域好事概率增加，低繁荣度区域坏事概率增加
   */
  getEventProbModifier(regionId: string): number {
    const prosperity = this.getProsperity(regionId);
    const base = 50; // 中间值
    // 繁荣度越高，modifier 越正；繁荣度越低，modifier 越负
    return ((prosperity - base) / 100) * this.config.eventProbImpactFactor;
  }

  /**
   * 获取区域状态
   */
  getRegionState(regionId: string): RegionProsperityState | undefined {
    return this.regionProsperities.get(regionId);
  }

  /**
   * 获取所有区域状态
   */
  getAllRegionStates(): RegionProsperityState[] {
    return Array.from(this.regionProsperities.values());
  }

  /**
   * 获取区域数量
   */
  getRegionCount(): number {
    return this.regionProsperities.size;
  }

  /**
   * 获取配置
   */
  getConfig(): ProsperityConfig {
    return this.config;
  }

  /**
   * 广播繁荣度变化
   */
  private broadcastProsperityChange(
    regionId: string,
    prosperity: number,
    delta: number,
    reason: string,
  ): void {
    if (!this.config.broadcastChanges) return;

    this.io.emit('server.prosperityChanged', {
      regionId,
      prosperity,
      delta,
      reason,
      timestamp: Date.now(),
    });
  }

  /**
   * 根据格子 ID 查找所属区域
   */
  findRegionByCellId(cellId: number): string | undefined {
    for (const state of this.regionProsperities.values()) {
      if (state.cellIds.includes(cellId)) {
        return state.regionId;
      }
    }
    return undefined;
  }

  /**
   * 获取低繁荣度区域列表（繁荣度 < 阈值）
   */
  getLowProsperityRegions(threshold: number = 30): RegionProsperityState[] {
    return this.getAllRegionStates().filter((s) => s.prosperity < threshold);
  }

  /**
   * 获取高繁荣度区域列表（繁荣度 > 阈值）
   */
  getHighProsperityRegions(threshold: number = 70): RegionProsperityState[] {
    return this.getAllRegionStates().filter((s) => s.prosperity > threshold);
  }
}

/**
 * 快速创建繁荣度管理器实例
 */
export function createProsperityManager(
  io: TypedServer,
  world: GameWorld,
  timeZoneManager: TimeZoneManager,
  dayNightCycle: DayNightCycle,
  config?: ProsperityConfig,
): ProsperityManager {
  return new ProsperityManager(io, world, timeZoneManager, dayNightCycle, config);
}