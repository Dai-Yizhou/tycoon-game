/**
 * 游戏视图模型（ViewModel / Store）
 *
 * 作为 UI 组件与游戏逻辑之间的唯一桥梁：
 * - 持有全部游戏状态（原 GamePage.ts 中的 80+ 模块级变量）
 * - 提供 UI 读取接口，业务状态由 GameStore 投影
 * - UI 组件仅消费此层，不直接访问 GameController / Socket / Canvas
 *
 * 低耦合设计：ViewModel 不导入任何 UI 代码、Canvas 渲染器或 Socket 客户端，
 * 只负责 UI 投影与变更通知。业务事件统一进入 GameStore。
 */

import type { Player } from '@game/shared';
import type { MapIndex } from '@game/shared';
import type { BoardRenderer } from '../renderer/BoardRenderer.js';
import type { TypedClientSocket } from '../hooks/useSocket.js';
import type { GameStore, ClientGameSnapshot, ClientChatMessage } from '../state/GameStore.js';

// ===== 状态切片类型定义 =====

/** 玩家核心状态 */
export interface PlayerSlice {
  currentPlayer: Player | null;
  currentPlayerPosition: number;
  currentMoney: number;
  currentCredit: number;
  currentEnv: number;
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
}

/** 行为事件配置 */
export interface BehaviorEvent {
  msg: string;
  money?: number;
  credit?: number;
  env?: number;
}

export interface BehaviorConfig {
  id: string;
  name: string;
  description: string;
  events: BehaviorEvent[];
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

/** 队伍成员 */
export interface TeamMember {
  id: string;
  username: string;
  money: number;
  credit: number;
  env: number;
  status: 'normal' | 'bankrupt' | 'jail';
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
  status: import('@game/shared').PlayerStatus;
  primaryValue: number;
}

/** 其他玩家状态 */
export interface OtherPlayersSlice {
  players: OtherPlayerInfo[];
}

/** 教程状态 */
export interface TutorialSlice {
  step: number;
  active: boolean;
}

/** 行为配置状态 */
export interface BehaviorSlice {
  configs: Map<string, BehaviorConfig>;
}

// ===== 常量 =====

export const MOVE_STEP_DURATION = 280;
export const CAMERA_FOLLOW_SPEED = 0.15;
export const DICE_ANIM_DURATION = 700;
export const ROLL_COOLDOWN = 3000;

export const RARITY_COLORS: Record<string, string> = {
  common: '#9ca3af', uncommon: '#22c55e', rare: '#3b82f6',
  epic: '#a855f7', legendary: '#f59e0b', ultimate: '#ef4444', unique: '#ec4899',
};

export const RARITY_LABELS: Record<string, string> = {
  common: '普通', uncommon: '罕见', rare: '稀有',
  epic: '史诗', legendary: '传奇', ultimate: '究极', unique: '唯一',
};

export const TIMEZONE_OFFSETS: Record<string, number> = {
  'UTC-8': 0, 'UTC-4': 0.25, 'UTC+0': 0.5, 'UTC+4': 0.75,
};

export const CHAT_CHANNEL_DEFS: ChatChannelDef[] = [
  { id: 'system', label: '系统', color: '#6b7280' },
  { id: 'team', label: '队伍', color: '#3b82f6' },
  { id: 'region', label: '区域', color: '#22c55e' },
];

// ===== 变更事件 =====

/** 状态变更事件，标识哪个切片发生了变化 */
export type StateChangeKey =
  | 'player' | 'movement' | 'camera' | 'dice' | 'cooldown' | 'jail'
  | 'dayNight'
  | 'regions' | 'chat' | 'team' | 'tutorial' | 'otherPlayers' | 'behavior'
  | 'all';

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
  private readonly store: GameStore | null;
  private readonly unsubscribeStore: (() => void) | null;

  constructor(store: GameStore | null = null, displayName = '玩家') {
    this.store = store;
    this.unsubscribeStore = store?.subscribe(() => {
      this.notify('player', 'store');
      this.notify('movement', 'store');
      this.notify('chat', 'store');
    }) ?? null;
    this.player.currentPlayerName = displayName;
  }

  private projectedSnapshot(): ClientGameSnapshot | null {
    return this.store?.getSnapshot() ?? null;
  }

  private projectPlayerName(): string {
    return this.projectedSnapshot()?.currentPlayer?.username ?? this.player.currentPlayerName;
  }
  // — 状态切片 —
  private player: PlayerSlice = {
    currentPlayer: null,
    currentPlayerPosition: 0,
    currentMoney: 2000,
    currentCredit: 50,
    currentEnv: 0,
    isBankrupt: false,
    actionUsedThisTurn: false,
    ownedProperties: new Set(),
    propertyLevels: new Map(),
    ownedInvestments: new Set(),
    investmentShares: new Map(),
    currentPlayerName: '玩家',
  };

