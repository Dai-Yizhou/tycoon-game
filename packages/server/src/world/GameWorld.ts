/**
 * 游戏世界（GameWorld）
 *
 * 服务端核心状态容器，统一管理：
 * - 当前时代（Era）
 * - 玩家（通过 PlayerManager）
 * - 队伍（Team）
 * - 地图（MapData、MapMeta、MapIndex）
 *
 * 通过事件系统向上层（SocketManager、管理工具）通知状态变化：
 * - `playerAdded`   : 玩家加入
 * - `playerRemoved` : 玩家离开
 * - `playerUpdated` : 玩家数据更新（位置/状态/数值等）
 * - `eraChanged`    : 时代切换
 * - `teamChanged`   : 队伍变更
 * - `mapLoaded`     : 地图加载完成
 *
 * 设计原则：
 * - 组合而非继承：GameWorld HAS-A PlayerManager
 * - 事件先于副作用：所有状态变更先 emit 事件再写存储
 * - 接受依赖注入：PlayerManager 可外部传入，便于测试
 */

import { EventEmitter } from 'node:events';
import { buildPlayerValues, type EraInfo, type MapData, type MapMeta, type Player, type Team } from '@game/shared';
import { MapIndex, type ValidationResult, validateMapData, validateMapMeta } from '@game/shared';
import { PlayerEvents, PlayerManager, type PlayerEventName, type PlayerEventListener, type PlayerRemovedEvent } from './PlayerManager.js';
import type { WorldSnapshot, WorldStore } from '../storage/WorldStore.js';
import { WorldRuntimeStateStore } from '../state/WorldRuntimeStateStore.js';

/**
 * 游戏世界事件类型
 */
export const WorldEvents = {
  PlayerAdded: 'playerAdded',
  PlayerRemoved: 'playerRemoved',
  PlayerUpdated: 'playerUpdated',
  PlayerPositionChanged: 'playerPositionChanged',
  PlayerStatusChanged: 'playerStatusChanged',
  EraChanged: 'eraChanged',
  TeamChanged: 'teamChanged',
  MapLoaded: 'mapLoaded',
} as const;

/** 游戏世界事件名字符串字面量联合 */
export type WorldEventName = (typeof WorldEvents)[keyof typeof WorldEvents];

/**
 * 事件载荷类型
 */
export interface PlayerAddedPayload {
  player: Player;
}

export interface PlayerRemovedPayload {
  playerId: string;
  player: Player;
}

export interface PlayerUpdatedPayload {
  player: Player;
}

export interface PlayerStatusChangedPayload {
  playerId: string;
  status: Player['status'];
}

export interface EraChangedPayload {
  previousEraId: string | null;
  newEra: EraInfo;
}

export interface TeamChangedPayload {
  team: Team;
  /** 变更类型 */
  changeType: 'created' | 'updated' | 'disbanded' | 'memberAdded' | 'memberRemoved';
}

export interface MapLoadedPayload {
  mapId: string;
  mapMeta: MapMeta;
  cellCount: number;
  validation: ValidationResult;
}

/**
 * 事件监听器
 */
export type WorldEventListener<T> = (payload: T) => void;

/**
 * 加载地图的选项
 */
export interface LoadMapOptions {
  /** 是否跳过校验（默认 false） */
  skipValidation?: boolean;
}

/**
 * 游戏世界配置
 */
export interface GameWorldOptions {
  /** 自定义 PlayerManager（测试时注入） */
  playerManager?: PlayerManager;
  worldStore?: WorldStore;
}

/**
 * 游戏世界
 */
export class GameWorld {
  private readonly emitter: EventEmitter;
  private readonly playerManager: PlayerManager;
  private readonly teams: Map<string, Team>;
  private readonly worldStore?: WorldStore;

  private mapData: MapData | null = null;
  private mapMeta: MapMeta | null = null;
  private mapIndex: MapIndex | null = null;
  private currentEra: EraInfo | null = null;
  private resourceVersion = 0;
  private readonly cellVersions = new Map<number, number>();
  private readonly playerPositions = new Map<string, number>();
  private runtimeState: WorldRuntimeStateStore | null = null;
  private lastValidation: ValidationResult | null = null;
  private snapshotStateProvider: (() => Pick<WorldSnapshot, 'taxRecords' | 'jailStates'>) | null = null;

