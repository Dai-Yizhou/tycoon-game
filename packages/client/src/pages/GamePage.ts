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
import type { MapData, Player } from '@game/shared';
import { MapIndex, t } from '@game/shared';
import { BoardRenderer } from '../board/board-renderer.js';
import { createNotificationCenter, type NotificationCenter } from '../components/NotificationCenter.js';
import type { TopBarComponent } from '../components/TopBarComponent.js';
import { ActionBarComponent } from '../components/ActionBarComponent.js';
import { GameHudShell } from '../components/GameHudShell.js';
import { NoOpEffectHooks } from '../game/GameEffects.js';
import { GameViewModel } from '../game/GameViewModel.js';

import {
  achievements,
  activeTalents, animationFrameId,
  currentPlayer, currentPlayerPosition, currentPlayerName, currentMoney, currentCredit, currentEnv, isBankrupt, actionUsedThisTurn,
  isMoving, canRoll, isWaitingForChoice, isServerAnimating, isInJail, jailEndTime, dayNightStartTime, DAY_NIGHT_CYCLE, serverTimeOffset,
  gameSocket, investmentShares,
  mapIndex,
  otherPlayers, ownedInvestments, ownedProperties,
  propertyLevels, prosperityTimer,
  regionProsperityMap, renderer,
  rollCooldownTimer, setAchievements,
  setActionUsedThisTurn, setAnimationFrameId, setAvailableTP,
  setBankBtnEl, setCameraTarget, setCanRoll, setCanvasEl, setChatChannelContainer,
  setCurrentCredit, setCurrentEnv, setCurrentMoney, setCurrentPlayer, setCurrentPlayerName,
  setCurrentPlayerPosition, setDayNightCycle, setDayNightStartTime,
  setDiceAnimating, setGameSocket, setIsBankrupt,
  setIsInJail, setIsMoving, setIsWaitingForChoice, setItems, setLastLocalIsDay,
  setLastPlayerTimezone, setLoanAmount, setMapIndex, setMapRegions,
  setOtherPlayers, setPlayerDisplayPos,
  setProsperity, setProsperityTimer, setRenderer, setRollCooldownTimer,
  setServerTimeOffset, setTalentDefs, setTalentsLocked, setTeamMembers, setTeamPanelContentEl,
  setTopBarProsperityEl, setTopBarProsperityFillEl, setTopBarRegionFieldsEl, setTopBarTalentsEl,
  setTopBarTimeEl, setTotalMoneyEarned, setValueFieldDefs,
  // 辅助函数
  // 类型
  type RegionInfo,
  // 额外状态变量
  valueFieldDefs, teamMembers,
  // 额外 setter
  setDiceDisplayEl, setRollBtn, setActionButtonsEl, setChatBoxEl,
} from '../state/GameStore.js';


import {
  loadTalentConfig, loadAchievementConfig, loadPlayerProgress,
} from '../game/systems/ConfigLoader.js';

import {
  normalizeClientMapData,
} from '../game/systems/MapLoader.js';

import {
  applyTeamMembers,
} from '../game/systems/TeamSystem.js';

import {
  startTutorial,
} from '../game/systems/TutorialSystem.js';

import { checkTalentSelection } from '../game/systems/TalentSystem.js';

import {
  addChatMessage,
} from '../game/systems/ChatSystem.js';

import {
  startRenderLoop,
  updateTopBar, updateTeamPanel, updateActionPanel, updateItemsPanel,
  centerCameraOnCell, handleMouseMove, handleClick, handleMouseLeave, handleResize,
} from '../game/systems/UIUpdates.js';

import {
  handleRollDice,
} from '../game/systems/GameLogic.js';

import {
} from '../game/systems/MovementSystem.js';

import { registerSocketHandlers, unregisterSocketHandlers } from '../game/systems/SocketEventHandler.js';
import { DesignAdapter } from '../design/DesignAdapter.js';
import { getThemeTokens } from '../design/ThemeConfig.js';