  private movement: MovementSlice = {
    isMoving: false,
    canRoll: true,
    remainingSteps: 0,
    previousCellId: -1,
    playerDisplayX: 600,
    playerDisplayY: 500,
    moveFromX: 0, moveFromY: 0,
    moveToX: 0, moveToY: 0,
    moveStartTime: 0,
    isWaitingForChoice: false,
    serverPath: [],
    serverPathIndex: 0,
    isServerAnimating: false,
  };

  private camera: CameraSlice = { cameraTargetX: 0, cameraTargetY: 0 };
  private dice: DiceSlice = { diceValue: 0, diceAnimating: false, diceAnimStart: 0 };
  private cooldown: CooldownSlice = { rollCooldownEnd: 0, rollCooldownTimer: null };
  private jail: JailSlice = { isInJail: false, jailEndTime: 0 };

  private dayNight: DayNightSlice = {
    cycleDuration: 15 * 60 * 1000,
    cycleStartTime: Date.now(),
    serverTimeOffset: 0,
    prosperity: 100,
  };

  private regions: RegionSlice = {
    mapRegions: [],
    valueFieldDefs: [],
    regionProsperityMap: new Map(),
  };

  private chat: ChatSlice = {
    activeChannels: new Set(['system']),
    history: [],
  };

  private team: TeamSlice = { members: [] };
  private tutorial: TutorialSlice = { step: 0, active: false };

  private otherPlayers: OtherPlayersSlice = { players: [] };

  private behavior: BehaviorSlice = { configs: new Map() };

  // — 外部引用（非状态，由 GamePage 注入） —
  /** 棋盘渲染器，供渲染循环使用 */
  renderer: BoardRenderer | null = null;
  /** 地图索引 */
  mapIndex: MapIndex | null = null;
  /** Canvas 元素 */
  canvasEl: HTMLCanvasElement | null = null;
  /** Socket 连接 */
  gameSocket: TypedClientSocket | null = null;
  /** 动画帧 ID */
  animationFrameId: number | null = null;
  /** 繁荣度定时器 */
  prosperityTimer: ReturnType<typeof setInterval> | null = null;
  /** 详细面板更新定时器 */
  detailPanelUpdateTimer: ReturnType<typeof setInterval> | null = null;
  /** 上次玩家时区 */
  lastPlayerTimezone = '';
  /** 上次昼夜状态 */
  lastLocalIsDay: boolean | null = null;

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

  // ===== Player =====
  getPlayer(): PlayerSlice { const snapshot = this.projectedSnapshot(); return snapshot ? { ...this.player, currentPlayer: snapshot.currentPlayer, currentPlayerPosition: snapshot.currentPlayerPosition, currentMoney: snapshot.currentMoney, currentCredit: snapshot.currentCredit, currentEnv: snapshot.currentEnv, isBankrupt: snapshot.isBankrupt, currentPlayerName: this.projectPlayerName() } : this.player; }

  // ===== Movement =====
  getMovement(): MovementSlice {
    const snapshot = this.projectedSnapshot();
    return snapshot ? { ...this.movement, canRoll: snapshot.canRoll } : this.movement;
  }
  updateMovement(partial: Partial<MovementSlice>, source = 'ui'): void {
    Object.assign(this.movement, partial);
    this.notify('movement', source);
  }

  // ===== Camera =====
  getCamera(): CameraSlice { return this.camera; }
  setCamera(partial: Partial<CameraSlice>, source = 'external'): void {
    Object.assign(this.camera, partial);
    this.notify('camera', source);
  }

  // ===== Dice =====
  getDice(): DiceSlice { return this.dice; }
  updateDice(partial: Partial<DiceSlice>, source = 'ui'): void {
    Object.assign(this.dice, partial);
    this.notify('dice', source);
  }

  // ===== Cooldown =====
  getCooldown(): CooldownSlice { return this.cooldown; }
  updateCooldown(partial: Partial<CooldownSlice>, source = 'ui'): void {
    Object.assign(this.cooldown, partial);
    this.notify('cooldown', source);
  }

  // ===== Jail =====
  getJail(): JailSlice { const snapshot = this.projectedSnapshot(); return snapshot ? { ...this.jail, isInJail: snapshot.isInJail, jailEndTime: snapshot.jailEndTime } : this.jail; }

  // ===== Day/Night =====
  getDayNight(): DayNightSlice { return this.dayNight; }
  updateDayNight(partial: Partial<DayNightSlice>, source = 'ui'): void {
    Object.assign(this.dayNight, partial);
    this.notify('dayNight', source);
  }

