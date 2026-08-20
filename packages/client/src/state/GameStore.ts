/**
 * 游戏全局状态存储
 *
 * 集中管理所有游戏状态变量，消除 GamePage.ts 中 50+ 全局变量散落问题。
 * 所有状态读取/修改通过此模块，便于追踪、测试和后续迁移到响应式框架。
 */

import type { Cell, Player, MapIndex, ChatMessage as ServerChatMessage } from '@game/shared';
import { getExtra } from '@game/shared';
import type { BoardRenderer } from '../renderer/BoardRenderer.js';
import type { TypedClientSocket } from '../hooks/useSocket.js';

// ===== 类型定义 =====

export interface OtherPlayerInfo {
  id: string;
  username: string;
  position: { cellId: number };
  status: string;
  primaryValue: number;
}

export interface RegionInfo {
  id: string; name: string; color: string; cellIds: number[];
  prosperity: number; timezone: string;
}

export interface ValueFieldDef {
  id: string; name: string; scope: 'player' | 'region';
  min?: number; max?: number;
}

export interface BehaviorEvent {
  playerId: string; event: { msg: string; type: string };
  effects: { field: string; value: number }[];
}

export interface BehaviorConfig {
  id: string; type: string; weight: number;
  events: BehaviorEvent[];
}

export interface TeamMember {
  id: string; username: string; money: number; credit: number;
  env: number; status: string;
}

export interface ChatChannelDef {
  id: string; label: string; icon: string; color: string;
}

// ===== 状态 =====

// 渲染
export let renderer: BoardRenderer | null = null;
export let animationFrameId: number | null = null;
export let mapIndex: MapIndex | null = null;
export let canvasEl: HTMLCanvasElement | null = null;
export let gameSocket: TypedClientSocket | null = null;

// 当前玩家
export let currentPlayer: Player | null = null;
export let currentPlayerPosition = 0;
export let currentMoney = 2000;
export let currentCredit = 50;
export let currentEnv = 0;
export let isBankrupt = false;
export let actionUsedThisTurn = false;
export let currentPlayerName = '';

// 持有资产
export let ownedProperties: Set<number> = new Set();
export let propertyLevels: Map<number, number> = new Map();
export let ownedInvestments: Set<number> = new Set();
export let investmentShares: Map<number, number> = new Map();

// 其他玩家
export let otherPlayers: OtherPlayerInfo[] = [];

// 移动
export let isMoving = false;
export let canRoll = true;
export let remainingSteps = 0;
export let previousCellId = -1;
export let playerDisplayX = 600;
export let playerDisplayY = 500;
export let moveFromX = 0;
export let moveFromY = 0;
export let moveToX = 0;
export let moveToY = 0;
export let moveStartTime = 0;
export const moveStepDuration = 280;
export let isWaitingForChoice = false;
export let serverPath: number[] = [];
export let serverPathIndex = 0;
export let isServerAnimating = false;

// 相机
export let cameraTargetX = 0;
export let cameraTargetY = 0;
export const cameraFollowSpeed = 0.15;

// 骰子
export let diceValue = 0;
export let diceAnimating = false;
export let diceAnimStart = 0;
export const diceAnimDuration = 700;

// 冷却
export const rollCooldown = 3000;
export let rollCooldownEnd = 0;
export let rollCooldownTimer: ReturnType<typeof setInterval> | null = null;

// 监狱
export let isInJail = false;
export let jailEndTime = 0;

// 昼夜
export let DAY_NIGHT_CYCLE = 15 * 60 * 1000;
export let dayNightStartTime = Date.now();
export let serverTimeOffset = 0;

// 区域与繁荣度
export let prosperity = 100;
export let prosperityTimer: ReturnType<typeof setInterval> | null = null;
export let mapRegions: RegionInfo[] = [];
export let valueFieldDefs: ValueFieldDef[] = [];
export let regionProsperityMap: Map<string, number> = new Map();

// 行为
export let behaviorConfigs: Map<string, BehaviorConfig> = new Map();

// 教程
export let tutorialStep = 0;
export let tutorialActive = false;