let notificationCenter: NotificationCenter | null = null;
let gameViewModel: GameViewModel | null = null;
let topBarComponent: TopBarComponent | null = null;
let actionBarComponent: ActionBarComponent | null = null;
let gameHudShell: GameHudShell | null = null;
let viewModelSyncTimer: ReturnType<typeof setInterval> | null = null;

// ===== 入口函数 =====

// ===== Main Entry =====

export function createGamePage(controller: GameController): HTMLElement {
  const container = controller.getContainer();
  const context = controller.getContext();
  const page = document.createElement('div');
  page.className = 'page game-page';
  applyGamePageThemeTokens(page, { tokens: getThemeTokens((globalThis as { __GAME_THEME__?: string }).__GAME_THEME__) });
  gameViewModel = new GameViewModel();
  const effects = new NoOpEffectHooks();

  // Board
  const boardContainer = document.createElement('div');
  boardContainer.className = 'board-container';
  const canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.setAttribute('aria-label', t('game.boardAriaLabel'));
  boardContainer.appendChild(canvas);
  setCanvasEl(canvas);
  page.appendChild(boardContainer);

  setRenderer(new BoardRenderer(canvas));
  renderer!.drawPlaceholder(t('common.loadingMap'));

  // Build isolated HUD layer. Business actions stay in GamePage.
  const backButton = document.createElement('button');
  backButton.className = 'back-button';
  backButton.textContent = '返回';
  backButton.addEventListener('click', () => controller.setState('start'));
  page.appendChild(backButton);
  gameHudShell = new GameHudShell(gameViewModel, effects, {
    onRoll: handleRollDice,
    onBank: () => { window.dispatchEvent(new CustomEvent('game:open-bank')); },
    onChatSend: (message, channel) => {
      if (gameSocket) gameSocket.emit('client.chat', { channel, content: message });
      else addChatMessage(t('chat.you') + message, channel);
    },
  });
  page.appendChild(gameHudShell.getElement());
  syncViewModel();
  viewModelSyncTimer = setInterval(syncViewModel, 100);

  // Init: load configs first, then player progress, then game
  const playerName = context.playerName || t('game.defaultPlayerName');
  setCurrentPlayerName(playerName);
  initMockPlayer(playerName);
  // 用登录返回的真实玩家数据更新 currentPlayer
  if (context.player && context.player.id) {
    currentPlayer!.id = context.player.id;
    currentPlayer!.username = context.player.username || playerName;
    if (context.player.position?.cellId !== undefined) {
      currentPlayer!.position.cellId = context.player.position.cellId;
      setCurrentPlayerPosition(context.player.position.cellId);
      (window as any).currentPlayerPosition = currentPlayerPosition;
    }
    if (context.player.values?.money?.current !== undefined) {
      currentPlayer!.values.money.current = context.player.values.money.current;
      setCurrentMoney(context.player.values.money.current);
    }
    if (context.player.values?.credit?.current !== undefined) {
      currentPlayer!.values.credit.current = context.player.values.credit.current;
    }
  }
  initTeam();

  Promise.all([loadTalentConfig(), loadAchievementConfig(), loadMapData()]).then(
    ([talents, achDefs, mapResult]) => {
      setTalentDefs(talents);
      setAchievements(achDefs);
      loadPlayerProgress();
      if (!renderer || !mapResult) return;
      const { mapData, regions, valueFields } = mapResult;
      setMapRegions(regions);
      setValueFieldDefs(valueFields);
      // 初始化区域繁荣度快照
      for (const r of regions) {
        regionProsperityMap.set(r.id, r.prosperity);
      }
      setMapIndex(new MapIndex(mapData));
      renderer.loadMap(mapData);
      const startCell = mapIndex!.getById(0);
      if (startCell) {
        setPlayerDisplayPos(startCell.x, startCell.y);
        setCameraTarget(startCell.x, startCell.y);
      }
      centerCameraOnCell(0);
      startRenderLoop();
      updateTopBar();
      updateTeamPanel();
      updateActionPanel();
      updateItemsPanel();
      addChatMessage(t('game.welcomeMessage'), 'system');
      checkTalentSelection();
      startTutorial();
    },
  );

  // 从 controller 获取登录时同步的时间数据
  const ctx = controller.getContext();
  if (ctx.cycleStartTime !== null) {
    setDayNightStartTime(ctx.cycleStartTime);
  }
  if (ctx.cycleMinutes !== null) {
    setDayNightCycle(ctx.cycleMinutes * 60 * 1000);
  }

  // 初始化已有玩家列表（登录时服务端返回的其他在线玩家）
  if (ctx.existingPlayers && ctx.existingPlayers.length > 0) {
    const _otherPlayers = ctx.existingPlayers.map(p => ({
      id: p.id,
      username: p.username,
      position: p.position,
      status: p.status || 'normal',
      primaryValue: p.values?.money?.current,
    }));
    setOtherPlayers(_otherPlayers);
  }

  // 监听服务端昼夜事件，同步时间
  const socket = controller.getSocket();
  setGameSocket(socket);
  if (socket) {
    notificationCenter = createNotificationCenter({
      container: page,
      socket,
      playerId: context.player?.id || currentPlayer?.id || '',
    });
    page.appendChild(notificationCenter.getElement());

    registerSocketHandlers(socket);
  }

  // Canvas events - no drag/zoom, only hover and click
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('click', handleClick);
  canvas.addEventListener('mouseleave', handleMouseLeave);
  window.addEventListener('resize', handleResize);

  container.appendChild(page);
  return page;
}

