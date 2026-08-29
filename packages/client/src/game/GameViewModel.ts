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

import type { Player } from '@game/shared';
import type { GameStore, ClientGameSnapshot, ClientChatMessage } from '../state/GameStore.js';
import { localizedText } from './i18n.js';
import { resolveTimezoneOffsetMinutes } from './timezone.js';

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
  rollCooldownTimer: ReturnType<typeof setInterval> | null;
}

/** 监狱状态 */
export interface JailSlice {
  isInJail: boolean;
  jailEndTime: number;
}

/** 昼夜与繁荣度状态 */
export interface DayNightSlice {
  cycleDuration: number;
  cycleStartTime: number;
  serverTimeOffset: number;
  prosperity: number;
}

/** 区域信息 */
export interface RegionInfo {
  id: string;
  name: string;
  cellIds: number[];
  prosperity: number;
  environmentValue?: number;
}

/** 动态数值字段定义 */
export interface ValueFieldDef {
  id: string;
  name: string;
  scope: 'player' | 'region';
  min?: number;
  max?: number;
}

/** 区域状态 */
export interface RegionSlice {
  mapRegions: RegionInfo[];
  valueFieldDefs: ValueFieldDef[];
  regionProsperityMap: Map<string, number>;
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
  activeChannels: Set<string>;
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
}

/** 队伍成员 */
export interface TeamMember {
  id: string;
  username: string;
  values: Record<string, number>;
  status: string;
}

/** 队伍状态 */
export interface TeamSlice {
  members: TeamMember[];
}

/** 其他在线玩家信息 */
export interface OtherPlayerInfo {
  id: string;
  username: string;
  position: { cellId: number };
  status: string;
  primaryValue: number;
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

export const MOVE_STEP_DURATION = 280;
export const CAMERA_FOLLOW_SPEED = 0.15;
export const DICE_ANIM_DURATION = 700;

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
  getCooldown(): CooldownSlice { const snapshot = this.projectedSnapshot(); return { rollCooldownEnd: snapshot.rollCooldownEnd, rollCooldownMs: snapshot.rollCooldownMs, rollCooldownTimer: null }; }

  // ===== Jail =====
  getJail(): JailSlice { const snapshot = this.projectedSnapshot(); return { isInJail: snapshot.isInJail, jailEndTime: snapshot.jailEndTime }; }

  // ===== Day/Night =====
  getDayNight(): DayNightSlice {
    const snapshot = this.projectedSnapshot();
    return { cycleDuration: 15 * 60 * 1000, cycleStartTime: snapshot.dayNightStartTime, serverTimeOffset: snapshot.serverTimeOffset, prosperity: snapshot.prosperity };
  }

  // ===== Regions =====
  getRegions(): RegionSlice {
    const snapshot = this.projectedSnapshot();
    return { mapRegions: snapshot.mapRegions, valueFieldDefs: snapshot.valueFieldDefs, regionProsperityMap: snapshot.regionProsperityMap, regionValues: snapshot.regionValues };
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
    return { activeChannels: new Set(['region', 'system', 'team']), history: snapshot.chatHistory };
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
    const localProgress = ((serverElapsed / dayNight.cycleDuration) + offsetMinutes / (24 * 60)) % 1;
    const totalMinutes = Math.floor(localProgress * 24 * 60);
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const isDay = localProgress >= 0.25 && localProgress < 0.75;
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