// 详细面板
export let detailPanelExpanded = false;
export let detailPanelUpdateTimer: ReturnType<typeof setInterval> | null = null;

// 昼夜与时区
export let lastLocalIsDay: boolean | null = null;
export let lastPlayerTimezone = '';

// 聊天
export let activeChatChannels: Set<string> = new Set(['system']);
export let selectedChatChannel = 'global';
export const chatChannelDefs: ChatChannelDef[] = [
  { id: 'system', label: 'chat.channel.system', icon: '🔔', color: '#f59e0b' },
  { id: 'global', label: 'chat.channel.global', icon: '🌍', color: '#3b82f6' },
  { id: 'team', label: 'chat.channel.team', icon: '👥', color: '#10b981' },
  { id: 'region', label: 'chat.channel.region', icon: '📍', color: '#8b5cf6' },
];

// 队伍
export let teamMembers: TeamMember[] = [];

// DOM 元素引用
export let rollBtn: HTMLButtonElement | null = null;
export let diceDisplayEl: HTMLElement | null = null;
export let actionButtonsEl: HTMLElement | null = null;
export let chatBoxEl: HTMLElement | null = null;
export let hoverCardEl: HTMLElement | null = null;
export let topBarProsperityEl: HTMLElement | null = null;
export let topBarProsperityFillEl: HTMLElement | null = null;
export let topBarRegionFieldsEl: HTMLElement | null = null;
export let topBarTimeEl: HTMLElement | null = null;
export let teamPanelContentEl: HTMLElement | null = null;
export let chatChannelContainer: HTMLElement | null = null;

// ===== 状态更新函数 =====

