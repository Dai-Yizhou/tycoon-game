/**
 * 时区管理器
 *
 * 负责：
 * - 时区划分管理（从地图数据读取）
 * - 本地时间计算（基于全局时间 + 时区偏移）
 * - 时区昼夜判定
 * - 时区查询接口
 * - 多层级时区支持（主时区 + 子时区）
 * - 相邻时区查询
 *
 * 设计原则：
 * - 时区划分由地图元数据定义（MapMeta.timezones）
 * - 每个格子属于某个时区（从 cell.timezone 读取）
 * - 不同时区有不同的本地时间和昼夜状态
 * - 时区偏移为分钟数（相对全局时间）
 * - 子时区继承父时区偏移，可拥有更精细的边界
 */

import { logger } from '../utils/logger.js';
import type { GameWorld } from './GameWorld.js';
import type { TimeZone } from '@game/shared';
import { DayNightPhase, type DayNightCycle } from './DayNightCycle.js';

/**
 * 时区状态快照
 */
export interface TimeZoneSnapshot {
  /** 时区 ID */
  timezoneId: string;
  /** 时区显示名 */
  timezoneName?: string;
  /** 时区偏移（分钟） */
  offsetMinutes: number;
  /** 本地时间（Unix 毫秒） */
  localTime: number;
  /** 本地昼夜阶段 */
  localPhase: DayNightPhase;
  /** 格子 ID 列表 */
  cellIds: number[];
  /** 父时区 ID（如果是子时区） */
  parentId?: string;
}

/**
 * 时区本地时间详情
 */
