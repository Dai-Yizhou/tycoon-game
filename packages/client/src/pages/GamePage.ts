/**
 * 游戏主界面
 *
 * 功能：
 * - 顶部状态栏：显示区域数值（金钱/信用/环保）
 * - 左下角聊天框：系统/队伍/区域频道
 * - 右上角队伍面板 + 页面卡片（设置/天赋/成就）
 * - 鼠标悬停格子显示悬浮卡片
 * - 操作控件根据当前格子动态显示/隐藏
 * - 平滑移动动画 + 岔路口方向选择
 * - 破产机制：仅破产时可回起点重开
 * - 一次停留仅可进行一次购买/升级操作
 * - 视野系统：相机跟随玩家，不可缩放/拖移
 * - 天赋系统：起点处勾选启用
 * - 成就系统：记录进展，计算天赋值
 * - 道具系统：查封令、复活令
 * - 银行/贷款系统：信用值联动
 * - 投资项目系统：购买、合租
 * - 交通枢纽系统：付费传送
 * - 纪念碑系统：修缮增加信用值
 * - 监狱系统：进入监狱状态
 */

declare global {
  interface Window {
    resetTutorial: () => void;
    clearGameData: () => void;
    toggleTutorial: () => void;
    useItem: (itemId: string) => void;
    showTeamInvite: () => void;
    showTeamManagement: () => void;
    removeTeamMember: (memberId: string) => void;
    leaveTeam: () => void;
    acceptTeamInvite: () => void;
    rejectTeamInvite: () => void;
    nextTutorialStep: () => void;
    prevTutorialStep: () => void;
    endTutorial: () => void;
  }
}

import type { GameController } from '../game/GameController.js';
import type { MapData, Cell, Player } from '@game/shared';
import { MapIndex, getExtra } from '@game/shared';
import { BoardRenderer } from '../board/board-renderer.js';

// ===== State =====
let renderer: BoardRenderer | null = null;
let animationFrameId: number | null = null;
let mapIndex: MapIndex | null = null;
let canvasEl: HTMLCanvasElement | null = null;
let gameSocket: import('../hooks/useSocket').TypedClientSocket | null = null;

let currentPlayer: Player | null = null;
let currentPlayerPosition = 0;
(window as any).currentPlayerPosition = currentPlayerPosition;
(window as any).currentPlayerPosition = currentPlayerPosition;
let currentMoney = 2000;
let currentCredit = 50;
let currentEnv = 0;
let isBankrupt = false;
let actionUsedThisTurn = false;
let ownedProperties: Set<number> = new Set();
let propertyLevels: Map<number, number> = new Map();
let ownedInvestments: Set<number> = new Set();
let investmentShares: Map<number, number> = new Map();

// Other players (online)
interface OtherPlayerInfo {
  id: string;
  username: string;
  position: { cellId: number };
  status: import('@game/shared').PlayerStatus;
  primaryValue: number; // 财产（金钱）
}
let otherPlayers: OtherPlayerInfo[] = [];

// Movement
let isMoving = false;
let canRoll = true;
let remainingSteps = 0;
let previousCellId = -1;
let playerDisplayX = 600;
let playerDisplayY = 500;
let moveFromX = 0;
let moveFromY = 0;
let moveToX = 0;
let moveToY = 0;
let moveStartTime = 0;
const moveStepDuration = 280;
let isWaitingForChoice = false;

// Camera follow
let cameraTargetX = 0;
let cameraTargetY = 0;
const cameraFollowSpeed = 0.15;

// Dice
let diceValue = 0;
let diceAnimating = false;
let diceAnimStart = 0;
const diceAnimDuration = 700;

// Cooldown
const rollCooldown = 3000;
let rollCooldownEnd = 0;
let rollCooldownTimer: ReturnType<typeof setInterval> | null = null;

// Jail
let isInJail = false;
let jailEndTime = 0;

// Talents (loaded from config file)
interface TalentDef {
  id: string;
  name: string;
  description: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  cost: number;
  requires?: string;
  branch: 'economy' | 'social' | 'exploration';
}
let TALENT_DEFS: TalentDef[] = [];
let activeTalents: Set<string> = new Set();
let availableTP = 0;
let talentsLocked = false;

// Rarity metadata shared by talents and achievements
const RARITY_COLORS: Record<string, string> = {
  common: '#9ca3af', uncommon: '#22c55e', rare: '#3b82f6',
  epic: '#a855f7', legendary: '#f59e0b', ultimate: '#ef4444', unique: '#ec4899',
};
const RARITY_LABELS: Record<string, string> = {
  common: '普通', uncommon: '罕见', rare: '稀有',
  epic: '史诗', legendary: '传奇', ultimate: '究极', unique: '唯一',
};

function isTalentActive(id: string): boolean {
  return activeTalents.has(id);
}

// Achievements (loaded from config file)
interface AchievementDef {
  id: string;
  name: string;
  description: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'ultimate' | 'unique';
  goal: number;
  current: number;
  completed: boolean;
  tpReward: number;
}
let achievements: AchievementDef[] = [];
let totalMoneyEarned = 0;

// Account binding: playerName acts as account identifier
let currentPlayerName = '玩家';
function getAccountKey(): string {
  return `monopoly_player_${currentPlayerName}`;
}
function savePlayerProgress(): void {
  const key = getAccountKey();
  const data = {
    activeTalents: Array.from(activeTalents),
    availableTP,
    talentsLocked,
    achievements: achievements.map(a => ({ id: a.id, current: a.current, completed: a.completed })),
    totalMoneyEarned,
    version: 1,
  };
  localStorage.setItem(`${key}_progress`, JSON.stringify(data));
}
function loadPlayerProgress(): void {
  const key = getAccountKey();
  const raw = localStorage.getItem(`${key}_progress`);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (data.activeTalents) activeTalents = new Set(data.activeTalents);
    if (typeof data.availableTP === 'number') availableTP = data.availableTP;
    if (typeof data.talentsLocked === 'boolean') talentsLocked = data.talentsLocked;
    if (typeof data.totalMoneyEarned === 'number') totalMoneyEarned = data.totalMoneyEarned;
    if (Array.isArray(data.achievements)) {
      for (const saved of data.achievements) {
        const ach = achievements.find(a => a.id === saved.id);
        if (ach) {
          ach.current = saved.current ?? 0;
          ach.completed = saved.completed ?? false;
        }
      }
    }
  } catch {
    console.warn('[GamePage] 玩家进度数据解析失败');
  }
}

// Config loading
async function loadTalentConfig(): Promise<TalentDef[]> {
  try {
    const res = await fetch('/config/talents.json');
    if (res.ok) return await res.json();
  } catch { /* fallback */ }
  // Built-in fallback
  return [
    { id: 'credit', name: '信用系统', description: '启用信用值数值，影响贷款额度和事件概率', rarity: 'common', cost: 1, branch: 'economy' },
    { id: 'bank', name: '银行系统', description: '启用银行贷款功能，可借款和还款', rarity: 'uncommon', cost: 2, requires: 'credit', branch: 'economy' },
    { id: 'investment_boost', name: '投资加成', description: '投资项目收益+20%', rarity: 'rare', cost: 3, requires: 'bank', branch: 'economy' },
    { id: 'monument_master', name: '纪念碑大师', description: '修缮纪念碑信用值+15（原+10）', rarity: 'rare', cost: 3, requires: 'credit', branch: 'economy' },
    { id: 'team_boost', name: '组队加成', description: '组队时信用值加成翻倍', rarity: 'common', cost: 1, branch: 'social' },
    { id: 'item_luck', name: '道具幸运', description: '触发事件获取道具概率+30%', rarity: 'uncommon', cost: 2, requires: 'team_boost', branch: 'social' },
    { id: 'seal_master', name: '查封大师', description: '查封令效果持续时间+50%', rarity: 'rare', cost: 3, requires: 'item_luck', branch: 'social' },
    { id: 'env', name: '环保系统', description: '启用环保值数值，受地产和事件影响', rarity: 'common', cost: 1, branch: 'exploration' },
    { id: 'transport_discount', name: '交通折扣', description: '传送费用-30%', rarity: 'uncommon', cost: 2, requires: 'env', branch: 'exploration' },
    { id: 'vision', name: '鹰眼视野', description: '相机跟随时显示更多棋盘区域', rarity: 'rare', cost: 3, requires: 'transport_discount', branch: 'exploration' },
  ];
}
async function loadAchievementConfig(): Promise<AchievementDef[]> {
  try {
    const res = await fetch('/config/achievements.json');
    if (res.ok) {
      const defs: Omit<AchievementDef, 'current' | 'completed'>[] = await res.json();
      return defs.map(d => ({ ...d, current: 0, completed: false }));
    }
  } catch { /* fallback */ }
  // Built-in fallback
  return [
    { id: 'first_move', name: '初次移动', description: '第一次掷骰移动', rarity: 'common', goal: 1, current: 0, completed: false, tpReward: 1 },
    { id: 'money_1000', name: '小有积蓄', description: '累计赚取1000元', rarity: 'common', goal: 1000, current: 0, completed: false, tpReward: 1 },
    { id: 'money_5000', name: '财富初现', description: '累计赚取5000元', rarity: 'uncommon', goal: 5000, current: 0, completed: false, tpReward: 1 },
    { id: 'money_10000', name: '富甲一方', description: '累计赚取10000元', rarity: 'rare', goal: 10000, current: 0, completed: false, tpReward: 2 },
    { id: 'property_3', name: '地产新手', description: '购买3处地产', rarity: 'common', goal: 3, current: 0, completed: false, tpReward: 1 },
    { id: 'property_8', name: '地产大亨', description: '购买8处地产', rarity: 'rare', goal: 8, current: 0, completed: false, tpReward: 2 },
    { id: 'invest_3', name: '投资入门', description: '进行3次投资', rarity: 'uncommon', goal: 3, current: 0, completed: false, tpReward: 1 },
    { id: 'invest_10', name: '投资专家', description: '进行10次投资', rarity: 'epic', goal: 10, current: 0, completed: false, tpReward: 2 },
    { id: 'monument_1', name: '修缮者', description: '修缮1座纪念碑', rarity: 'uncommon', goal: 1, current: 0, completed: false, tpReward: 1 },
    { id: 'monument_5', name: '纪念碑守护者', description: '修缮5座纪念碑', rarity: 'legendary', goal: 5, current: 0, completed: false, tpReward: 3 },
    { id: 'transport_5', name: '旅行者', description: '使用传送5次', rarity: 'uncommon', goal: 5, current: 0, completed: false, tpReward: 1 },
    { id: 'bankrupt_1', name: '从头再来', description: '经历1次破产', rarity: 'common', goal: 1, current: 0, completed: false, tpReward: 1 },
    { id: 'bankrupt_3', name: '不屈不挠', description: '经历3次破产并重开', rarity: 'epic', goal: 3, current: 0, completed: false, tpReward: 2 },
    { id: 'moves_50', name: '步步为营', description: '完成50次移动', rarity: 'uncommon', goal: 50, current: 0, completed: false, tpReward: 1 },
    { id: 'moves_200', name: '环游世界', description: '完成200次移动', rarity: 'legendary', goal: 200, current: 0, completed: false, tpReward: 3 },
  ];
}

// Items
let items: { id: string; name: string; icon: string; count: number }[] = [];

// Bank/Loan
let loanAmount = 0;
let loanInterestRate = 0.05;

// Day/Night & Prosperity
// 昼夜周期时长（毫秒），从服务端同步
let DAY_NIGHT_CYCLE = 15 * 60 * 1000;
// 服务器周期起始时间（从服务端同步，所有玩家看到一样的时间）
let dayNightStartTime = Date.now();
// 服务器与客户端的时间差（用于校正时钟偏移）
let serverTimeOffset = 0;
let prosperity = 100;
let prosperityTimer: ReturnType<typeof setInterval> | null = null;

// 区域配置和动态数值字段定义（从服务端 map-meta 加载）
interface RegionInfo {
  id: string;
  name: string;
  cellIds: number[];
  prosperity: number;
  environmentValue?: number;
}
let mapRegions: RegionInfo[] = [];
let valueFieldDefs: { id: string; name: string; scope: 'player' | 'region'; min?: number; max?: number }[] = [];
// 各区域繁荣度快照（由 server.prosperityChanged 更新）
let regionProsperityMap: Map<string, number> = new Map();

// Behavior config system
interface BehaviorEvent {
  msg: string;
  money?: number;
  credit?: number;
  env?: number;
  item?: string;
}
interface BehaviorConfig {
  id: string;
  name: string;
  description: string;
  events: BehaviorEvent[];
}
let behaviorConfigs: Map<string, BehaviorConfig> = new Map();

async function loadBehaviorConfig(id: string): Promise<BehaviorConfig | null> {
  try {
    const res = await fetch(`/config/behaviors/${id}.json`);
    if (res.ok) return await res.json();
  } catch { /* fallback */ }
  return null;
}

// 时区定义：offset 为周期内偏移比例（0~1）
// UTC-8 最先进入白天，UTC+4 最后
const TIMEZONE_OFFSETS: Record<string, number> = {
  'UTC-8': 0,
  'UTC-4': 0.25,
  'UTC+0': 0.5,
  'UTC+4': 0.75,
};

// 基于服务器时间 + 时区计算本地昼夜状态
// 时间从服务器开机时开始计算（dayNightStartTime 由服务端同步）
// 所有玩家看到的服务器时间一致，时区偏移决定各时区的本地昼夜
function getLocalDayNight(timezone: string): { isDay: boolean; progress: number; hour: number; minute: number; timeStr: string } {
  const offset = TIMEZONE_OFFSETS[timezone] ?? 0;
  // 使用校正后的服务器时间
  const serverNow = Date.now() + serverTimeOffset;
  const serverElapsed = serverNow - dayNightStartTime;
  const localProgress = ((serverElapsed / DAY_NIGHT_CYCLE) + offset) % 1;

  // 映射到 24 小时制：progress 0=00:00, 0.25=06:00, 0.5=12:00, 0.75=18:00
  const totalMinutes = Math.floor(localProgress * 24 * 60);
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

  // 白天：06:00~18:00（progress 0.25~0.75）
  const isDay = localProgress >= 0.25 && localProgress < 0.75;

  return { isDay, progress: localProgress, hour, minute, timeStr };
}

// 获取玩家当前所在时区
function getPlayerTimezone(): string {
  if (!mapIndex) return 'UTC+0';
  const cell = mapIndex.getById(currentPlayerPosition);
  return cell ? (getExtra<string>(cell, 'timezone', '') || 'UTC+0') : 'UTC+0';
}

// Tutorial System
const DEBUG_MODE = process.env.NODE_ENV === 'development';
let tutorialStep = 0;
let tutorialActive = false;
const tutorialSteps = [
  {
    title: '🎮 欢迎来到大富翁.io',
    content: '这是一款结合经典大富翁与io游戏的多人在线游戏。你可以通过掷骰前进、购买地产、投资项目来积累财富！',
    highlight: null,
  },
  {
    title: '🎲 掷骰子',
    content: '点击右下角的"掷骰子"按钮开始移动。骰子会随机掷出1-6点，你的棋子会沿路径前进。',
    highlight: 'roll-button',
  },
  {
    title: '🏠 购买地产',
    content: '当你停在无主地产上时，可以选择购买。拥有地产后，其他玩家经过时需要支付租金给你。',
    highlight: null,
  },
  {
    title: '⭐ 信用值系统',
    content: '信用值影响银行贷款利率和事件概率。修缮纪念碑可以提升信用值。',
    highlight: null,
  },
  {
    title: '💎 投资项目',
    content: '投资项目可以带来稳定收益。你可以全额投资或与其他玩家合租。',
    highlight: null,
  },
  {
    title: '👥 组队系统',
    content: '你可以与其他玩家组队，共享财产和信用值。组队是达成高目标的重要策略！',
    highlight: null,
  },
  {
    title: '🌙 昼夜循环',
    content: '游戏世界有3分钟的昼夜循环。白天区域繁荣度恢复，夜晚则下降，影响地产收益。',
    highlight: null,
  },
  {
    title: '🎉 开始游戏！',
    content: '你已经了解了基本玩法。现在开始你的大富翁之旅吧！祝你好运！',
    highlight: null,
  },
];

// Chat
let activeChatChannels: Set<string> = new Set(['system']);
const chatChannelDefs = [
  { id: 'system', label: '系统', color: '#6b7280' },
  { id: 'team', label: '队伍', color: '#3b82f6' },
  { id: 'region', label: '区域', color: '#22c55e' },
];

// Team System
interface TeamMember {
  id: string;
  username: string;
  money: number;
  credit: number;
  env: number;
  status: 'normal' | 'bankrupt' | 'jail';
}

let teamMembers: TeamMember[] = [];

// UI refs
let rollBtn: HTMLButtonElement | null = null;
let diceDisplayEl: HTMLElement | null = null;
let actionButtonsEl: HTMLElement | null = null;
let chatBoxEl: HTMLElement | null = null;
let hoverCardEl: HTMLElement | null = null;
let topBarTalentsEl: HTMLElement | null = null;
let topBarProsperityEl: HTMLElement | null = null;
let topBarProsperityFillEl: HTMLElement | null = null;
let topBarRegionFieldsEl: HTMLElement | null = null;
let topBarTimeEl: HTMLElement | null = null; void topBarTimeEl;
let bankBtnEl: HTMLButtonElement | null = null;
let teamPanelContentEl: HTMLElement | null = null;
let chatChannelContainer: HTMLElement | null = null; void chatChannelContainer;
let itemsPanelEl: HTMLElement | null = null;

// ===== Helpers =====
function cName(c: Cell): string { return getExtra<string>(c, 'name', '') ?? ''; }
function cType(c: Cell): string { return getExtra<string>(c, 'type', '') ?? ''; }
function cIcon(c: Cell): string { return getExtra<string>(c, 'icon', '📍') ?? '📍'; }
function cPrice(c: Cell): number { return getExtra<number>(c, 'price', 0) ?? 0; }
function cRent(c: Cell): number[] { return getExtra<number[]>(c, 'rent', []) ?? []; }
function cUpgradeCost(c: Cell): number[] { return getExtra<number[]>(c, 'upgradeCost', []) ?? []; }
function cDesc(c: Cell): string[] { return getExtra<string[]>(c, 'description', []) ?? []; }
function cEffects(c: Cell): unknown[] { return getExtra<unknown[]>(c, 'extra', []) ?? []; }

