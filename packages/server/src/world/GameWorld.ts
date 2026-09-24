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
import { buildPlayerValues, resolveField, type Cell, type CellTypeId, type EraInfo, type MapData, type MapMeta, type Player, type Team, type Uct, type ValueModifierRule, type WorldView } from '@game/shared';
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
  RegionValueChanged: 'regionValueChanged',
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

export interface RegionValueChangedPayload {
  regionId: string;
  fieldId: string;
  value: number;
  /** 本次变化量 */
  delta: number;
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
export interface WorldIdentity {
  worldId: string;
  namespace: string;
  temporary: boolean;
  expiresAt?: number;
}

export interface GameWorldOptions {
  /** 自定义 PlayerManager（测试时注入） */
  playerManager?: PlayerManager;
  worldStore?: WorldStore;
  worldIdentity?: WorldIdentity;
}

/**
 * 游戏世界
 */
export class GameWorld {
  private readonly emitter: EventEmitter;
  private readonly playerManager: PlayerManager;
  private readonly teams: Map<string, Team>;
  private readonly worldStore?: WorldStore;
  private readonly worldIdentity?: WorldIdentity;

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
  /** D8：区域环境时刻读取器（白天=0/夜晚=1，缺省恒 0；由 app.ts 按目标格时区从 TimeZoneManager 接入） */
  private regionTimeProvider: ((cell: Cell) => number) | null = null;
  private persistenceQueue: Promise<void> = Promise.resolve();
  private persistenceInitialized = false;
  private persistedRevision: number | undefined;