/** 将主题令牌投影到页面根节点，组件只消费 CSS 变量，不读取主题 JSON。 */
export interface GamePageThemeConfig {
  tokens?: Record<string, unknown>;
}

export function applyGamePageThemeTokens(page: HTMLElement, config: GamePageThemeConfig = {}): void {
  const adapter = new DesignAdapter(config.tokens ?? getThemeTokens());
  const snapshot = adapter.createSnapshot('day');
  for (const [name, value] of Object.entries(snapshot.dom)) {
    page.style.setProperty(name, value);
  }
  page.style.setProperty('--gp-map-bg', snapshot.canvas.board.background);
  page.style.setProperty('--gp-accent', adapter.getColor('color.palette.accent'));
  page.style.setProperty('--gp-border', adapter.getColor('color.palette.border'));
  page.style.setProperty('--gp-fg', adapter.getColor('color.palette.ink'));
}

// ===== UI Builders =====

/**
 * 构建左侧玩家信息条（参考florr.io设计）
 * 紧凑、条状，不占太多屏幕空间
 */

// ===== Player Init =====

function initMockPlayer(name: string): void {
  const _player: Player = {
    id: 'player-1',
    username: name,
    teamId: null,
    position: { cellId: 0 },
    values: {
      money: { id: 'money', name: t('hud.money'), current: 2000, min: 0 },
      credit: { id: 'credit', name: t('hud.credit'), current: 50, min: 0, max: 100 },
      env: { id: 'env', name: t('hud.env'), current: 0, min: 0 },
    },
    items: [],
    status: 'normal',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  setCurrentPlayer(_player);
  setCurrentMoney(2000);
  setCurrentCredit(50);
  setCurrentEnv(0);
  setCurrentPlayerPosition(0);
(window as any).currentPlayerPosition = currentPlayerPosition;
  setIsBankrupt(false);
  setIsInJail(false);
  setActionUsedThisTurn(false);
  setItems([]);
  setLoanAmount(0);
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

function hideIntersectionChoice(): void {
  document.getElementById('intersection-choice')?.remove();
}

function initTeam(): void {
  setTeamMembers([]);
  // 向服务端查询当前队伍状态（若已组队则服务端返回完整成员显示数据）
  if (gameSocket) {
    gameSocket.emit('client.getTeamState', {}, (result) => {
      if (result.ok && result.data) {
        applyTeamMembers(result.data.members);
        if (result.data.team && currentPlayer) {
          currentPlayer.teamId = result.data.team.id;
        }
        updateTeamPanel();
      }
    });
  }
}

/**
 * 应用服务端推送的队伍成员视图，完整重建本地 teamMembers
 *
 * 这是唯一允许修改 teamMembers 的入口，确保本地状态始终来自服务端权威数据。
 */

function leaveTeam(): void {
  if (!gameSocket) {
    addChatMessage(t('team.noConnectionLeave'), 'system');
    return;
  }
  gameSocket.emit('client.leaveTeam', {}, (result) => {
    if (result.ok) {
      addChatMessage(t('team.leftTeam'), 'system');
      // 本地状态由 server.teamMemberLeft / server.teamDisbanded 事件更新
    } else {
      addChatMessage(t('team.leaveFailed', { error: result.error || t('common.unknownError') }), 'system');
    }
  });
}

window.showTeamInvite = function(): void {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';

  const hasOtherPlayers = otherPlayers.length > 0;

  const playerListHtml = hasOtherPlayers
    ? otherPlayers.map(p => {
        const statusColor = p.status === 'bankrupt' ? '#ef4444' : (p.status === 'jail' ? '#f59e0b' : '#10b981');
        const statusText = p.status === 'bankrupt' ? t('hud.bankrupt') : (p.status === 'jail' ? t('hud.inJail') : t('hud.normal'));
        return `
          <div class="management-item">
            <div style="display:flex; flex-direction:column; gap:4px;">
              <span style="font-weight:500;">${p.username}</span>
              <span style="font-size:0.75rem; color:var(--secondary);">💰 ${p.primaryValue} · <span style="color:${statusColor}">${statusText}</span></span>
            </div>
            <button class="modal-btn btn-primary" data-player-id="${p.id}" data-player-name="${p.username}">${t('team.invite')}</button>
          </div>
        `;
      }).join('')
    : `
      <div style="text-align:center; padding:16px 8px; color:var(--secondary); font-size:0.85rem; line-height:1.6;">
        <div style="font-size:2rem; margin-bottom:8px;">🌙</div>
        <div>${t('team.noOtherPlayers')}</div>
        <div style="font-size:0.75rem; margin-top:6px; color:var(--secondary);">${t('team.waitingForPlayers')}</div>
      </div>
    `;

  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">${t('team.invitePlayersTitle')}</div>
      <div class="modal-body">
        <div class="team-management-list" id="invite-player-list">
          ${playerListHtml}
        </div>
        <button class="modal-btn btn-cancel" onclick="this.closest('.modal-overlay').remove()">${t('common.close')}</button>
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
            addChatMessage(t('team.inviteSent', { name: playerName }), 'system');
          } else {
            addChatMessage(t('team.inviteError', { error: result.error || t('common.unknownError') }), 'system');
          }
        });
      } else {
        addChatMessage(t('team.noConnection'), 'system');
      }

      modal.remove();
    });
  });
}