// 从 cell 的 extra 中提取环保值（如 "环保+5" → 5, "环保-3" → -3）
function getCellEnvValue(cell: Cell): number {
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

function getRegionEnvValue(cellId: number): number {
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
      if (!visited.has(destId)) {
        queue.push(destId);
      }
    }
  }
  
  return total;
}

// 根据格子 ID 查找所属区域
function getRegionByCellId(cellId: number): RegionInfo | null {
  for (const region of mapRegions) {
    if (region.cellIds.includes(cellId)) return region;
  }
  return null;
}

// 获取当前玩家所在区域的繁荣度
function getCurrentRegionProsperity(): number {
  const region = getRegionByCellId(currentPlayerPosition);
  if (region) {
    return regionProsperityMap.get(region.id) ?? region.prosperity;
  }
  return prosperity;
}

function cOwners(c: Cell): number[] { return getExtra<number[]>(c, 'owners', []) ?? []; }
function cTransportCost(c: Cell): number { return getExtra<number>(c, 'transportCost', 0) ?? 0; }
function cMonumentCost(c: Cell): number { return getExtra<number>(c, 'monumentCost', 0) ?? 0; }
function cInvestmentReturn(c: Cell): number { return getExtra<number>(c, 'investmentReturn', 0) ?? 0; }

function getCellTypeName(type: string): string {
  const names: Record<string, string> = {
    property: '地产', event: '事件格', investment: '投资项目',
    transport: '交通枢纽', monument: '纪念碑', start: '起点',
    jail: '监狱', empty: '空地',
  };
  return names[type] || type;
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function getCanvasCoords(e: MouseEvent): { x: number; y: number } {
  if (!canvasEl) return { x: 0, y: 0 };
  const rect = canvasEl.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// ===== Main Entry =====
export function createGamePage(controller: GameController): HTMLElement {
  const container = controller.getContainer();
  const context = controller.getContext();
  const page = document.createElement('div');
  page.className = 'page game-page';

  // Board
  const boardContainer = document.createElement('div');
  boardContainer.className = 'board-container';
  const canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.setAttribute('aria-label', '游戏棋盘');
  boardContainer.appendChild(canvas);
  canvasEl = canvas;
  page.appendChild(boardContainer);

  renderer = new BoardRenderer(canvas);
  renderer.drawPlaceholder('加载地图中...');

  // Build UI
  buildTopBar(page);
  buildChatBox(page);
  buildTeamPanel(page);
  buildPageCards(page);
  topBarTalentsEl = document.getElementById('pc-talent-badge');
  buildDetailPanel(page);
  buildActionPanel(page);
  buildHoverCard(page);
  buildBackButton(page, controller);
  buildItemsPanel(page);

  // Init: load configs first, then player progress, then game
  const playerName = context.playerName || '玩家';
  currentPlayerName = playerName;
  initMockPlayer(playerName);
  // 用登录返回的真实玩家数据更新 currentPlayer
  if (context.player && context.player.id) {
    currentPlayer!.id = context.player.id;
    currentPlayer!.username = context.player.username || playerName;
    if (context.player.position?.cellId !== undefined) {
      currentPlayer!.position.cellId = context.player.position.cellId;
      currentPlayerPosition = context.player.position.cellId;
      (window as any).currentPlayerPosition = currentPlayerPosition;
    }
    if (context.player.values?.money?.current !== undefined) {
      currentPlayer!.values.money.current = context.player.values.money.current;
      currentMoney = context.player.values.money.current;
    }
    if (context.player.values?.credit?.current !== undefined) {
      currentPlayer!.values.credit.current = context.player.values.credit.current;
    }
  }
  initTeam();

  Promise.all([loadTalentConfig(), loadAchievementConfig(), loadMapData()]).then(
    ([talents, achDefs, mapResult]) => {
      TALENT_DEFS = talents;
      achievements = achDefs;
      loadPlayerProgress();
      if (!renderer || !mapResult) return;
      const { mapData, regions, valueFields } = mapResult;
      mapRegions = regions;
      valueFieldDefs = valueFields;
      // 初始化区域繁荣度快照
      for (const r of regions) {
        regionProsperityMap.set(r.id, r.prosperity);
      }
      mapIndex = new MapIndex(mapData);
      renderer.loadMap(mapData);
      const startCell = mapIndex.getById(0);
      if (startCell) {
        playerDisplayX = startCell.x;
        playerDisplayY = startCell.y;
        cameraTargetX = startCell.x;
        cameraTargetY = startCell.y;
      }
      centerCameraOnCell(0);
      startRenderLoop();
      updateTopBar();
      updateTeamPanel();
      updateActionPanel();
      updateItemsPanel();
      addChatMessage('🎮 欢迎来到大富翁.io！点击"掷骰子"开始游戏', 'system');
      checkTalentSelection();
      startTutorial();
    },
  );

  // 从 controller 获取登录时同步的时间数据
  const ctx = controller.getContext();
  if (ctx.cycleStartTime !== null) {
    dayNightStartTime = ctx.cycleStartTime;
  }
  if (ctx.cycleMinutes !== null) {
    DAY_NIGHT_CYCLE = ctx.cycleMinutes * 60 * 1000;
  }

  // 初始化已有玩家列表（登录时服务端返回的其他在线玩家）
  if (ctx.existingPlayers && ctx.existingPlayers.length > 0) {
    otherPlayers = ctx.existingPlayers.map(p => ({
      id: p.id,
      username: p.username,
      position: p.position,
      status: p.status || 'normal',
      primaryValue: p.values?.money?.current,
    }));
  }

  // 监听服务端昼夜事件，同步时间
  const socket = controller.getSocket();
  gameSocket = socket;
  if (socket) {
    // 每秒进度更新：同步 cycleStartTime 和计算时钟偏移
    socket.on('server.dayNightProgress', (payload) => {
      dayNightStartTime = payload.cycleStartTime;
      DAY_NIGHT_CYCLE = payload.cycleMinutes * 60 * 1000;
      // 校正客户端时钟：serverTime - Date.now() = offset
      serverTimeOffset = payload.globalTime - Date.now();
    });

    // 阶段切换：同步时间
    socket.on('server.dayNightChanged', (payload) => {
      dayNightStartTime = payload.cycleStartTime;
      DAY_NIGHT_CYCLE = payload.cycleMinutes * 60 * 1000;
      serverTimeOffset = payload.globalTime - Date.now();
      const phaseMsg = payload.isDay ? '☀️ 白天到来' : '🌙 夜晚降临';
      addChatMessage(`🕐 ${phaseMsg}`, 'system');
    });

    // 时区变化
    socket.on('server.timezoneChanged', (payload) => {
      const tzName = payload.toTimezoneName || payload.toTimezoneId;
      const tz = getPlayerTimezone();
      const { timeStr, isDay } = getLocalDayNight(tz);
      addChatMessage(`🌐 进入 ${tzName}，当前时间 ${timeStr}（${isDay ? '白天' : '夜晚'}）`, 'system');
      updateTopBarTime();
      updateBoardTheme();
    });

    // 心跳校正时钟偏移
    socket.on('server.pong', (payload) => {
      serverTimeOffset = payload.serverTime - Date.now();
    });

    // 监听聊天消息
    socket.on('server.chat', (payload) => {
      const { message } = payload;
      if (message && message.content) {
        const senderName = message.senderName || '匿名玩家';
        const channel = message.channel || 'system';
        addChatMessage(`${senderName}: ${message.content}`, channel);
      }
    });

    // 监听其他玩家事件
    socket.on('server.playerJoined', (payload) => {
      // 添加新玩家或更新已有玩家（重连场景）
      const existingIndex = otherPlayers.findIndex(p => p.id === payload.id);
      const playerMoney = payload.values?.money?.current ?? 2000;
      const playerData: OtherPlayerInfo = {
        id: payload.id,
        username: payload.username,
        position: { cellId: payload.position?.cellId || 0 },
        status: (payload.status as OtherPlayerInfo['status']) || 'normal',
        primaryValue: playerMoney,
      };
      if (existingIndex === -1) {
        otherPlayers.push(playerData);
        addChatMessage(`👤 ${payload.username} 加入了游戏`, 'system');
      } else {
        otherPlayers[existingIndex] = playerData;
      }
      updateRendererPlayers();
    });

    socket.on('server.playerLeft', (payload) => {
      // 从列表移除玩家
      const player = otherPlayers.find(p => p.id === payload.playerId);
      if (player) {
        otherPlayers = otherPlayers.filter(p => p.id !== payload.playerId);
        addChatMessage(`👤 ${player.username} 离开了游戏`, 'system');
        updateRendererPlayers();
      }
      // 从队伍成员中移除（如果存在）
      const member = teamMembers.find(m => m.id === payload.playerId);
      if (member) {
        teamMembers = teamMembers.filter(m => m.id !== payload.playerId);
        addChatMessage(`👤 队伍成员 ${member.username} 已下线`, 'system');
        updateTeamPanel();
      }
      // 从打开的邀请面板中移除对应条目
      const inviteItem = document.querySelector(`[data-player-id="${payload.playerId}"]`);
      if (inviteItem) {
        const item = inviteItem.closest('.management-item');
        if (item) item.remove();
      }
    });

    socket.on('server.playerMoved', (payload) => {
      // 更新玩家位置并重新渲染
      const player = otherPlayers.find(p => p.id === payload.playerId);
      if (player) {
        player.position.cellId = payload.cellId;
        updateRendererPlayers();
      }
      // 更新当前玩家的位置
      if (currentPlayer && payload.playerId === currentPlayer.id) {
        currentPlayerPosition = payload.cellId;
        (window as any).currentPlayerPosition = currentPlayerPosition;
      }
    });

    socket.on('server.valueChanged', (payload) => {
      // 更新玩家财产（如果fieldId === 'money')
      if (payload.fieldId === 'money') {
        const player = otherPlayers.find(p => p.id === payload.playerId);
        if (player) {
          player.primaryValue = payload.current;
          updateRendererPlayers();
        }
      }
    });

    socket.on('server.playerStatusChanged', (payload) => {
      // 更新玩家状态
      const player = otherPlayers.find(p => p.id === payload.playerId);
      if (player) {
        player.status = payload.status as OtherPlayerInfo['status'];
        updateRendererPlayers();
      }
    });

    socket.on('server.teamInviteReceived', (payload) => {
      addChatMessage(`📨 收到 ${payload.inviterName} 的组队邀请！`, 'system');

      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal">
          <div class="modal-header">👥 组队邀请</div>
          <div class="modal-body">
            <div>${payload.inviterName} 邀请你加入队伍！</div>
            <div class="modal-actions" style="margin-top: 20px;">
              <button onclick="window.acceptTeamInvite()" style="padding: 8px 24px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">接受</button>
              <button onclick="window.rejectTeamInvite()" style="padding: 8px 24px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">拒绝</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      window.rejectTeamInvite = function(): void {
        modal.remove();
        addChatMessage(`你拒绝了 ${payload.inviterName} 的组队邀请`, 'system');
      };

      window.acceptTeamInvite = function(): void {
        socket.emit('client.joinTeam', { teamId: payload.teamId }, (result) => {
          if (result.ok) {
            modal.remove();
            addChatMessage(`✅ 已加入 ${payload.inviterName} 的队伍！`, 'system');
            // 更新本地队伍面板
            if (currentPlayer) {
              currentPlayer.teamId = payload.teamId;
            }
            updateTeamPanel();
          } else {
            addChatMessage(`❌ 加入队伍失败: ${result.error || '未知错误'}`, 'system');
          }
        });
      };
    });

    socket.on('server.teamMemberJoined', (payload) => {
      const existingMember = teamMembers.find(m => m.id === payload.playerId);
      if (!existingMember) {
        teamMembers.push({
          id: payload.playerId,
          username: payload.playerName,
          money: 2000,
          credit: 50,
          env: 0,
          status: 'normal',
        });
        addChatMessage(`🤝 ${payload.playerName} 加入了队伍！`, 'system');
        updateTeamPanel();
      }
    });

    // 监听服务端繁荣度变化
    socket.on('server.prosperityChanged', (payload) => {
      if (payload.regionId) {
        regionProsperityMap.set(payload.regionId, payload.prosperity);
        // 如果玩家在当前区域，更新显示
        const currentRegion = getRegionByCellId(currentPlayerPosition);
        if (currentRegion && currentRegion.id === payload.regionId) {
          prosperity = payload.prosperity;
        }
      }
    });
  }

  // Canvas events - no drag/zoom, only hover and click
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('click', handleClick);
  canvas.addEventListener('mouseleave', handleMouseLeave);
  window.addEventListener('resize', handleResize);

  container.appendChild(page);
  return page;
}

// ===== UI Builders =====

/**
 * 构建左侧玩家信息条（参考florr.io设计）
 * 紧凑、条状，不占太多屏幕空间
 */
function buildTopBar(page: HTMLElement): void {
  const bar = document.createElement('div');
  bar.className = 'player-info-bar';

  // 用户名显示
  const nameItem = document.createElement('div');
  nameItem.className = 'pib-name';
  nameItem.innerHTML = `<span id="pib-username">玩家</span>`;
  bar.appendChild(nameItem);

  // 时间显示
  const timeItem = document.createElement('div');
  timeItem.className = 'pib-time';
  timeItem.id = 'pib-time';
  timeItem.innerHTML = `<span class="pib-time-icon">☀️</span><span class="pib-time-text" id="topbar-time">--:--</span><span class="pib-time-tz" id="topbar-tz">UTC+0</span>`;
  bar.appendChild(timeItem);

  // 区域数值（繁荣度 + 环保值 + 动态字段）
  const regionSection = document.createElement('div');
  regionSection.className = 'pib-region';

  // 区域名称
  const regionName = document.createElement('div');
  regionName.className = 'pib-region-name';
  regionName.id = 'pib-region-name';
  regionName.textContent = '—';
  regionName.title = '当前所在区域';
  regionSection.appendChild(regionName);

  // 繁荣度（带进度条）
  const prosperityBar = document.createElement('div');
  prosperityBar.className = 'pib-region-bar';
  prosperityBar.innerHTML = `
    <span class="pib-v-icon" title="区域繁荣度">📈</span>
    <div class="pib-v-track" title="繁荣度">
      <div class="pib-v-fill pib-v-prosperity" id="pib-prosperity-fill" style="width: 100%"></div>
    </div>
    <span class="pib-v-num" id="pib-prosperity-val">100</span>
  `;
  regionSection.appendChild(prosperityBar);

  // 动态区域数值字段容器（由 updateTopBar 填充）
  const dynamicFields = document.createElement('div');
  dynamicFields.className = 'pib-region-fields';
  dynamicFields.id = 'pib-region-fields';
  regionSection.appendChild(dynamicFields);

  bar.appendChild(regionSection);

  // 队伍简要（如果组队）
  const teamBrief = document.createElement('div');
  teamBrief.className = 'pib-team-brief';
  teamBrief.id = 'team-brief';
  teamBrief.style.display = 'none';
  bar.appendChild(teamBrief);

  page.appendChild(bar);
  topBarTimeEl = document.getElementById('topbar-time');
  topBarProsperityEl = document.getElementById('pib-prosperity-val');
  topBarProsperityFillEl = document.getElementById('pib-prosperity-fill');
  topBarRegionFieldsEl = document.getElementById('pib-region-fields');
}

function buildChatBox(page: HTMLElement): void {
  const box = document.createElement('div');
  box.className = 'chat-box';

  const header = document.createElement('div');
  header.className = 'chat-header';

  const channelContainer = document.createElement('div');
  channelContainer.className = 'chat-channels';
  for (const ch of chatChannelDefs) {
    const label = document.createElement('label');
    label.className = 'chat-channel-checkbox';
    label.title = `显示/隐藏${ch.label}频道消息`;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = activeChatChannels.has(ch.id);
    cb.dataset.channel = ch.id;
    cb.addEventListener('change', () => {
      if (cb.checked) {
        activeChatChannels.add(ch.id);
      } else {
        activeChatChannels.delete(ch.id);
      }
      refreshChatMessages();
    });
    const span = document.createElement('span');
    span.className = 'chat-channel-label';
    span.textContent = ch.label;
    span.style.color = ch.color;
    label.appendChild(cb);
    label.appendChild(span);
    channelContainer.appendChild(label);
  }
  header.appendChild(channelContainer);
  chatChannelContainer = channelContainer;

  const messages = document.createElement('div');
  messages.className = 'chat-messages';
  messages.id = 'chat-messages';

  // 输入框容器
  const inputContainer = document.createElement('div');
  inputContainer.className = 'chat-input-container';
  inputContainer.style.cssText = 'display: flex; gap: 6px; padding: 6px; border-top: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.2);';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'chat-input';
  input.placeholder = '输入消息...';
  input.style.cssText = 'flex: 1; padding: 4px 8px; font-size: 13px; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; background: rgba(0,0,0,0.3); color: #fff; outline: none;';
  input.maxLength = 200;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'chat-send-btn';
  sendBtn.textContent = '发送';
  sendBtn.style.cssText = 'padding: 4px 12px; font-size: 13px; border: none; border-radius: 4px; background: #3b82f6; color: #fff; cursor: pointer; transition: background 0.2s;';
  sendBtn.addEventListener('mouseenter', () => { sendBtn.style.background = '#2563eb'; });
  sendBtn.addEventListener('mouseleave', () => { sendBtn.style.background = '#3b82f6'; });

  const sendMessage = () => {
    const msg = input.value.trim();
    if (!msg) return;

    // 确定当前频道（默认使用第一个启用的频道，否则system）
    const channel = Array.from(activeChatChannels)[0] || 'system';

    if (gameSocket) {
      // 通过 socket 发送
      gameSocket.emit('client.chat', { channel, content: msg }, (result) => {
        if (result.ok) {
          addChatMessage(`你: ${msg}`, channel);
        } else {
          addChatMessage(`❌ 消息发送失败: ${result.error || '未知错误'}`, 'system');
        }
      });
    } else {
      // 单机模式：直接显示
      addChatMessage(`你: ${msg}`, channel);
    }

    input.value = '';
  };

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  inputContainer.appendChild(input);
  inputContainer.appendChild(sendBtn);

  box.appendChild(header);
  box.appendChild(messages);
  box.appendChild(inputContainer);
  page.appendChild(box);
  chatBoxEl = messages;
}

function buildTeamPanel(page: HTMLElement): void {
  const panel = document.createElement('div');
  panel.className = 'team-panel';
  panel.innerHTML = `
    <div class="team-panel-title" title="当前队伍成员列表">👥 队伍</div>
    <div class="team-panel-content" id="team-content"></div>
    <div class="team-panel-actions">
      <button class="team-action-btn" title="邀请其他玩家加入队伍" onclick="window.showTeamInvite()">邀请</button>
      <button class="team-action-btn" title="管理队伍成员" onclick="window.showTeamManagement()">管理</button>
    </div>
  `;
  page.appendChild(panel);
  teamPanelContentEl = panel.querySelector('#team-content');
}

function buildPageCards(page: HTMLElement): void {
  const container = document.createElement('div');
  container.className = 'page-cards';

  const cards = [
    { icon: '⚙️', label: '设置', key: 'settings' },
    { icon: '🎯', label: '天赋', key: 'talents' },
    { icon: '🏆', label: '成就', key: 'achievements' },
  ];

  for (const card of cards) {
    const btn = document.createElement('button');
    btn.className = 'page-card-btn';
    btn.title = card.label;
    let badgeHtml = '';
    if (card.key === 'talents') {
      badgeHtml = `<span class="pc-badge" id="pc-talent-badge" title="可用天赋点">0</span>`;
    }
    btn.innerHTML = `<span class="pc-icon">${card.icon}</span><span class="pc-label">${card.label}</span>${badgeHtml}`;
    btn.addEventListener('click', () => {
      if (card.key === 'talents') showTalentsModal();
      else if (card.key === 'achievements') showAchievementsModal();
      else if (card.key === 'settings') showSettingsModal();
      else addChatMessage(`📋 ${card.label}页面功能开发中...`);
    });
    container.appendChild(btn);
  }

  page.appendChild(container);
}

/**
 * 右下角详细面板（参考florr.io设计）
 * 可展开/收起，包含多个标签页
 */
let detailPanelEl: HTMLElement | null = null;
let detailPanelExpanded = false;

function buildDetailPanel(page: HTMLElement): void {
  const panel = document.createElement('div');
  panel.className = 'detail-panel';
  panel.id = 'detail-panel';

  // 展开/收起按钮
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'detail-toggle';
  toggleBtn.id = 'detail-toggle';
  toggleBtn.title = '详细信息';
  toggleBtn.innerHTML = '📊';
  toggleBtn.addEventListener('click', toggleDetailPanel);
  panel.appendChild(toggleBtn);

  // 可展开内容
  const content = document.createElement('div');
  content.className = 'detail-content';
  content.id = 'detail-content';
  content.style.display = 'none';

  // 标签页切换
  const tabs = document.createElement('div');
  tabs.className = 'detail-tabs';
  tabs.innerHTML = `
    <button class="detail-tab active" data-tab="region">区域</button>
    <button class="detail-tab" data-tab="team">队伍</button>
    <button class="detail-tab" data-tab="other">其他</button>
  `;
  content.appendChild(tabs);

  // 区域标签页内容（动态数值字段区域 + 固定区域）
  const regionTab = document.createElement('div');
  regionTab.className = 'detail-tab-content active';
  regionTab.id = 'tab-region';
  regionTab.innerHTML = `
    <div class="dp-section">
      <div class="dp-label">📍 当前位置</div>
      <div class="dp-value" id="dp-cellname">-</div>
    </div>
    <div id="dp-region-fields"></div>
    <div class="dp-section">
      <div class="dp-label">✨ 区域繁荣度</div>
      <div class="dp-bar"><div class="dp-bar-fill" id="dp-prosperity-bar" style="width: 100%"></div></div>
      <div class="dp-value"><span id="dp-prosperity-val">100</span>%</div>
    </div>
    <div class="dp-section">
      <div class="dp-label">🕐 昼夜状态</div>
      <div class="dp-value" id="dp-time">☀️ 白天</div>
    </div>
  `;
  content.appendChild(regionTab);

  // 队伍标签页内容
  const teamTab = document.createElement('div');
  teamTab.className = 'detail-tab-content';
  teamTab.id = 'tab-team';
  teamTab.innerHTML = `
    <div class="dp-section" id="dp-team-members">
      <div class="dp-label">👥 队伍成员</div>
      <div id="dp-team-list">无队伍</div>
    </div>
    <div class="dp-section" id="dp-team-values">
      <div class="dp-label">📊 队伍总资产</div>
      <div id="dp-team-total">-</div>
    </div>
  `;
  content.appendChild(teamTab);

  // 其他标签页内容（成就、天赋简要）
  const otherTab = document.createElement('div');
  otherTab.className = 'detail-tab-content';
  otherTab.id = 'tab-other';
  otherTab.innerHTML = `
    <div id="dp-player-fields"></div>
    <div class="dp-section">
      <div class="dp-label">🎯 天赋点</div>
      <div class="dp-value"><span id="dp-tp">0</span> 点可用</div>
    </div>
    <div class="dp-section">
      <div class="dp-label">🏆 成就进度</div>
      <div class="dp-bar"><div class="dp-bar-fill" id="dp-ach-bar" style="width: 0%"></div></div>
      <div class="dp-value"><span id="dp-ach-count">0</span> / <span id="dp-ach-total">0</span></div>
    </div>
  `;
  content.appendChild(otherTab);

  panel.appendChild(content);
  page.appendChild(panel);
  detailPanelEl = panel;

  // 标签页切换事件
  tabs.querySelectorAll('.detail-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLElement;
      const tabId = target.dataset.tab;
      if (!tabId) return;

      // 切换标签激活状态
      tabs.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
      target.classList.add('active');

      // 切换内容显示
      content.querySelectorAll('.detail-tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(`tab-${tabId}`)?.classList.add('active');
    });
  });
}

