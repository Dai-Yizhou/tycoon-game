/**
 * 昼夜循环管理器
 *
 * 负责：
 * - 全局时间管理（基于配置的昼夜周期）
 * - 昼夜状态切换（白天/夜晚）
 * - 昼夜事件触发（计税、交通枢纽变更目的地等）
 * - 广播昼夜变化通知
 *
 * 设计原则：
 * - 昼夜周期由地图元数据决定（map-meta.dayNightCycle），不读 ServerConfig
 * - 白天/夜晚时间比例由地图元数据决定（map-meta.dayNightRatio，默认 0.5）
 * - 白昼窗口以 12:00 为中点：`cycleStartTime` 为游戏日 00:00（UTC+0），
 *   白昼区间为 [dayStart, dayEnd) = [0.5 - dayRatio/2, 0.5 + dayRatio/2)
 * - 相位定义唯一来源为 @game/shared 的 resolveDayNightPhase（两端同构）
 * - 昼夜变化触发相关系统事件（计税、交通枢纽等）
 * - 服务端权威管理全局时间
 */

import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger.js';
import type { TypedServer } from '../transport/SocketManager.js';
import type { TransportHandler } from '../handlers/transportHandler.js';
import { resolveDayNightPhase } from '@game/shared';

/**
 * 昼夜循环事件类型
 */
export const DayNightEvents = {
  DayStarted: 'dayStarted',
  NightStarted: 'nightStarted',
  CycleTick: 'cycleTick',
} as const;

export type DayNightEventName = (typeof DayNightEvents)[keyof typeof DayNightEvents];

/**
 * 昼夜状态
 */
export enum DayNightPhase {
  /** 白天 */
  Day = 'day',
  /** 夜晚 */
  Night = 'night',
}

/**
 * 昼夜循环配置
 */
export interface DayNightConfig {
  /** 昼夜周期时长（分钟） */
  cycleMinutes: number;
  /** 白天占周期的比例（0-1） */
  dayRatio: number;
  /** 是否启用昼夜事件（交通枢纽目的地变更等） */
  enableEvents: boolean;
  /** 是否广播昼夜变化 */
  broadcastChanges: boolean;
}

/**
 * 默认昼夜配置
 */
export const DEFAULT_DAY_NIGHT_CONFIG: DayNightConfig = {
  cycleMinutes: 15, // 默认 15 分钟周期
  dayRatio: 0.5, // 白天占 50%
  enableEvents: true,
  broadcastChanges: true,
};

/**
 * 昼夜状态快照
 */
export interface DayNightSnapshot {
  /** 当前阶段 */
  phase: DayNightPhase;
  /** 全局时间（Unix 毫秒） */
  globalTime: number;
  /** 周期内进度（0-1） */
  progress: number;
  /** 当前周期开始时间 */
  cycleStartTime: number;
  /** 下次阶段切换时间 */
  nextPhaseChangeTime: number;
}

/**
 * 昼夜循环管理器
 */
export class DayNightCycle extends EventEmitter {
  private readonly io: TypedServer;
  private readonly config: DayNightConfig;
  private readonly transportHandler?: TransportHandler;

  private cycleTimer: NodeJS.Timeout | null = null;
  private phaseChangeTimer: NodeJS.Timeout | null = null;
  private currentPhase: DayNightPhase = DayNightPhase.Day;
  private cycleStartTime: number = Date.now();
  private cycleCount: number = 0;

  constructor(
    io: TypedServer,
    config: DayNightConfig = DEFAULT_DAY_NIGHT_CONFIG,
    transportHandler?: TransportHandler,
  ) {
    super();
    this.io = io;
    this.config = config;
    this.transportHandler = transportHandler;
  }

  /**
   * 启动昼夜循环
   */
  start(): void {
    if (this.cycleTimer) {
      logger.warn('昼夜循环已在运行');
      return;
    }

    this.cycleStartTime = Date.now();
    this.currentPhase = this.phaseAt(this.cycleStartTime);

    // 定时广播周期进度
    const tickInterval = 1000; // 每秒更新一次
    this.cycleTimer = setInterval(() => {
      this.onCycleTick();
    }, tickInterval);
    this.cycleTimer.unref();

    // 定时检查阶段切换
    this.schedulePhaseChange();

    logger.info(`昼夜循环已启动，周期 ${this.config.cycleMinutes} 分钟，白昼占比 ${this.config.dayRatio}`);
    this.broadcastDayNightChange();
  }

