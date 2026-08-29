/**
 * 前后端 Socket.IO 事件类型定义
 *
 * 采用 Socket.IO 推荐的 typed events 模式：
 * - `ClientToServerEvents` : 客户端 → 服务端
 * - `ServerToClientEvents` : 服务端 → 客户端
 * - `SocketData`           : 每个连接的状态（如 playerId、teamId）
 *
 * 业务事件以「domain.action」形式命名（如 `client.rollDice`），便于扩展。
 *
 * 用法（服务端）：
 * ```ts
 * import { Server } from 'socket.io';
 * import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '@game/shared';
 *
 * const io = new Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>();
 * io.on('connection', (socket) => {
 *   socket.on('client.rollDice', (payload, ack) => {
 *     // ...
 *     socket.emit('server.playerMoved', { playerId: socket.data.playerId, ... });
 *     ack({ ok: true });
 *   });
 * });
 * ```
 *
 * 用法（客户端）：
 * ```ts
 * import { io, Socket } from 'socket.io-client';
 * import type { ClientToServerEvents, ServerToClientEvents } from '@game/shared';
 *
 * const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();
 * socket.emit('client.rollDice', { steps: 6 });
 * socket.on('server.playerMoved', (payload) => { /* ... *\/ });
 * ```
 */

import type { Cell, Uct } from './cell.js';
import type { ChatChannel, ChatMessage } from './chat.js';
import type { Player, ValueField } from './player.js';
import type { Team, TeamInvite, TeamMemberView } from './team.js';
import type { LeaderboardSnapshot } from './leaderboard.js';
import type { AchievementSnapshot } from './achievement.js';

// ---------------------------------------------------------------------------
// 共用负载（Payloads）
// ---------------------------------------------------------------------------

/** 玩家标识 */
export interface PlayerIdPayload {
  playerId: string;
}

/** 格子标识 */
export interface CellIdPayload {
  cellId: number;
}

/** 通用结果回执 */
export interface AckResult<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** 数值变化广播 */
export interface ValueChangedPayload {
  playerId: string;
  /** 受影响的字段 ID */
  fieldId: string;
  /** 变化后的当前值 */
  current: number;
  /** 变化量 */
  delta: number;
}

/** 位置变更 */
export interface PositionChangedPayload extends PlayerIdPayload {
  cellId: number;
  /** 路径经过的格子（动画用），按顺序 */
  path?: number[];
}

// ---------------------------------------------------------------------------
// 客户端 → 服务端（ClientToServerEvents）
// ---------------------------------------------------------------------------

export interface ClientToServerEvents {
  /** 登录/加入游戏 */
  'client.login': (
    payload: { username: string; guest?: boolean },
    ack?: (result: AckResult<{ player: Player; serverTime: number; cycleStartTime: number; cycleMinutes: number; existingPlayers: Player[]; leaderboard?: LeaderboardSnapshot; leaderboardEnabled?: boolean; achievements?: AchievementSnapshot }>) => void,
  ) => void;

  /** 掷骰子 */
  'client.rollDice': (
    payload: Record<string, never>,
    ack?: (result: AckResult<{ dice: number; steps: number; cooldownMs: number; cooldownEndsAt: number }>) => void,
  ) => void;

  /**
   * 选择移动路径上的多岔路
   *
   * 当玩家走过的格子有多个 destinations 时，服务端推送 `server.askPath` 询问选择。
   */
  'client.choosePath': (
    payload: { fromCellId: number; toCellId: number },
    ack?: (result: AckResult<{ cellId: number }>) => void,
  ) => void;

  /** 购买地产/项目 */
  'client.buyProperty': (
    payload: { cellId: number; requestId?: string; expectedResourceVersion?: number; expectedCellVersion?: number },
    ack?: (result: AckResult<{ cell: Cell }>) => void,
  ) => void;

