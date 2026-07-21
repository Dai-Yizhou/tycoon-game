/**
 * AI 玩家本地类型定义
 */

export interface AckResult<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

export type PlayerStatus = 'normal' | 'jail' | 'bankrupt' | 'frozen';

export interface ValueField {
  id: string;
  name: string;
  current: number;
  min?: number;
  max?: number;
  scope?: 'player' | 'region';
}

export interface PlayerPosition {
  cellId: number;
}

export interface Player {
  id: string;
  username: string;
  teamId: string | null;
  position: PlayerPosition;
  values: Record<string, ValueField>;
  items: unknown[];
  status: PlayerStatus;
  createdAt: number;
  lastActiveAt: number;
}

export interface Team {
  id: string;
  name: string;
  memberIds: string[];
  sharedValues: Record<string, ValueField>;
  createdAt: number;
  disbanded: boolean;
  leaderId?: string;
}

export interface Cell {
  id: number;
  x: number;
  y: number;
  destinations: number[];
  extra: Record<string, unknown>;
}

export type MapData = Cell[];

export type ChatChannel = 'system' | 'team' | 'region' | 'all';

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  playerId: string;
  playerName: string;
  content: string;
  timestamp: number;
}

export type LogLevel = 'info' | 'action' | 'event' | 'warning' | 'error' | 'bug';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  botName: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface BotConfig {
  username: string;
  serverUrl: string;
  guest: boolean;
  decisionInterval: number;
  autoBuy: boolean;
  autoUpgrade: boolean;
  autoTeam: boolean;
  autoTalent: boolean;
  reserveMoney: number;
  logDir: string;
  useLLM?: boolean;
  llmPersonality?: string;
  llmStrategy?: string;
  llmDecisionTimeout?: number;
}

export interface GameStateSnapshot {
  currentPlayer: Player | null;
  position: number;
  money: number;
  credit: number;
  status: PlayerStatus;
  otherPlayers: Map<string, { id: string; username: string; position: number; status: PlayerStatus }>;
  currentCell: Cell | null;
  team: Team | null;
  talentPoints: number;
  learnedTalents: string[];
  isDay: boolean;
  cycleMinutes: number;
  lastDiceResult: number;
  lastDiceSteps: number;
  cooldownActive: boolean;
  pendingPathChoice: { fromCellId: number; options: { cellId: number; label?: string }[] } | null;
  pendingTeamInvite: { inviterId: string; inviterName: string; teamId: string } | null;
  ownedPropertyIds: Set<number>;
  items: Item[];
  mortgagedProperties: MortgagedProperty[];
  investments: InvestmentHolding[];
  unimplementedOperations: string[];
}

export interface Item {
  id: string;
  type: string;
  name?: string;
  quantity: number;
  metadata?: Record<string, unknown>;
}

export interface MortgagedProperty {
  cellId: number;
  mortgagePrice: number;
  mortgagedAt: number;
}

export interface InvestmentHolding {
  cellId: number;
  share: number;
}

export interface EvaluationReport {
  timestamp: number;
  botName: string;
  overallScore: number;
  categories: {
    gameplay: CategoryScore;
    economy: CategoryScore;
    visuals: CategoryScore;
    bugs: CategoryScore;
    balance: CategoryScore;
    ui: CategoryScore;
  };
  suggestions: string[];
  llmAnalysis?: string;
}

export interface CategoryScore {
  score: number;
  maxScore: number;
  notes: string[];
}

export interface ControlCommand {
  action: 'pause' | 'resume' | 'stop' | 'execute';
  command?: string;
  args?: Record<string, unknown>;
}

export interface BotStats {
  connected: boolean;
  loggedIn: boolean;
  actionsTaken: number;
  diceRolled: number;
  propertiesBought: number;
  propertiesUpgraded: number;
  bugsDetected: number;
  gameBugsDetected?: number;
  errors: number;
  uptime: number;
}

export interface FullBotState {
  name: string;
  type?: 'socket' | 'browser';
  config: BotConfig;
  stats: BotStats;
  gameState: GameStateSnapshot;
  paused: boolean;
  llmInfo?: { enabled: boolean; available: boolean; backend: string; model: string; personality?: string; strategy?: string };
}