function toggleDetailPanel(): void {
  if (!detailPanelEl) return;
  const content = document.getElementById('detail-content');
  if (!content) return;

  detailPanelExpanded = !detailPanelExpanded;
  content.style.display = detailPanelExpanded ? 'block' : 'none';

  // 更新展开状态
  if (detailPanelExpanded) {
    updateDetailPanel();
  }
}

function updateDetailPanel(): void {
  // 动态渲染区域数值字段
  const regionFieldsEl = document.getElementById('dp-region-fields');
  if (regionFieldsEl) {
    const region = getRegionByCellId(currentPlayerPosition);
    const htmlParts: string[] = [];

    // 优先使用 map-meta 中定义的区域数值字段
    const regionFields = valueFieldDefs.filter(f => f.scope === 'region');
    if (regionFields.length > 0) {
      for (const f of regionFields) {
        let val = 0;
        if (f.id === 'environmental' || f.id === 'env') {
          val = region?.environmentValue ?? getRegionEnvValue(currentPlayerPosition);
        } else if (region) {
          val = (region as unknown as Record<string, unknown>)[f.id] as number ?? 0;
        }
        const icon = f.id === 'environmental' || f.id === 'env' ? '🌱' : '📊';
        htmlParts.push(`<div class="dp-section">
          <div class="dp-label">${icon} ${f.name}</div>
          <div class="dp-value">${val}</div>
        </div>`);
      }
    } else if (region?.environmentValue !== undefined) {
      // 无字段定义但区域有 environmentValue
      htmlParts.push(`<div class="dp-section">
        <div class="dp-label">🌱 环保值</div>
        <div class="dp-value">${region.environmentValue}</div>
      </div>`);
    } else {
      // 回退到从格子 extra 计算
      const envVal = getRegionEnvValue(currentPlayerPosition);
      htmlParts.push(`<div class="dp-section">
        <div class="dp-label">🌱 区域环保值</div>
        <div class="dp-value">${envVal}</div>
      </div>`);
    }

    regionFieldsEl.innerHTML = htmlParts.join('');
  }

  const prosperityEl = document.getElementById('dp-prosperity-val');
  const prosperityBar = document.getElementById('dp-prosperity-bar');
  const timeEl = document.getElementById('dp-time');
  const cellNameEl = document.getElementById('dp-cellname');

  const currentProsperity = getCurrentRegionProsperity();
  if (prosperityEl) prosperityEl.textContent = String(currentProsperity);
  if (prosperityBar) prosperityBar.style.width = `${currentProsperity}%`;
  if (timeEl) {
    const tz = getPlayerTimezone();
    const { isDay: localIsDay, timeStr } = getLocalDayNight(tz);
    timeEl.textContent = `${localIsDay ? '☀️' : '🌙'} ${timeStr}（${tz}）`;
  }
  if (cellNameEl && mapIndex) {
    const cell = mapIndex.getById(currentPlayerPosition);
    cellNameEl.textContent = cell ? cName(cell) : '-';
  }

  // 更新队伍数值
  const teamListEl = document.getElementById('dp-team-list');
  const teamTotalEl = document.getElementById('dp-team-total');
  if (teamListEl) {
    if (teamMembers.length > 1) {
      teamListEl.innerHTML = teamMembers.map(m =>
        `<div class="dp-team-member">${m.username} 💰${m.money}</div>`
      ).join('');
    } else {
      teamListEl.innerHTML = '无队伍';
    }
  }
  if (teamTotalEl) {
    const total = teamMembers.reduce((sum, m) => sum + m.money, 0);
    teamTotalEl.textContent = `💰 ${total} 元`;
  }

  // 动态渲染玩家数值字段（排除已在 topbar 显示的 money/credit）
  const playerFieldsEl = document.getElementById('dp-player-fields');
  if (playerFieldsEl) {
    const playerFields = valueFieldDefs.filter(f => f.scope === 'player' && f.id !== 'money' && f.id !== 'credit');
    if (playerFields.length > 0) {
      playerFieldsEl.innerHTML = playerFields.map(f => {
        const val = currentPlayer?.values?.[f.id]?.current ?? 0;
        return `<div class="dp-section">
          <div class="dp-label">📊 ${f.name}</div>
          <div class="dp-value">${val}</div>
        </div>`;
      }).join('');
    } else {
      playerFieldsEl.innerHTML = '';
    }
  }

  // 更新其他数值
  const tpEl = document.getElementById('dp-tp');
  const achCountEl = document.getElementById('dp-ach-count');
  const achTotalEl = document.getElementById('dp-ach-total');
  const achBar = document.getElementById('dp-ach-bar');

  if (tpEl) tpEl.textContent = String(availableTP);
  if (achCountEl) achCountEl.textContent = String(achievements.filter(a => a.completed).length);
  if (achTotalEl) achTotalEl.textContent = String(achievements.length);
  if (achBar) {
    const percent = achievements.length > 0 ? (achievements.filter(a => a.completed).length / achievements.length * 100) : 0;
    achBar.style.width = `${percent}%`;
  }
}

function buildActionPanel(page: HTMLElement): void {
  const panel = document.createElement('div');
  panel.className = 'action-panel';

  // Dice area
  const diceArea = document.createElement('div');
  diceArea.className = 'dice-area';
  const diceDisplay = document.createElement('div');
  diceDisplay.className = 'dice-display';
  diceDisplay.textContent = '🎲';
  diceDisplay.title = '骰子点数';
  diceDisplayEl = diceDisplay;
  diceArea.appendChild(diceDisplay);

  const rollButton = document.createElement('button');
  rollButton.className = 'roll-button';
  rollButton.title = '掷骰子移动';
  rollButton.textContent = '掷骰子';
  rollButton.addEventListener('click', handleRollDice);
  rollBtn = rollButton;
  diceArea.appendChild(rollButton);
  panel.appendChild(diceArea);

  // Action buttons container (dynamic)
  const actionButtons = document.createElement('div');
  actionButtons.className = 'action-buttons';
  actionButtons.id = 'action-buttons';
  panel.appendChild(actionButtons);
  actionButtonsEl = actionButtons;

  // Bank/Loan button
  const bankBtn = document.createElement('button');
  bankBtn.className = 'action-btn action-bank';
  bankBtn.title = '银行贷款';
  bankBtn.textContent = '🏦 银行';
  bankBtn.addEventListener('click', showBankModal);
  panel.appendChild(bankBtn);
  bankBtnEl = bankBtn;

  page.appendChild(panel);
}

function buildHoverCard(page: HTMLElement): void {
  const card = document.createElement('div');
  card.className = 'hover-card';
  card.style.display = 'none';
  page.appendChild(card);
  hoverCardEl = card;
}

function buildBackButton(page: HTMLElement, controller: GameController): void {
  const btn = document.createElement('button');
  btn.className = 'back-button';
  btn.textContent = '← 返回';
  btn.title = '返回开始页面';
  btn.addEventListener('click', () => {
    controller.setState('start');
  });
  page.appendChild(btn);
}

function buildItemsPanel(page: HTMLElement): void {
  const panel = document.createElement('div');
  panel.className = 'items-panel';
  panel.innerHTML = '<div class="items-header" title="持有的道具列表">🎒 道具</div><div class="items-content" id="items-content"></div>';
  page.appendChild(panel);
  itemsPanelEl = panel.querySelector('#items-content');
}

// ===== Player Init =====
function initMockPlayer(name: string): void {
  currentPlayer = {
    id: 'player-1',
    username: name,
    teamId: null,
    position: { cellId: 0 },
    values: {
      money: { id: 'money', name: '财产', current: 2000, min: 0 },
      credit: { id: 'credit', name: '信用值', current: 50, min: 0, max: 100 },
      env: { id: 'env', name: '环保值', current: 0, min: 0 },
    },
    items: [],
    status: 'normal',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  currentMoney = 2000;
  currentCredit = 50;
  currentEnv = 0;
  currentPlayerPosition = 0;
(window as any).currentPlayerPosition = currentPlayerPosition;
  isBankrupt = false;
  isInJail = false;
  actionUsedThisTurn = false;
  items = [];
  loanAmount = 0;
}

// ===== Map Loading =====
async function loadMapData(): Promise<{ mapData: MapData; regions: RegionInfo[]; valueFields: typeof valueFieldDefs } | null> {
  try {
    const response = await fetch('/api/map');
    if (response.ok) {
      const data = await response.json();
      const mapData = normalizeClientMapData(data.mapData);
      const regions: RegionInfo[] = (data.regions || []).map((r: Record<string, unknown>) => ({
        id: String(r['id'] || ''),
        name: String(r['name'] || ''),
        cellIds: Array.isArray(r['cellIds']) ? r['cellIds'] as number[] : [],
        prosperity: typeof r['prosperity'] === 'number' ? r['prosperity'] : 100,
        ...(typeof r['environmentValue'] === 'number' ? { environmentValue: r['environmentValue'] } : {}),
      }));
      const valueFields = (data.valueFieldDefinitions || []).map((f: Record<string, unknown>) => ({
        id: String(f['id'] || ''),
        name: String(f['name'] || ''),
        scope: (f['scope'] === 'region' ? 'region' : 'player') as 'player' | 'region',
        ...(typeof f['min'] === 'number' ? { min: f['min'] } : {}),
        ...(typeof f['max'] === 'number' ? { max: f['max'] } : {}),
      }));
      return { mapData, regions, valueFields };
    }
  } catch {
    console.warn('[GamePage] 使用本地地图数据');
  }
  return { mapData: normalizeClientMapData(getFallbackMapData()), regions: [], valueFields: [] };
}

const MAP_SCALE = 3.0;

function getTimezoneByX(x: number): string {
  const scaledX = x * MAP_SCALE;
  if (scaledX < 1100) return 'UTC-8';
  if (scaledX < 1800) return 'UTC-4';
  if (scaledX < 2500) return 'UTC+0';
  return 'UTC+4';
}

function normalizeClientMapData(data: unknown[]): MapData {
  return data.map((raw) => {
    const cell = raw as Record<string, unknown>;
    const id = cell['id'] as number;
    const origX = cell['x'] as number;
    const origY = cell['y'] as number;
    const x = origX * MAP_SCALE;
    const y = origY * MAP_SCALE;
    const destinations = (cell['destinations'] as number[]) ?? [];
    const timezone = getTimezoneByX(origX);
    const existingExtra = cell['extra'];
    if (existingExtra && typeof existingExtra === 'object' && !Array.isArray(existingExtra)) {
      return { id, x, y, destinations, extra: { ...(existingExtra as Record<string, unknown>), timezone } };
    }
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(cell)) {
      if (!['id', 'x', 'y', 'destinations'].includes(key)) {
        extra[key] = value;
      }
    }
    extra['timezone'] = timezone;
    return { id, x, y, destinations, extra };
  });
}