export function setRenderer(val: BoardRenderer | null): void { renderer = val; }
export function setAnimationFrameId(val: number | null): void { animationFrameId = val; }
export function setMapIndex(val: MapIndex | null): void { mapIndex = val; }
export function setCanvasEl(val: HTMLCanvasElement | null): void { canvasEl = val; }
export function setGameSocket(val: TypedClientSocket | null): void { gameSocket = val; }
export function setCurrentPlayer(val: Player | null): void { currentPlayer = val; }
export function setCurrentPlayerPosition(val: number): void { currentPlayerPosition = val; (window as any).currentPlayerPosition = val; }
export function setActionUsedThisTurn(val: boolean): void { actionUsedThisTurn = val; }
export function setCurrentPlayerName(val: string): void { currentPlayerName = val; }
export function setOtherPlayers(val: OtherPlayerInfo[]): void { otherPlayers = val; }
export function setIsMoving(val: boolean): void { isMoving = val; }
export function setCanRoll(val: boolean): void { canRoll = val; }
export function setRemainingSteps(val: number): void { remainingSteps = val; }
export function setPreviousCellId(val: number): void { previousCellId = val; }
export function setPlayerDisplayPos(x: number, y: number): void { playerDisplayX = x; playerDisplayY = y; }
export function setMoveFrom(x: number, y: number): void { moveFromX = x; moveFromY = y; }
export function setMoveTo(x: number, y: number): void { moveToX = x; moveToY = y; }
export function setMoveStartTime(val: number): void { moveStartTime = val; }
export function setIsWaitingForChoice(val: boolean): void { isWaitingForChoice = val; }
export function setServerPath(val: number[]): void { serverPath = val; }
export function setServerPathIndex(val: number): void { serverPathIndex = val; }
export function setIsServerAnimating(val: boolean): void { isServerAnimating = val; }
export function setCameraTarget(x: number, y: number): void { cameraTargetX = x; cameraTargetY = y; }
export function setDiceValue(val: number): void { diceValue = val; }
export function setDiceAnimating(val: boolean): void { diceAnimating = val; }
export function setDiceAnimStart(val: number): void { diceAnimStart = val; }
export function setRollCooldownEnd(val: number): void { rollCooldownEnd = val; }
export function setRollCooldownTimer(val: ReturnType<typeof setInterval> | null): void { rollCooldownTimer = val; }
export function setIsInJail(val: boolean): void { isInJail = val; }
export function setJailEndTime(val: number): void { jailEndTime = val; }
export function setDayNightCycle(val: number): void { DAY_NIGHT_CYCLE = val; }
export function setDayNightStartTime(val: number): void { dayNightStartTime = val; }
export function setServerTimeOffset(val: number): void { serverTimeOffset = val; }
export function setProsperity(val: number): void { prosperity = val; }
export function setProsperityTimer(val: ReturnType<typeof setInterval> | null): void { prosperityTimer = val; }
export function setMapRegions(val: RegionInfo[]): void { mapRegions = val; }
export function setValueFieldDefs(val: ValueFieldDef[]): void { valueFieldDefs = val; }
export function setRegionProsperityMap(val: Map<string, number>): void { regionProsperityMap = val; }
export function setBehaviorConfigs(val: Map<string, BehaviorConfig>): void { behaviorConfigs = val; }
export function setTutorialStep(val: number): void { tutorialStep = val; }
export function setTutorialActive(val: boolean): void { tutorialActive = val; }
export function setActiveChatChannels(val: Set<string>): void { activeChatChannels = val; }
export function setSelectedChatChannel(val: string): void { selectedChatChannel = val; }
export function setTeamMembers(val: TeamMember[]): void { teamMembers = val; }
export function setRollBtn(val: HTMLButtonElement | null): void { rollBtn = val; }
export function setDiceDisplayEl(val: HTMLElement | null): void { diceDisplayEl = val; }
export function setActionButtonsEl(val: HTMLElement | null): void { actionButtonsEl = val; }
export function setChatBoxEl(val: HTMLElement | null): void { chatBoxEl = val; }
export function setHoverCardEl(val: HTMLElement | null): void { hoverCardEl = val; }
export function setTopBarProsperityEl(val: HTMLElement | null): void { topBarProsperityEl = val; }
export function setTopBarProsperityFillEl(val: HTMLElement | null): void { topBarProsperityFillEl = val; }
export function setTopBarRegionFieldsEl(val: HTMLElement | null): void { topBarRegionFieldsEl = val; }
export function setTopBarTimeEl(val: HTMLElement | null): void { topBarTimeEl = val; }
export function setTeamPanelContentEl(val: HTMLElement | null): void { teamPanelContentEl = val; }
export function setChatChannelContainer(val: HTMLElement | null): void { chatChannelContainer = val; }
export function setDetailPanelExpanded(val: boolean): void { detailPanelExpanded = val; }
export function setDetailPanelUpdateTimer(val: ReturnType<typeof setInterval> | null): void { detailPanelUpdateTimer = val; }
export function setLastLocalIsDay(val: boolean | null): void { lastLocalIsDay = val; }
export function setLastPlayerTimezone(val: string): void { lastPlayerTimezone = val; }

// ===== 辅助函数 =====

export function cName(c: Cell): string { return getExtra<string>(c, 'name', '') ?? ''; }
export function cType(c: Cell): string { return getExtra<string>(c, 'type', '') ?? ''; }
export function cIcon(c: Cell): string { return getExtra<string>(c, 'icon', '📍') ?? '📍'; }
export function cPrice(c: Cell): number { return getExtra<number>(c, 'price', 0) ?? 0; }
export function cRent(c: Cell): number[] { return getExtra<number[]>(c, 'rent', []) ?? []; }
export function cUpgradeCost(c: Cell): number[] { return getExtra<number[]>(c, 'upgradeCost', []) ?? []; }
export function cDesc(c: Cell): string[] { return getExtra<string[]>(c, 'description', []) ?? []; }
export function cEffects(c: Cell): unknown[] { return getExtra<unknown[]>(c, 'extra', []) ?? []; }
export function cOwners(c: Cell): number[] { return getExtra<number[]>(c, 'owners', []) ?? []; }
export function cTransportCost(c: Cell): number { return getExtra<number>(c, 'transportCost', 0) ?? 0; }
export function cMonumentCost(c: Cell): number { return getExtra<number>(c, 'monumentCost', 0) ?? 0; }
export function cInvestmentReturn(c: Cell): number { return getExtra<number>(c, 'investmentReturn', 0) ?? 0; }