export interface LocalTimeInfo {
  /** 时区 ID */
  timezoneId: string;
  /** 本地时间（Unix 毫秒） */
  localTime: number;
  /** 本地小时（0-23） */
  localHour: number;
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
  /** 子时区映射（parentId -> childId[]） */
  private readonly childrenMap: Map<string, string[]> = new Map();
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
   * 以偏移值为键合成内部时区条目；旧配置 `mapMeta.timezones` 表仅作兼容回退。
   */
  private initializeTimezones(): void {
    const mapMeta = this.world.getMapMeta();
    const mapData = this.world.getMapData();
    if (!mapMeta) {
      logger.warn('地图元数据未加载，无法初始化时区');
      return;
    }

    const offsetKey = (offset: number) => `offset:${offset}`;

    // 1. 以每个格子直接声明的数字偏移为准建立内部时区条目
    let coveredCells = 0;
    if (mapData) {
      for (const cell of mapData) {
        const offset = cell.extra?.['timezone'];
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

    // 2. 兼容旧配置：从 timezones 表补充（仅当其格子未被直接偏移覆盖）
    for (const tz of mapMeta.timezones ?? []) {
      if (!this.timezoneMap.has(tz.id)) {
        this.timezoneMap.set(tz.id, { ...tz, cellIds: [...(tz.cellIds ?? [])] });
      }
      for (const cellId of tz.cellIds ?? []) {
        if (!this.cellTimezoneMap.has(cellId)) {
          this.cellTimezoneMap.set(cellId, tz.id);
        }
      }
      if (tz.parentId) {
        const siblings = this.childrenMap.get(tz.parentId) ?? [];
        siblings.push(tz.id);
        this.childrenMap.set(tz.parentId, siblings);
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
      `时区初始化完成：${this.timezoneMap.size} 个时区（覆盖 ${coveredCells} 个格子），其中 ${this.childrenMap.size} 个有时区`,
    );
  }

  /**
   * 重新初始化时区（地图切换时）
   */
  reinitialize(): void {
    this.timezoneMap.clear();
    this.cellTimezoneMap.clear();
    this.childrenMap.clear();
    this.playerLastTimezone.clear();
    this.initializeTimezones();
    logger.info('时区已重新初始化');
  }

  /**
   * 解析时区的有效偏移（考虑父时区继承）
   */
  getEffectiveOffset(timezoneId: string): number {
    const tz = this.timezoneMap.get(timezoneId);
    if (!tz) return 0;

    if (tz.parentId) {
      const parentOffset = this.getEffectiveOffset(tz.parentId);
      return tz.offsetMinutes !== undefined && tz.offsetMinutes !== 0
        ? tz.offsetMinutes
        : parentOffset;
    }

    return tz.offsetMinutes ?? 0;
  }

  /**
   * 获取时区的根父时区（最顶层的主时区）
   */
  getRootTimezone(timezoneId: string): TimeZone | undefined {
    const tz = this.timezoneMap.get(timezoneId);
    if (!tz) return undefined;

    if (!tz.parentId) return tz;

    return this.getRootTimezone(tz.parentId);
  }

  /**
   * 获取时区的父时区链（从当前到根）
   */
  getTimezoneChain(timezoneId: string): TimeZone[] {
    const chain: TimeZone[] = [];
    let currentId: string | undefined = timezoneId;

    while (currentId) {
      const tz = this.timezoneMap.get(currentId);
      if (!tz) break;
      chain.push(tz);
      currentId = tz.parentId;
    }

    return chain;
  }

  /**
   * 获取子时区列表
   */
  getChildTimezones(parentId: string): TimeZone[] {
    const childIds = this.childrenMap.get(parentId) ?? [];
    return childIds
      .map((id) => this.timezoneMap.get(id))
      .filter((tz): tz is TimeZone => tz !== undefined);
  }

  /**
   * 获取格子所属时区
   *
   * 权威来源：格子 `extra.timezone` 声明的数字 UTC 偏移（分钟）。
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
        const offset = cell.extra?.['timezone'];
        if (typeof offset === 'number' && Number.isFinite(offset)) {
          return this.ensureOffsetTimezone(offset, cellId);
        }

        // 兼容旧配置：格子 extra.timezone 可能是时区 ID（字符串），查表回退
        const cellTzId = cell.extra?.['timezone'] as string | undefined;
        if (cellTzId) {
          const tz = this.timezoneMap.get(cellTzId);
          if (tz) {
            this.cellTimezoneMap.set(cellId, cellTzId);
            return tz;
          }
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
   * 检查两个格子是否在相邻的时区内
   * （基于格子的邻接关系及时区归属）
   */
  areTimezonesAdjacent(cellIdA: number, cellIdB: number): boolean {
    const tzA = this.getCellTimezone(cellIdA);
    const tzB = this.getCellTimezone(cellIdB);

    if (!tzA || !tzB) return false;
    if (tzA.id === tzB.id) return false;

    const rootA = this.getRootTimezone(tzA.id);
    const rootB = this.getRootTimezone(tzB.id);

    if (rootA && rootB && rootA.id === rootB.id) {
      return true;
    }

    const mapIndex = this.world.getMapIndex();
    if (!mapIndex) return false;

    const cellA = mapIndex.getById(cellIdA);
    const cellB = mapIndex.getById(cellIdB);
    if (!cellA || !cellB) return false;

    const aAdjacent = cellA.destinations ?? [];
    const bAdjacent = cellB.destinations ?? [];

    for (const adjId of aAdjacent) {
      const adjTz = this.getCellTimezone(adjId);
      if (adjTz && adjTz.id === tzB.id) {
        return true;
      }
    }
    for (const adjId of bAdjacent) {
      const adjTz = this.getCellTimezone(adjId);
      if (adjTz && adjTz.id === tzA.id) {
        return true;
      }
    }

    return false;
  }

  /**
   * 获取与指定时区相邻的时区列表
   */
  getAdjacentTimezones(timezoneId: string): TimeZone[] {
    const tz = this.timezoneMap.get(timezoneId);
    if (!tz) return [];

    const adjacentIds = new Set<string>();
    const mapIndex = this.world.getMapIndex();
    if (!mapIndex) return [];

    for (const cellId of tz.cellIds) {
      const cell = mapIndex.getById(cellId);
      if (!cell) continue;

      for (const adjCellId of cell.destinations ?? []) {
        const adjTz = this.getCellTimezone(adjCellId);
        if (adjTz && adjTz.id !== timezoneId) {
          adjacentIds.add(adjTz.id);
        }
      }
    }

    return Array.from(adjacentIds)
      .map((id) => this.timezoneMap.get(id))
      .filter((t): t is TimeZone => t !== undefined);
  }

  /**
   * 计算时区边界过渡因子（0~1）
   * 用于在时区边界处做平滑过渡效果
   */
  getTimezoneTransitionFactor(cellId: number, fromTimezoneId: string, toTimezoneId: string): number {
    const cellTz = this.getCellTimezone(cellId);
    if (!cellTz) return 0;

    if (cellTz.id === fromTimezoneId) return 0;
    if (cellTz.id === toTimezoneId) return 1;

    const chainFrom = this.getTimezoneChain(fromTimezoneId);
    const chainTo = this.getTimezoneChain(toTimezoneId);
    const chainCell = this.getTimezoneChain(cellTz.id);

    const fromIds = new Set(chainFrom.map((t) => t.id));
    const toIds = new Set(chainTo.map((t) => t.id));

    for (const ct of chainCell) {
      if (toIds.has(ct.id)) return 1;
      if (fromIds.has(ct.id)) return 0;
    }

    return 0.5;
  }

  /**
   * 获取时区本地时间
   */
  getLocalTime(timezoneId: string): LocalTimeInfo {
    const offsetMinutes = this.getEffectiveOffset(timezoneId);
    const snapshot = this.dayNightCycle.getSnapshot();
    const globalTime = snapshot.globalTime;

    const offsetMs = offsetMinutes * 60 * 1000;
    const localTime = globalTime + offsetMs;

    const localHour = Math.floor((localTime / (60 * 60 * 1000)) % 24);

    const cycleDurationMs = this.dayNightCycle.getConfig().cycleMinutes * 60 * 1000;
    const dayRatio = this.dayNightCycle.getConfig().dayRatio;
    const cycleStartTime = snapshot.cycleStartTime;

    const localCycleStartTime = cycleStartTime + offsetMs;
    const localElapsedMs = localTime - localCycleStartTime;
    const localProgress = (localElapsedMs % cycleDurationMs) / cycleDurationMs;

    const isDay = localProgress < dayRatio;
    const isNight = !isDay;

    return {
      timezoneId,
      localTime,
      localHour,
      isDay,
      isNight,
    };
  }

  /**
   * 获取格子本地时间
   */
  getCellLocalTime(cellId: number): LocalTimeInfo {
    const tz = this.getCellTimezone(cellId);
    return this.getLocalTime(tz?.id ?? this.defaultTimezoneId);
  }

  /**
   * 获取时区快照
   */
  getTimezoneSnapshot(timezoneId: string): TimeZoneSnapshot | undefined {
    const tz = this.timezoneMap.get(timezoneId);
    if (!tz) return undefined;

    const localTimeInfo = this.getLocalTime(timezoneId);
    const snapshot = this.dayNightCycle.getSnapshot();
    const offsetMinutes = this.getEffectiveOffset(timezoneId);

    const cycleDurationMs = this.dayNightCycle.getConfig().cycleMinutes * 60 * 1000;
    const dayRatio = this.dayNightCycle.getConfig().dayRatio;
    const offsetMs = offsetMinutes * 60 * 1000;
    const localCycleStartTime = snapshot.cycleStartTime + offsetMs;
    const localElapsedMs = localTimeInfo.localTime - localCycleStartTime;
    const localProgress = (localElapsedMs % cycleDurationMs) / cycleDurationMs;
    const localPhase: DayNightPhase = localProgress < dayRatio ? DayNightPhase.Day : DayNightPhase.Night;

    return {
      timezoneId: tz.id,
      timezoneName: tz.name,
      offsetMinutes,
      localTime: localTimeInfo.localTime,
      localPhase,
      cellIds: tz.cellIds,
      parentId: tz.parentId,
    };
  }

  /**
   * 获取所有时区快照
   */
  getAllTimezoneSnapshots(): TimeZoneSnapshot[] {
    const snapshots: TimeZoneSnapshot[] = [];
    for (const tzId of this.timezoneMap.keys()) {
      const snapshot = this.getTimezoneSnapshot(tzId);
      if (snapshot) {
        snapshots.push(snapshot);
      }
    }
    return snapshots;
  }

  /**
   * 判断格子是否在夜晚时区
   */
  isCellInNight(cellId: number): boolean {
    const localTime = this.getCellLocalTime(cellId);
    return localTime.isNight;
  }

  /**
   * 判断格子是否在白天时区
   */
  isCellInDay(cellId: number): boolean {
    const localTime = this.getCellLocalTime(cellId);
    return localTime.isDay;
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
   * 获取默认时区 ID
   */
  getDefaultTimezoneId(): string {
    return this.defaultTimezoneId;
  }

  /**
   * 设置默认时区 ID
   */
  setDefaultTimezoneId(id: string): void {
    this.defaultTimezoneId = id;
    logger.debug(`默认时区设置为 ${id}`);
  }

  /**
   * 获取时区内的格子列表
   */
  getTimezoneCells(timezoneId: string): number[] {
    const tz = this.timezoneMap.get(timezoneId);
    return tz?.cellIds ?? [];
  }

  /**
   * 添加格子到时区
   */
  addCellToTimezone(cellId: number, timezoneId: string): void {
    const tz = this.timezoneMap.get(timezoneId);
    if (!tz) {
      logger.warn(`时区 ${timezoneId} 不存在`);
      return;
    }

    this.cellTimezoneMap.set(cellId, timezoneId);
    if (!tz.cellIds.includes(cellId)) {
      tz.cellIds.push(cellId);
    }
  }

  /**
   * 移除格子从时区
   */
  removeCellFromTimezone(cellId: number): void {
    const timezoneId = this.cellTimezoneMap.get(cellId);
    if (!timezoneId) return;

    const tz = this.timezoneMap.get(timezoneId);
    if (tz) {
      const idx = tz.cellIds.indexOf(cellId);
      if (idx >= 0) {
        tz.cellIds.splice(idx, 1);
      }
    }

    this.cellTimezoneMap.delete(cellId);
  }

  /**
   * 获取处于夜晚的时区列表
   */
  getNightTimezones(): TimeZoneSnapshot[] {
    return this.getAllTimezoneSnapshots().filter((s) => s.localPhase === 'night');
  }

  /**
   * 获取处于白天的时区列表
   */
  getDayTimezones(): TimeZoneSnapshot[] {
    return this.getAllTimezoneSnapshots().filter((s) => s.localPhase === 'day');
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

  /**
   * 手动设置玩家上次所在时区（用于初始化）
   */
  setPlayerLastTimezone(playerId: string, timezoneId: string): void {
    this.playerLastTimezone.set(playerId, timezoneId);
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