function getFallbackMapData(): unknown[] {
  return [
    { id: 0, x: 600, y: 500, destinations: [1, 39], name: '起点', type: 'start', price: 0, rent: [], description: ['游戏起点', '经过可得200元', '可设置天赋'], extra: [], behavior: '', icon: '🚩', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 0 },
    { id: 1, x: 750, y: 480, destinations: [0, 2], name: '樱花大道', type: 'property', price: 120, rent: [8, 40, 120, 280, 450], description: ['浪漫商业街'], extra: [], behavior: '', icon: '🌸', level: 0, upgradeCost: [50, 100, 150, 200], owners: [], isMortgaged: 0, mortgagePrice: 60 },
    { id: 2, x: 880, y: 420, destinations: [1, 3], name: '市中心事件', type: 'event', price: 0, rent: [], description: ['繁华市中心的随机事件'], extra: [], behavior: 'event_city_center', icon: '❓', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 0 },
    { id: 3, x: 980, y: 330, destinations: [2, 4], name: '科技大厦', type: 'property', price: 200, rent: [16, 80, 200, 450, 700], description: ['高科技办公楼'], extra: [], behavior: '', icon: '🏢', level: 0, upgradeCost: [100, 150, 200, 300], owners: [], isMortgaged: 0, mortgagePrice: 100 },
    { id: 4, x: 1020, y: 220, destinations: [3, 5], name: '交通枢纽', type: 'transport', price: 0, rent: [], description: ['快速传送点', '付费传送到其他枢纽'], extra: [], behavior: '', icon: '🚇', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 0, transportCost: 50 },
    { id: 5, x: 980, y: 110, destinations: [4, 6], name: '翡翠公园', type: 'property', price: 280, rent: [24, 120, 300, 650, 1000], description: ['绿色生态住宅区'], extra: ['环保+5'], behavior: '', icon: '🌳', level: 0, upgradeCost: [120, 180, 240, 350], owners: [], isMortgaged: 0, mortgagePrice: 140 },
    { id: 6, x: 880, y: 20, destinations: [5, 7], name: '投资中心', type: 'investment', price: 350, rent: [], description: ['金融投资项目', '可合租'], extra: [], behavior: '', icon: '💎', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 175, investmentReturn: 50 },
    { id: 7, x: 750, y: -40, destinations: [6, 8], name: '水晶港湾', type: 'property', price: 350, rent: [35, 175, 420, 900, 1400], description: ['海景豪宅区'], extra: [], behavior: '', icon: '🌊', level: 0, upgradeCost: [150, 220, 300, 400], owners: [], isMortgaged: 0, mortgagePrice: 175 },
    { id: 8, x: 600, y: -60, destinations: [7, 9], name: '纪念碑', type: 'monument', price: 0, rent: [], description: ['时代纪念碑', '修缮增加信用值'], extra: [], behavior: '', icon: '🗿', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 0, monumentCost: 200 },
    { id: 9, x: 450, y: -40, destinations: [8, 10], name: '云端花园', type: 'property', price: 400, rent: [45, 220, 550, 1200, 1800], description: ['空中花园别墅'], extra: [], behavior: '', icon: '🌺', level: 0, upgradeCost: [180, 250, 350, 500], owners: [], isMortgaged: 0, mortgagePrice: 200 },
    { id: 10, x: 320, y: 20, destinations: [9, 11], name: '住宅区事件', type: 'event', price: 0, rent: [], description: ['宁静住宅区的随机事件'], extra: [], behavior: 'event_residential', icon: '❓', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 0 },
    { id: 11, x: 220, y: 110, destinations: [10, 12], name: '黄金海岸', type: 'property', price: 450, rent: [55, 275, 680, 1500, 2200], description: ['黄金地段'], extra: [], behavior: '', icon: '🏖️', level: 0, upgradeCost: [200, 300, 400, 550], owners: [], isMortgaged: 0, mortgagePrice: 225 },
    { id: 12, x: 180, y: 220, destinations: [11, 13], name: '投资银行', type: 'investment', price: 400, rent: [], description: ['顶级金融机构', '可合租'], extra: [], behavior: '', icon: '🏦', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 200, investmentReturn: 60 },
    { id: 13, x: 220, y: 330, destinations: [12, 14], name: '监狱', type: 'jail', price: 0, rent: [], description: ['违反规则会被关进来', '掷骰冷却大幅延长'], extra: [], behavior: '', icon: '🔒', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 0 },
    { id: 14, x: 320, y: 420, destinations: [13, 15], name: '美食街', type: 'property', price: 180, rent: [12, 60, 180, 400, 600], description: ['世界各地美食'], extra: [], behavior: '', icon: '🍜', level: 0, upgradeCost: [80, 120, 180, 250], owners: [], isMortgaged: 0, mortgagePrice: 90 },
    { id: 15, x: 450, y: 480, destinations: [14, 16], name: '交通中心', type: 'transport', price: 0, rent: [], description: ['城市公交枢纽'], extra: [], behavior: '', icon: '🚌', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 0, transportCost: 30 },
    { id: 16, x: 600, y: 380, destinations: [15, 17], name: '星光广场', type: 'property', price: 300, rent: [30, 150, 380, 850, 1300], description: ['娱乐购物中心'], extra: [], behavior: '', icon: '⭐', level: 0, upgradeCost: [130, 190, 260, 380], owners: [], isMortgaged: 0, mortgagePrice: 150 },
    { id: 17, x: 600, y: 260, destinations: [16, 18], name: '商业区事件', type: 'event', price: 0, rent: [], description: ['商业中心的随机事件'], extra: [], behavior: 'event_commercial', icon: '❓', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 0 },
    { id: 18, x: 500, y: 180, destinations: [17, 19], name: '大学城', type: 'property', price: 250, rent: [20, 100, 250, 550, 850], description: ['知识的殿堂'], extra: [], behavior: '', icon: '🎓', level: 0, upgradeCost: [110, 160, 220, 300], owners: [], isMortgaged: 0, mortgagePrice: 125 },
    { id: 19, x: 380, y: 150, destinations: [18, 20], name: '艺术区', type: 'property', price: 220, rent: [18, 90, 220, 500, 750], description: ['创意与灵感'], extra: [], behavior: '', icon: '🎨', level: 0, upgradeCost: [90, 140, 200, 280], owners: [], isMortgaged: 0, mortgagePrice: 110 },
    { id: 20, x: 280, y: 180, destinations: [19, 21], name: '科技园', type: 'investment', price: 380, rent: [], description: ['创新企业聚集地', '可合租'], extra: [], behavior: '', icon: '🔬', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 190, investmentReturn: 55 },
    { id: 21, x: 220, y: 260, destinations: [20, 22], name: '体育馆', type: 'property', price: 260, rent: [22, 110, 280, 620, 950], description: ['运动的天堂'], extra: [], behavior: '', icon: '⚽', level: 0, upgradeCost: [120, 170, 230, 320], owners: [], isMortgaged: 0, mortgagePrice: 130 },
    { id: 22, x: 220, y: 380, destinations: [21, 23], name: '动物园', type: 'property', price: 160, rent: [10, 50, 150, 350, 520], description: ['可爱的动物们'], extra: [], behavior: '', icon: '🦁', level: 0, upgradeCost: [70, 110, 160, 220], owners: [], isMortgaged: 0, mortgagePrice: 80 },
    { id: 23, x: 280, y: 480, destinations: [22, 24], name: '住宅区事件', type: 'event', price: 0, rent: [], description: ['宁静住宅区的随机事件'], extra: [], behavior: 'event_residential', icon: '❓', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 0 },
    { id: 24, x: 380, y: 520, destinations: [23, 25], name: '图书馆', type: 'property', price: 150, rent: [9, 45, 140, 320, 480], description: ['知识的海洋'], extra: [], behavior: '', icon: '📚', level: 0, upgradeCost: [60, 100, 150, 210], owners: [], isMortgaged: 0, mortgagePrice: 75 },
    { id: 25, x: 500, y: 520, destinations: [24, 26], name: '医院', type: 'property', price: 190, rent: [14, 70, 190, 420, 650], description: ['健康守护'], extra: [], behavior: '', icon: '🏥', level: 0, upgradeCost: [85, 130, 180, 260], owners: [], isMortgaged: 0, mortgagePrice: 95 },
    { id: 26, x: 720, y: 380, destinations: [1, 27], name: '游乐园', type: 'property', price: 210, rent: [16, 80, 210, 480, 720], description: ['欢乐的海洋'], extra: [], behavior: '', icon: '🎢', level: 0, upgradeCost: [90, 140, 190, 270], owners: [], isMortgaged: 0, mortgagePrice: 105 },
    { id: 27, x: 820, y: 320, destinations: [26, 28], name: '电影院', type: 'property', price: 170, rent: [12, 60, 160, 380, 580], description: ['光影世界'], extra: [], behavior: '', icon: '🎬', level: 0, upgradeCost: [75, 115, 165, 240], owners: [], isMortgaged: 0, mortgagePrice: 85 },
    { id: 28, x: 880, y: 230, destinations: [27, 29], name: '投资基金', type: 'investment', price: 420, rent: [], description: ['专业理财', '可合租'], extra: [], behavior: '', icon: '📈', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 210, investmentReturn: 70 },
    { id: 29, x: 880, y: 130, destinations: [28, 30], name: '太空港', type: 'transport', price: 0, rent: [], description: ['星际旅行起点'], extra: [], behavior: '', icon: '🚀', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 0, transportCost: 100 },
    { id: 30, x: 820, y: 50, destinations: [29, 31], name: '天文台', type: 'property', price: 320, rent: [28, 140, 350, 780, 1200], description: ['仰望星空'], extra: [], behavior: '', icon: '🔭', level: 0, upgradeCost: [140, 200, 280, 400], owners: [], isMortgaged: 0, mortgagePrice: 160 },
    { id: 31, x: 720, y: 0, destinations: [30, 32], name: '市中心事件', type: 'event', price: 0, rent: [], description: ['繁华市中心的随机事件'], extra: [], behavior: 'event_city_center', icon: '❓', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 0 },
    { id: 32, x: 480, y: 0, destinations: [31, 33], name: '海底世界', type: 'property', price: 380, rent: [38, 190, 480, 1050, 1600], description: ['深海探索'], extra: ['环保+3'], behavior: '', icon: '🐠', level: 0, upgradeCost: [170, 240, 330, 450], owners: [], isMortgaged: 0, mortgagePrice: 190 },
    { id: 33, x: 360, y: 50, destinations: [32, 34], name: '赌场', type: 'investment', price: 500, rent: [], description: ['一掷千金', '可合租'], extra: [], behavior: '', icon: '🎰', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 250, investmentReturn: 80 },
    { id: 34, x: 260, y: 100, destinations: [33, 35], name: '豪华酒店', type: 'property', price: 480, rent: [60, 300, 750, 1650, 2500], description: ['五星级享受'], extra: [], behavior: '', icon: '🏨', level: 0, upgradeCost: [220, 320, 420, 600], owners: [], isMortgaged: 0, mortgagePrice: 240 },
    { id: 35, x: 180, y: 180, destinations: [34, 36], name: '商业区事件', type: 'event', price: 0, rent: [], description: ['商业中心的随机事件'], extra: [], behavior: 'event_commercial', icon: '❓', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 0 },
    { id: 36, x: 160, y: 280, destinations: [35, 37], name: '政府大楼', type: 'property', price: 300, rent: [25, 125, 320, 720, 1100], description: ['权力中心'], extra: [], behavior: '', icon: '🏛️', level: 0, upgradeCost: [130, 190, 260, 380], owners: [], isMortgaged: 0, mortgagePrice: 150 },
    { id: 37, x: 180, y: 380, destinations: [36, 38], name: '公园', type: 'property', price: 140, rent: [7, 35, 110, 260, 400], description: ['城市绿洲'], extra: ['环保+2'], behavior: '', icon: '🌲', level: 0, upgradeCost: [60, 90, 130, 180], owners: [], isMortgaged: 0, mortgagePrice: 70 },
    { id: 38, x: 260, y: 460, destinations: [37, 39], name: '火车站', type: 'transport', price: 0, rent: [], description: ['城市门户'], extra: [], behavior: '', icon: '🚂', level: 0, upgradeCost: [], owners: [], isMortgaged: 0, mortgagePrice: 0, transportCost: 40 },
    { id: 39, x: 480, y: 500, destinations: [38, 0], name: '自由港', type: 'property', price: 360, rent: [32, 160, 400, 900, 1400], description: ['自由贸易区'], extra: [], behavior: '', icon: '⚓', level: 0, upgradeCost: [160, 230, 310, 440], owners: [], isMortgaged: 0, mortgagePrice: 180 },
  ];
}

// ===== Render Loop =====
let detailPanelUpdateTimer: ReturnType<typeof setInterval> | null = null;

function startRenderLoop(): void {
  startProsperityTimer();
  startDetailPanelUpdateTimer();
  const animate = () => {
    if (!renderer) return;
    updateDiceAnimation();
    updateMovement();
    updateCameraFollow();
    updateDayNight();

    if (isMoving) {
      renderer.updatePlayers([]);
    } else {
      updateRendererPlayers();
    }

    renderer.render();
    drawTimezoneVignette();

    if (isMoving) {
      drawPlayerAtWorldPos(playerDisplayX, playerDisplayY);
    }

    drawOtherPlayers();

    animationFrameId = requestAnimationFrame(animate);
  };
  animate();
}

function startDetailPanelUpdateTimer(): void {
  if (detailPanelUpdateTimer) clearInterval(detailPanelUpdateTimer);
  detailPanelUpdateTimer = setInterval(() => {
    updateTopBarTime();
    if (detailPanelExpanded) {
      updateDetailPanel();
    }
  }, 1000);
}

function updateRendererPlayers(): void {
  if (!renderer || !currentPlayer || !mapIndex) return;
  currentPlayer.position.cellId = currentPlayerPosition;
  const allPlayers: Player[] = [currentPlayer, ...otherPlayers.map(op => ({
    id: op.id,
    username: op.username,
    position: op.position,
    status: op.status,
    values: { money: { id: 'money', name: '财产', current: op.primaryValue, min: 0 } },
    teamId: null,
    items: [],
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  }))];
  renderer.updatePlayers(allPlayers);
}

function updateCameraFollow(): void {
  if (!renderer) return;
  const cam = renderer.getCamera();
  const state = cam.getState();

  const targetOffsetX = state.viewportWidth / 2 - cameraTargetX * state.zoom;
  const targetOffsetY = state.viewportHeight / 2 - cameraTargetY * state.zoom;

  const dx = targetOffsetX - state.offsetX;
  const dy = targetOffsetY - state.offsetY;

  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
    cam.panTo(
      state.offsetX + dx * cameraFollowSpeed,
      state.offsetY + dy * cameraFollowSpeed
    );
  }
}

let lastPlayerTimezone = '';
let lastLocalIsDay: boolean | null = null;

function updateDayNight(): void {
  const tz = getPlayerTimezone();
  const { isDay: localIsDay, timeStr } = getLocalDayNight(tz);

  if (tz !== lastPlayerTimezone && lastPlayerTimezone !== '') {
    addChatMessage(`🌐 进入 ${tz} 时区，当前时间 ${timeStr}（${localIsDay ? '白天' : '夜晚'}）`, 'system');
    updateBoardTheme();
    updateTopBar();
  }

  if (localIsDay !== lastLocalIsDay && lastLocalIsDay !== null) {
    addChatMessage(localIsDay ? '☀️ 白天来了！区域繁荣度开始恢复' : '🌙 夜晚降临，区域繁荣度下降', 'system');
    updateBoardTheme();
    updateTopBar();
  }

  lastPlayerTimezone = tz;
  lastLocalIsDay = localIsDay;
}

function updateBoardTheme(): void {
  const boardContainer = document.querySelector('.board-container') as HTMLElement;
  if (!boardContainer) return;
  const tz = getPlayerTimezone();
  const { isDay: localIsDay } = getLocalDayNight(tz);
  if (localIsDay) {
    boardContainer.style.background = '#f1f5f9';
    boardContainer.style.filter = 'none';
  } else {
    boardContainer.style.background = '#1e293b';
    boardContainer.style.filter = 'sepia(20%) saturate(80%) hue-rotate(200deg) brightness(85%)';
  }
}

function startProsperityTimer(): void {
  if (prosperityTimer) clearInterval(prosperityTimer);
  prosperityTimer = setInterval(() => {
    const tz = getPlayerTimezone();
    const { isDay: localIsDay } = getLocalDayNight(tz);
    if (localIsDay) {
      prosperity = Math.min(100, prosperity + 1);
    } else {
      prosperity = Math.max(30, prosperity - 1);
    }
    updateTopBar();
  }, 10000);
}

function updateDiceAnimation(): void {
  if (!diceAnimating || !diceDisplayEl) return;
  const elapsed = performance.now() - diceAnimStart;
  if (elapsed >= diceAnimDuration) {
    diceAnimating = false;
    diceDisplayEl.textContent = `🎲 ${diceValue}`;
    return;
  }
  const progress = elapsed / diceAnimDuration;
  const displayValue = (Math.floor(progress * 15) % 6) + 1;
  diceDisplayEl.textContent = `🎲 ${displayValue}`;
}

// ===== Movement =====
function updateMovement(): void {
  if (!isMoving || isWaitingForChoice) return;
  const elapsed = performance.now() - moveStartTime;
  const progress = Math.min(elapsed / moveStepDuration, 1);
  const t = easeInOutQuad(progress);
  playerDisplayX = moveFromX + (moveToX - moveFromX) * t;
  playerDisplayY = moveFromY + (moveToY - moveFromY) * t;

  cameraTargetX = playerDisplayX;
  cameraTargetY = playerDisplayY;

  if (progress >= 1) {
    remainingSteps--;
    if (remainingSteps > 0) {
      startNextStep();
    } else {
      isMoving = false;
      onPlayerArrived();
    }
  }
}

function startNextStep(): void {
  if (!mapIndex) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell) { isMoving = false; return; }

  let available = cell.destinations.filter(d => d !== previousCellId);
  if (available.length === 0) available = [...cell.destinations];
  if (available.length === 0) { isMoving = false; onPlayerArrived(); return; }

  if (available.length === 1) {
    animateMoveTo(available[0]);
  } else {
    isWaitingForChoice = true;
    showIntersectionChoice(available);
  }
}

function animateMoveTo(targetId: number): void {
  if (!mapIndex) return;
  const target = mapIndex.getById(targetId);
  if (!target) return;
  previousCellId = currentPlayerPosition;
  moveFromX = playerDisplayX;
  moveFromY = playerDisplayY;
  moveToX = target.x;
  moveToY = target.y;
  moveStartTime = performance.now();
  currentPlayerPosition = targetId;
(window as any).currentPlayerPosition = currentPlayerPosition;
}

function onIntersectionChoice(targetId: number): void {
  isWaitingForChoice = false;
  hideIntersectionChoice();
  animateMoveTo(targetId);
}

function showIntersectionChoice(options: number[]): void {
  if (!renderer || !mapIndex || !canvasEl) return;
  hideIntersectionChoice();
  const cam = renderer.getCamera();
  const playerScreen = cam.worldToScreen(playerDisplayX, playerDisplayY);
  const rect = canvasEl.getBoundingClientRect();

  const container = document.createElement('div');
  container.className = 'intersection-choice';
  container.id = 'intersection-choice';
  container.style.left = `${rect.left + playerScreen.screenX}px`;
  container.style.top = `${rect.top + playerScreen.screenY}px`;

  for (const optId of options) {
    const cell = mapIndex.getById(optId);
    if (!cell) continue;
    const cellScreen = cam.worldToScreen(cell.x, cell.y);
    const dx = cellScreen.screenX - playerScreen.screenX;
    const dy = cellScreen.screenY - playerScreen.screenY;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const offset = 55;
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.style.left = `${(dx / dist) * offset}px`;
    btn.style.top = `${(dy / dist) * offset}px`;
    btn.innerHTML = `${cIcon(cell)} ${cName(cell)}`;
    btn.title = `前往 ${cName(cell)}`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onIntersectionChoice(optId);
    });
    container.appendChild(btn);
  }

  document.body.appendChild(container);
  addChatMessage('🔀 岔路口！请选择方向', 'system');
}

