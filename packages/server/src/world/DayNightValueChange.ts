/**
 * 昼夜驱动的 UCT 数值变化服务
 *
 * 负责：
 * - 当某个时区进入白天/夜晚时，对该时区所属区域的地图配置 UCT 字段施加一次增量
 * - 配置从地图元数据 `dayNight` 段读取（参考税收实现），不硬编码具体字段名
 *
 * 设计原则（UCT）：
 * - 区域无时区属性、仅每格声明时区；区域的时区由其格子声明推导（同区域格子时区一致）。
 * - 按「时区去重」触发：每个去重后的时区偏移只判定一次相位，跨相位时对该时区下的
 *   所有区域各施加一次增量，避免同一时区内的多个区域各自重复判定。
 * - 相位定义唯一来源为 @game/shared 的 resolveDayNightPhase（与服务端 DayNightCycle
 *   及客户端同源），不做本地重算。
 * - 数值变化通过 `world.changeRegionValue` 应用，由 GameWorld 统一触发
 *   `regionValueChanged` 事件（保存快照、供排行榜/广播使用）。
 * - 未配置 `dayNight` 段时不做任何调整。
 */

import { logger } from '../utils/logger.js';
import type { GameWorld } from './GameWorld.js';
import type { DayNightCycle } from './DayNightCycle.js';
import { DayNightEvents } from './DayNightCycle.js';
import type { Uct, DayNightValueChangeConfig } from '@game/shared';
import { getLocale, resolveDayNightPhase, t } from '@game/shared';
import { broadcastSystemMessage, formatFieldAmounts, type SystemChatIO } from '../net/systemChat.js';

/**
 * 昼夜 UCT 数值变化服务
 */
export class DayNightValueChange {
  private readonly world: GameWorld;
  private readonly dayNightCycle: DayNightCycle;
  private readonly config: DayNightValueChangeConfig | undefined;
  /** 系统聊天广播目标（可选：未注入时只改数值不发消息） */
  private readonly io: SystemChatIO | undefined;
  /** 去重时区偏移 → 该时区下的区域 ID 列表 */
  private readonly offsetRegions: Map<number, string[]> = new Map();
  /** 各时区上次判定结果（用于检测跨相位）；首次仅记录基线不施加增量 */
  private readonly lastIsDay: Map<number, boolean> = new Map();

  private readonly onTick = (): void => {
    this.evaluate();
  };

  constructor(
    world: GameWorld,
    dayNightCycle: DayNightCycle,
    config: DayNightValueChangeConfig | undefined = world.getMapMeta()?.dayNight,
    io?: SystemChatIO,
  ) {
    this.world = world;
    this.dayNightCycle = dayNightCycle;
    this.config = config;
    this.io = io;
    if (this.config) {
      this.indexRegionOffsets();
      this.dayNightCycle.on(DayNightEvents.CycleTick, this.onTick);
    }
  }

  /**
   * 停止监听昼夜事件
   */
  stop(): void {
    this.dayNightCycle.off(DayNightEvents.CycleTick, this.onTick);
  }

  /**
   * 建立「时区偏移 → 区域列表」索引（区域时区由其格子声明推导）
   */
  private indexRegionOffsets(): void {
    const mapData = this.world.getMapData() ?? [];
    for (const cell of mapData) {
      const offset = cell.timezone;
      if (typeof offset !== 'number' || !Number.isFinite(offset)) continue;
      const regionId = cell.regionId;
      if (!regionId) continue;

      const regions = this.offsetRegions.get(offset) ?? [];
      if (!regions.includes(regionId)) regions.push(regionId);
      this.offsetRegions.set(offset, regions);
    }
  }

  /**
   * 逐时区判定相位，跨相位时对该时区下的所有区域施加对应增量
   */
  private evaluate(): void {
    if (!this.config) return;
    const snapshot = this.dayNightCycle.getSnapshot();
    const cycleConfig = this.dayNightCycle.getConfig();
    const cycleDurationMs = cycleConfig.cycleMinutes * 60 * 1000;
    const baseline = this.lastIsDay.size === 0;

    for (const [offsetMinutes, regionIds] of this.offsetRegions) {
      const phase = resolveDayNightPhase({
        gameElapsedMs: snapshot.globalTime - snapshot.cycleStartTime,
        cycleDurationMs,
        dayRatio: cycleConfig.dayRatio,
        offsetMinutes,
      });
      const previous = this.lastIsDay.get(offsetMinutes);
      this.lastIsDay.set(offsetMinutes, phase.isDay);
      if (baseline || previous === undefined || previous === phase.isDay) continue;

      this.applyPhase(regionIds, phase.isDay ? this.config.day : this.config.night, phase.isDay);
    }
  }

  /**
   * 对指定区域施加一次增量
   */
  private applyPhase(regionIds: string[], delta: Uct | undefined, isDay: boolean): void {
    if (!delta) return;
    const regionDeltas = delta.region ?? {};
    const fieldIds = Object.keys(regionDeltas);
    if (fieldIds.length === 0) return;

    const meta = this.world.getMapMeta();
    const fieldDefinitions = meta?.valueFieldDefinitions ?? [];
    const phaseLabel = t(isDay ? 'server.dayNightPhaseDay' : 'server.dayNightPhaseNight');
    const locale = getLocale();

    for (const regionId of regionIds) {
      const applied: Record<string, number> = {};
      for (const fieldId of fieldIds) {
        const amount = regionDeltas[fieldId];
        if (!Number.isFinite(amount) || amount === 0) continue;
        this.world.changeRegionValue(regionId, fieldId, amount);
        applied[fieldId] = amount;
        logger.debug(`昼夜切换：区域 ${regionId} 字段 ${fieldId} 变化 ${amount}`);
      }
      // 聊天框系统消息：昼夜更替引起的区域数值变化
      const detail = formatFieldAmounts(applied, fieldDefinitions, 'region');
      if (!detail) continue;
      const regionName = meta?.regions.find((region) => region.id === regionId)?.name[locale] ?? regionId;
      if (this.io) broadcastSystemMessage(this.io, t('server.dayNightChanged', { phase: phaseLabel, region: regionName, detail }));
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
  io?: SystemChatIO,
): DayNightValueChange {
  return new DayNightValueChange(world, dayNightCycle, config, io);
}