  /** 升级地产 */
  'client.upgradeProperty': (
    payload: { cellId: number; requestId?: string; expectedResourceVersion?: number; expectedCellVersion?: number },
    ack?: (result: AckResult<{ cell: Cell; cost: import('./cell.js').Uct }>) => void,
  ) => void;


  /** 组队邀请（服务端权威：客户端仅发送请求，邀请由服务端校验并创建） */
  'client.inviteToTeam': (
    payload: { targetPlayerId: string },
    ack?: (result: AckResult<{ invite: TeamInvite }>) => void,
  ) => void;

  /** 响应组队邀请（接受/拒绝，由服务端校验并执行加入逻辑） */
  'client.respondToTeamInvite': (
    payload: { inviteId: string; accept: boolean },
    ack?: (result: AckResult<{ team: Team | null }>) => void,
  ) => void;

  /** 离开队伍（由服务端校验并执行，结果通过 team 事件广播） */
  'client.leaveTeam': (
    payload: Record<string, never>,
    ack?: (result: AckResult<{ teamDisbanded: boolean }>) => void,
  ) => void;

  /** 查询当前队伍状态（服务端返回完整队伍与成员显示数据） */
  'client.getTeamState': (
    payload: Record<string, never>,
    ack?: (result: AckResult<{ team: Team | null; members: TeamMemberView[]; color: string | null }>) => void,
  ) => void;

  /** 聊天 */
  'client.chat': (
    payload: { channel: ChatChannel; content: string; metadata?: Record<string, unknown> },
    ack?: (result: AckResult<{ message: ChatMessage }>) => void,
  ) => void;


  /** 客户端 → 服务端心跳 */
  'client.ping': (
    payload: { timestamp: number },
    ack?: (result: { timestamp: number; serverTime: number }) => void,
  ) => void;

  /** 使用交通枢纽传送 */
  'client.useTransport': (
    payload: { hubCellId: number; targetCellId: number },
    ack?: (result: AckResult) => void,
  ) => void;

  /** 获取交通枢纽目的地列表 */
  'client.getTransportDestinations': (
    payload: { hubCellId: number },
    ack?: (result: AckResult) => void,
  ) => void;

  /** 购买投资项目 */
  'client.buyInvestment': (
    payload: { cellId: number; requestId?: string; expectedResourceVersion?: number; expectedCellVersion?: number },
    ack?: (result: AckResult<{ cell: Cell }>) => void,
  ) => void;

  /** 修缮纪念碑 */
  'client.repairMonument': (
    payload: { monumentId: number },
    ack?: (result: AckResult) => void,
  ) => void;

  /** 获取纪念碑状态 */
  'client.getMonumentStatus': (
    payload: { monumentId: number },
    ack?: (result: AckResult) => void,
  ) => void;

  /** 破产重开（破产玩家选择重新开始游戏） */
  'client.bankruptRestart': (
    payload: Record<string, never>,
    ack?: (result: AckResult) => void,
  ) => void;
}

// ---------------------------------------------------------------------------
// 服务端 → 客户端（ServerToClientEvents）
// ---------------------------------------------------------------------------

export interface ServerToClientEvents {
  /** 完整游戏状态（玩家登录/重连时下发） */
  'server.gameState': (payload: {
    player: Player;
    team: Team | null;
    achievements?: AchievementSnapshot;
    members?: TeamMemberView[];
    ownedProperties?: Array<{ cellId: number; level: number }>;
    ownedInvestments?: Array<{ cellId: number; share: number }>;
    /** 当前玩家视野内可见的格子（可选） */
    visibleCells?: Cell[];
    /** 服务端时间 */
    serverTime: number;
    /** 当前排行榜快照 */
    leaderboard?: LeaderboardSnapshot;
    /** 是否启用排行榜 */
    leaderboardEnabled?: boolean;
  }) => void;

  /** 榜单完整快照更新 */
  'server.leaderboardUpdated': (payload: LeaderboardSnapshot) => void;