function hideIntersectionChoice(): void {
  document.getElementById('intersection-choice')?.remove();
}

function drawTimezoneVignette(): void {
  if (!canvasEl || !renderer) return;
  const ctx = canvasEl.getContext('2d');
  if (!ctx) return;
  const camState = renderer.getCamera().getState();
  const w = camState.viewportWidth;
  const h = camState.viewportHeight;

  const playerScreenX = playerDisplayX * camState.zoom + camState.offsetX;
  const playerScreenY = playerDisplayY * camState.zoom + camState.offsetY;

  // 基于玩家所在时区的本地昼夜
  const tz = getPlayerTimezone();
  const { isDay: localIsDay } = getLocalDayNight(tz);
  const isDarkTz = tz === 'UTC-8' || tz === 'UTC-4';
  const nightFactor = localIsDay ? 0 : 0.5;

  const maxDim = Math.max(w, h);
  const innerRadius = maxDim * 0.28;
  const outerRadius = maxDim * 0.7;

  const grad = ctx.createRadialGradient(
    playerScreenX, playerScreenY, innerRadius,
    playerScreenX, playerScreenY, outerRadius
  );

  if (isDarkTz) {
    grad.addColorStop(0, `rgba(0, 0, 25, 0)`);
    grad.addColorStop(0.5, `rgba(10, 10, 45, ${0.18 + nightFactor * 0.5})`);
    grad.addColorStop(1, `rgba(5, 5, 35, ${0.5 + nightFactor * 0.35})`);
  } else {
    grad.addColorStop(0, `rgba(0, 0, 0, 0)`);
    grad.addColorStop(0.6, `rgba(20, 20, 45, ${0.06 + nightFactor * 0.35})`);
    grad.addColorStop(1, `rgba(10, 10, 35, ${0.28 + nightFactor * 0.4})`);
  }

  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawPlayerAtWorldPos(worldX: number, worldY: number): void {
  if (!canvasEl || !renderer) return;
  const ctx = canvasEl.getContext('2d');
  if (!ctx) return;
  const camState = renderer.getCamera().getState();
  const sx = worldX * camState.zoom + camState.offsetX;
  const sy = worldY * camState.zoom + camState.offsetY;
  const r = 14 * camState.zoom;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(sx, sy + r * 0.9, r * 0.7, r * 0.25, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.35, sy - r * 0.1);
  ctx.lineTo(sx + r * 0.35, sy - r * 0.1);
  ctx.lineTo(sx + r * 0.7, sy + r * 0.7);
  ctx.lineTo(sx - r * 0.7, sy + r * 0.7);
  ctx.closePath();
  ctx.fillStyle = '#3b82f6';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, 2 * camState.zoom);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(sx, sy - r * 0.45, r * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = '#3b82f6';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, 2 * camState.zoom);
  ctx.stroke();
  ctx.restore();
}

function drawOtherPlayers(): void {
  if (!canvasEl || !renderer || !mapIndex) return;
  const ctx = canvasEl.getContext('2d');
  if (!ctx) return;
  const camState = renderer.getCamera().getState();

  for (const player of otherPlayers) {
    const cell = mapIndex.getById(player.position.cellId);
    if (!cell) continue;

    const sx = cell.x * camState.zoom + camState.offsetX;
    const sy = cell.y * camState.zoom + camState.offsetY;
    const r = 14 * camState.zoom;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(sx, sy + r * 0.9, r * 0.7, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sx - r * 0.35, sy - r * 0.1);
    ctx.lineTo(sx + r * 0.35, sy - r * 0.1);
    ctx.lineTo(sx + r * 0.7, sy + r * 0.7);
    ctx.lineTo(sx - r * 0.7, sy + r * 0.7);
    ctx.closePath();
    ctx.fillStyle = '#f97316';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, 2 * camState.zoom);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy - r * 0.45, r * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#f97316';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, 2 * camState.zoom);
    ctx.stroke();

    ctx.font = `${Math.max(10, 12 * camState.zoom)}px sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = Math.max(2, 3 * camState.zoom);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const labelY = sy - r * 1.8;
    ctx.strokeText(player.username, sx, labelY);
    ctx.fillText(player.username, sx, labelY);

    ctx.restore();
  }
}

// ===== Game Logic =====
function handleRollDice(): void {
  if (!canRoll || isMoving || diceAnimating || isBankrupt) return;
  if (isInJail) {
    const now = Date.now();
    if (now < jailEndTime) {
      const remaining = Math.ceil((jailEndTime - now) / 1000);
      addChatMessage(`🔒 还在监狱中！剩余 ${remaining} 秒`, 'system');
      return;
    }
    isInJail = false;
    addChatMessage('✅ 出狱了！恢复正常状态', 'system');
  }
  const now = Date.now();
  if (now < rollCooldownEnd) return;

  canRoll = false;

  if (gameSocket) {
    gameSocket.emit('client.rollDice', {}, (result) => {
      if (result.ok && result.data) {
        diceValue = result.data.dice;
        diceAnimating = true;
        diceAnimStart = performance.now();
        rollCooldownEnd = Date.now() + rollCooldown;
        addChatMessage(`🎲 掷出了 ${diceValue} 点！`, 'system');
        startRollCooldownTimer();
        setTimeout(() => startMovement(diceValue), diceAnimDuration + 150);
      } else {
        addChatMessage(`❌ 掷骰失败：${result.error || '未知错误'}`, 'error');
        canRoll = true;
      }
    });
  } else {
    diceValue = Math.floor(Math.random() * 6) + 1;
    diceAnimating = true;
    diceAnimStart = performance.now();
    rollCooldownEnd = now + rollCooldown;
    addChatMessage(`🎲 掷出了 ${diceValue} 点！`, 'system');
    startRollCooldownTimer();
    setTimeout(() => startMovement(diceValue), diceAnimDuration + 150);
  }
}

function startRollCooldownTimer(): void {
  if (rollCooldownTimer) clearInterval(rollCooldownTimer);
  const update = () => {
    const remaining = rollCooldownEnd - Date.now();
    if (remaining <= 0) {
      if (rollCooldownTimer) { clearInterval(rollCooldownTimer); rollCooldownTimer = null; }
      canRoll = true;
      if (rollBtn) {
        rollBtn.disabled = false;
        rollBtn.classList.remove('disabled', 'cooldown');
        rollBtn.textContent = '掷骰子';
        rollBtn.style.background = '';
      }
      return;
    }
    if (rollBtn) {
      // 用渐变进度条代替读秒：从左到右填充
      const progress = 1 - (remaining / rollCooldown);
      rollBtn.textContent = '🎲 …';
      rollBtn.classList.add('cooldown');
      rollBtn.style.background = `linear-gradient(to right, var(--accent, #4f46e5) ${progress * 100}%, rgba(255,255,255,0.15) ${progress * 100}%)`;
    }
  };
  update();
  rollCooldownTimer = setInterval(update, 100);
}

function startMovement(steps: number): void {
  if (!mapIndex) return;
  // Lock talents once the player departs from the start cell
  if (currentPlayerPosition === 0 && !talentsLocked) {
    talentsLocked = true;
    updateTopBar();
  }
  remainingSteps = steps;
  isMoving = true;
  actionUsedThisTurn = false;
  hideHoverCard();
  updateActionPanel();
  addAchievementProgress('first_move', 1);
  addAchievementProgress('moves_50', 1);
  addAchievementProgress('moves_200', 1);

  showPathPrediction(steps);
  startNextStep();
}

let predictedPath: number[] = [];

function showPathPrediction(steps: number): void {
  if (!mapIndex) return;
  predictedPath = [];
  let pos = currentPlayerPosition;
  let prev = previousCellId;

  for (let i = 0; i < steps; i++) {
    const cell = mapIndex.getById(pos);
    if (!cell) break;
    predictedPath.push(pos);

    let available = cell.destinations.filter(d => d !== prev);
    if (available.length === 0) available = [...cell.destinations];
    if (available.length === 0) break;

    if (available.length === 1) {
      prev = pos;
      pos = available[0];
    } else {
      addChatMessage(`💡 提示：移动 ${i + 1} 步后会遇到岔路口（${available.length}个方向）`, 'system');
      predictedPath.push(pos);
      break;
    }
  }

  if (predictedPath.length > 0) {
    const finalCell = mapIndex.getById(predictedPath[predictedPath.length - 1]);
    if (finalCell) {
      addChatMessage(`📍 预计到达：${cName(finalCell)}${predictedPath.length < steps ? '（途中有岔路）' : ''}`, 'system');
    }
  }
}

function onPlayerArrived(): void {
  if (!mapIndex) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell) return;
  playerDisplayX = cell.x;
  playerDisplayY = cell.y;
  cameraTargetX = cell.x;
  cameraTargetY = cell.y;

  const type = cType(cell);
  const name = cName(cell);

  switch (type) {
    case 'start':
      currentMoney += 200;
      addEarnedMoney(200);
      addChatMessage('🚩 经过起点，获得 200 元！', 'system');
      checkTalentSelection();
      break;
    case 'property':
      if (ownedProperties.has(cell.id)) {
        addChatMessage(`🏠 你已拥有 ${name}`, 'system');
      } else if (cOwners(cell).length > 0) {
        const rent = cRent(cell)[propertyLevels.get(cell.id) || 0] || 0;
        currentMoney = Math.max(0, currentMoney - rent);
        addChatMessage(`💸 支付过路费 ${rent} 元`, 'system');
        checkBankruptcy();
      } else {
        addChatMessage(`📍 ${name} 无人所有，可购买`, 'system');
      }
      break;
    case 'event':
      triggerRandomEvent();
      break;
    case 'investment':
      if (ownedInvestments.has(cell.id)) {
        let returnAmount = cInvestmentReturn(cell);
        if (isTalentActive('investment_boost')) {
          returnAmount = Math.floor(returnAmount * 1.2);
        }
        currentMoney += returnAmount;
        addEarnedMoney(returnAmount);
        addChatMessage(`💎 投资收益：${returnAmount} 元${isTalentActive('investment_boost') ? '（投资加成+20%）' : ''}`, 'system');
      } else {
        addChatMessage(`💎 投资项目：${name}，可购买或合租`, 'system');
      }
      break;
    case 'transport':
      addChatMessage(`🚇 交通枢纽：${name}，可付费传送`, 'system');
      break;
    case 'jail':
      isInJail = true;
      jailEndTime = Date.now() + 15000;
      currentCredit = Math.max(0, currentCredit - 10);
      addChatMessage('🔒 进监狱了！15秒内无法掷骰，信用值-10', 'system');
      break;
    case 'monument':
      addChatMessage('🗿 时代纪念碑：可修缮增加信用值', 'system');
      break;
    default:
      addChatMessage(`📍 到达：${name}`, 'system');
  }

  updateTopBar();
  updateTeamPanel();
  updateActionPanel();
  updateItemsPanel();
}

function checkBankruptcy(): void {
  if (currentMoney <= 0) {
    currentMoney = 0;
    isBankrupt = true;
    canRoll = false;
    addAchievementProgress('bankrupt_1', 1);
    addAchievementProgress('bankrupt_3', 1);
    if (rollBtn) {
      rollBtn.disabled = true;
      rollBtn.classList.add('disabled');
    }
    addChatMessage('💀 你已破产！点击"返回起点"重新开始', 'system');
  }
}

function triggerRandomEvent(): void {
  let events: BehaviorEvent[] = [
    { msg: '🎉 中奖了！获得 150 元', money: 150, credit: 0, env: 0 },
    { msg: '💸 意外支出，损失 100 元', money: -100, credit: 0, env: 0 },
    { msg: '⭐ 热心公益，信用值+5', money: 0, credit: 5, env: 0 },
    { msg: '🌱 参与环保活动，环保值+3', money: 0, credit: 2, env: 3 },
    { msg: '🎁 收到礼物，获得 80 元', money: 80, credit: 0, env: 0 },
    { msg: '📉 投资失败，损失 120 元', money: -120, credit: 0, env: 0 },
    { msg: '🔑 获得查封令道具', money: 0, credit: 0, env: 0, item: 'seal' },
    { msg: '🩹 获得复活令道具', money: 0, credit: 0, env: 0, item: 'revive' },
    { msg: '⭐ 信用值+10', money: 0, credit: 10, env: 0 },
    { msg: '🌱 环保值+5', money: 0, credit: 0, env: 5 },
  ];

  // 使用行为文件定义的事件
  if (mapIndex) {
    const cell = mapIndex.getById(currentPlayerPosition);
    if (cell) {
      const behaviorId = getExtra<string>(cell, 'behavior', '');
      if (behaviorId) {
        const behavior = behaviorConfigs.get(behaviorId);
        if (behavior && behavior.events.length > 0) {
          events = behavior.events;
        } else {
          // 懒加载行为配置
          loadBehaviorConfig(behaviorId).then(config => {
            if (config) behaviorConfigs.set(behaviorId, config);
          });
        }
      }
    }
  }

  const event = events[Math.floor(Math.random() * events.length)];
  const moneyDelta = event.money || 0;
  currentMoney = Math.max(0, currentMoney + moneyDelta);
  if (moneyDelta > 0) addEarnedMoney(moneyDelta);
  if (isTalentActive('credit')) {
    currentCredit = Math.max(0, Math.min(100, currentCredit + (event.credit || 0)));
  }
  if (isTalentActive('env')) {
    currentEnv = Math.max(0, currentEnv + (event.env || 0));
  }
  addChatMessage(event.msg, 'system');
  if (event.item) {
    addItem(event.item);
  }
  if (moneyDelta < 0) checkBankruptcy();
}

function handleBuyProperty(): void {
  if (!mapIndex || actionUsedThisTurn) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell || cType(cell) !== 'property') return;
  if (ownedProperties.has(cell.id)) return;
  const price = cPrice(cell);
  if (currentMoney < price) { addChatMessage('❌ 金钱不足，无法购买', 'system'); return; }

  currentMoney -= price;
  ownedProperties.add(cell.id);
  propertyLevels.set(cell.id, 0);
  actionUsedThisTurn = true;
  updateAchievement('property_3', ownedProperties.size);
  updateAchievement('property_8', ownedProperties.size);

  const effects = cEffects(cell);
  const envMatch = effects.find(e => typeof e === 'string' && (e as string).includes('环保'));
  if (envMatch && isTalentActive('env')) {
    const match = (envMatch as string).match(/环保\+(\d+)/);
    if (match) currentEnv += parseInt(match[1]);
  }

  addChatMessage(`✅ 成功购买 ${cName(cell)}！`, 'system');
  updateTopBar();
  updateTeamPanel();
  updateActionPanel();
}

function handleUpgradeProperty(): void {
  if (!mapIndex || actionUsedThisTurn) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell || cType(cell) !== 'property') return;
  if (!ownedProperties.has(cell.id)) return;
  const level = propertyLevels.get(cell.id) || 0;
  if (level >= 4) { addChatMessage('❌ 已达最高等级', 'system'); return; }
  const cost = cUpgradeCost(cell)[level] || 0;
  if (currentMoney < cost) { addChatMessage('❌ 金钱不足，无法升级', 'system'); return; }

  currentMoney -= cost;
  propertyLevels.set(cell.id, level + 1);
  actionUsedThisTurn = true;

  addChatMessage(`⬆️ ${cName(cell)} 升级到 ${level + 1} 级！`, 'system');
  updateTopBar();
  updateTeamPanel();
  updateActionPanel();
}

function handleBuyInvestment(): void {
  if (!mapIndex || actionUsedThisTurn) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell || cType(cell) !== 'investment') return;
  const price = cPrice(cell);
  if (currentMoney < price) { addChatMessage('❌ 金钱不足，无法投资', 'system'); return; }

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">💎 全额投资 ${cName(cell)}</div>
      <div class="modal-body">
        <div class="bank-info">
          <div>💰 投资价格: ${price} 元</div>
          <div>📈 每次收益: ${cInvestmentReturn(cell)} 元</div>
          <div>💵 当前余额: ${currentMoney} 元</div>
        </div>
        <button class="modal-btn btn-primary" id="btn-confirm-buy">确认购买（${price} 元）</button>
        <button class="modal-btn btn-cancel" id="btn-cancel-buy">取消</button>
      </div>
    </div>
  `;

  modal.querySelector('#btn-confirm-buy')!.addEventListener('click', () => {
    if (currentMoney < price) { addChatMessage('❌ 金钱不足', 'system'); return; }
    currentMoney -= price;
    ownedInvestments.add(cell.id);
    investmentShares.set(cell.id, 100);
    actionUsedThisTurn = true;
    addAchievementProgress('invest_3', 1);
    addAchievementProgress('invest_10', 1);
    addChatMessage(`✅ 成功全额投资 ${cName(cell)}！`, 'system');
    modal.remove();
    updateTopBar();
    updateTeamPanel();
    updateActionPanel();
  });
  modal.querySelector('#btn-cancel-buy')!.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}

function handleCoInvest(): void {
  if (!mapIndex || actionUsedThisTurn) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell || cType(cell) !== 'investment') return;
  const totalPrice = cPrice(cell);
  const maxShare = Math.min(90, Math.floor(currentMoney / totalPrice * 100));

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">🤝 合租投资 ${cName(cell)}</div>
      <div class="modal-body">
        <div class="bank-info">
          <div>💰 项目总价: ${totalPrice} 元</div>
          <div>📈 每次收益: ${cInvestmentReturn(cell)} 元</div>
          <div>💵 当前余额: ${currentMoney} 元</div>
        </div>
        <div class="input-section">
          <label class="input-label">持股比例（1% - ${maxShare}%）</label>
          <div class="input-row">
            <input type="number" id="coinvest-share" class="amount-input" min="1" max="${maxShare}" value="${Math.min(50, maxShare)}" />
            <span class="input-suffix">%</span>
          </div>
          <div class="input-hint" id="coinvest-hint"></div>
        </div>
        <button class="modal-btn btn-primary" id="btn-confirm-coinvest">确认合租</button>
        <button class="modal-btn btn-cancel" id="btn-cancel-coinvest">取消</button>
      </div>
    </div>
  `;

  const shareInput = modal.querySelector('#coinvest-share') as HTMLInputElement;
  const hintEl = modal.querySelector('#coinvest-hint') as HTMLElement;

  const updateHint = (): void => {
    const share = parseInt(shareInput.value) || 0;
    const cost = Math.floor(totalPrice * share / 100);
    const income = Math.floor(cInvestmentReturn(cell) * share / 100);
    hintEl.textContent = `需支付 ${cost} 元，每次收益 ${income} 元`;
  };
  shareInput.addEventListener('input', updateHint);
  updateHint();

  modal.querySelector('#btn-confirm-coinvest')!.addEventListener('click', () => {
    const share = parseInt(shareInput.value) || 0;
    if (share < 1 || share > maxShare) { addChatMessage(`❌ 比例需在 1% - ${maxShare}% 之间`, 'system'); return; }
    const cost = Math.floor(totalPrice * share / 100);
    if (currentMoney < cost) { addChatMessage('❌ 金钱不足', 'system'); return; }
    currentMoney -= cost;
    ownedInvestments.add(cell.id);
    investmentShares.set(cell.id, share);
    actionUsedThisTurn = true;
    addAchievementProgress('invest_3', 1);
    addAchievementProgress('invest_10', 1);
    addChatMessage(`✅ 合租投资 ${cName(cell)}！持有 ${share}% 股份`, 'system');
    modal.remove();
    updateTopBar();
    updateTeamPanel();
    updateActionPanel();
  });
  modal.querySelector('#btn-cancel-coinvest')!.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}