window.showTeamManagement = function(): void {
  if (teamMembers.length <= 1) {
    addChatMessage(t('team.noTeammates'), 'system');
    return;
  }
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">${t('team.managementTitle')}</div>
      <div class="modal-body">
        <div class="team-management-list">
          ${teamMembers.filter(m => !currentPlayer || m.id !== currentPlayer.id).map(m => `
            <div class="management-item">
              <span>${m.username}</span>
              <button class="modal-btn btn-secondary" onclick="window.removeTeamMember('${m.id}')">${t('team.removeMember')}</button>
            </div>
          `).join('')}
        </div>
        <button class="modal-btn btn-danger" onclick="window.leaveTeam()">${t('team.leaveTeam')}</button>
        <button class="modal-btn btn-cancel" onclick="this.closest('.modal-overlay').remove()">${t('common.close')}</button>
      </div>
    </div>
  `;
  
  window.removeTeamMember = (memberId: string) => {
    const member = teamMembers.find(m => m.id === memberId);
    if (!member) return;
    if (!gameSocket) {
      addChatMessage(t('team.noConnectionRemove'), 'system');
      return;
    }
    gameSocket.emit('client.kickTeamMember', { targetPlayerId: memberId }, (result) => {
      if (result.ok) {
        // 本地状态由 server.teamMemberKicked 事件更新
        modal.remove();
      } else {
        addChatMessage(t('team.removeFailed', { error: result.error || t('common.unknownError') }), 'system');
      }
    });
  };
  
  window.leaveTeam = () => {
    leaveTeam();
    modal.remove();
  };
  
  document.body.appendChild(modal);
}


function syncViewModel(): void {
  if (!gameViewModel) return;
  gameViewModel.setPlayer({ currentPlayer, currentPlayerPosition, currentMoney, currentCredit, currentEnv, isBankrupt, actionUsedThisTurn, ownedProperties, propertyLevels, ownedInvestments, investmentShares, currentPlayerName });
  gameViewModel.setMovement({ isMoving, canRoll, isWaitingForChoice, isServerAnimating });
  gameViewModel.setJail({ isInJail, jailEndTime });
  gameViewModel.setTeam({ members: teamMembers.map((member) => ({ ...member, status: member.status as 'normal' | 'bankrupt' | 'jail' })) });
  gameViewModel.setDayNight({ cycleStartTime: dayNightStartTime, cycleDuration: DAY_NIGHT_CYCLE, serverTimeOffset });
}

// ===== Tutorial System =====

export function cleanupGamePage(page: HTMLElement): void {
  if (viewModelSyncTimer) {
    clearInterval(viewModelSyncTimer);
    viewModelSyncTimer = null;
  }
  gameHudShell?.destroy();
  gameHudShell = null;
  actionBarComponent?.destroy();
  topBarComponent?.destroy();
  actionBarComponent = null;
  topBarComponent = null;
  gameViewModel = null;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    setAnimationFrameId(null);
  }
  if (rollCooldownTimer) {
    clearInterval(rollCooldownTimer);
    setRollCooldownTimer(null);
  }
  if (prosperityTimer) {
    clearInterval(prosperityTimer);
    setProsperityTimer(null);
  }
  hideIntersectionChoice();
  if (notificationCenter) {
    notificationCenter.destroy();
    notificationCenter = null;
  }
  // 清理 socket 监听器
  if (gameSocket) {
    unregisterSocketHandlers(gameSocket);
    setGameSocket(null);
  }
  setRenderer(null);
  setMapIndex(null);
  setCurrentPlayer(null);
  setCanvasEl(null);
  setRollBtn(null);
  setDiceDisplayEl(null);
  setActionButtonsEl(null);
  setChatBoxEl(null);
  setTopBarTalentsEl(null);
  setTopBarProsperityEl(null);
  setTopBarProsperityFillEl(null);
  setTopBarRegionFieldsEl(null);
  setTopBarTimeEl(null);
  setBankBtnEl(null);
  setTeamPanelContentEl(null);
  setChatChannelContainer(null);
  setIsMoving(false);
  setCanRoll(true);
  setIsBankrupt(false);
  setActionUsedThisTurn(false);
  setDiceAnimating(false);
  setIsWaitingForChoice(false);
  setIsInJail(false);
  setOtherPlayers([]);
  ownedProperties.clear();
  propertyLevels.clear();
  ownedInvestments.clear();
  investmentShares.clear();
  setItems([]);
  setCurrentMoney(2000);
  setCurrentCredit(50);
  setCurrentEnv(0);
  setCurrentPlayerPosition(0);
(window as any).currentPlayerPosition = currentPlayerPosition;
  setLoanAmount(0);
  setProsperity(100);
  setLastPlayerTimezone('');
  setLastLocalIsDay(null);
  setDayNightStartTime(Date.now());
  setServerTimeOffset(0);
  setDayNightCycle(15 * 60 * 1000);
  setTeamMembers([]);
  activeTalents.clear();
  setAvailableTP(0);
  setTalentsLocked(false);
  setTotalMoneyEarned(0);
  for (const ach of achievements) {
    ach.current = 0;
    ach.completed = false;
  }
  page.remove();
}

export function getRenderer(): BoardRenderer | null { return renderer; }