  constructor(options: GameWorldOptions = {}) {
    this.emitter = new EventEmitter();
    this.playerManager = options.playerManager ?? new PlayerManager();
    this.teams = new Map();
    this.worldStore = options.worldStore;
    this.worldIdentity = options.worldIdentity;

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

  /** 设置 D8 区域环境时刻读取器（白天=0/夜晚=1，按结算目标格解析）；未设置时恒返回 0 */
  setRegionTimeProvider(provider: (cell: Cell) => number): void {
    this.regionTimeProvider = provider;
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
   * 获取玩家用于经济资格判定的领域状态（离线冻结不掩盖 jail/bankrupt）
   */
  getEffectiveStatus(playerId: string): Player['status'] {
    return this.playerManager.getEffectiveStatus(playerId);
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

  saveSnapshot(taxRecords: WorldSnapshot['taxRecords'] = {}, jailStates: WorldSnapshot['jailStates'] = {}): Promise<void> {
    if (!this.worldStore || !this.mapData || !this.mapMeta) return Promise.resolve();
    const state = this.snapshotStateProvider?.() ?? { taxRecords, jailStates };
    const snapshot: WorldSnapshot = {
      version: 2,
      worldId: this.worldIdentity?.worldId,
      namespace: this.worldIdentity?.namespace,
      temporary: this.worldIdentity?.temporary,
      expiresAt: this.worldIdentity?.expiresAt,
      revision: this.resourceVersion,
      savedAt: Date.now(),
      mapId: this.mapMeta.id,
      players: this.getAllPlayers(),
      teams: this.getAllTeams(),
      runtime: this.getRuntimeState().snapshot(),
      era: this.currentEra,
      taxRecords: state.taxRecords,
      jailStates: state.jailStates ?? {},
    };
    const task = async (): Promise<void> => {
      if (!this.persistenceInitialized) {
        await this.worldStore?.initialize(snapshot);
        this.persistenceInitialized = true;
      } else {
        await this.worldStore?.save(snapshot, this.persistedRevision);
      }
      this.persistedRevision = snapshot.revision;
    };
    const pending = this.persistenceQueue.then(task);
    this.persistenceQueue = pending.catch(() => undefined);
    return pending;
  }

  async flushPersistence(taxRecords: WorldSnapshot['taxRecords'] = {}, jailStates: WorldSnapshot['jailStates'] = {}): Promise<void> {
    await this.saveSnapshot(taxRecords, jailStates);
  }

  restoreSnapshot(): WorldSnapshot | null {
    const snapshot = this.worldStore?.load() ?? null;
    if (!snapshot) return null;
    if (snapshot.version !== 2 || snapshot.mapId !== this.mapMeta?.id) throw new Error('world snapshot map mismatch');
    this.persistenceInitialized = true;
    this.persistedRevision = snapshot.revision;
    this.resourceVersion = snapshot.revision;
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

  getWorldIdentity(): WorldIdentity | undefined {
    return this.worldIdentity;
  }

  /**
   * 获取地图索引
   */
  getMapIndex(): MapIndex | null {
    return this.mapIndex;
  }

  getRegionId(cellId: number): string | undefined {
    return this.mapData?.find((cell) => cell.id === cellId)?.regionId;
  }

  getRegionValue(regionId: string, fieldId: string): number {
    return this.getRuntimeState().getRegionValue(regionId, fieldId);
  }

  changeRegionValue(regionId: string, fieldId: string, delta: number): number {
    const value = this.getRuntimeState().changeRegionValue(regionId, fieldId, delta);
    this.emit(WorldEvents.RegionValueChanged, { regionId, fieldId, value, delta });
    this.saveSnapshot();
    return value;
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
  // D8 数值调节：refs 求值读数上下文（两端同构，服务端权威方）
  // ---------------------------------------------------------------------------

  /** 查询 cellType+base 的 valueModifier 规则；无则 undefined */
  getBaseModifier(cellType: CellTypeId, base: string): ValueModifierRule | undefined {
    return this.mapMeta?.valueModifiers?.find((r) => r.scope.cellType === cellType && r.scope.base === base) ?? undefined;
  }

  /** 区域环境时刻（白天=0/夜晚=1），按结算目标格时区解析 */
  getRegionTime(cell: Cell): number {
    return this.regionTimeProvider?.(cell) ?? 0;
  }

  /** 构建某区域的 region 作用域 UCT（仅取 valueFieldDefinitions 中 scope=region 的字段） */
  getRegionUct(regionId: string): Uct {
    if (!this.mapMeta) return {};
    const region: Record<string, number> = {};
    for (const def of this.mapMeta.valueFieldDefinitions) {
      if (def.scope !== 'region') continue;
      region[def.id] = this.getRegionValue(regionId, def.id);
    }
    return { region };
  }

  /** 从玩家构造 player 作用域 UCT（仅取 valueFieldDefinitions 中 player 作用域的字段） */
  playerToUct(player: Player): Uct {
    if (!this.mapMeta) return {};
    const out: Record<string, number> = {};
    for (const def of this.mapMeta.valueFieldDefinitions) {
      if (def.scope === 'region') continue;
      out[def.id] = player.values[def.id]?.current ?? 0;
    }
    return { player: out };
  }

  /**
   * 计算队员某字段的算术均值（团队 UCT 聚合约定）。
   * - 无团队 → 视为单人自己的团队（memberCnt=1，均值=自己该字段值）
   * - player 作用域字段 → 取各成员自己的 player.values.current
   * - region 作用域字段 → 取各成员所在区域的 region 值
   * 该字段无任何成员取值时返回 undefined。
   */
  computeTeamValue(payerId: string, fieldId: string): number | undefined {
    const team = this.getTeamByPlayer(payerId);
    const memberIds = team?.memberIds.length ? team.memberIds : [payerId];
    const def = this.mapMeta?.valueFieldDefinitions.find((d) => d.id === fieldId);
    const values: number[] = [];
    for (const memberId of memberIds) {
      const member = this.getPlayer(memberId);
      if (!member) continue;
      if (def?.scope === 'region') {
        const regionId = this.getRegionId(member.position.cellId);
        if (regionId === undefined) continue;
        values.push(this.getRegionValue(regionId, fieldId));
      } else {
        const v = member.values[fieldId]?.current;
        if (v === undefined) continue;
        values.push(v);
      }
    }
    if (values.length === 0) return undefined;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * 计算某玩家所属团队的 UCT 汇总表：对地图声明的每个 value field（player/region 作用域）
   * 求团队均值。无值（字段未声明/成员缺该字段）的字段不进入结果。
   * 客户端据此以权威均值驱动 teamValue 展示，消除本地回退自身的乐观偏差（L-7）。
   */
  computeTeamValueTable(playerId: string): Record<string, number> {
    const table: Record<string, number> = {};
    for (const def of this.mapMeta?.valueFieldDefinitions ?? []) {
      const value = this.computeTeamValue(playerId, def.id);
      if (value !== undefined) table[def.id] = value;
    }
    return table;
  }

  private getTeamByPlayer(playerId: string): Team | undefined {
    const player = this.getPlayer(playerId);
    if (!player?.teamId) return undefined;
    return this.teams.get(player.teamId);
  }

  /**
   * 组装一次结算的 WorldView（付款方 + 目标格）。
   * - `playerUct` 可显式覆盖（如投资 delta 求值时需置空 payer 上下文）
   * - `teamValue` 缺省走 computeTeamValue（无团队时等价单人）
   */
  buildResolutionView(opts: {
    payer: Player;
    base: number | Uct;
    cell: Cell;
    level: number;
    ownerCount: number;
    playerUct?: Uct;
    teamValue?: (fieldId: string) => number | undefined;
  }): WorldView {
    const team = this.getTeamByPlayer(opts.payer.id);
    return {
      base: opts.base,
      playerUct: opts.playerUct ?? this.playerToUct(opts.payer),
      teamMemberCount: team?.memberIds.length ?? 1,
      teamValue: opts.teamValue ?? ((fieldId: string) => this.computeTeamValue(opts.payer.id, fieldId)),
      regionUct: this.getRegionUct(opts.cell.regionId),
      regionTime: this.getRegionTime(opts.cell),
      curCellLevel: opts.level,
      curCellOwnerCount: opts.ownerCount,
    };
  }

  /**
   * 结算时刻按规则求一次最终值并固定；无规则则返回 base 原值。
   * - `base` 为 number（如 jailCooldown）→ 返回 number；为 Uct → 返回覆盖合并后的 Uct。
   * - `payer` 缺失时用中性上下文（空 playerUct、无团队、teamMemberCount=1），用于无单一付款方的展示/域事件。
   * - `playerUct` 可显式覆盖（如投资 delta 求值时置空 payer 上下文只求解一次）。
   */
  resolveValueModifier(opts: {
    cellType: CellTypeId;
    baseField: string;
    base: number | Uct;
    cell: Cell;
    level: number;
    ownerCount: number;
    payer?: Player;
    playerUct?: Uct;
  }): number | Uct {
    const rule = this.getBaseModifier(opts.cellType, opts.baseField);
    if (!rule) return opts.base;
    const view: WorldView = opts.payer
      ? this.buildResolutionView({
          payer: opts.payer,
          base: opts.base,
          cell: opts.cell,
          level: opts.level,
          ownerCount: opts.ownerCount,
          playerUct: opts.playerUct,
        })
      : {
          base: opts.base,
          playerUct: opts.playerUct ?? {},
          teamMemberCount: 1,
          teamValue: undefined,
          regionUct: this.getRegionUct(opts.cell.regionId),
          regionTime: this.getRegionTime(opts.cell),
          curCellLevel: opts.level,
          curCellOwnerCount: opts.ownerCount,
        };
    return resolveField(rule.calc, view);
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