export function getCellEnvValue(cell: Cell): number {
  const extras = getExtra<string[]>(cell, 'extra', []) ?? [];
  let total = 0;
  for (const e of extras) {
    if (typeof e === 'string') {
      const m = e.match(/环保([+-]?\d+)/);
      if (m) total += parseInt(m[1], 10);
    }
  }
  return total;
}

export function getRegionEnvValue(cellId: number): number {
  if (!mapIndex) return 0;
  let total = 0;
  const visited = new Set<number>();
  const queue = [cellId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const cell = mapIndex.getById(currentId);
    if (!cell) continue;
    total += getCellEnvValue(cell);
    for (const destId of cell.destinations) {
      if (!visited.has(destId)) queue.push(destId);
    }
  }
  return total;
}

export function getRegionByCellId(cellId: number): RegionInfo | null {
  for (const region of mapRegions) {
    if (region.cellIds.includes(cellId)) return region;
  }
  return null;
}

export function getCurrentRegionProsperity(): number {
  const region = getRegionByCellId(currentPlayerPosition);
  if (region) return regionProsperityMap.get(region.id) ?? region.prosperity;
  return prosperity;
}

export function getCellTypeName(type: string): string {
  const names: Record<string, string> = {
    property: 'property', event: 'event', investment: 'investment',
    transport: 'transport', monument: 'monument', start: 'start',
    jail: 'jail', empty: 'empty',
  };
  return names[type] || type;
}