  'server.achievementUnlocked': (payload: import('./achievement.js').AchievementUnlockedPayload) => void;

  /** 玩家加入 */
  'server.playerJoined': (payload: Player) => void;

  /** 玩家离开 */
  'server.playerLeft': (payload: PlayerIdPayload) => void;

  /** 玩家移动 */
  'server.playerMoved': (payload: PositionChangedPayload) => void;

  /** 服务端询问路径选择 */
  'server.askPath': (payload: {
    fromCellId: number;
    options: { cellId: number; label?: string }[];
  }) => void;

  /** 玩家数值变化（财产/信用值等） */
  'server.valueChanged': (payload: ValueChangedPayload) => void;

  /** 玩家状态变更（在监狱/破产等） */
  'server.playerStatusChanged': (payload: {
    playerId: string;
    status: Player['status'];
    expiresAt?: number;
  }) => void;

  /** 地产被购买 */
  'server.propertyBought': (payload: { cell: Cell; playerId: string; runtime: { ownerships: Array<{ playerId: string; share: number; purchasePrice: number }>; level: number; accumulatedValue: number } }) => void;

  /** 地产被升级 */
  'server.propertyUpgraded': (payload: {
    cell: Cell;
    playerId: string;
    newLevel: number;
    cost: import('./cell.js').Uct;
    runtime: { ownerships: Array<{ playerId: string; share: number; purchasePrice: number }>; level: number; accumulatedValue: number };
  }) => void;

  /** 玩家进入监狱 */
  'server.playerJailed': (payload: { playerId: string; cellId: number; durationMs: number; expiresAt: number; remainingMs: number }) => void;

  /** 玩家出狱 */
  'server.playerReleased': (payload: { playerId: string }) => void;

  /** 玩家破产 */
  'server.playerBankrupt': (payload: {
    playerId: string;
    bankruptcyId?: string;
    bankruptcyTime?: number;
    reason?: string;
    netWorthAtBankruptcy?: number;
  }) => void;

  'server.playerRestarted': (payload: {
    playerId: string;
    restartTime: number;
    player: Player;
    startingValues?: import('./cell.js').Uct;
  }) => void;


  /** 通用通知（弹窗） */
  'server.notification': (payload: {
    id: string;
    type: 'info' | 'success' | 'warning' | 'error';
    title: string;
    content: string;
    actions?: { label: string; action: string; payload?: unknown }[];
    /** 持续时间（毫秒），0 表示需用户手动关闭 */
    durationMs?: number;
  }) => void;

  /** 聊天消息（频道内） */
  'server.chat': (payload: { message: ChatMessage }) => void;

  /**
   * 队伍状态更新广播（服务端权威）
   *
   * members 携带每个成员的实时显示数据，客户端据此完整重建本地队伍视图。
   */
  'server.teamUpdated': (payload: { team: Team; members: TeamMemberView[] }) => void;

  /** 收到组队邀请 */
  'server.teamInviteReceived': (payload: {
    inviterId: string;
    inviterName: string;
    inviteId: string;
    teamId: string;
    expiresAt: number;
  }) => void;

  /** 队伍成员加入通知（仅提示，队伍状态以 teamUpdated 为准） */
  'server.teamMemberJoined': (payload: {
    teamId: string;
    playerId: string;
    playerName: string;
  }) => void;

  /** 队伍成员离开通知（仅提示，队伍状态以 teamUpdated 为准） */
  'server.teamMemberLeft': (payload: {
    teamId: string;
    playerId: string;
  }) => void;


  /** 队伍解散通知 */
  'server.teamDisbanded': (payload: { teamId: string }) => void;
  /** 昼夜切换 */
  'server.dayNightChanged': (payload: {
    isDay: boolean;
    /** 全局时间（Unix 毫秒） */
    globalTime: number;
    /** 周期内进度（0-1） */
    progress: number;
    /** 周期起始时间（Unix 毫秒），客户端据此同步 */
    cycleStartTime: number;
    /** 周期时长（分钟） */
    cycleMinutes: number;
  }) => void;