function handleTransport(): void {
  if (!mapIndex || actionUsedThisTurn) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell || cType(cell) !== 'transport') return;
  let cost = cTransportCost(cell);
  if (isTalentActive('transport_discount')) {
    cost = Math.floor(cost * 0.7);
  }
  if (currentMoney < cost) { addChatMessage('❌ 金钱不足，无法传送', 'system'); return; }

  const transports = mapIndex.getAll().filter(c => cType(c) === 'transport' && c.id !== cell.id);
  if (transports.length === 0) {
    addChatMessage('❌ 没有其他交通枢纽可传送', 'system');
    return;
  }

  showTransportModal(cell, cost, transports);
}

function showTransportModal(fromCell: Cell, cost: number, destinations: Cell[]): void {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';

  const content = document.createElement('div');
  content.className = 'modal-content';
  content.innerHTML = `
    <div class="modal-header">
      <h3>🚇 ${cName(fromCell)} - 选择目的地</h3>
    </div>
    <div class="modal-body">
      <div class="transport-cost">
        <span class="transport-cost-label">传送费用</span>
        <span class="transport-cost-value">💰 ${cost} 元</span>
        ${isTalentActive('transport_discount') ? '<span class="transport-discount">（交通折扣-30%）</span>' : ''}
      </div>
      <div class="transport-list">
        ${destinations.map(dest => `
          <div class="transport-item" data-id="${dest.id}">
            <span class="transport-icon">${cIcon(dest)}</span>
            <span class="transport-name">${cName(dest)}</span>
            <span class="transport-distance">距离 ${Math.abs(dest.x - fromCell.x) + Math.abs(dest.y - fromCell.y)} 格</span>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  content.querySelectorAll('.transport-item').forEach(el => {
    el.addEventListener('click', () => {
      const targetId = parseInt(el.getAttribute('data-id') || '0', 10);
      const target = mapIndex?.getById(targetId);
      if (!target) return;

      currentMoney -= cost;
      currentPlayerPosition = target.id;
(window as any).currentPlayerPosition = currentPlayerPosition;
      playerDisplayX = target.x;
      playerDisplayY = target.y;
      cameraTargetX = target.x;
      cameraTargetY = target.y;
      actionUsedThisTurn = true;
      addAchievementProgress('transport_5', 1);

      addChatMessage(`🚇 传送到 ${cName(target)}！${isTalentActive('transport_discount') ? '（交通折扣-30%）' : ''}`, 'system');
      updateTopBar();
      updateTeamPanel();
      updateActionPanel();

      modal.remove();
    });
  });
}

function handleRestoreMonument(): void {
  if (!mapIndex || actionUsedThisTurn) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell || cType(cell) !== 'monument') return;
  const cost = cMonumentCost(cell);
  if (currentMoney < cost) { addChatMessage('❌ 金钱不足，无法修缮', 'system'); return; }

  currentMoney -= cost;
  const creditGain = isTalentActive('monument_master') ? 15 : 10;
  currentCredit = Math.min(100, currentCredit + creditGain);
  actionUsedThisTurn = true;
  addAchievementProgress('monument_1', 1);
  addAchievementProgress('monument_5', 1);

  addChatMessage(`🗿 修缮纪念碑！信用值+${creditGain}`, 'system');
  updateTopBar();
  updateTeamPanel();
  updateActionPanel();
}

function handleBankruptRestart(): void {
  if (!isBankrupt || !mapIndex) return;

  // 记录破产前的天赋和成就数据
  const savedActiveTalents = new Set(activeTalents);
  const savedAvailableTP = availableTP;
  const savedTalentsLocked = talentsLocked;
  const savedAchievements = achievements.map(a => ({ ...a }));

  currentPlayerPosition = 0;
(window as any).currentPlayerPosition = currentPlayerPosition;
  currentMoney = 2000;
  currentCredit = 50;
  currentEnv = 0;
  isBankrupt = false;
  actionUsedThisTurn = false;
  canRoll = true;
  isInJail = false;
  previousCellId = -1;
  loanAmount = 0;

  // 恢复天赋和成就数据（保留）
  activeTalents = savedActiveTalents;
  availableTP = savedAvailableTP;
  talentsLocked = savedTalentsLocked;
  achievements = savedAchievements;

  const startCell = mapIndex.getById(0);
  if (startCell) {
    playerDisplayX = startCell.x;
    playerDisplayY = startCell.y;
    cameraTargetX = startCell.x;
    cameraTargetY = startCell.y;
  }
  centerCameraOnCell(0);

  if (rollBtn) {
    rollBtn.disabled = false;
    rollBtn.classList.remove('disabled');
    rollBtn.textContent = '掷骰子';
  }

  // 保存进度（包括保留的天赋和成就）
  savePlayerProgress();

  addChatMessage('🔄 重新开始！获得启动资金 2000 元，天赋和成就已保留', 'system');
  updateTopBar();
  updateTeamPanel();
  updateActionPanel();
}

// ===== Bank System =====
function showBankModal(): void {
  if (!isTalentActive('bank')) {
    addChatMessage('❌ 银行系统未启用', 'system');
    return;
  }

  const maxLoan = getMaxLoanAmount();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">🏦 银行</div>
      <div class="modal-body">
        <div class="bank-info">
          <div>💰 当前余额: ${currentMoney} 元</div>
          <div>⭐ 信用值: ${currentCredit}</div>
          <div>📊 当前贷款: ${loanAmount} 元</div>
          <div>📈 贷款利率: ${(loanInterestRate * 100).toFixed(0)}%</div>
          <div>💵 可贷款额度: ${maxLoan} 元</div>
        </div>
        <div class="input-section">
          <label class="input-label">贷款金额（最多 ${maxLoan} 元）</label>
          <div class="input-row">
            <input type="number" id="loan-amount" class="amount-input" min="0" max="${maxLoan}" value="${Math.min(500, maxLoan)}" />
            <button class="modal-btn btn-primary" id="btn-loan">贷款</button>
          </div>
        </div>
        <div class="input-section">
          <label class="input-label">还款金额（当前贷款 ${loanAmount} 元）</label>
          <div class="input-row">
            <input type="number" id="repay-amount" class="amount-input" min="0" max="${loanAmount}" value="${Math.min(loanAmount, currentMoney)}" ${loanAmount === 0 ? 'disabled' : ''} />
            <button class="modal-btn btn-secondary" id="btn-repay" ${loanAmount === 0 ? 'disabled' : ''}>还款</button>
          </div>
          <div class="input-hint" id="repay-hint"></div>
        </div>
        <button class="modal-btn btn-cancel" id="btn-bank-close">关闭</button>
      </div>
    </div>
  `;

  const loanInput = modal.querySelector('#loan-amount') as HTMLInputElement;
  const repayInput = modal.querySelector('#repay-amount') as HTMLInputElement;
  const repayHint = modal.querySelector('#repay-hint') as HTMLElement;

  const updateRepayHint = (): void => {
    const v = parseInt(repayInput.value) || 0;
    if (v > 0 && loanAmount > 0) {
      const interest = Math.floor(v * loanInterestRate);
      repayHint.textContent = `本金 ${v} + 利息 ${interest} = 共需 ${v + interest} 元`;
    } else {
      repayHint.textContent = '';
    }
  };
  repayInput.addEventListener('input', updateRepayHint);
  updateRepayHint();

  modal.querySelector('#btn-loan')!.addEventListener('click', () => {
    const amount = parseInt(loanInput.value) || 0;
    if (amount <= 0) { addChatMessage('❌ 请输入有效金额', 'system'); return; }
    if (amount > maxLoan) { addChatMessage(`❌ 超出可贷款额度（最多 ${maxLoan} 元）`, 'system'); return; }
    currentMoney += amount;
    loanAmount += amount;
    currentCredit = Math.max(0, currentCredit - 5);
    addChatMessage(`🏦 贷款 ${amount} 元！信用值-5`, 'system');
    modal.remove();
    updateTopBar();
    updateActionPanel();
  });

  modal.querySelector('#btn-repay')!.addEventListener('click', () => {
    const amount = parseInt(repayInput.value) || 0;
    if (amount <= 0) { addChatMessage('❌ 请输入有效金额', 'system'); return; }
    if (amount > loanAmount) { addChatMessage(`❌ 超出当前贷款（${loanAmount} 元）`, 'system'); return; }
    const interest = Math.floor(amount * loanInterestRate);
    const totalRepay = amount + interest;
    if (currentMoney < totalRepay) { addChatMessage(`❌ 资金不足（需 ${totalRepay} 元，含利息 ${interest} 元）`, 'system'); return; }
    currentMoney -= totalRepay;
    loanAmount -= amount;
    currentCredit = Math.min(100, currentCredit + 2);
    addChatMessage(`🏦 还款 ${amount} 元，利息 ${interest} 元！信用值+2`, 'system');
    modal.remove();
    updateTopBar();
    updateActionPanel();
  });

  modal.querySelector('#btn-bank-close')!.addEventListener('click', () => modal.remove());

  document.body.appendChild(modal);
}

function getMaxLoanAmount(): number {
  if (!isTalentActive('bank')) return 0;
  const baseLimit = currentCredit * 20;
  return Math.max(0, baseLimit - loanAmount);
}

function showSettingsModal(): void {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">⚙️ 设置</div>
      <div class="modal-body">
        <div class="settings-list">
          <button class="modal-btn btn-secondary" onclick="window.resetTutorial()">重新开始教程</button>
          <button class="modal-btn btn-secondary" onclick="window.clearGameData()">清除游戏数据</button>
          <button class="modal-btn btn-secondary" onclick="window.toggleTutorial()">${tutorialActive ? '关闭教程' : '开启教程'}</button>
        </div>
        <div class="settings-info">
          <div>📱 游戏版本: v1.0.0</div>
          <div>🌍 服务器: 本地开发</div>
          <div>🔧 调试模式: ${DEBUG_MODE ? '开启' : '关闭'}</div>
        </div>
        <button class="modal-btn btn-cancel" onclick="this.closest('.modal-overlay').remove()">关闭</button>
      </div>
    </div>
  `;
  
  window.resetTutorial = () => {
    localStorage.removeItem('gameTutorialCompleted');
    addChatMessage('🎓 教程已重置，下次进入游戏将重新显示', 'system');
    modal.remove();
  };
  
  window.clearGameData = () => {
    localStorage.removeItem(`${getAccountKey()}_progress`);
    localStorage.removeItem('gameTutorialCompleted');
    activeTalents.clear();
    availableTP = 0;
    talentsLocked = false;
    totalMoneyEarned = 0;
    for (const ach of achievements) {
      ach.current = 0;
      ach.completed = false;
    }
    addChatMessage('🗑️ 游戏数据已清除', 'system');
    modal.remove();
    updateTopBar();
  };
  
  window.toggleTutorial = () => {
    toggleTutorial();
    modal.remove();
  };
  
  document.body.appendChild(modal);
}

// ===== Talent System =====
function checkTalentSelection(): void {
  // Only allow talent selection at the start cell while not locked
  if (currentPlayerPosition === 0 && !talentsLocked) {
    setTimeout(() => showTalentsModal(true), 500);
  }
}

function buildTalentBranchHtml(branchId: string, branchName: string, branchIcon: string, readOnly: boolean): string {
  const branchTalents = TALENT_DEFS.filter(t => t.branch === branchId);
  const talentHtml = branchTalents.map(t => {
    const active = activeTalents.has(t.id);
    const prereqMet = !t.requires || activeTalents.has(t.requires);
    const canSelect = !readOnly && !active && prereqMet && availableTP >= t.cost;
    const color = RARITY_COLORS[t.rarity] || '#9ca3af';
    const rarityLabel = RARITY_LABELS[t.rarity] || t.rarity;
    const stateClass = active ? 'talent-active' : (prereqMet ? 'talent-available' : 'talent-locked');
    let actionHtml: string;
    if (active) {
      actionHtml = '<div class="talent-status">✅ 已激活</div>';
    } else if (readOnly) {
      actionHtml = '<div class="talent-status">未激活</div>';
    } else if (canSelect) {
      actionHtml = `<button class="talent-select-btn" data-select-id="${t.id}">激活</button>`;
    } else if (!prereqMet) {
      const req = TALENT_DEFS.find(d => d.id === t.requires);
      actionHtml = `<div class="talent-status">需要前置：${req ? req.name : t.requires}</div>`;
    } else {
      actionHtml = '<div class="talent-status">天赋点不足</div>';
    }
    return `
      <div class="talent-item ${stateClass}" style="border-color:${color}" title="${t.description}">
        <div class="talent-name" style="color:${color}">${t.name} <span class="talent-rarity">[${rarityLabel}]</span></div>
        <div class="talent-desc">${t.description}</div>
        <div class="talent-cost">消耗 ${t.cost} TP</div>
        ${actionHtml}
      </div>
    `;
  }).join('');
  return `
    <div class="talent-branch">
      <div class="branch-title">${branchIcon} ${branchName}</div>
      ${talentHtml}
    </div>
  `;
}

function showTalentsModal(force = false): void {
  const readOnly = talentsLocked;
  const spentTP = TALENT_DEFS
    .filter(t => activeTalents.has(t.id))
    .reduce((sum, t) => sum + t.cost, 0);

  const branchesHtml = [
    buildTalentBranchHtml('economy', '经济', '💰', readOnly),
    buildTalentBranchHtml('social', '社交', '👥', readOnly),
    buildTalentBranchHtml('exploration', '探索', '🧭', readOnly),
  ].join('');

  const headerSuffix = readOnly ? '(已锁定)' : (force ? '(起点必选)' : '');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">🎯 天赋树 ${headerSuffix}</div>
      <div class="modal-body">
        ${readOnly ? '<div class="talent-locked-msg">🔒 天赋已锁定，破产重开后可重新选择</div>' : ''}
        <div class="talent-tp-bar">可用天赋点: <strong>${availableTP}</strong> &nbsp;|&nbsp; 已花费: ${spentTP} TP</div>
        <div class="talent-tree">${branchesHtml}</div>
        <div class="modal-actions">
          <button class="modal-btn btn-cancel" id="talent-close">关闭</button>
        </div>
      </div>
    </div>
  `;

  if (!readOnly) {
    modal.querySelectorAll('.talent-select-btn[data-select-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const el = e.currentTarget as HTMLElement;
        const talentId = el.dataset.selectId;
        if (!talentId) return;
        const talent = TALENT_DEFS.find(t => t.id === talentId);
        if (!talent) return;
        if (activeTalents.has(talent.id)) return;
        if (talent.requires && !activeTalents.has(talent.requires)) return;
        if (availableTP < talent.cost) return;
        activeTalents.add(talent.id);
        availableTP -= talent.cost;
        savePlayerProgress();
        addChatMessage(`🎯 激活天赋：${talent.name}！消耗 ${talent.cost} TP`, 'system');
        modal.remove();
        updateTopBar();
        showTalentsModal(force);
      });
    });
  }

  modal.querySelector('#talent-close')!.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}

// ===== Achievement System =====
function showAchievementsModal(): void {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';

  const completed = achievements.filter(a => a.completed).length;
  const total = achievements.length;
  const progressPercent = total > 0 ? Math.floor((completed / total) * 100) : 0;
  const totalTP = calculateTalentPoints();

  const rarityOrder = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'ultimate', 'unique'];
  const grouped: Record<string, AchievementDef[]> = {};
  for (const r of rarityOrder) grouped[r] = [];
  for (const ach of achievements) {
    if (!grouped[ach.rarity]) grouped[ach.rarity] = [];
    grouped[ach.rarity].push(ach);
  }

  const rarityGroupHtml = rarityOrder
    .filter(r => grouped[r].length > 0)
    .map(r => {
      const color = RARITY_COLORS[r] || '#9ca3af';
      const label = RARITY_LABELS[r] || r;
      const itemHtml = grouped[r].map(ach => {
        const progress = Math.min(ach.current, ach.goal);
        const doneMark = ach.completed ? '✓ Done' : '';
        return `
          <div class="ach-item ${ach.completed ? 'ach-done' : ''}" style="border-color:${color}">
            <div class="ach-name" style="color:${color}">${ach.name} <span class="ach-done-mark">${doneMark}</span></div>
            <div class="ach-desc">${ach.description}</div>
            <div class="ach-progress">进度: ${progress} / ${ach.goal}</div>
            <div class="ach-reward">奖励: ${ach.tpReward} TP</div>
          </div>
        `;
      }).join('');
      return `
        <div class="ach-rarity-group">
          <div class="ach-rarity-title" style="color:${color}">${label}</div>
          ${itemHtml}
        </div>
      `;
    }).join('');

  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">🏆 成就</div>
      <div class="modal-body">
        <div class="ach-progress-bar">
          <div class="ach-progress-fill" style="width:${progressPercent}%"></div>
          <span class="ach-progress-text">${completed} / ${total} (${progressPercent}%)</span>
        </div>
        <div class="ach-tp-summary">🎯 已获得天赋点: <strong>${totalTP}</strong> &nbsp;|&nbsp; 可用: ${availableTP}</div>
        <div class="ach-list">${rarityGroupHtml}</div>
        <button class="modal-btn btn-cancel" id="ach-close">关闭</button>
      </div>
    </div>
  `;

  modal.querySelector('#ach-close')!.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}