  constructor(options: GameWorldOptions = {}) {
    this.emitter = new EventEmitter();
    this.playerManager = options.playerManager ?? new PlayerManager();
    this.teams = new Map();
    this.worldStore = options.worldStore;

    // 透传 PlayerManager 的事件为 WorldEvent
    this.playerManager.on(PlayerEvents.Added, ({ player }: { player: Player }) => {
      this.playerPositions.set(player.id, player.position.cellId);
      this.emit(WorldEvents.PlayerAdded, { player });
    });
    this.playerManager.on(PlayerEvents.Removed, ({ playerId, player }: PlayerRemovedEvent) => {
      this.playerPositions.delete(playerId);
      this.emit(WorldEvents.PlayerRemoved, { playerId, player });
    });
    this.playerManager.on(PlayerEvents.Updated, ({ player }: { player: Player }) => {
      const previousCellId = this.playerPositions.get(player.id);
      if (previousCellId !== player.position.cellId) {
        this.playerPositions.set(player.id, player.position.cellId);
        this.emit(WorldEvents.PlayerPositionChanged, { player });
      }
      this.emit(WorldEvents.PlayerUpdated, { player });
    });
    this.playerManager.on(PlayerEvents.StatusChanged, ({ playerId, status }: PlayerStatusChangedPayload) => {
      this.emit(WorldEvents.PlayerStatusChanged, { playerId, status });
    });
  }

  setSnapshotStateProvider(provider: () => Pick<WorldSnapshot, 'taxRecords' | 'jailStates'>): void {
    this.snapshotStateProvider = provider;
  }

  // ---------------------------------------------------------------------------
  // 玩家操作（委托给 PlayerManager，并发出 WorldEvent）
  // ---------------------------------------------------------------------------

  /**
   * 添加玩家
   */
  addPlayer(player: Player, socketId?: string): boolean {
    const added = this.playerManager.addPlayer(player, socketId);
    if (added) this.saveSnapshot();
    return added;
  }

  /**
   * 移除玩家
   */
  removePlayer(playerId: string): boolean {
    const removed = this.playerManager.removePlayer(playerId) !== undefined;
    if (removed) this.saveSnapshot();
    return removed;
  }

  /**
   * 更新玩家
   */
  updatePlayer(player: Player): boolean {
    const updated = this.playerManager.updatePlayer(player);
    if (updated) { this.resourceVersion += 1; this.saveSnapshot(); }
    return updated;
  }

  getResourceVersion(): number { return this.resourceVersion; }

  compareAndSwapResourceVersion(expected: number): boolean {
    if (expected !== this.resourceVersion) return false;
    this.resourceVersion += 1;
    return true;
  }

  getCellVersion(cellId: number): number {
    return this.cellVersions.get(cellId) ?? 0;
  }

  compareAndSwapCellVersion(cellId: number, expected: number): boolean {
    if (expected !== this.getCellVersion(cellId)) return false;
    this.cellVersions.set(cellId, expected + 1);
    return true;
  }

  compareAndSwapEconomicVersions(cellId: number, expectedResourceVersion?: number, expectedCellVersion?: number): boolean {
    if (expectedResourceVersion !== undefined && expectedResourceVersion !== this.resourceVersion) return false;
    if (expectedCellVersion !== undefined && expectedCellVersion !== this.getCellVersion(cellId)) return false;
    if (expectedResourceVersion !== undefined) this.resourceVersion += 1;
    if (expectedCellVersion !== undefined) this.cellVersions.set(cellId, this.getCellVersion(cellId) + 1);
    return true;
  }

  markCellUpdated(cellId: number): void {
    this.cellVersions.set(cellId, this.getCellVersion(cellId) + 1);
  }

  /**
   * 获取玩家
   */
  getPlayer(playerId: string): Player | undefined {
    return this.playerManager.getPlayer(playerId);
  }

  /**
   * 获取全部玩家
   */
  getAllPlayers(): Player[] {
    return this.playerManager.getAllPlayers();
  }

  /**
   * 获取玩家数
   */
  getPlayerCount(): number {
    return this.playerManager.getPlayerCount();
  }

  /**
   * 生成新玩家 ID
   */
  generatePlayerId(): string {
    return this.playerManager.generatePlayerId();
  }

  /**
   * 获取底层 PlayerManager（高级用法，谨慎使用）
   */
  getPlayerManager(): PlayerManager {
    return this.playerManager;
  }

