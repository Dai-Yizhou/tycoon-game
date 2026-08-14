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
 * - 昼夜周期由配置文件决定（dayNightCycleMinutes）
 * - 白天/夜晚时间比例可配置（默认各占 50%）
 * - 昼夜变化触发相关系统事件（计税、交通枢纽等）
 * - 服务端权威管理全局时间
 */

import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger.js';
import type { TypedServer } from '../transport/SocketManager.js';
import type { GameWorld } from './GameWorld.js';
import type { Taxation } from '../economy/Taxation.js';
import type { TransportHandler } from '../handlers/transportHandler.js';

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
  /** 是否启用昼夜事件（计税、交通枢纽变更等） */
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
  private readonly world: GameWorld;
  private readonly config: DayNightConfig;
  private readonly taxation?: Taxation;
  private readonly transportHandler?: TransportHandler;

  private cycleTimer: NodeJS.Timeout | null = null;
  private phaseChangeTimer: NodeJS.Timeout | null = null;
  private currentPhase: DayNightPhase = DayNightPhase.Day;
  private cycleStartTime: number = Date.now();
  private cycleCount: number = 0;

  constructor(
    io: TypedServer,
    world: GameWorld,
    config: DayNightConfig = DEFAULT_DAY_NIGHT_CONFIG,
    taxation?: Taxation,
    transportHandler?: TransportHandler,
  ) {
    super();
    this.io = io;
    this.world = world;
    this.config = config;
    this.taxation = taxation;
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
    this.currentPhase = DayNightPhase.Day;

    // 定时广播周期进度
    const tickInterval = 1000; // 每秒更新一次
    this.cycleTimer = setInterval(() => {
      this.onCycleTick();
    }, tickInterval);
    this.cycleTimer.unref();

    // 定时检查阶段切换
    this.schedulePhaseChange();

    logger.info(`昼夜循环已启动，周期 ${this.config.cycleMinutes} 分钟`);
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
   * 获取当前昼夜快照
   */
  getSnapshot(): DayNightSnapshot {
    const now = Date.now();
    const cycleDurationMs = this.config.cycleMinutes * 60 * 1000;
    const elapsedMs = now - this.cycleStartTime;
    const progress = (elapsedMs % cycleDurationMs) / cycleDurationMs;

    // 计算下次阶段切换时间
    const dayDurationMs = cycleDurationMs * this.config.dayRatio;
    const nextPhaseChangeTime =
      this.currentPhase === DayNightPhase.Day
        ? this.cycleStartTime + dayDurationMs
        : this.cycleStartTime + cycleDurationMs;

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
        globalTime: snapshot.globalTime,
        cycleStartTime: this.cycleStartTime,
        cycleMinutes: this.config.cycleMinutes,
      });
    }
  }

  /**
   * 安排阶段切换
   */
  private schedulePhaseChange(): void {
    const cycleDurationMs = this.config.cycleMinutes * 60 * 1000;
    const dayDurationMs = cycleDurationMs * this.config.dayRatio;

    // 计算到下次阶段切换的时间
    const now = Date.now();
    const elapsedMs = now - this.cycleStartTime;
    let nextChangeDelay: number;

    if (this.currentPhase === DayNightPhase.Day) {
      // 白天阶段，计算到夜晚的时间
      nextChangeDelay = dayDurationMs - elapsedMs;
    } else {
      // 夜晚阶段，计算到下一个周期开始的时间
      nextChangeDelay = cycleDurationMs - elapsedMs;
    }

    // 确保 delay 为正数
    if (nextChangeDelay <= 0) {
      nextChangeDelay = 100;
    }

    this.phaseChangeTimer = setTimeout(() => {
      this.onPhaseChange();
    }, nextChangeDelay);
    this.phaseChangeTimer.unref();
  }

  /**
   * 阶段切换
   */
  private onPhaseChange(): void {
    // 切换阶段
    if (this.currentPhase === DayNightPhase.Day) {
      this.currentPhase = DayNightPhase.Night;
      this.emit(DayNightEvents.NightStarted, this.getSnapshot());
      logger.debug('进入夜晚阶段');
    } else {
      this.currentPhase = DayNightPhase.Day;
      this.emit(DayNightEvents.DayStarted, this.getSnapshot());
      this.cycleCount++;
      this.cycleStartTime = Date.now(); // 开始新周期
      logger.debug(`进入白天阶段，第 ${this.cycleCount} 个周期`);

      // 触发周期性事件（计税、交通枢纽变更）
      if (this.config.enableEvents) {
        this.triggerCycleEvents();
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
    // 1. 计税
    if (this.taxation) {
      const players = this.world.getAllPlayers();
      logger.debug(`触发计税：${players.length} 名玩家`);
      for (const player of players) {
        if (player.status === 'normal') {
          this.taxation.triggerManualTax(player.id);
        }
      }
    }

    // 2. 交通枢纽目的地变更
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
      globalTime: snapshot.globalTime,
      progress: snapshot.progress,
      cycleStartTime: this.cycleStartTime,
      cycleMinutes: this.config.cycleMinutes,
    });
  }

  /**
   * 手动切换到白天（调试用）
   */
  forceDay(): void {
    this.currentPhase = DayNightPhase.Day;
    this.cycleStartTime = Date.now();
    this.broadcastDayNightChange();
    this.emit(DayNightEvents.DayStarted, this.getSnapshot());
    logger.debug('手动切换到白天');
    this.schedulePhaseChange();
  }

  /**
   * 手动切换到夜晚（调试用）
   */
  forceNight(): void {
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
  updateConfig(cycleMinutes: number): void {
    this.config.cycleMinutes = cycleMinutes;
    logger.debug(`昼夜周期更新为 ${cycleMinutes} 分钟`);
  }
}

/**
 * 快速创建昼夜循环实例
 */
export function createDayNightCycle(
  io: TypedServer,
  world: GameWorld,
  config?: DayNightConfig,
  taxation?: Taxation,
  transportHandler?: TransportHandler,
): DayNightCycle {
  return new DayNightCycle(io, world, config, taxation, transportHandler);
}