  // ===== Regions =====
  getRegions(): RegionSlice { return this.regions; }
  setRegions(partial: Partial<RegionSlice>, source = 'external'): void {
    Object.assign(this.regions, partial);
    this.notify('regions', source);
  }

  // ===== Chat =====
  getChat(): ChatSlice {
    const snapshot = this.projectedSnapshot();
    return snapshot ? { ...this.chat, history: snapshot.chatHistory } : this.chat;
  }
  setChat(partial: Partial<ChatSlice>, source = 'external'): void {
    Object.assign(this.chat, partial);
    this.notify('chat', source);
  }

  // ===== Team =====
  getTeam(): TeamSlice { const snapshot = this.projectedSnapshot(); return snapshot ? { members: snapshot.teamMembers as TeamMember[] } : this.team; }

  // ===== Tutorial =====
  getTutorial(): TutorialSlice { return this.tutorial; }
  setTutorial(partial: Partial<TutorialSlice>, source = 'external'): void {
    Object.assign(this.tutorial, partial);
    this.notify('tutorial', source);
  }

  // ===== Other Players =====
  getOtherPlayers(): OtherPlayersSlice { const snapshot = this.projectedSnapshot(); return snapshot ? { players: snapshot.otherPlayers as OtherPlayerInfo[] } : this.otherPlayers; }

  // ===== Behavior =====
  getBehavior(): BehaviorSlice { return this.behavior; }
  setBehavior(partial: Partial<BehaviorSlice>, source = 'external'): void {
    Object.assign(this.behavior, partial);
    this.notify('behavior', source);
  }

  // ===== 工具方法 =====

  /**
   * 获取当前玩家所在时区
   */
  getPlayerTimezone(): string {
    if (!this.mapIndex) return 'UTC+0';
    const cell = this.mapIndex.getById(this.player.currentPlayerPosition);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tz = cell ? (cell as any).extra?.timezone ?? (cell as any).timezone : null;
    return tz || 'UTC+0';
  }

  /**
   * 基于服务器时间 + 时区计算本地昼夜状态
   */
  getLocalDayNight(timezone: string): {
    isDay: boolean; progress: number; hour: number; minute: number; timeStr: string;
  } {
    const offset = TIMEZONE_OFFSETS[timezone] ?? 0;
    const serverNow = Date.now() + this.dayNight.serverTimeOffset;
    const serverElapsed = serverNow - this.dayNight.cycleStartTime;
    const localProgress = ((serverElapsed / this.dayNight.cycleDuration) + offset) % 1;
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
    this.player = {
      currentPlayer: null, currentPlayerPosition: 0, currentMoney: 2000,
      currentCredit: 50, currentEnv: 0, isBankrupt: false, actionUsedThisTurn: false,
      ownedProperties: new Set(), propertyLevels: new Map(),
      ownedInvestments: new Set(), investmentShares: new Map(), currentPlayerName: '玩家',
    };
    this.movement = {
      isMoving: false, canRoll: true, remainingSteps: 0, previousCellId: -1,
      playerDisplayX: 600, playerDisplayY: 500,
      moveFromX: 0, moveFromY: 0, moveToX: 0, moveToY: 0, moveStartTime: 0,
      isWaitingForChoice: false, serverPath: [], serverPathIndex: 0, isServerAnimating: false,
    };
    this.camera = { cameraTargetX: 0, cameraTargetY: 0 };
    this.dice = { diceValue: 0, diceAnimating: false, diceAnimStart: 0 };
    this.cooldown = { rollCooldownEnd: 0, rollCooldownTimer: null };
    this.jail = { isInJail: false, jailEndTime: 0 };
    this.dayNight = { cycleDuration: 15 * 60 * 1000, cycleStartTime: Date.now(), serverTimeOffset: 0, prosperity: 100 };
    this.regions = { mapRegions: [], valueFieldDefs: [], regionProsperityMap: new Map() };
    this.chat = { activeChannels: new Set(['system']), history: [] };
    this.team = { members: [] };
    this.tutorial = { step: 0, active: false };
    this.otherPlayers = { players: [] };
    this.behavior = { configs: new Map() };
    this.renderer = null;
    this.mapIndex = null;
    this.canvasEl = null;
    this.gameSocket = null;
    this.animationFrameId = null;
    this.prosperityTimer = null;
    this.detailPanelUpdateTimer = null;
    this.lastPlayerTimezone = '';
    this.lastLocalIsDay = null;
    this.unsubscribeStore?.();
    this.notify('all', 'reset');
  }
}
