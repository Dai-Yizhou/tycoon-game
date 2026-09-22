/**
 * 游戏视图模型（ViewModel / Store）
 *
 * 作为 UI 组件与游戏逻辑之间的唯一桥梁：
 * - 提供 UI 读取接口，业务状态由 GameStore 投影
 * - UI 组件仅消费此层，不直接访问 GameController / Socket / Canvas
 *
 * 低耦合设计：ViewModel 不导入任何 UI 代码、Canvas 渲染器或 Socket 客户端，
 * 只负责 UI 投影与变更通知。业务事件统一进入 GameStore。
 */

import type { Player, Uct, ValueModifierRule } from '@game/shared';
import type { GameStore, ClientGameSnapshot, RegionInfo, ValueFieldDef, TeamMember, OtherPlayerInfo, ClientChatMessage } from '../state/GameStore.js';
import { type CellHoverResolutionCtx } from './cellDisplayModel.js';
import { localizedText } from './i18n.js';
import { resolveTimezoneOffsetMinutes } from './timezone.js';

// 领域类型统一以 GameStore 为单一数据源（避免与本地声明重复）
export type { RegionInfo, ValueFieldDef, TeamMember, OtherPlayerInfo } from '../state/GameStore.js';

// ===== 状态切片类型定义 =====

/** 玩家核心状态 */
export interface PlayerSlice {
  currentPlayer: Player | null;
  currentPlayerPosition: number;
  isBankrupt: boolean;
  actionUsedThisTurn: boolean;
  ownedProperties: Set<number>;
  propertyLevels: Map<number, number>;
  ownedInvestments: Set<number>;
  investmentShares: Map<number, number>;
  currentPlayerName: string;
}

/** 移动状态 */
export interface MovementSlice {
  isMoving: boolean;
  canRoll: boolean;
  remainingSteps: number;
  previousCellId: number;
  playerDisplayX: number;
  playerDisplayY: number;
  moveFromX: number;
  moveFromY: number;
  moveToX: number;
  moveToY: number;
  moveStartTime: number;
  isWaitingForChoice: boolean;
  serverPath: number[];
  serverPathIndex: number;
  isServerAnimating: boolean;
}

/** 相机状态 */
export interface CameraSlice {
  cameraTargetX: number;
  cameraTargetY: number;
}

/** 骰子状态 */
export interface DiceSlice {
  diceValue: number;
  diceAnimating: boolean;
  diceAnimStart: number;
}

/** 冷却状态 */
export interface CooldownSlice {
  rollCooldownEnd: number;
  rollCooldownMs: number;
}

/** 监狱状态 */
export interface JailSlice {
  isInJail: boolean;
  jailEndTime: number;
  jailDurationMs: number;
}

/** 昼夜与繁荣度状态 */
export interface DayNightSlice {
  cycleDuration: number;
  cycleStartTime: number;
  serverTimeOffset: number;
  /** 服务端权威下发的白天占周期比例（dayRatio），默认 0.5 */
  dayRatio: number;
}

/** 区域状态 */
export interface RegionSlice {
  mapRegions: RegionInfo[];
  valueFieldDefs: ValueFieldDef[];
  valueModifiers: ValueModifierRule[];
  regionValues: Map<string, Record<string, number>>;
}

/** 聊天消息 */
export type ChatMessage = ClientChatMessage;

export interface ChatChannelDef {
  id: string;
  label: string;
  color: string;
}

/** 聊天状态 */
export interface ChatSlice {
  history: ChatMessage[];
}

export interface PathChoiceOption {
  cellId: number;
  label: string;
}

export interface PathChoiceSlice {
  active: boolean;
  options: PathChoiceOption[];
}

export interface CellActionOption {
  id: string;
  label: string;
  detail?: string;
  enabled: boolean;
  data?: Record<string, unknown>;
}

/** 队伍状态 */
export interface TeamSlice {
  members: TeamMember[];
}

/** 其他玩家状态 */
export interface OtherPlayersSlice {
  players: OtherPlayerInfo[];
}

export interface LeaderboardSlice {
  leaderboard: import('@game/shared').LeaderboardState;
}

export interface AchievementSlice {
  achievements: ClientGameSnapshot['achievements'];
}

/** 教程状态 */
export interface TutorialSlice {
  step: number;
  active: boolean;
}

// ===== 常量 =====