  // ---------------------------------------------------------------------------
  // 地图
  // ---------------------------------------------------------------------------

  /**
   * 加载地图（同时加载 mapData 与 mapMeta）
   *
   * - 内部建立 MapIndex 以加速查询
   * - 校验通过后触发 `mapLoaded` 事件
   * - 若 mapMeta.valueFieldDefinitions 非空，可自动初始化玩家的 values
   *
   * @returns 校验结果（含 errors / warnings）
   */
  loadMap(mapData: MapData, mapMeta: MapMeta, options: LoadMapOptions = {}): ValidationResult {
    let result: ValidationResult = { valid: true, errors: [], warnings: [] };
    if (!options.skipValidation) {
      const dataCheck = validateMapData(mapData);
      const metaCheck = validateMapMeta(mapMeta, mapData);
      result = {
        valid: dataCheck.valid && metaCheck.valid,
        errors: [...dataCheck.errors, ...metaCheck.errors],
        warnings: [...dataCheck.warnings, ...metaCheck.warnings],
      };
    }

    this.mapData = mapData;
    this.mapMeta = mapMeta;
    this.mapIndex = new MapIndex(mapData);
    this.runtimeState = new WorldRuntimeStateStore(mapData, mapMeta);
    this.lastValidation = result;

    this.emit(WorldEvents.MapLoaded, {
      mapId: mapMeta.id,
      mapMeta,
      cellCount: mapData.length,
      validation: result,
    });
    return result;
  }

  saveSnapshot(taxRecords: WorldSnapshot['taxRecords'] = {}, jailStates: WorldSnapshot['jailStates'] = {}): void {
    if (!this.worldStore || !this.mapData || !this.mapMeta) return;
    const state = this.snapshotStateProvider?.() ?? { taxRecords, jailStates };
    this.worldStore.save({ version: 2, revision: this.resourceVersion, savedAt: Date.now(), mapId: this.mapMeta.id, players: this.getAllPlayers(), teams: this.getAllTeams(), runtime: this.getRuntimeState().snapshot(), era: this.currentEra, taxRecords: state.taxRecords, jailStates: state.jailStates ?? {} });
  }

  restoreSnapshot(): WorldSnapshot | null {
    const snapshot = this.worldStore?.load() ?? null;
    if (!snapshot) return null;
    if (snapshot.version !== 2 || snapshot.mapId !== this.mapMeta?.id) throw new Error('world snapshot map mismatch');
    this.getRuntimeState().restore(snapshot.runtime);
    this.playerManager.clear();
    for (const player of snapshot.players) this.playerManager.addPlayer(player);
    this.teams.clear();
    for (const team of snapshot.teams) this.teams.set(team.id, team);
    this.currentEra = snapshot.era;
    return snapshot;
  }

  getSnapshot(): WorldSnapshot | null {
    if (!this.mapData || !this.mapMeta) return null;
    const state = this.snapshotStateProvider?.() ?? { taxRecords: {}, jailStates: {} };
    return { version: 2, revision: this.resourceVersion, savedAt: Date.now(), mapId: this.mapMeta.id, players: this.getAllPlayers(), teams: this.getAllTeams(), runtime: this.getRuntimeState().snapshot(), era: this.currentEra, taxRecords: state.taxRecords, jailStates: state.jailStates ?? {} };
  }

  /**
   * 获取地图数据
   */
  getMapData(): MapData | null {
    return this.mapData;
  }

  /**
   * 获取地图元数据
   */
  getMapMeta(): MapMeta | null {
    return this.mapMeta;
  }

  /**
   * 获取地图索引
   */
  getMapIndex(): MapIndex | null {
    return this.mapIndex;
  }

  getRegionValue(regionId: string, fieldId: string): number {
    return this.getRuntimeState().getRegionValue(regionId, fieldId);
  }

  changeRegionValue(regionId: string, fieldId: string, delta: number): number {
    return this.getRuntimeState().changeRegionValue(regionId, fieldId, delta);
  }

  getRuntimeState(): WorldRuntimeStateStore {
    if (!this.runtimeState) throw new Error('运行时状态尚未初始化');
    return this.runtimeState;
  }

  /**
   * 获取最近一次地图校验结果
   */
  getLastValidation(): ValidationResult | null {
    return this.lastValidation;
  }

