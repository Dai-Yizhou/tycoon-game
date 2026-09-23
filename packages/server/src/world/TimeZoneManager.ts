/**
 * 时区管理器
 *
 * 负责：
 * - 时区划分管理（从地图格子直接声明的数字 UTC 偏移读取）
 * - 本地昼夜相位计算（游戏时钟 UTC+0 基准 + 时区偏移）
 * - 时区查询接口
 *
 * 口径：
 * - 游戏内不存在真实世界时间。游戏时钟以服务端计时器为基准（UTC+0），
 *   时区偏移用于按格子所在时区换算显示与 modifier 求值相位。
 * - 相位定义唯一来源为 @game/shared 的 resolveDayNightPhase（两端同构）。
 */

import { logger } from '../utils/logger.js';
import type { GameWorld } from './GameWorld.js';
import type { TimeZone } from '@game/shared';
import { resolveDayNightPhase } from '@game/shared';
import type { DayNightCycle } from './DayNightCycle.js';

/**
 * 时区本地时间详情（仅暴露相位判定；展示用时钟由客户端按同一纯函数解析）
 */
export interface LocalTimeInfo {
  /** 时区 ID */
  timezoneId: string;
  /** 是否为白天 */
  isDay: boolean;
  /** 是否为夜晚 */
  isNight: boolean;
}

/**
 * 时区变化事件
 */
export interface TimeZoneChangedEvent {
  /** 玩家 ID */
  playerId: string;
  /** 之前的时区 ID */
  fromTimezoneId: string;
  /** 新的时区 ID */
  toTimezoneId: string;
  /** 之前的时区偏移（分钟） */
  fromOffsetMinutes: number;
  /** 新的时区偏移（分钟） */
  toOffsetMinutes: number;
}

/**
 * 时区管理器
 */
export class TimeZoneManager {
  private readonly world: GameWorld;
  private readonly dayNightCycle: DayNightCycle;
  /** 时区映射（timezoneId -> TimeZone） */
  private readonly timezoneMap: Map<string, TimeZone> = new Map();
  /** 格子时区映射（cellId -> timezoneId） */
  private readonly cellTimezoneMap: Map<number, string> = new Map();
  /** 默认时区 ID */
  private defaultTimezoneId: string = 'default';
  /** 玩家上次所在时区（用于检测变化） */
  private readonly playerLastTimezone: Map<string, string> = new Map();

  constructor(world: GameWorld, dayNightCycle: DayNightCycle) {
    this.world = world;
    this.dayNightCycle = dayNightCycle;
    this.initializeTimezones();
  }

  /**
   * 初始化时区（从地图格子直接读取）
   *
   * 权威来源：每个格子在 `map.json` 直接声明数字 `timezone`（UTC 偏移分钟数）。
   */
  private initializeTimezones(): void {
    const mapMeta = this.world.getMapMeta();
    const mapData = this.world.getMapData();
    if (!mapMeta) {
      logger.warn('地图元数据未加载，无法初始化时区');
      return;
    }

    const offsetKey = (offset: number) => `offset:${offset}`;

    let coveredCells = 0;
    if (mapData) {
      for (const cell of mapData) {
        const offset = cell.timezone;
        if (typeof offset !== 'number' || !Number.isFinite(offset)) continue;

        const id = offsetKey(offset);
        let tz = this.timezoneMap.get(id);
        if (!tz) {
          tz = { id, name: formatOffsetLabel(offset), offsetMinutes: offset, cellIds: [] };
          this.timezoneMap.set(id, tz);
        }
        this.cellTimezoneMap.set(cell.id, id);
        if (!tz.cellIds.includes(cell.id)) {
          tz.cellIds.push(cell.id);
        }
        coveredCells++;
      }
    }

    if (this.timezoneMap.size === 0) {
      this.timezoneMap.set(this.defaultTimezoneId, {
        id: this.defaultTimezoneId,
        offsetMinutes: 0,
        cellIds: [],
      });
      logger.debug('无时区配置，创建默认时区');
      return;
    }

    logger.info(
      `时区初始化完成：${this.timezoneMap.size} 个时区（覆盖 ${coveredCells} 个格子）`,
    );
  }

  /**
   * 重新初始化时区（地图切换时）
   */
  reinitialize(): void {
    this.timezoneMap.clear();
    this.cellTimezoneMap.clear();
    this.playerLastTimezone.clear();
    this.initializeTimezones();
    logger.info('时区已重新初始化');
  }