export const RARITY_COLORS: Record<string, string> = {
  common: '#9ca3af', uncommon: '#22c55e', rare: '#3b82f6',
  epic: '#a855f7', legendary: '#f59e0b', ultimate: '#ef4444', unique: '#ec4899',
};

export const RARITY_LABELS: Record<string, string> = {
  common: '普通', uncommon: '罕见', rare: '稀有',
  epic: '史诗', legendary: '传奇', ultimate: '究极', unique: '唯一',
};

export const CHAT_CHANNEL_DEFS: ChatChannelDef[] = [
  { id: 'system', label: '系统', color: '#6b7280' },
  { id: 'team', label: '队伍', color: '#3b82f6' },
  { id: 'region', label: '区域', color: '#22c55e' },
  { id: 'global', label: '世界', color: '#f59e0b' },
];

// ===== 变更事件 =====

/** 状态变更事件，标识哪个切片发生了变化 */
export type StateChangeKey =
  | 'player' | 'movement' | 'camera' | 'dice' | 'cooldown' | 'jail'
  | 'dayNight'
  | 'regions' | 'chat' | 'team' | 'tutorial' | 'otherPlayers' | 'behavior'
  | 'pathChoice' | 'cellActions' | 'leaderboard' | 'achievements' | 'all';

export interface StateChangeEvent {
  key: StateChangeKey;
  source: string;
}

export type StateChangeListener = (event: StateChangeEvent) => void;

// ===== ViewModel =====

/**
 * 游戏视图模型
 *
 */
export class GameViewModel {
  private readonly store: GameStore;
  private readonly unsubscribeStore: () => void;
  private readonly displayName: string;

  constructor(store: GameStore, displayName = '玩家') {
    this.store = store;
    this.displayName = displayName;
    this.unsubscribeStore = store.subscribe(() => {
      this.notify('player', 'store');
      this.notify('movement', 'store');
      this.notify('chat', 'store');
      this.notify('leaderboard', 'store');
      this.notify('achievements', 'store');
      this.notify('all', 'store');
    });
  }

  private projectedSnapshot(): ClientGameSnapshot {
    return this.store.getSnapshot();
  }

  private projectPlayerName(): string {
    return this.projectedSnapshot().currentPlayer?.username ?? this.displayName;
  }

  getStore(): GameStore { return this.store; }

  // — 订阅系统 —
  private listeners: Map<StateChangeKey, Set<StateChangeListener>> = new Map();