  /**
   * 停止昼夜循环
   */
  stop(): void {
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
    if (this.phaseChangeTimer) {
      clearTimeout(this.phaseChangeTimer);
      this.phaseChangeTimer = null;
    }
    logger.info('昼夜循环已停止');
  }

  /**
   * 白昼窗口边界（周期内比例）：以 12:00（0.5）为中点，跨度 dayRatio
   */
  private dayWindow(): { dayStart: number; dayEnd: number } {
    const ratio = this.config.dayRatio > 0 && this.config.dayRatio < 1 ? this.config.dayRatio : 0.5;
    const half = ratio / 2;
    return { dayStart: 0.5 - half, dayEnd: 0.5 + half };
  }

  /**
   * 周期内进度（全局相位，0..1）——与 @game/shared 纯函数同口径（offset=0）
   */
  private globalProgressAt(time: number): number {
    const cycleDurationMs = this.config.cycleMinutes * 60 * 1000;
    if (cycleDurationMs <= 0) return 0;
    return (((time - this.cycleStartTime) % cycleDurationMs) + cycleDurationMs) % cycleDurationMs / cycleDurationMs;
  }

  /**
   * 由时间推导相位（权威口径）
   */
  private phaseAt(time: number): DayNightPhase {
    const phase = resolveDayNightPhase({
      gameElapsedMs: time - this.cycleStartTime,
      cycleDurationMs: this.config.cycleMinutes * 60 * 1000,
      dayRatio: this.config.dayRatio,
      offsetMinutes: 0,
    });
    return phase.isDay ? DayNightPhase.Day : DayNightPhase.Night;
  }

  /**
   * 获取当前昼夜快照
   */
  getSnapshot(): DayNightSnapshot {
    const now = Date.now();
    const cycleDurationMs = this.config.cycleMinutes * 60 * 1000;
    const progress = this.globalProgressAt(now);
    const { dayStart, dayEnd } = this.dayWindow();

    // 计算下次阶段切换时间（游戏日 00:00 起算的固定周期，不重置 cycleStartTime）
    const elapsedInCycle = progress * cycleDurationMs;
    const nextBoundaryFraction =
      elapsedInCycle < dayStart * cycleDurationMs ? dayStart
        : elapsedInCycle < dayEnd * cycleDurationMs ? dayEnd
          : 1;
    const nextPhaseChangeTime = now + (nextBoundaryFraction * cycleDurationMs - elapsedInCycle);

    return {
      phase: this.currentPhase,
      globalTime: now,
      progress,
      cycleStartTime: this.cycleStartTime,
      nextPhaseChangeTime,
    };
  }

  /**
   * 获取当前阶段
   */
  getCurrentPhase(): DayNightPhase {
    return this.currentPhase;
  }

  /**
   * 是否为白天
   */
  isDay(): boolean {
    return this.currentPhase === DayNightPhase.Day;
  }

  /**
   * 是否为夜晚
   */
  isNight(): boolean {
    return this.currentPhase === DayNightPhase.Night;
  }

  /**
   * 周期进度更新
   */
  private onCycleTick(): void {
    const snapshot = this.getSnapshot();
    this.emit(DayNightEvents.CycleTick, snapshot);

    // 每秒广播进度（可选，用于客户端平滑动画）
    if (this.config.broadcastChanges) {
      this.io.emit('server.dayNightProgress', {
        phase: snapshot.phase,
        progress: snapshot.progress,
        dayRatio: this.config.dayRatio,
        globalTime: snapshot.globalTime,
        cycleStartTime: this.cycleStartTime,
        cycleMinutes: this.config.cycleMinutes,
      });
    }
  }

  /**
   * 安排阶段切换（到下一个相位边界：入昼 dayStart 或入夜 dayEnd）
   */
  private schedulePhaseChange(): void {
    const snapshot = this.getSnapshot();
    let nextChangeDelay = snapshot.nextPhaseChangeTime - Date.now();

    // 确保 delay 为正数
    if (nextChangeDelay <= 0) {
      nextChangeDelay = 100;
    }

    this.phaseChangeTimer = this.scheduleLongTimeout(nextChangeDelay);
    this.phaseChangeTimer.unref();
  }