function calculateTalentPoints(): number {
  return achievements.filter(a => a.completed).reduce((sum, a) => sum + a.tpReward, 0);
}

function updateAchievement(id: string, value: number): void {
  const ach = achievements.find(a => a.id === id);
  if (!ach || ach.completed) return;
  ach.current = Math.max(ach.current, value);
  if (ach.current >= ach.goal) {
    ach.completed = true;
    availableTP += ach.tpReward;
    savePlayerProgress();
    addChatMessage(`🏆 成就完成：${ach.name}！获得 ${ach.tpReward} 天赋点`, 'system');
    updateTopBar();
  }
}

function addAchievementProgress(id: string, delta: number): void {
  const ach = achievements.find(a => a.id === id);
  if (!ach || ach.completed) return;
  ach.current += delta;
  if (ach.current >= ach.goal) {
    ach.completed = true;
    availableTP += ach.tpReward;
    savePlayerProgress();
    addChatMessage(`🏆 成就完成：${ach.name}！获得 ${ach.tpReward} 天赋点`, 'system');
    updateTopBar();
  }
}

function addEarnedMoney(amount: number): void {
  if (amount <= 0) return;
  totalMoneyEarned += amount;
  savePlayerProgress();
  updateAchievement('money_1000', totalMoneyEarned);
  updateAchievement('money_5000', totalMoneyEarned);
  updateAchievement('money_10000', totalMoneyEarned);
}

// ===== Item System =====
function addItem(itemId: string): void {
  const itemMap: Record<string, { name: string; icon: string }> = {
    seal: { name: '查封令', icon: '🔒' },
    revive: { name: '复活令', icon: '🩹' },
  };
  const item = itemMap[itemId];
  if (!item) return;
  const existing = items.find(i => i.id === itemId);
  if (existing) existing.count++;
  else items.push({ id: itemId, ...item, count: 1 });
  updateItemsPanel();
}

window.useItem = function(itemId: string): void {
  const index = items.findIndex(i => i.id === itemId);
  if (index === -1) return;

  // 根据道具类型显示不同的目标选择界面
  switch (itemId) {
    case 'seal':
      showSealItemModal(index);
      break;
    case 'revive':
      showReviveItemModal(index);
      break;
    default:
      addChatMessage(`❌ 未知的道具类型: ${itemId}`, 'system');
  }
}

/**
 * 显示查封令目标选择弹窗
 */
