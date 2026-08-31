/**
 * 昼夜驱动的 UCT 数值变化服务
 *
 * 负责：
 * - 进入白天/夜晚时，对地图配置的区域 UCT 字段施加一次增量
 * - 配置从地图元数据 `dayNight` 段读取（参考税收实现），不硬编码具体字段名
 *
 * 设计原则（UCT）：
 * - 与玩家/区域 UCT 字段统一处理：凡配置声明为 region 的字段，
 *   进入白天/夜晚时对所有区域施加对应增量（正/负）。
 * - 数值变化通过 `world.changeRegionValue` 应用，由 GameWorld 统一触发
 *   `regionValueChanged` 事件（保存快照、供排行榜/广播使用）。
 * - 未配置 `dayNight` 段时不做任何调整。
 */

import { logger } from '../utils/logger.js';
import type { GameWorld } from './GameWorld.js';
import type { DayNightCycle } from './DayNightCycle.js';
import { DayNightEvents } from './DayNightCycle.js';
import type { Uct } from '@game/shared';
import type { DayNightValueChangeConfig } from '@game/shared';

/**
 * 昼夜 UCT 数值变化服务
 */
export class DayNightValueChange {
  private readonly world: GameWorld;
  private readonly dayNightCycle: DayNightCycle;
  private readonly config: DayNightValueChangeConfig | undefined;

  private readonly onDayStarted = (): void => {
    this.applyPhase(this.config?.day);
  };

  private readonly onNightStarted = (): void => {
    this.applyPhase(this.config?.night);
  };

  constructor(
    world: GameWorld,
    dayNightCycle: DayNightCycle,
    config: DayNightValueChangeConfig | undefined = world.getMapMeta()?.dayNight,
  ) {
    this.world = world;
    this.dayNightCycle = dayNightCycle;
    this.config = config;
    if (this.config) {
      this.dayNightCycle.on(DayNightEvents.DayStarted, this.onDayStarted);
      this.dayNightCycle.on(DayNightEvents.NightStarted, this.onNightStarted);
    }
  }

  /**
   * 停止监听昼夜事件
   */
  stop(): void {
    this.dayNightCycle.off(DayNightEvents.DayStarted, this.onDayStarted);
    this.dayNightCycle.off(DayNightEvents.NightStarted, this.onNightStarted);
  }

  /**
   * 对配置声明的所有区域字段，向所有区域施加一次增量
   */
  private applyPhase(delta: Uct | undefined): void {
    if (!delta) return;
    const regionDeltas = delta.region ?? {};
    const fieldIds = Object.keys(regionDeltas);
    if (fieldIds.length === 0) return;

    const regions = this.world.getMapMeta()?.regions ?? [];
    for (const region of regions) {
      for (const fieldId of fieldIds) {
        const amount = regionDeltas[fieldId];
        if (!Number.isFinite(amount) || amount === 0) continue;
        this.world.changeRegionValue(region.id, fieldId, amount);
        logger.debug(`昼夜切换：区域 ${region.id} 字段 ${fieldId} 变化 ${amount}`);
      }
    }
  }
}

/**
 * 快速创建昼夜 UCT 数值变化服务实例
 */
export function createDayNightValueChange(
  world: GameWorld,
  dayNightCycle: DayNightCycle,
  config?: DayNightValueChangeConfig,
): DayNightValueChange {
  return new DayNightValueChange(world, dayNightCycle, config);
}