  /** 昼夜进度更新（每秒广播） */
  'server.dayNightProgress': (payload: {
    /** 当前阶段（'day' 或 'night'） */
    phase: 'day' | 'night';
    /** 周期内进度（0-1） */
    progress: number;
    /** 全局时间（Unix 毫秒） */
    globalTime: number;
    /** 周期起始时间（Unix 毫秒），客户端据此同步 */
    cycleStartTime: number;
    /** 周期时长（分钟） */
    cycleMinutes: number;
  }) => void;

  /** 繁荣度变化 */
  'server.prosperityChanged': (payload: {
    /** 区域 ID */
    regionId?: string;
    /** 纪念碑 ID */
    monumentId?: number;
    /** 当前繁荣度 */
    prosperity: number;
    /** 变化量 */
    delta: number;
    /** 变化原因 */
    reason?: string;
    /** 变化时间 */
    timestamp?: number;
  }) => void;

  /** 时代切换预告 */
  'server.eraEndingSoon': (payload: { eraId: string; endsAt: number }) => void;

  /** 时代切换完成 */
  'server.eraChanged': (payload: {
    previousEraId: string | null;
    newEraId: string;
    newMapId: string;
  }) => void;

  /** 骰子结果广播（其他玩家可见） */
  'server.diceRolled': (payload: { playerId: string; dice: number; steps: number; cooldownMs: number; cooldownEndsAt: number }) => void;

  /** 全局初始数值字段定义（用于客户端 UI 渲染） */
  'server.valueFieldDefinitions': (payload: { definitions: ValueField[] }) => void;


  /** 错误 */
  'server.error': (payload: { code: string; message: string }) => void;

  /** 服务端心跳回包 */
  'server.pong': (payload: { timestamp: number; serverTime: number }) => void;

  /** 交通枢纽目的地变更 */
  'server.transportDestinationsChanged': (payload: {
    hubId: number;
    destinations: Array<{ cellId: number; name?: string }>;
  }) => void;

  /** 投资项目被购买 */
  'server.investmentBought': (payload: { cell: Cell; playerId: string; runtime: { ownerships: Array<{ playerId: string; share: number; purchasePrice: number }>; level: number; accumulatedValue: number } }) => void;

  /** 投资项目事件被触发 */
  'server.investmentEventTriggered': (payload: {
    investmentId: number;
    amount: import('./cell.js').Uct;
    affectedPlayers: Array<{ playerId: string; share: number; amount: import('./cell.js').Uct }>;
  }) => void;

  /** 计税周期完成 */
  'server.taxCycleComplete': (payload: {
    timestamp: number;
    playerCount: number;
  }) => void;

  /** 税收收取（按 UCT 逐字段） */
  'server.taxCollected': (payload: {
    playerId: string;
    /** 基础税逐字段税额 */
    baseTax: Uct;
    /** 股份税逐字段税额 */
    shareTax: Uct;
    totalTax: number;
    timestamp?: number;
  }) => void;

  /** 时区变化 */
  'server.timezoneChanged': (payload: {
    playerId: string;
    fromTimezoneId: string;
    toTimezoneId: string;
    fromOffsetMinutes: number;
    toOffsetMinutes: number;
    fromTimezoneName?: string;
    toTimezoneName?: string;
  }) => void;
}

// ---------------------------------------------------------------------------
// 连接级状态（SocketData）
// ---------------------------------------------------------------------------

/**
 * 每个 socket 连接关联的状态
 */
export interface SocketData {
  playerId?: string;
  teamId?: string | null;
  /** 是否已鉴权 */
  authenticated?: boolean;
  /** 连接的远端 IP（调试用） */
  remoteAddress?: string;
  /** 是否为游客模式（游客不持久化） */
  guest?: boolean;
  username?: string;
}