function showSealItemModal(itemIndex: number): void {
  if (!mapIndex) return;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';

  // 获取所有地产格子作为目标选项
  const propertyCells = mapIndex.getAll().filter(c => cType(c) === 'property');

  const content = document.createElement('div');
  content.className = 'modal-content';
  content.innerHTML = `
    <div class="modal-header">
      <span class="modal-icon">🔒</span>
      <h2 class="modal-title">使用查封令</h2>
    </div>
    <div class="modal-body">
      <div class="seal-info">
        <p class="seal-description">查封令可以禁用目标格子一段时间，使其无法进行任何操作。</p>
        <p class="seal-warning">⚠️ 使用后信用值将降低 5 点</p>
      </div>
      <div class="seal-cell-selection">
        <label class="seal-label">选择目标格子：</label>
        <select class="seal-cell-select" id="seal-cell-select">
          <option value="">-- 请选择格子 --</option>
          ${propertyCells.map(cell => `
            <option value="${cell.id}">${cIcon(cell)} ${cName(cell)} (ID: ${cell.id})${ownedProperties.has(cell.id) ? ' - 你拥有' : ''}</option>
          `).join('')}
        </select>
        <div class="seal-cell-hint">选择要查封的地产格子</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="modal-btn modal-btn-cancel" id="seal-cancel">取消</button>
      <button class="modal-btn modal-btn-confirm" id="seal-confirm" disabled>确认使用</button>
    </div>
    <div class="seal-error" id="seal-error" style="display: none;"></div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  // 绑定事件
  const cellSelect = modal.querySelector('#seal-cell-select') as HTMLSelectElement;
  const confirmBtn = modal.querySelector('#seal-confirm') as HTMLButtonElement;
  const cancelBtn = modal.querySelector('#seal-cancel') as HTMLButtonElement;
  const errorDiv = modal.querySelector('#seal-error') as HTMLElement;

  cellSelect?.addEventListener('change', () => {
    confirmBtn.disabled = !cellSelect.value;
  });

  cancelBtn?.addEventListener('click', () => modal.remove());

  confirmBtn?.addEventListener('click', () => {
    const cellId = parseInt(cellSelect?.value || '', 10);
    if (isNaN(cellId)) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = '❌ 请选择目标格子';
      return;
    }

    // 使用道具
    useSealItem(itemIndex, cellId, modal);
  });

  // 点击遮罩关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

/**
 * 使用查封令道具
 */
function useSealItem(itemIndex: number, cellId: number, modal: HTMLElement): void {
  // 本地模拟使用（暂无服务端连接）
  addChatMessage(`🔒 使用查封令！禁用格子 ${cellId}`, 'system');
  currentCredit = Math.max(0, currentCredit - 5);

  // 更新道具数量
  items[itemIndex].count--;
  if (items[itemIndex].count <= 0) items.splice(itemIndex, 1);

  modal.remove();
  updateItemsPanel();
  updateTopBar();

  // 如果有 socket 连接，发送到服务端
  if (gameSocket) {
    gameSocket.emit('client.useItem', {
      itemId: 'seal',
      targetCellId: cellId,
    }, (result: { ok: boolean; error?: string }) => {
      if (!result.ok) {
        addChatMessage(`❌ 查封令使用失败: ${result.error ?? '未知错误'}`, 'system');
      }
    });
  }
}

/**
 * 显示复活令目标选择弹窗
 */
function showReviveItemModal(itemIndex: number): void {
  // 获取破产玩家列表（从 teamMembers 中筛选）
  const bankruptPlayers = teamMembers.filter(m => m.status === 'bankrupt');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';

  const content = document.createElement('div');
  content.className = 'modal-content';
  content.innerHTML = `
    <div class="modal-header">
      <span class="modal-icon">🩹</span>
      <h2 class="modal-title">使用复活令</h2>
    </div>
    <div class="modal-body">
      <div class="revive-info">
        <p class="revive-description">复活令可以复活破产玩家，使其重新回到游戏中并获得启动资金。</p>
        <p class="revive-bonus">✨ 使用后你的信用值将增加 10 点</p>
      </div>
      <div class="revive-player-selection">
        <label class="revive-label">选择破产玩家：</label>
        <div class="revive-player-list" id="revive-player-list">
          ${bankruptPlayers.length === 0 ? '<div class="revive-no-players">当前没有破产玩家</div>' : ''}
          ${bankruptPlayers.map(player => `
            <div class="revive-player-item" data-player-id="${player.id}">
              <span class="revive-player-name">${player.username}</span>
              <span class="revive-player-status">💔 已破产（余额: ${player.money}）</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="modal-btn modal-btn-cancel" id="revive-cancel">取消</button>
      <button class="modal-btn modal-btn-confirm" id="revive-confirm" disabled>确认使用</button>
    </div>
    <div class="revive-error" id="revive-error" style="display: none;"></div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  // 绑定事件
  const confirmBtn = modal.querySelector('#revive-confirm') as HTMLButtonElement;
  const cancelBtn = modal.querySelector('#revive-cancel') as HTMLButtonElement;
  const errorDiv = modal.querySelector('#revive-error') as HTMLElement;
  let selectedPlayerId: string | null = null;

  // 绑定玩家选择事件
  const playerItems = modal.querySelectorAll('.revive-player-item');
  playerItems.forEach(item => {
    item.addEventListener('click', (e) => {
      playerItems.forEach(i => i.classList.remove('selected'));
      (e.currentTarget as HTMLElement).classList.add('selected');
      selectedPlayerId = (e.currentTarget as HTMLElement).dataset.playerId ?? null;
      if (confirmBtn) confirmBtn.disabled = selectedPlayerId === null;
    });
  });

  cancelBtn?.addEventListener('click', () => modal.remove());

  confirmBtn?.addEventListener('click', () => {
    if (!selectedPlayerId) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = '❌ 请选择破产玩家';
      return;
    }

    // 使用道具
    useReviveItem(itemIndex, selectedPlayerId, modal);
  });

  // 点击遮罩关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

/**
 * 使用复活令道具
 */
function useReviveItem(itemIndex: number, playerId: string, modal: HTMLElement): void {
  // 本地模拟使用（复活自己或队友）
  const targetPlayer = teamMembers.find(m => m.id === playerId);
  if (!targetPlayer) {
    addChatMessage('❌ 破产玩家不存在', 'system');
    modal.remove();
    return;
  }

  addChatMessage(`🩹 使用复活令！复活 ${targetPlayer.username}`, 'system');
  currentCredit = Math.min(100, currentCredit + 10);

  // 复活目标玩家
  targetPlayer.status = 'normal';
  targetPlayer.money = 2000; // 启动资金
  targetPlayer.credit = 50;

  // 如果复活的是自己
  if (playerId === 'player-1') {
    isBankrupt = false;
    canRoll = true;
    currentMoney = 2000;
    currentCredit = Math.min(100, currentCredit + 10);
    currentPlayerPosition = 0;
(window as any).currentPlayerPosition = currentPlayerPosition;

    const startCell = mapIndex?.getById(0);
    if (startCell) {
      playerDisplayX = startCell.x;
      playerDisplayY = startCell.y;
      cameraTargetX = startCell.x;
      cameraTargetY = startCell.y;
    }

    if (rollBtn) {
      rollBtn.disabled = false;
      rollBtn.classList.remove('disabled');
      rollBtn.textContent = '掷骰子';
    }
  }

  // 更新道具数量
  items[itemIndex].count--;
  if (items[itemIndex].count <= 0) items.splice(itemIndex, 1);

  modal.remove();
  updateItemsPanel();
  updateTopBar();
  updateTeamPanel();

  // 如果有 socket 连接，发送到服务端
  if (gameSocket) {
    gameSocket.emit('client.useItem', {
      itemId: 'revive',
      targetPlayerId: playerId,
    }, (result: { ok: boolean; error?: string }) => {
      if (!result.ok) {
        addChatMessage(`❌ 复活令使用失败: ${result.error ?? '未知错误'}`, 'system');
      }
    });
  }
}

// ===== Chat System =====
interface ChatMessage {
  text: string;
  channel: string;
  timestamp: number;
}
let chatHistory: ChatMessage[] = [];

function addChatMessage(msg: string, channel: string = 'system'): void {
  chatHistory.push({ text: msg, channel, timestamp: Date.now() });
  while (chatHistory.length > 100) chatHistory.shift();
  if (!chatBoxEl) return;
  // 只有该频道启用时才显示
  if (!activeChatChannels.has(channel)) return;
  const el = document.createElement('div');
  el.className = 'chat-message';
  el.dataset.channel = channel;
  const chDef = chatChannelDefs.find(c => c.id === channel);
  if (chDef) {
    const tag = document.createElement('span');
    tag.className = 'chat-msg-tag';
    tag.style.color = chDef.color;
    tag.textContent = `[${chDef.label}]`;
    el.appendChild(tag);
    el.appendChild(document.createTextNode(' ' + msg));
  } else {
    el.textContent = msg;
  }
  chatBoxEl.appendChild(el);
  while (chatBoxEl.children.length > 50) {
    chatBoxEl.firstChild?.remove();
  }
  chatBoxEl.scrollTop = chatBoxEl.scrollHeight;
}

function refreshChatMessages(): void {
  if (!chatBoxEl) return;
  chatBoxEl.innerHTML = '';
  for (const m of chatHistory) {
    if (!activeChatChannels.has(m.channel)) continue;
    const el = document.createElement('div');
    el.className = 'chat-message';
    el.dataset.channel = m.channel;
    const chDef = chatChannelDefs.find(c => c.id === m.channel);
    if (chDef) {
      const tag = document.createElement('span');
      tag.className = 'chat-msg-tag';
      tag.style.color = chDef.color;
      tag.textContent = `[${chDef.label}]`;
      el.appendChild(tag);
      el.appendChild(document.createTextNode(' ' + m.text));
    } else {
      el.textContent = m.text;
    }
    chatBoxEl.appendChild(el);
  }
  chatBoxEl.scrollTop = chatBoxEl.scrollHeight;
}

// ===== Team System =====
function initTeam(): void {
  teamMembers = [{
    id: 'player-1',
    username: currentPlayer?.username || '玩家',
    money: currentMoney,
    credit: currentCredit,
    env: currentEnv,
    status: isBankrupt ? 'bankrupt' : (isInJail ? 'jail' : 'normal'),
  }];
}

function updateTeamMembers(): void {
  const self = teamMembers.find(m => m.id === 'player-1');
  if (self) {
    self.money = currentMoney;
    self.credit = currentCredit;
    self.env = currentEnv;
    self.status = isBankrupt ? 'bankrupt' : (isInJail ? 'jail' : 'normal');
  }
}

function leaveTeam(): void {
  if (teamMembers.length <= 1) {
    addChatMessage('❌ 无法离开：你是唯一的队员', 'system');
    return;
  }
  teamMembers = teamMembers.filter(m => m.id !== 'player-1');
  addChatMessage('👤 已离开队伍', 'system');
  updateTeamPanel();
}

window.showTeamInvite = function(): void {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';

  const hasOtherPlayers = otherPlayers.length > 0;

  const playerListHtml = hasOtherPlayers
    ? otherPlayers.map(p => {
        const statusColor = p.status === 'bankrupt' ? '#ef4444' : (p.status === 'jail' ? '#f59e0b' : '#10b981');
        const statusText = p.status === 'bankrupt' ? '破产' : (p.status === 'jail' ? '监狱' : '正常');
        return `
          <div class="management-item">
            <div style="display:flex; flex-direction:column; gap:4px;">
              <span style="font-weight:500;">${p.username}</span>
              <span style="font-size:0.75rem; color:var(--secondary);">💰 ${p.primaryValue} · <span style="color:${statusColor}">${statusText}</span></span>
            </div>
            <button class="modal-btn btn-primary" data-player-id="${p.id}" data-player-name="${p.username}">邀请</button>
          </div>
        `;
      }).join('')
    : `
      <div style="text-align:center; padding:16px 8px; color:var(--secondary); font-size:0.85rem; line-height:1.6;">
        <div style="font-size:2rem; margin-bottom:8px;">🌙</div>
        <div>当前没有其他在线玩家</div>
        <div style="font-size:0.75rem; margin-top:6px; color:var(--secondary);">等待其他玩家加入游戏</div>
      </div>
    `;

  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">👥 邀请队友</div>
      <div class="modal-body">
        <div class="team-management-list" id="invite-player-list">
          ${playerListHtml}
        </div>
        <button class="modal-btn btn-cancel" onclick="this.closest('.modal-overlay').remove()">关闭</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const inviteButtons = modal.querySelectorAll('[data-player-id]');
  inviteButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const playerId = btn.getAttribute('data-player-id') || '';
      const playerName = btn.getAttribute('data-player-name') || '';

      if (gameSocket) {
        gameSocket.emit('client.inviteToTeam', { targetPlayerId: playerId }, (result) => {
          if (result.ok) {
            addChatMessage(`📨 已向 ${playerName} 发送组队邀请`, 'system');
          } else {
            addChatMessage(`❌ 邀请失败: ${result.error || '未知错误'}`, 'system');
          }
        });
      } else {
        const existingMember = teamMembers.find(m => m.id === playerId);
        if (!existingMember) {
          teamMembers.push({
            id: playerId,
            username: playerName,
            money: 2000,
            credit: 50,
            env: 0,
            status: 'normal',
          });
          addChatMessage(`🤝 ${playerName} 加入了队伍（本地模拟）`, 'system');
          updateTeamPanel();
        } else {
          addChatMessage(`❌ ${playerName} 已经在队伍中了`, 'system');
        }
      }

      modal.remove();
    });
  });
}

window.showTeamManagement = function(): void {
  if (teamMembers.length <= 1) {
    addChatMessage('❌ 你目前没有队友', 'system');
    return;
  }
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">👥 队伍管理</div>
      <div class="modal-body">
        <div class="team-management-list">
          ${teamMembers.filter(m => m.id !== 'player-1').map(m => `
            <div class="management-item">
              <span>${m.username}</span>
              <button class="modal-btn btn-secondary" onclick="window.removeTeamMember('${m.id}')">移除</button>
            </div>
          `).join('')}
        </div>
        <button class="modal-btn btn-danger" onclick="window.leaveTeam()">离开队伍</button>
        <button class="modal-btn btn-cancel" onclick="this.closest('.modal-overlay').remove()">关闭</button>
      </div>
    </div>
  `;
  
  window.removeTeamMember = (memberId: string) => {
    const member = teamMembers.find(m => m.id === memberId);
    if (member) {
      teamMembers = teamMembers.filter(m => m.id !== memberId);
      addChatMessage(`👤 ${member.username} 已被移出队伍`, 'system');
      modal.remove();
      updateTeamPanel();
    }
  };
  
  window.leaveTeam = () => {
    leaveTeam();
    modal.remove();
  };
  
  document.body.appendChild(modal);
}

// ===== Tutorial System =====
function startTutorial(): void {
  const hasCompletedTutorial = localStorage.getItem('gameTutorialCompleted');
  if (hasCompletedTutorial) {
    return;
  }
  
  tutorialStep = 0;
  tutorialActive = true;
  showTutorialStep();
}

function showTutorialStep(): void {
  if (tutorialStep >= tutorialSteps.length) {
    endTutorial();
    return;
  }
  
  const step = tutorialSteps[tutorialStep];
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal tutorial-modal">
      <div class="modal-header">${step.title}</div>
      <div class="modal-body">
        <div class="tutorial-content">${step.content}</div>
        <div class="tutorial-progress">
          <span>${tutorialStep + 1}/${tutorialSteps.length}</span>
        </div>
        <div class="modal-actions">
          ${tutorialStep > 0 ? '<button class="modal-btn btn-secondary" onclick="window.prevTutorialStep()">上一步</button>' : ''}
          <button class="modal-btn btn-primary" onclick="window.nextTutorialStep()">下一步</button>
          <button class="modal-btn btn-cancel" onclick="window.endTutorial()">跳过</button>
        </div>
      </div>
    </div>
  `;
  
  window.nextTutorialStep = () => {
    modal.remove();
    tutorialStep++;
    showTutorialStep();
  };
  
  window.prevTutorialStep = () => {
    modal.remove();
    tutorialStep--;
    showTutorialStep();
  };
  
  window.endTutorial = () => {
    modal.remove();
    endTutorial();
  };
  
  document.body.appendChild(modal);
}

function endTutorial(): void {
  tutorialActive = false;
  localStorage.setItem('gameTutorialCompleted', 'true');
  addChatMessage('🎓 新手引导完成！现在可以自由探索游戏了', 'system');
}

function toggleTutorial(): void {
  if (tutorialActive) {
    const overlay = document.querySelector('.modal-overlay');
    overlay?.remove();
    tutorialActive = false;
  } else {
    tutorialStep = 0;
    tutorialActive = true;
    showTutorialStep();
  }
}

// ===== UI Updates =====
function updateTopBarTime(): void {
  const tz = getPlayerTimezone();
  const { isDay, timeStr } = getLocalDayNight(tz);

  const timeEl = document.getElementById('topbar-time');
  const tzEl = document.getElementById('topbar-tz');
  const timeIconEl = document.querySelector('.pib-time-icon');

  if (timeEl) timeEl.textContent = timeStr;
  if (tzEl) tzEl.textContent = tz;
  if (timeIconEl) timeIconEl.textContent = isDay ? '☀️' : '🌙';
}

function updateTopBar(): void {
  // 更新天赋角标（0 时隐藏）
  if (topBarTalentsEl) {
    topBarTalentsEl.textContent = String(availableTP);
    topBarTalentsEl.style.display = availableTP > 0 ? '' : 'none';
  }

  // 更新玩家名显示
  const usernameEl = document.getElementById('pib-username');
  if (usernameEl) usernameEl.textContent = currentPlayerName;

  // 更新时间显示
  updateTopBarTime();

  // 更新区域名称
  const regionNameEl = document.getElementById('pib-region-name');
  const currentRegion = getRegionByCellId(currentPlayerPosition);
  if (regionNameEl) {
    regionNameEl.textContent = currentRegion ? currentRegion.name : '未知区域';
  }

  // 更新繁荣度
  const currentProsperity = getCurrentRegionProsperity();
  if (topBarProsperityEl) topBarProsperityEl.textContent = String(currentProsperity);
  if (topBarProsperityFillEl) topBarProsperityFillEl.style.width = `${Math.min(100, Math.max(0, currentProsperity))}%`;

  // 动态渲染区域数值字段（繁荣度已在上方显示，此处渲染其他区域字段）
  if (topBarRegionFieldsEl) {
    const regionFields = valueFieldDefs.filter(f => f.scope === 'region' && f.id !== 'prosperity');
    if (regionFields.length > 0) {
      topBarRegionFieldsEl.innerHTML = regionFields.map(f => {
        let val = 0;
        if (f.id === 'environmental' || f.id === 'env') {
          val = currentRegion?.environmentValue ?? getRegionEnvValue(currentPlayerPosition);
        } else if (currentRegion) {
          val = (currentRegion as unknown as Record<string, unknown>)[f.id] as number ?? 0;
        }
        const icon = f.id === 'environmental' || f.id === 'env' ? '🌱' : '📊';
        return `<div class="pib-region-field" title="${f.name}">
          <span class="pib-v-icon">${icon}</span>
          <span class="pib-field-name">${f.name}</span>
          <span class="pib-v-num">${val}</span>
        </div>`;
      }).join('');
    } else if (currentRegion?.environmentValue !== undefined) {
      topBarRegionFieldsEl.innerHTML = `<div class="pib-region-field" title="区域环保值">
        <span class="pib-v-icon">🌱</span>
        <span class="pib-field-name">环保值</span>
        <span class="pib-v-num">${currentRegion.environmentValue}</span>
      </div>`;
    } else {
      const envVal = getRegionEnvValue(currentPlayerPosition);
      topBarRegionFieldsEl.innerHTML = `<div class="pib-region-field" title="区域环保值">
        <span class="pib-v-icon">🌱</span>
        <span class="pib-field-name">环保值</span>
        <span class="pib-v-num">${envVal}</span>
      </div>`;
    }
  }

  // 更新队伍简要显示
  const teamBriefEl = document.getElementById('team-brief');
  if (teamBriefEl) {
    if (teamMembers.length > 1) {
      teamBriefEl.style.display = 'flex';
      teamBriefEl.innerHTML = `<span class="pib-team-icon">👥</span><span class="pib-team-count">${teamMembers.length}</span>`;
    } else {
      teamBriefEl.style.display = 'none';
    }
  }

  // 更新详细面板（如果展开）
  if (detailPanelExpanded) {
    updateDetailPanel();
  }

  // Hide bank button entirely when the bank talent is disabled
  if (bankBtnEl) {
    bankBtnEl.style.display = isTalentActive('bank') ? '' : 'none';
  }
}

function updateTeamPanel(): void {
  if (!teamPanelContentEl) return;
  updateTeamMembers();

  const memberHtml = teamMembers.map(m => {
    const statusColor = m.status === 'bankrupt' ? '#ef4444' : (m.status === 'jail' ? '#f59e0b' : '#10b981');
    const statusBg = m.status === 'bankrupt' ? 'rgba(239,68,68,0.12)' : (m.status === 'jail' ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)');
    const statusText = m.status === 'bankrupt' ? '破产' : (m.status === 'jail' ? '监狱' : '正常');
    const isSelf = m.id === 'player-1';
    return `
      <div class="team-member ${isSelf ? 'tm-self' : ''}">
        <div class="tm-header">
          <span class="tm-name">${m.username}${isSelf ? ' (你)' : ''}</span>
          <span class="tm-status-badge" style="color:${statusColor};background:${statusBg};">${statusText}</span>
        </div>
        <div class="tm-values">
          <div class="tm-value-item" title="金钱">
            <span class="tm-value-icon">💰</span>
            <span class="tm-value-num">${m.money}</span>
          </div>
          <div class="tm-value-item" title="信用值">
            <span class="tm-value-icon">⭐</span>
            <span class="tm-value-num">${m.credit}</span>
          </div>
          <div class="tm-value-item" title="环保值">
            <span class="tm-value-icon">🌱</span>
            <span class="tm-value-num">${m.env}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  teamPanelContentEl.innerHTML = memberHtml;
}

function updateActionPanel(): void {
  if (!actionButtonsEl) return;
  actionButtonsEl.innerHTML = '';

  if (isBankrupt) {
    const btn = document.createElement('button');
    btn.className = 'action-btn action-restart';
    btn.textContent = '🔄 返回起点重新开始';
    btn.title = '破产后返回起点重新开始游戏';
    btn.addEventListener('click', handleBankruptRestart);
    actionButtonsEl.appendChild(btn);
    return;
  }

  if (!mapIndex || isMoving) return;
  const cell = mapIndex.getById(currentPlayerPosition);
  if (!cell) return;
  const type = cType(cell);

  if (type === 'property' && !actionUsedThisTurn) {
    const isOwned = ownedProperties.has(cell.id);
    const level = propertyLevels.get(cell.id) || 0;

    if (!isOwned && currentMoney >= cPrice(cell)) {
      const btn = document.createElement('button');
      btn.className = 'action-btn action-buy';
      btn.textContent = `💰 购买 (${cPrice(cell)}元)`;
      btn.title = `购买此处地产，花费${cPrice(cell)}元`;
      btn.addEventListener('click', handleBuyProperty);
      actionButtonsEl.appendChild(btn);
    } else if (isOwned && level < 4) {
      const cost = cUpgradeCost(cell)[level] || 0;
      if (currentMoney >= cost) {
        const btn = document.createElement('button');
        btn.className = 'action-btn action-upgrade';
        btn.textContent = `⬆️ 升级 (${cost}元)`;
        btn.title = `升级地产到${level + 1}级，花费${cost}元`;
        btn.addEventListener('click', handleUpgradeProperty);
        actionButtonsEl.appendChild(btn);
      }
    }
  }

  if (type === 'investment' && !actionUsedThisTurn) {
    if (!ownedInvestments.has(cell.id)) {
      const fullPrice = cPrice(cell);
      const halfPrice = Math.floor(fullPrice / 2);
      
      if (currentMoney >= fullPrice) {
        const btn = document.createElement('button');
        btn.className = 'action-btn action-buy';
        btn.textContent = `💰 全额投资 (${fullPrice}元)`;
        btn.title = `全额购买此投资项目，花费${fullPrice}元`;
        btn.addEventListener('click', handleBuyInvestment);
        actionButtonsEl.appendChild(btn);
      }

      if (currentMoney >= halfPrice) {
        const btn = document.createElement('button');
        btn.className = 'action-btn action-upgrade';
        btn.textContent = `🤝 合租投资 (${halfPrice}元)`;
        btn.title = `与他人合租此投资项目，花费${halfPrice}元`;
        btn.addEventListener('click', handleCoInvest);
        actionButtonsEl.appendChild(btn);
      }
    }
  }

  if (type === 'transport' && !actionUsedThisTurn) {
    const cost = cTransportCost(cell);
    if (currentMoney >= cost) {
      const btn = document.createElement('button');
      btn.className = 'action-btn action-upgrade';
      btn.textContent = `🚇 传送 (${cost}元)`;
      btn.title = `传送到另一个交通枢纽，花费${cost}元`;
      btn.addEventListener('click', handleTransport);
      actionButtonsEl.appendChild(btn);
    }
  }

  if (type === 'monument' && !actionUsedThisTurn) {
    const cost = cMonumentCost(cell);
    if (currentMoney >= cost) {
      const btn = document.createElement('button');
      btn.className = 'action-btn action-buy';
      btn.textContent = `🗿 修缮 (${cost}元)`;
      btn.title = `修缮纪念碑增加信用值，花费${cost}元`;
      btn.addEventListener('click', handleRestoreMonument);
      actionButtonsEl.appendChild(btn);
    }
  }
}

function updateItemsPanel(): void {
  if (!itemsPanelEl) return;
  if (items.length === 0) {
    itemsPanelEl.innerHTML = '<div class="no-items">无道具</div>';
    return;
  }
  itemsPanelEl.innerHTML = items.map(item => `
    <div class="item-item" title="点击使用 ${item.name}" onclick="window.useItem('${item.id}')">
      <span class="item-icon">${item.icon}</span>
      <span class="item-name">${item.name}</span>
      <span class="item-count">x${item.count}</span>
    </div>
  `).join('');
}

// ===== Hover Card =====
function showHoverCard(cell: Cell, clientX: number, clientY: number): void {
  if (!hoverCardEl) return;
  const name = cName(cell);
  const icon = cIcon(cell);
  const type = cType(cell);
  const price = cPrice(cell);
  const rent = cRent(cell);
  const desc = cDesc(cell);
  const effects = cEffects(cell);

  const timezone = getExtra<string>(cell, 'timezone', '');

  let html = `<div class="hc-title">${icon} ${name}</div>`;
  html += `<div class="hc-type">${getCellTypeName(type)}</div>`;
  if (timezone) {
    html += `<div class="hc-tz">🌐 ${timezone}</div>`;
  }

  // 区域数值显示（分离显示，不混入队伍数值）
  if (type !== 'start' && type !== 'jail') {
    const cellEnvValue = getCellEnvValue(cell);
    html += `<div class="hc-region-stats">
      <div class="hc-region-header">📍 区域数值</div>
      <div class="hc-region-item">🌱 环保: ${cellEnvValue >= 0 ? '+' : ''}${cellEnvValue}</div>
      <div class="hc-region-item">✨ 繁荣: ${getCurrentRegionProsperity()}%</div>
    </div>`;
  }

  if (desc.length > 0) html += `<div class="hc-desc">${desc.join('<br>')}</div>`;
  if (type === 'property') {
    html += `<div class="hc-price">💰 ${price} 元</div>`;
    if (rent.length > 0) html += `<div class="hc-rent">租金: ${rent.join(' / ')}</div>`;
    if (ownedProperties.has(cell.id)) {
      const level = propertyLevels.get(cell.id) || 0;
      html += `<div class="hc-owned">✅ 等级 ${level}/4</div>`;
    }
  }
  if (type === 'investment') {
    html += `<div class="hc-price">💰 ${price} 元</div>`;
    html += `<div class="hc-rent">收益: ${cInvestmentReturn(cell)} 元/次</div>`;
    if (ownedInvestments.has(cell.id)) {
      html += `<div class="hc-owned">✅ 持有 ${investmentShares.get(cell.id) || 0}% 股份</div>`;
    }
  }
  if (type === 'transport') {
    html += `<div class="hc-price">🚇 传送费用: ${cTransportCost(cell)} 元</div>`;
  }
  if (type === 'monument') {
    html += `<div class="hc-price">🗿 修缮费用: ${cMonumentCost(cell)} 元</div>`;
  }
  if (effects.length > 0) html += `<div class="hc-effects">✨ ${effects.join(', ')}</div>`;

  hoverCardEl.innerHTML = html;
  hoverCardEl.style.display = 'block';

  const cardWidth = 220;
  const cardHeight = hoverCardEl.offsetHeight || 100;
  let x = clientX + 15;
  let y = clientY + 15;
  if (x + cardWidth > window.innerWidth) x = clientX - cardWidth - 15;
  if (y + cardHeight > window.innerHeight) y = clientY - cardHeight - 15;
  hoverCardEl.style.left = `${x}px`;
  hoverCardEl.style.top = `${y}px`;
}

function hideHoverCard(): void {
  if (hoverCardEl) hoverCardEl.style.display = 'none';
}

// ===== Canvas Events =====
function handleMouseMove(e: MouseEvent): void {
  if (!renderer || !mapIndex) return;

  const { x, y } = getCanvasCoords(e);
  const cellId = renderer.hitTest(x, y);
  if (cellId !== null) {
    const cell = mapIndex.getById(cellId);
    if (cell) {
      showHoverCard(cell, e.clientX, e.clientY);
      return;
    }
  }
  hideHoverCard();
}

function handleClick(e: MouseEvent): void {
  if (!renderer || !mapIndex) return;
  const { x, y } = getCanvasCoords(e);
  const cellId = renderer.hitTest(x, y);
  if (cellId !== null) {
    const cell = mapIndex.getById(cellId);
    if (cell && cType(cell) === 'transport') {
      handleTransport();
    }
  }
}

function handleMouseLeave(): void {
  hideHoverCard();
}

// ===== Utilities =====
function centerCameraOnCell(cellId: number): void {
  if (!renderer || !mapIndex) return;
  const cell = mapIndex.getById(cellId);
  if (!cell) return;
  renderer.centerOn(cell.x, cell.y);
  cameraTargetX = cell.x;
  cameraTargetY = cell.y;
}

function handleResize(): void {
  renderer?.resize(window.innerWidth, window.innerHeight);
}

// ===== Cleanup =====
export function cleanupGamePage(page: HTMLElement): void {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (rollCooldownTimer) {
    clearInterval(rollCooldownTimer);
    rollCooldownTimer = null;
  }
  if (prosperityTimer) {
    clearInterval(prosperityTimer);
    prosperityTimer = null;
  }
  hideIntersectionChoice();
  // 清理 socket 监听器
  if (gameSocket) {
    gameSocket.off('server.dayNightProgress');
    gameSocket.off('server.dayNightChanged');
    gameSocket.off('server.pong');
    gameSocket.off('server.chat');
    gameSocket.off('server.playerJoined');
    gameSocket.off('server.playerLeft');
    gameSocket.off('server.playerMoved');
    gameSocket.off('server.valueChanged');
    gameSocket.off('server.playerStatusChanged');
    gameSocket = null;
  }
  renderer = null;
  mapIndex = null;
  currentPlayer = null;
  canvasEl = null;
  rollBtn = null;
  diceDisplayEl = null;
  actionButtonsEl = null;
  chatBoxEl = null;
  hoverCardEl = null;
  topBarTalentsEl = null;
  topBarProsperityEl = null;
  topBarProsperityFillEl = null;
  topBarRegionFieldsEl = null;
  topBarTimeEl = null;
  bankBtnEl = null;
  teamPanelContentEl = null;
  chatChannelContainer = null;
  itemsPanelEl = null;
  isMoving = false;
  canRoll = true;
  isBankrupt = false;
  actionUsedThisTurn = false;
  diceAnimating = false;
  isWaitingForChoice = false;
  isInJail = false;
  otherPlayers = [];
  ownedProperties.clear();
  propertyLevels.clear();
  ownedInvestments.clear();
  investmentShares.clear();
  items = [];
  currentMoney = 2000;
  currentCredit = 50;
  currentEnv = 0;
  currentPlayerPosition = 0;
(window as any).currentPlayerPosition = currentPlayerPosition;
  loanAmount = 0;
  prosperity = 100;
  lastPlayerTimezone = '';
  lastLocalIsDay = null;
  dayNightStartTime = Date.now();
  serverTimeOffset = 0;
  DAY_NIGHT_CYCLE = 15 * 60 * 1000;
  teamMembers = [];
  activeTalents.clear();
  availableTP = 0;
  talentsLocked = false;
  totalMoneyEarned = 0;
  for (const ach of achievements) {
    ach.current = 0;
    ach.completed = false;
  }
  page.remove();
}

export function getRenderer(): BoardRenderer | null { return renderer; }