  /**
   * 解析时区的有效偏移（相对全局时间，分钟）
   */
  getEffectiveOffset(timezoneId: string): number {
    const tz = this.timezoneMap.get(timezoneId);
    if (!tz) return 0;
    return tz.offsetMinutes ?? 0;
  }

  /**
   * 获取格子所属时区
   *
   * 权威来源：格子直接声明的数字 UTC 偏移（分钟）。
   * 若初始化时已建立索引则直接返回；否则按偏移解析（动态补录）。
   */
  getCellTimezone(cellId: number): TimeZone | undefined {
    const indexedId = this.cellTimezoneMap.get(cellId);
    if (indexedId) {
      const indexed = this.timezoneMap.get(indexedId);
      if (indexed) return indexed;
    }

    const mapIndex = this.world.getMapIndex();
    if (mapIndex) {
      const cell = mapIndex.getById(cellId);
      if (cell) {
        const offset = cell.timezone;
        if (typeof offset === 'number' && Number.isFinite(offset)) {
          return this.ensureOffsetTimezone(offset, cellId);
        }
      }
    }

    return this.timezoneMap.get(this.defaultTimezoneId);
  }

  /**
   * 按数字偏移获取（或动态创建）一个内部时区条目
   */
  private ensureOffsetTimezone(offset: number, cellId: number): TimeZone {
    const id = `offset:${offset}`;
    let tz = this.timezoneMap.get(id);
    if (!tz) {
      tz = { id, name: formatOffsetLabel(offset), offsetMinutes: offset, cellIds: [] };
      this.timezoneMap.set(id, tz);
    }
    this.cellTimezoneMap.set(cellId, id);
    if (!tz.cellIds.includes(cellId)) {
      tz.cellIds.push(cellId);
    }
    return tz;
  }

  /**
   * 获取时区本地昼夜相位
   */
  getLocalTime(timezoneId: string): LocalTimeInfo {
    const offsetMinutes = this.getEffectiveOffset(timezoneId);
    const snapshot = this.dayNightCycle.getSnapshot();
    const config = this.dayNightCycle.getConfig();
    const phase = resolveDayNightPhase({
      gameElapsedMs: snapshot.globalTime - snapshot.cycleStartTime,
      cycleDurationMs: config.cycleMinutes * 60 * 1000,
      dayRatio: config.dayRatio,
      offsetMinutes,
    });
    return { timezoneId, isDay: phase.isDay, isNight: !phase.isDay };
  }

  /**
   * 获取格子本地昼夜相位
   */
  getCellLocalTime(cellId: number): LocalTimeInfo {
    const tz = this.getCellTimezone(cellId);
    return this.getLocalTime(tz?.id ?? this.defaultTimezoneId);
  }

  /**
   * 获取时区列表
   */
  getTimezones(): TimeZone[] {
    return Array.from(this.timezoneMap.values());
  }

  /**
   * 获取时区数量
   */
  getTimezoneCount(): number {
    return this.timezoneMap.size;
  }

  /**
   * 检查玩家是否跨时区移动
   * 如果发生变化，返回变化事件详情；否则返回 null
   */
  checkPlayerTimezoneChange(playerId: string, newCellId: number): TimeZoneChangedEvent | null {
    const newTz = this.getCellTimezone(newCellId);
    if (!newTz) return null;

    const lastTzId = this.playerLastTimezone.get(playerId);
    this.playerLastTimezone.set(playerId, newTz.id);

    if (!lastTzId || lastTzId === newTz.id) {
      return null;
    }

    const lastTz = this.timezoneMap.get(lastTzId);
    if (!lastTz) return null;

    return {
      playerId,
      fromTimezoneId: lastTzId,
      toTimezoneId: newTz.id,
      fromOffsetMinutes: this.getEffectiveOffset(lastTzId),
      toOffsetMinutes: this.getEffectiveOffset(newTz.id),
    };
  }
}

/**
 * 快速创建时区管理器实例
 */
export function createTimeZoneManager(world: GameWorld, dayNightCycle: DayNightCycle): TimeZoneManager {
  return new TimeZoneManager(world, dayNightCycle);
}

/**
 * 将 UTC 偏移（分钟）格式化为可读标签，如 480 → "UTC+08:00"、-330 → "UTC-05:30"。
 */
function formatOffsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `UTC${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}