  private scheduleLongTimeout(delayMs: number): NodeJS.Timeout {
    const safeDelay = Math.min(delayMs, 2_147_483_647);
    return setTimeout(() => {
      if (delayMs > safeDelay) {
        this.schedulePhaseChange();
      } else {
        this.onPhaseChange();
      }
    }, safeDelay);
  }

  /**
   * 阶段切换（依据权威相位判定，而非假设固定先后顺序）
   */
  private onPhaseChange(): void {
    const next = this.phaseAt(Date.now());
    if (next !== this.currentPhase) {
      this.currentPhase = next;
      if (next === DayNightPhase.Day) {
        this.emit(DayNightEvents.DayStarted, this.getSnapshot());
        this.cycleCount++;
        logger.debug(`进入白天阶段，第 ${this.cycleCount} 个周期`);

        // 触发周期性事件（交通枢纽变更）
        if (this.config.enableEvents) {
          this.triggerCycleEvents();
        }
      } else {
        this.emit(DayNightEvents.NightStarted, this.getSnapshot());
        logger.debug('进入夜晚阶段');
      }
    }

    // 广播变化
    this.broadcastDayNightChange();

    // 安排下一次阶段切换
    this.schedulePhaseChange();
  }

  /**
   * 触发周期性事件
   */
  private triggerCycleEvents(): void {
    if (this.transportHandler) {
      logger.debug('触发交通枢纽目的地变更');
      this.transportHandler.updateAllHubDestinations();
    }
  }

  /**
   * 广播昼夜变化
   */
  private broadcastDayNightChange(): void {
    if (!this.config.broadcastChanges) return;

    const snapshot = this.getSnapshot();
    this.io.emit('server.dayNightChanged', {
      isDay: snapshot.phase === DayNightPhase.Day,
      dayRatio: this.config.dayRatio,
      globalTime: snapshot.globalTime,
      progress: snapshot.progress,
      cycleStartTime: this.cycleStartTime,
      cycleMinutes: this.config.cycleMinutes,
    });
  }

  /**
   * 手动切换到白天（调试用）：将游戏时钟对齐到正午（progress=0.5）
   */
  forceDay(): void {
    const cycleDurationMs = this.config.cycleMinutes * 60 * 1000;
    this.cycleStartTime = Date.now() - 0.5 * cycleDurationMs;
    this.currentPhase = DayNightPhase.Day;
    this.broadcastDayNightChange();
    this.emit(DayNightEvents.DayStarted, this.getSnapshot());
    logger.debug('手动切换到白天');
    this.schedulePhaseChange();
  }

  /**
   * 手动切换到夜晚（调试用）：将游戏时钟对齐到午夜（progress=0）
   */
  forceNight(): void {
    this.cycleStartTime = Date.now();
    this.currentPhase = DayNightPhase.Night;
    this.broadcastDayNightChange();
    this.emit(DayNightEvents.NightStarted, this.getSnapshot());
    logger.debug('手动切换到夜晚');
    this.schedulePhaseChange();
  }

  /**
   * 获取周期计数
   */
  getCycleCount(): number {
    return this.cycleCount;
  }

  /**
   * 获取配置
   */
  getConfig(): DayNightConfig {
    return this.config;
  }

  /**
   * 获取周期起始时间（供 login handler 同步给客户端）
   */
  getCycleStartTime(): number {
    return this.cycleStartTime;
  }

  /**
   * 更新配置（从地图元数据）
   */
  updateConfig(cycleMinutes: number, dayRatio?: number): void {
    this.config.cycleMinutes = cycleMinutes;
    if (typeof dayRatio === 'number') {
      this.config.dayRatio = dayRatio > 0 && dayRatio < 1 ? dayRatio : 0.5;
    }
    logger.debug(`昼夜周期更新为 ${cycleMinutes} 分钟，白昼占比 ${this.config.dayRatio}`);
  }
}

/**
 * 快速创建昼夜循环实例
 */
export function createDayNightCycle(
  io: TypedServer,
  config?: DayNightConfig,
  transportHandler?: TransportHandler,
): DayNightCycle {
  return new DayNightCycle(io, config, transportHandler);
}