  /**
   * 根据地图元数据构造玩家初始 values
   *
   * 若当前未加载地图元数据，返回空对象。
   */
  buildInitialPlayerValues(): Record<string, ReturnType<typeof buildPlayerValues>[string]> {
    if (!this.mapMeta) return {};
    return buildPlayerValues(this.mapMeta);
  }

  // ---------------------------------------------------------------------------
  // 时代
  // ---------------------------------------------------------------------------

  /**
   * 设置当前时代
   *
   * 时代切换会触发 `eraChanged` 事件；客户端可据此切换地图/UI。
   */
  setEra(era: EraInfo): void {
    const previousEraId = this.currentEra?.id ?? null;
    this.currentEra = era;
    this.emit(WorldEvents.EraChanged, { previousEraId, newEra: era });
  }

  /**
   * 获取当前时代
   */
  getCurrentEra(): EraInfo | null {
    return this.currentEra;
  }

  /**
   * 通过 ID 查找时代
   */
  findEraById(eraId: string): EraInfo | null {
    if (this.currentEra?.id === eraId) return this.currentEra;
    return null;
  }

  // ---------------------------------------------------------------------------
  // 队伍
  // ---------------------------------------------------------------------------

  /**
   * 创建队伍
   *
   * - 重复 ID 返回 false
   * - 触发 `teamChanged` 事件（changeType='created'）
   */
  createTeam(team: Team): boolean {
    if (this.teams.has(team.id)) return false;
    this.teams.set(team.id, team);
    this.emit(WorldEvents.TeamChanged, { team, changeType: 'created' });
    return true;
  }

  /**
   * 解散队伍
   */
  disbandTeam(teamId: string): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;
    team.disbanded = true;
    team.disbandedAt = Date.now();
    // 移除所有成员关联
    for (const playerId of team.memberIds) {
      const player = this.playerManager.getPlayer(playerId);
      if (player && player.teamId === teamId) {
        player.teamId = null;
        this.playerManager.updatePlayer(player);
      }
    }
    this.emit(WorldEvents.TeamChanged, { team, changeType: 'disbanded' });
    return true;
  }

  /**
   * 添加队员
   */
  addTeamMember(teamId: string, playerId: string): boolean {
    const team = this.teams.get(teamId);
    if (!team || team.disbanded) return false;
    if (team.memberIds.includes(playerId)) return true;
    team.memberIds.push(playerId);
    const player = this.playerManager.getPlayer(playerId);
    if (player) {
      player.teamId = teamId;
      this.playerManager.updatePlayer(player);
    }
    this.emit(WorldEvents.TeamChanged, { team, changeType: 'memberAdded' });
    return true;
  }

  /**
   * 移除队员
   */
  removeTeamMember(teamId: string, playerId: string): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;
    const idx = team.memberIds.indexOf(playerId);
    if (idx === -1) return false;
    team.memberIds.splice(idx, 1);
    const player = this.playerManager.getPlayer(playerId);
    if (player && player.teamId === teamId) {
      player.teamId = null;
      this.playerManager.updatePlayer(player);
    }
    this.emit(WorldEvents.TeamChanged, { team, changeType: 'memberRemoved' });
    return true;
  }

  /**
   * 获取队伍
   */
  getTeam(teamId: string): Team | undefined {
    return this.teams.get(teamId);
  }

  /**
   * 获取全部队伍
   */
  getAllTeams(): Team[] {
    return Array.from(this.teams.values());
  }

  // ---------------------------------------------------------------------------
  // 事件订阅
  // ---------------------------------------------------------------------------

  /**
   * 订阅事件
   */
  on<T = unknown>(event: WorldEventName, listener: WorldEventListener<T>): void {
    this.emitter.on(event, listener);
  }

  /**
   * 取消订阅
   */
  off<T = unknown>(event: WorldEventName, listener: WorldEventListener<T>): void {
    this.emitter.off(event, listener);
  }

  /**
   * 监听 PlayerManager 的底层事件
   */
  onPlayerEvent<T = unknown>(event: PlayerEventName, listener: PlayerEventListener<T>): void {
    this.playerManager.on<T>(event, listener);
  }

  /**
   * 触发事件
   */
  private emit<T>(event: WorldEventName, payload: T): void {
    this.emitter.emit(event, payload);
  }
}

/**
 * 重导出 PlayerEvents 供外部使用
 */
export { PlayerEvents } from './PlayerManager.js';