export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function getCanvasCoords(e: MouseEvent): { x: number; y: number } {
  if (!canvasEl) return { x: 0, y: 0 };
  const rect = canvasEl.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

export const RARITY_COLORS: Record<string, string> = {
  common: '#94a3b8', rare: '#3b82f6', epic: '#8b5cf6', legendary: '#f59e0b',
};

export const RARITY_LABELS: Record<string, string> = {
  common: 'common', rare: 'rare', epic: 'epic', legendary: 'legendary',
};

export interface ClientGameSnapshot {
  sequence: number;
  currentPlayer: Player | null;
  otherPlayers: OtherPlayerInfo[];
  currentPlayerPosition: number;
  currentMoney: number;
  currentCredit: number;
  currentEnv: number;
  isBankrupt: boolean;
  isInJail: boolean;
  jailEndTime: number;
  canRoll: boolean;
  diceAnimating: boolean;
  actionUsedThisTurn: boolean;
  teamMembers: TeamMember[];
  ownedProperties: Set<number>;
  propertyLevels: Map<number, number>;
  ownedInvestments: Set<number>;
  investmentShares: Map<number, number>;
  chatHistory: ClientChatMessage[];
  cells: Map<number, Cell>;
  isMoving: boolean;
  remainingSteps: number;
  cameraTargetX: number;
  cameraTargetY: number;
  diceValue: number;
  diceAnimStart: number;
  rollCooldownEnd: number;
  dayNightStartTime: number;
  serverTimeOffset: number;
  pathChoice: { active: boolean; options: Array<{ cellId: number; label: string }> };
  previousCellId: number;
  playerDisplayX: number;
  playerDisplayY: number;
  moveFromX: number;
  moveFromY: number;
  moveToX: number;
  moveToY: number;
  moveStartTime: number;
  serverPath: number[];
  serverPathIndex: number;
  isWaitingForChoice: boolean;
  isServerAnimating: boolean;
  cellActions: Array<{ id: string; label: string; detail?: string; enabled: boolean }>;
}

export type ClientGameEvent =
  | { sequence: number; type: 'player'; player: Player }
  | { sequence: number; type: 'players'; players: OtherPlayerInfo[] }
  | { sequence: number; type: 'jail'; isInJail: boolean; jailEndTime: number }
  | { sequence: number; type: 'team'; members: TeamMember[] }
  | { sequence: number; type: 'value'; playerId: string; fieldId: string; current: number }
  | { sequence: number; type: 'status'; playerId: string; status: Player['status'] }
  | { sequence: number; type: 'otherPlayerValue'; playerId: string; current: number }
  | { sequence: number; type: 'otherPlayerStatus'; playerId: string; status: OtherPlayerInfo['status'] }
  | { sequence: number; type: 'otherPlayerMove'; playerId: string; cellId: number }
  | { sequence: number; type: 'property'; playerId: string; cellId: number; level: number }
  | { sequence: number; type: 'investment'; playerId: string; cellId: number; share: number }
  | { sequence: number; type: 'move'; playerId: string; cellId: number };

export interface ServerGameSnapshot {
  sequence: number;
  player: Player;
  teamMembers?: TeamMember[];
  ownedProperties?: Array<{ cellId: number; level: number }>;
  ownedInvestments?: Array<{ cellId: number; share: number }>;
}

export interface ClientChatMessage {
  text: string;
  channel: string;
  timestamp: number;
}

export class GameStore {
  private snapshot: ClientGameSnapshot = {
    sequence: 0, currentPlayer: null, otherPlayers: [], currentPlayerPosition: 0,
    currentMoney: 2000, currentCredit: 50, currentEnv: 0, isBankrupt: false,
    isInJail: false, jailEndTime: 0, canRoll: true, diceAnimating: false, actionUsedThisTurn: false, teamMembers: [], ownedProperties: new Set(), propertyLevels: new Map(), ownedInvestments: new Set(), investmentShares: new Map(), chatHistory: [], cells: new Map(), isMoving: false, remainingSteps: 0, cameraTargetX: 0, cameraTargetY: 0, diceValue: 0, diceAnimStart: 0, rollCooldownEnd: 0, dayNightStartTime: Date.now(), serverTimeOffset: 0, pathChoice: { active: false, options: [] }, previousCellId: -1, playerDisplayX: 600, playerDisplayY: 500, moveFromX: 0, moveFromY: 0, moveToX: 0, moveToY: 0, moveStartTime: 0, serverPath: [], serverPathIndex: 0, isWaitingForChoice: false, isServerAnimating: false, cellActions: [],
  };
  private readonly listeners = new Set<(snapshot: ClientGameSnapshot) => void>();

  getSnapshot(): ClientGameSnapshot { return this.snapshot; }

  nextSequence(): number {
    return this.snapshot.sequence + 1;
  }

  setCanRoll(value: boolean): void {
    this.snapshot = { ...this.snapshot, canRoll: value };
    this.publish();
  }

  setDiceAnimating(value: boolean): void {
    this.snapshot = { ...this.snapshot, diceAnimating: value };
    this.publish();
  }

  updateMovement(partial: Partial<Pick<ClientGameSnapshot, 'isMoving' | 'remainingSteps'>>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.publish();
  }

  setCamera(partial: Partial<Pick<ClientGameSnapshot, 'cameraTargetX' | 'cameraTargetY'>>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.publish();
  }

  updateDice(partial: Partial<Pick<ClientGameSnapshot, 'diceValue' | 'diceAnimStart'>>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.publish();
  }

  updateCooldown(partial: Partial<Pick<ClientGameSnapshot, 'rollCooldownEnd'>>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.publish();
  }

  updateDayNight(partial: Partial<Pick<ClientGameSnapshot, 'dayNightStartTime' | 'serverTimeOffset'>>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.publish();
  }

  setPathChoice(options: Array<{ cellId: number; label: string }>): void {
    this.snapshot = { ...this.snapshot, pathChoice: { active: options.length > 0, options: [...options] } };
    this.publish();
  }

  setCellActions(actions: Array<{ id: string; label: string; detail?: string; enabled: boolean }>): void {
    this.snapshot = { ...this.snapshot, cellActions: actions.map(action => ({ ...action })) };
    this.publish();
  }

  clearPathChoice(): void {
    this.setPathChoice([]);
  }

  setCell(cell: Cell): void {
    const cells = new Map(this.snapshot.cells);
    cells.set(cell.id, cell);
    this.snapshot = { ...this.snapshot, cells };
    this.publish();
  }

  setCells(cells: Cell[]): void {
    this.snapshot = { ...this.snapshot, cells: new Map(cells.map(cell => [cell.id, cell])) };
    this.publish();
  }

  getCell(cellId: number): Cell | null {
    return this.snapshot.cells.get(cellId) ?? null;
  }

  subscribe(listener: (snapshot: ClientGameSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }

  applySnapshot(snapshot: (Partial<ClientGameSnapshot> & Pick<ClientGameSnapshot, 'sequence'>) | ServerGameSnapshot): void {
    if (snapshot.sequence < this.snapshot.sequence) return;
    if ('player' in snapshot) {
      const { ownedProperties: _ownedProperties, ownedInvestments: _ownedInvestments, ...snapshotState } = snapshot;
      this.snapshot = {
        ...this.snapshot,
        ...snapshotState,
        currentPlayer: snapshot.player,
        currentPlayerPosition: snapshot.player.position?.cellId ?? 0,
        currentMoney: snapshot.player.values?.money?.current ?? 0,
        currentCredit: snapshot.player.values?.credit?.current ?? 0,
        currentEnv: snapshot.player.values?.environment?.current ?? snapshot.player.values?.env?.current ?? 0,
        isBankrupt: snapshot.player.status === 'bankrupt',
        isInJail: snapshot.player.status === 'jail',
      };
      this.projectAssets(snapshot);
      this.publish();
      return;
    }
    this.snapshot = { ...this.snapshot, ...snapshot };
    this.publish();
  }

  applyEvent(event: ClientGameEvent): void {
    if (event.sequence <= this.snapshot.sequence) return;
    if (event.type === 'player') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, currentPlayer: event.player, currentPlayerPosition: event.player.position?.cellId ?? 0, currentMoney: event.player.values?.money?.current ?? 0, currentCredit: event.player.values?.credit?.current ?? 0, currentEnv: event.player.values?.environment?.current ?? event.player.values?.env?.current ?? 0, isBankrupt: event.player.status === 'bankrupt', isInJail: event.player.status === 'jail' };
      this.projectAssets(event.player);
      this.publish();
      return;
    } else if (event.type === 'players') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, otherPlayers: event.players };
    } else if (event.type === 'jail') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, isInJail: event.isInJail, jailEndTime: event.jailEndTime, canRoll: !event.isInJail };
    } else if (event.type === 'team') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, teamMembers: event.members };
    } else if (event.type === 'property') {
      const ownedProperties = new Set(this.snapshot.ownedProperties);
      const propertyLevels = new Map(this.snapshot.propertyLevels);
      ownedProperties.add(event.cellId);
      propertyLevels.set(event.cellId, event.level);
      this.snapshot = { ...this.snapshot, sequence: event.sequence, ownedProperties, propertyLevels, actionUsedThisTurn: event.playerId === this.snapshot.currentPlayer?.id ? true : this.snapshot.actionUsedThisTurn };
    } else if (event.type === 'investment') {
      const ownedInvestments = new Set(this.snapshot.ownedInvestments);
      const investmentShares = new Map(this.snapshot.investmentShares);
      ownedInvestments.add(event.cellId);
      investmentShares.set(event.cellId, event.share);
      this.snapshot = { ...this.snapshot, sequence: event.sequence, ownedInvestments, investmentShares, actionUsedThisTurn: event.playerId === this.snapshot.currentPlayer?.id ? true : this.snapshot.actionUsedThisTurn };
    } else if (event.type === 'value' && this.snapshot.currentPlayer?.id === event.playerId) {
      const player = { ...this.snapshot.currentPlayer, values: { ...this.snapshot.currentPlayer.values, [event.fieldId]: { ...this.snapshot.currentPlayer.values[event.fieldId], current: event.current } } };
      this.snapshot = { ...this.snapshot, sequence: event.sequence, currentPlayer: player, currentMoney: event.fieldId === 'money' ? event.current : this.snapshot.currentMoney, currentCredit: event.fieldId === 'credit' ? event.current : this.snapshot.currentCredit, currentEnv: event.fieldId === 'env' || event.fieldId === 'environment' ? event.current : this.snapshot.currentEnv };
    } else if (event.type === 'status' && this.snapshot.currentPlayer?.id === event.playerId) {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, currentPlayer: { ...this.snapshot.currentPlayer, status: event.status }, isBankrupt: event.status === 'bankrupt', isInJail: event.status === 'jail', canRoll: event.status !== 'jail' && event.status !== 'bankrupt' };
    } else if (event.type === 'otherPlayerValue') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, otherPlayers: this.snapshot.otherPlayers.map((player) => player.id === event.playerId ? { ...player, primaryValue: event.current } : player) };
    } else if (event.type === 'value' && this.snapshot.otherPlayers.some((player) => player.id === event.playerId)) {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, otherPlayers: this.snapshot.otherPlayers.map((player) => player.id === event.playerId && event.fieldId === 'money' ? { ...player, primaryValue: event.current } : player) };
    } else if (event.type === 'otherPlayerStatus') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, otherPlayers: this.snapshot.otherPlayers.map((player) => player.id === event.playerId ? { ...player, status: event.status } : player) };
    } else if (event.type === 'otherPlayerMove') {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, otherPlayers: this.snapshot.otherPlayers.map((player) => player.id === event.playerId ? { ...player, position: { cellId: event.cellId } } : player) };
    } else if (event.type === 'move' && this.snapshot.currentPlayer?.id === event.playerId) {
      this.snapshot = { ...this.snapshot, sequence: event.sequence, currentPlayer: { ...this.snapshot.currentPlayer, position: { cellId: event.cellId } }, currentPlayerPosition: event.cellId, actionUsedThisTurn: false };
    }
    this.publish();
  }

  appendChatMessage(message: ServerChatMessage | ClientChatMessage): void {
    const chatMessage: ClientChatMessage = 'content' in message
      ? { text: `${message.senderName || '匿名'}: ${message.content}`, channel: message.channel, timestamp: message.timestamp }
      : message;
    this.snapshot = { ...this.snapshot, chatHistory: [...this.snapshot.chatHistory, chatMessage].slice(-100) };
    this.publish();
  }

  reset(): void {
    this.snapshot = {
      sequence: 0,
      currentPlayer: null,
      otherPlayers: [],
      currentPlayerPosition: 0,
      currentMoney: 2000,
      currentCredit: 50,
      currentEnv: 0,
      isBankrupt: false,
      isInJail: false,
      jailEndTime: 0,
      canRoll: true,
      diceAnimating: false,
      actionUsedThisTurn: false,
      teamMembers: [],
      ownedProperties: new Set(),
      propertyLevels: new Map(),
      ownedInvestments: new Set(),
      investmentShares: new Map(),
      chatHistory: [],
      cells: new Map(),
      isMoving: false,
      remainingSteps: 0,
      cameraTargetX: 0,
      cameraTargetY: 0,
      diceValue: 0,
      diceAnimStart: 0,
      rollCooldownEnd: 0,
      dayNightStartTime: Date.now(),
      serverTimeOffset: 0,
      pathChoice: { active: false, options: [] },
      previousCellId: -1,
      playerDisplayX: 600,
      playerDisplayY: 500,
      moveFromX: 0,
      moveFromY: 0,
      moveToX: 0,
      moveToY: 0,
      moveStartTime: 0,
      serverPath: [],
      serverPathIndex: 0,
      isWaitingForChoice: false,
      isServerAnimating: false,
      cellActions: [],
    };
    this.publish();
  }

  private projectAssets(source: unknown): void {
    const data = source as { ownedProperties?: Array<{ cellId: number; level: number }>; ownedInvestments?: Array<{ cellId: number; share: number }> };
    const properties = new Set(data.ownedProperties?.map((item) => item.cellId) ?? this.snapshot.ownedProperties);
    const propertyLevels = new Map(data.ownedProperties?.map((item) => [item.cellId, item.level]) ?? this.snapshot.propertyLevels);
    const investments = new Set(data.ownedInvestments?.map((item) => item.cellId) ?? this.snapshot.ownedInvestments);
    const investmentShares = new Map(data.ownedInvestments?.map((item) => [item.cellId, item.share]) ?? this.snapshot.investmentShares);
    this.snapshot = { ...this.snapshot, ownedProperties: properties, propertyLevels, ownedInvestments: investments, investmentShares };
  }
}