  /**
   * 订阅状态变更
   * @param key 订阅的切片 key，'all' 表示订阅所有变更
   * @param listener 回调函数
   * @returns 取消订阅函数
   */
  subscribe(key: StateChangeKey, listener: StateChangeListener): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(listener);
    return () => {
      this.listeners.get(key)?.delete(listener);
    };
  }

  /**
   * 通知订阅者状态变更
   */
  notify(key: StateChangeKey, source = 'unknown'): void {
    // 通知特定 key 的订阅者
    this.listeners.get(key)?.forEach(fn => fn({ key, source }));
    // 通知 'all' 的订阅者
    if (key !== 'all') {
      this.listeners.get('all')?.forEach(fn => fn({ key, source }));
    }
  }

  destroy(): void {
    this.unsubscribeStore();
    this.listeners.clear();
  }

  // ===== Player =====
  getPlayer(): PlayerSlice {
    const snapshot = this.projectedSnapshot();
    return { currentPlayer: snapshot.currentPlayer, currentPlayerPosition: snapshot.currentPlayerPosition, isBankrupt: snapshot.isBankrupt, actionUsedThisTurn: snapshot.actionUsedThisTurn, ownedProperties: snapshot.ownedProperties, propertyLevels: snapshot.propertyLevels, ownedInvestments: snapshot.ownedInvestments, investmentShares: snapshot.investmentShares, currentPlayerName: this.projectPlayerName() };
  }

  // ===== Movement =====
  getMovement(): MovementSlice {
    const snapshot = this.projectedSnapshot();
    return { isMoving: snapshot.isMoving, canRoll: snapshot.canRoll, remainingSteps: snapshot.remainingSteps, previousCellId: snapshot.previousCellId, playerDisplayX: snapshot.playerDisplayX, playerDisplayY: snapshot.playerDisplayY, moveFromX: snapshot.moveFromX, moveFromY: snapshot.moveFromY, moveToX: snapshot.moveToX, moveToY: snapshot.moveToY, moveStartTime: snapshot.moveStartTime, isWaitingForChoice: snapshot.isWaitingForChoice, serverPath: snapshot.serverPath, serverPathIndex: snapshot.serverPathIndex, isServerAnimating: snapshot.isServerAnimating };
  }

  // ===== Camera =====
  getCamera(): CameraSlice { const snapshot = this.projectedSnapshot(); return { cameraTargetX: snapshot.cameraTargetX, cameraTargetY: snapshot.cameraTargetY }; }

  // ===== Dice =====
  getDice(): DiceSlice { const snapshot = this.projectedSnapshot(); return { diceValue: snapshot.diceValue, diceAnimating: snapshot.diceAnimating, diceAnimStart: snapshot.diceAnimStart }; }

  // ===== Cooldown =====
  getCooldown(): CooldownSlice { const snapshot = this.projectedSnapshot(); return { rollCooldownEnd: snapshot.rollCooldownEnd, rollCooldownMs: snapshot.rollCooldownMs }; }

  // ===== Jail =====
  getJail(): JailSlice { const snapshot = this.projectedSnapshot(); return { isInJail: snapshot.isInJail, jailEndTime: snapshot.jailEndTime, jailDurationMs: snapshot.jailDurationMs }; }

  // ===== Day/Night =====
  getDayNight(): DayNightSlice {
    const snapshot = this.projectedSnapshot();
    return { cycleDuration: (snapshot.cycleMinutes > 0 ? snapshot.cycleMinutes : 15) * 60 * 1000, cycleStartTime: snapshot.dayNightStartTime, serverTimeOffset: snapshot.serverTimeOffset, dayRatio: snapshot.dayNightRatio > 0 ? snapshot.dayNightRatio : 0.5 };
  }

  // ===== Regions =====
  getRegions(): RegionSlice {
    const snapshot = this.projectedSnapshot();
    return { mapRegions: snapshot.mapRegions, valueFieldDefs: snapshot.valueFieldDefs, valueModifiers: snapshot.valueModifiers, regionValues: snapshot.regionValues };
  }

  getLeaderboard(): LeaderboardSlice {
    return { leaderboard: this.projectedSnapshot().leaderboard };
  }

  getAchievements(): AchievementSlice {
    return { achievements: this.projectedSnapshot().achievements };
  }

  // ===== Chat =====
  getChat(): ChatSlice {
    const snapshot = this.projectedSnapshot();
    return { history: snapshot.chatHistory };
  }

  getPathChoice(): PathChoiceSlice {
    const slice = this.projectedSnapshot().pathChoice;
    const localizedOptions = slice.options.map(opt => ({
      ...opt,
      label: localizedText(opt.label, '')
    }));
    return {
      ...slice,
      options: localizedOptions
    };
  }

  getCell(cellId: number): import('@game/shared').Cell | null {
    return this.projectedSnapshot().cells.get(cellId) ?? null;
  }

  getCellRuntimeState(cellId: number): { ownerships: Array<{ playerId: string; share: number; purchasePrice: number }>; level: number; accumulatedValue: number; repairedBy?: string; repairedAt?: number } | null {
    return this.projectedSnapshot().cellRuntimeStates.get(cellId) ?? null;
  }

  getCellActions(): CellActionOption[] { return [...this.projectedSnapshot().cellActions]; }

  /**
   * 为当前格构建 D8 展示求值上下文（宽松实现，用于 base → final 摘要）。
   * - 无任何 valueModifiers 时返回 null（跳过求值，展示 base 原样）。
   * - playerUct/regionUct 仅取地图声明的作用域字段。
   * - 团队均值：客户端仅持本玩家视角，按 D8 "无团队时 memberCnt=1、teamValue 取成员自身值"
   *   宽松实现，teamValue 回退为当前玩家自身字段值（真实多人团队无法在本端合成均值）。
   * - regionTime 按目标格时区的本地昼夜：白天=0/夜晚=1，与服务端权威结算（目标格时区）同源。
   */
  getCellResolutionCtx(cell: import('@game/shared').Cell): CellHoverResolutionCtx | null {
    const snapshot = this.projectedSnapshot();
    if (!snapshot.valueModifiers.length) return null;
    const playerUct: Uct = { player: {} };
    const regionUct: Uct = { region: {} };
    const currentPlayer = snapshot.currentPlayer;
    const regionValues = snapshot.regionValues.get(cell.regionId) ?? {};
    for (const def of snapshot.valueFieldDefs) {
      if (def.scope === 'region') {
        const v = regionValues[def.id];
        if (typeof v === 'number') regionUct.region![def.id] = v;
      } else {
        const v = currentPlayer?.values?.[def.id]?.current;
        if (typeof v === 'number') playerUct.player![def.id] = v;
      }
    }
    // 团队均值优先取服务端权威的 teamValueTable（当前玩家团队的字段均值），避免多人团队下
    // 乐观回退自身值导致 rent/升级费等展示偏差；缺失（单人/无该字段推送）时回退为当前玩家自身值。
    const teamValueTable = snapshot.teamValueTable;
    const teamValue = (fieldId: string): number | undefined => {
      const v = teamValueTable[fieldId];
      return typeof v === 'number' ? v : currentPlayer?.values?.[fieldId]?.current;
    };
    // regionTime 按目标格时区求本地昼夜（与服务端权威结算同源）。HUD 时钟仍按玩家格时区，
    // 但 D8 结算/预览的目标格 region.time 必须以目标格时区为准，否则目标格与玩家格时区不一致时会漂移。
    const targetOffset = resolveTimezoneOffsetMinutes(cell, snapshot.mapTimezones);
    const local = this.getLocalDayNight(targetOffset);
    return {
      valueModifiers: snapshot.valueModifiers,
      playerUct,
      teamMemberCount: snapshot.teamMembers.length || 1,
      teamValue,
      regionUct,
      regionTime: local.isDay ? 0 : 1,
      authoritativePrice: snapshot.boughtPrices.get(cell.id),
    };
  }

  // ===== Team =====
  getTeam(): TeamSlice { return { members: this.projectedSnapshot().teamMembers }; }

  // ===== Tutorial =====
  getTutorial(): TutorialSlice { return { step: 0, active: false }; }

  // ===== Other Players =====
  getOtherPlayers(): OtherPlayersSlice { return { players: this.projectedSnapshot().otherPlayers }; }

  // ===== 工具方法 =====

  /**
   * 获取当前玩家所在格子的时区偏移（分钟）
   */
  getPlayerTimezoneOffset(): number {
    const cell = this.projectedSnapshot().cells.get(this.projectedSnapshot().currentPlayerPosition);
    return resolveTimezoneOffsetMinutes(cell, this.projectedSnapshot().mapTimezones);
  }

  /**
   * 基于服务器时间 + 时区偏移计算本地昼夜状态
   */
  getLocalDayNight(offsetMinutes: number): {
    isDay: boolean; progress: number; hour: number; minute: number; timeStr: string;
  } {
    const dayNight = this.getDayNight();
    const serverNow = Date.now() + dayNight.serverTimeOffset;
    const serverElapsed = serverNow - dayNight.cycleStartTime;
    // 相位 = 全局进度 + 时区偏移。时区偏移是真实墙钟偏移（60 的倍数），按"24h 一天"换算相位
    // （offsetMinutes/1440），与服务端 TimeZoneManager.getLocalTime 同口径。cycle 只决定昼夜切换
    // 频率（dayRatio 为白天占比），不能把偏移对 cycle 取模——那会让短周期下真实时区偏移全部相消，
    // 不同时区显示相同时间。例如 cycle=24min 时 offset 480/0/-480 mod 24 全为 0。
    const offsetAsDayFraction = offsetMinutes / 1440;
    const localProgress = (((serverElapsed / dayNight.cycleDuration) + offsetAsDayFraction) % 1 + 1) % 1;
    const totalMinutes = Math.floor(localProgress * 24 * 60);
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    // 白天边界以服务端权威下发的 dayRatio 为准（默认 0.5，白天=周期起始的 [0,dayRatio) 块）。
    // 服务端在 progress=dayRatio 处切换相位并触发区域 pros 等 applyPhase；客户端须与之对齐，
    // 否则 HUD 由昼转夜会比服务端相位偏差，导致"HUD 转夜但区域值已提前变化/无同步变化"。
    const isDay = localProgress < dayNight.dayRatio;
    return { isDay, progress: localProgress, hour, minute, timeStr };
  }

  /**
   * 重置全部状态（用于游戏退出/重新开始）
   */
  reset(): void {
    this.store.reset();
    this.notify('all', 'reset');
  }
}
