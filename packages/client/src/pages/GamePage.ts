declare global {
  interface Window {
    resetTutorial: () => void;
    clearGameData: () => void;
    toggleTutorial: () => void;
    showTeamInvite: () => void;
    showTeamManagement: () => void;
    leaveTeam: () => void;

    nextTutorialStep: () => void;
    prevTutorialStep: () => void;
    endTutorial: () => void;
  }
}

import type { GameController } from '../game/GameController.js';
import { MapIndex, t } from '@game/shared';
import type { Player } from '@game/shared';
import { GameHudShell } from '../components/GameHudShell.js';
import { InteractiveMapSurface } from '../components/InteractiveMapSurface.js';
import { CssTransitionEffectHooks } from '../game/GameEffects.js';
import type { MovementEffectHooks } from '../game/GameEffects.js';
import { EffectController } from '../game/EffectController.js';
import { GameViewModel } from '../game/GameViewModel.js';
import { GameStore } from '../state/GameStore.js';
import type { TypedClientSocket } from '../hooks/useSocket.js';

import {
  loadMapData,
} from '../game/systems/MapLoader.js';

import {
  addChatMessage, setChatStore,
} from '../game/systems/ChatSystem.js';

import {
  handleRollDice,
  handleBuyProperty, handleUpgradeProperty, handleBuyInvestment, handleCoInvest,
  handleTransport, handleUseTransport, handleRestoreMonument, onPlayerArrived, ensureCooldownRevealTicker, type GameRuntime,
} from '../game/systems/GameLogic.js';

import {
  onIntersectionChoice,
} from '../game/systems/MovementSystem.js';
import { createMovementLoop, browserLoopHost, type MovementLoop } from '../game/systems/MovementLoop.js';

import { registerSocketHandlers, unregisterSocketHandlers } from '../game/systems/SocketEventHandler.js';
import { DesignAdapter } from '../design/DesignAdapter.js';
import { getRegionThemeId, getThemeId, getThemeTokens, SAVED_REGION_THEME_KEY } from '../design/ThemeConfig.js';
import { resolveCellActions } from '../game/cellActionResolver.js';

let gameViewModel: GameViewModel | null = null;
let gameStore: GameStore | null = null;
let gameHudShell: GameHudShell | null = null;
let unsubscribeGameStore: (() => void) | null = null;
let mapIndex: MapIndex | null = null;
let gameSocket: TypedClientSocket | null = null;
let gameEffects: EffectController | null = null;
let gameMovementLoop: MovementLoop | null = null;
// 当前已应用的区域 UI 主题 id；null 表示尚未应用（首次加载）。用于区分"主题切换转场"与"首次加载不转场"。
let appliedRegionThemeId: string | null = null;
const pageEventCleanups = new WeakMap<HTMLElement, () => void>();

function createGameRuntime(store: GameStore, socket: NonNullable<typeof gameSocket>, index: NonNullable<typeof mapIndex>): GameRuntime {
  return { store, socket, mapIndex: index, cooldownTimer: null, onHudRefresh: () => gameHudShell?.update(), onRollCooldownTick: () => gameHudShell?.updateDiceButton() };
}

function invokeGameAction(action: (runtime: GameRuntime) => void): void {
  if (gameStore && gameSocket && mapIndex) action(createGameRuntime(gameStore, gameSocket, mapIndex));
}

function toInteractivePlayers(snapshot: ReturnType<GameStore['getSnapshot']>): Player[] {
  if (!snapshot.currentPlayer) return [];
  const teamId = snapshot.currentPlayer.teamId;
  const teamMemberIds = new Set(snapshot.teamMembers.map(member => member.id));
  return [snapshot.currentPlayer, ...snapshot.otherPlayers.filter(player => player.status !== 'frozen').map(player => ({
    id: player.id,
    username: player.username,
    position: player.position,
    status: player.status as Player['status'],
    values: {},
    teamId: teamMemberIds.has(player.id) ? teamId : null,
    createdAt: 0,
    lastActiveAt: 0,
  }))];
}

export function createGamePage(controller: GameController): HTMLElement {
  const container = controller.getContainer();
  const context = controller.getContext();
  const page = document.createElement('div');
  page.className = 'page game-page';
  const designSnapshot = new DesignAdapter(getThemeTokens()).createSnapshot('day');
  applyGamePageThemeSnapshot(page, designSnapshot);
  gameStore = new GameStore();
  setChatStore(gameStore);
  gameViewModel = new GameViewModel(gameStore, context.playerName || t('game.defaultPlayerName'));
  const effects = new EffectController(new CssTransitionEffectHooks(page));
  gameEffects = effects;
  const movementEffects: MovementEffectHooks = effects;

  // Board
  const boardContainer = document.createElement('div');
  boardContainer.className = 'board-container';
  const interactiveMap = new InteractiveMapSurface();
  boardContainer.appendChild(interactiveMap.getElement());
  const ensureMovementLoop = (): MovementLoop | null => {
    if (gameMovementLoop) return gameMovementLoop;
    if (!gameStore || !gameEffects) return null;
    gameMovementLoop = createMovementLoop(gameStore, browserLoopHost(), {
      getMapIndex: () => mapIndex ?? undefined,
      onArrived: () => invokeGameAction(onPlayerArrived),
      effects: gameEffects,
      onDisplay: (id, x, y) => interactiveMap.setPlayerDisplayPosition(id, x, y),
      onSettled: (id, x, y) => interactiveMap.setPlayerDisplayPosition(id, x, y),
    });
    return gameMovementLoop;
  };
  unsubscribeGameStore = gameStore.subscribe((snapshot) => {
    const players = toInteractivePlayers(snapshot);
    interactiveMap.setMovementLocked(snapshot.isMoving);
    interactiveMap.updatePlayers(players);
    // hover 用权威移动字段定位本玩家所在格（players[0].position 在 serverPath 移动中可能滞后）
    interactiveMap.setSelfCell(snapshot.currentPlayerPosition);
    // 已持股（有股东）格子边框高亮；未持股/不能持股共用默认边框
    const heldCellIds = new Set<number>();
    for (const [cellId, state] of snapshot.cellRuntimeStates) {
      if (state.ownerships.length > 0) heldCellIds.add(cellId);
    }
    interactiveMap.setHeldCells(heldCellIds);
    if (!snapshot.isMoving) interactiveMap.followPlayer(snapshot.currentPlayerPosition);
    syncCellActions(snapshot.currentPlayerPosition);
    if (mapIndex) applyRegionTheme(page, snapshot.currentPlayerPosition);
    const displayPlayer = snapshot.currentPlayer;
    if (displayPlayer && snapshot.isMoving) {
      interactiveMap.setPlayerDisplayPosition(displayPlayer.id, snapshot.playerDisplayX, snapshot.playerDisplayY);
      interactiveMap.followDisplayPosition(snapshot.playerDisplayX, snapshot.playerDisplayY);
    }
    // 移动步进循环由独立、异常安全、可单测的 MovementLoop 驱动。此处仅"确保其运行"：
    // 未运行且 isMoving 为真时才启动（幂等），循环内部自续排，单帧抛错不会被吞成死循环，
    // 从而杜绝"isMoving 卡真、棋子永在不移动"的卡死。
    ensureMovementLoop()?.ensureRunning();
  });
  page.appendChild(boardContainer);


  gameHudShell = new GameHudShell(gameViewModel, effects, {
    effectsEnabled: effects.isEnabled(),
    onEffectsToggle: (enabled) => {
      effects.setEnabled(enabled);
      gameHudShell?.setEffectsEnabled(enabled);
      // 即时反映到掷骰按钮的冷却提示（动效关闭时不再揭示填充动画）
      gameHudShell?.updateDiceButton();
    },
    onBack: () => controller.reset(true),
    onRoll: () => {
      if (gameStore && gameSocket) {
        const index = mapIndex ?? ({ getById: () => undefined } as unknown as MapIndex);
        handleRollDice(createGameRuntime(gameStore, gameSocket, index));
      }
    },
      onPathChoice: (cellId) => {
      if (gameStore && gameSocket) onIntersectionChoice(gameStore, gameSocket, cellId, movementEffects);
      gameStore?.clearPathChoice();
    },
    onCellAction: (actionId, data) => {
      const actions: Record<string, (d?: Record<string, unknown>) => void> = {
        'buy-property': () => invokeGameAction(handleBuyProperty),
        'upgrade-property': () => invokeGameAction(handleUpgradeProperty),
        'buy-investment': () => invokeGameAction(handleBuyInvestment),
        'co-invest': () => invokeGameAction(handleCoInvest),
        transport: (d) => {
          const target = typeof d?.targetCellId === 'number' ? d.targetCellId : undefined;
          if (target !== undefined) invokeGameAction((rt) => handleUseTransport(rt, target));
          else invokeGameAction(handleTransport);
        },
        'restore-monument': () => invokeGameAction(handleRestoreMonument),
      };
      actions[actionId]?.(data);
    },
    onChatSend: (message, channel, onResult) => {
      if (!gameSocket) {
        gameStore?.appendChatMessage({ text: t('chat.noConnection'), channel: 'error', timestamp: Date.now() });
        onResult?.(false);
        return;
      }
      gameSocket.emit('client.chat', { channel, content: message }, (result) => {
        if (!result.ok) {
          gameStore?.appendChatMessage({ text: result.error || t('chat.sendFailed'), channel: 'error', timestamp: Date.now() });
        }
        if (result.ok && (message.startsWith('/team') || message.startsWith('/region') || message.startsWith('/global'))) {
          const target = message.split(' ')[0]?.slice(1);
          if (target) gameHudShell?.setChatChannel(target);
        }
        onResult?.(result.ok);
      });
    },
  });
  page.appendChild(gameHudShell.getElement());

  gameSocket = controller.getSocket();
  if (context.leaderboard) gameStore.setLeaderboard(context.leaderboard);
  // Init: load map data, then start game
  if (context.player && context.player.id) {
    gameStore?.applyEvent({ sequence: gameStore.nextSequence(), type: 'player', player: context.player });
  }
  gameHudShell?.update();
  initTeam();

  Promise.all([loadMapData()]).then(
    ([mapResult]) => {
      if (!mapResult) {
        return;
      }
      const { mapData, regions, timezones } = mapResult;
      // 初始化区域繁荣度快照
      gameStore?.setRegions(regions, mapResult.valueFields, timezones, mapResult.valueModifiers);
      mapIndex = new MapIndex(mapData);
      gameStore?.setCells(mapData);
      const snapshot = gameStore!.getSnapshot();
      if (snapshot.currentPlayer) {
        interactiveMap.render(mapData, toInteractivePlayers(snapshot), mapResult.valueFields.map((field) => ({
          id: field.id,
          name: { 'zh-CN': field.name, 'en-US': field.name },
          scope: field.scope,
          min: field.min,
          max: field.max,
        })));
        interactiveMap.followPlayer(snapshot.currentPlayerPosition);
      }
      applyRegionTheme(page, snapshot.currentPlayerPosition);
      const startCell = mapResult.mapData.find((cell) => cell.id === context.player?.position.cellId);
      if (startCell) {
        gameStore?.applySnapshot({ sequence: gameStore.nextSequence(), playerDisplayX: startCell.x, playerDisplayY: startCell.y, cameraTargetX: startCell.x, cameraTargetY: startCell.y });
      }
      syncCellActions(snapshot.currentPlayerPosition);
      gameHudShell?.update();
      addChatMessage(t('game.welcomeMessage'), 'system');
    },
  );

  // 从 controller 获取登录时同步的时间数据
  const ctx = controller.getContext();
  if (ctx.cycleStartTime !== null) {
    gameStore?.updateDayNight({ dayNightStartTime: ctx.cycleStartTime });
  }

  // 初始化已有玩家列表（登录时服务端返回的其他在线玩家）
  if (ctx.existingPlayers && ctx.existingPlayers.length > 0) {
    const _otherPlayers = ctx.existingPlayers.map(p => ({
      id: p.id,
      username: p.username,
      position: p.position,
      status: p.status || 'normal',
      primaryValue: Object.values(p.values ?? {}).find((field) => field.scope !== 'region')?.current ?? 0,
    }));
    gameStore?.applyEvent({ sequence: gameStore.nextSequence(), type: 'players', players: _otherPlayers });
  }

  // 监听服务端昼夜事件，同步时间
  const socket = gameSocket ?? controller.getSocket();
  if (socket) {
    registerSocketHandlers(socket, {
      controller,
      store: gameStore!,
      mapIndex: mapIndex ?? undefined,
      getMapIndex: () => mapIndex ?? undefined,
      onPathChoiceOptions: (options) => gameStore?.setPathChoice(options),
      onPathChoiceCleared: () => gameStore?.clearPathChoice(),
      onHudRefresh: () => gameHudShell?.update(),
      onJailCooldownStart: () => invokeGameAction((runtime) => ensureCooldownRevealTicker(runtime)),
      movementEffects,
      onEvent: () => {
        gameHudShell?.update();
        syncCellActions(gameStore?.getSnapshot().currentPlayerPosition ?? 0);
      },
    });
  }

  const interactiveMapElement = interactiveMap.getElement();
  const handleMapHover = (event: Event): void => {
    const detail = (event as CustomEvent).detail;
    const cellId = typeof detail?.cellId === 'number' ? detail.cellId : detail?.cell?.id;
    if (typeof cellId === 'number' && gameHudShell) gameHudShell.showCellHover(cellId, detail.rect);
  };
  const handleMapLeave = (): void => gameHudShell?.hideCellHover();
  const handleWindowCellHover = (event: Event): void => {
    const detail = (event as CustomEvent).detail;
    const cellId = typeof detail?.cellId === 'number' ? detail.cellId : detail?.cell?.id;
    if (typeof cellId === 'number' && gameHudShell) {
      // 兼容无 rect 的遗留事件：以 clientX/clientY 为格子右上角，按默认格子尺寸构造矩形
      const rect = detail.rect ?? { left: detail.clientX - 112, right: detail.clientX, top: detail.clientY, width: 112, height: 76 };
      gameHudShell.showCellHover(cellId, rect);
    } else gameHudShell?.hideCellHover();
  };
  const handleWindowCellLeave = (): void => gameHudShell?.hideCellHover();
  interactiveMapElement.addEventListener('map:hover', handleMapHover);
  interactiveMapElement.addEventListener('map:leave', handleMapLeave);
  window.addEventListener('game:cell-hover', handleWindowCellHover);
  window.addEventListener('game:cell-leave', handleWindowCellLeave);
  pageEventCleanups.set(page, () => {
    interactiveMapElement.removeEventListener('map:hover', handleMapHover);
    interactiveMapElement.removeEventListener('map:leave', handleMapLeave);
    window.removeEventListener('game:cell-hover', handleWindowCellHover);
    window.removeEventListener('game:cell-leave', handleWindowCellLeave);
  });

  container.appendChild(page);
  return page;
}

/** 将主题令牌投影到页面根节点，组件只消费 CSS 变量，不读取主题 JSON。 */
export interface GamePageThemeConfig {
  tokens?: Record<string, unknown>;
}

export function applyGamePageThemeTokens(page: HTMLElement, config: GamePageThemeConfig = {}): void {
  const snapshot = new DesignAdapter(config.tokens ?? getThemeTokens()).createSnapshot('day');
  applyGamePageThemeSnapshot(page, snapshot);
}

function applyGamePageThemeSnapshot(page: HTMLElement, snapshot: ReturnType<DesignAdapter['createSnapshot']>): void {
  // 所有 --gp-* 和 --tycoon-* 变量均由 DesignAdapter 从主题 JSON 注入到 dom 快照
  for (const [name, value] of Object.entries(snapshot.dom)) {
    page.style.setProperty(name, value);
  }
}

function applyRegionTheme(page: HTMLElement, cellId: number): void {
  const snapshot = gameStore?.getSnapshot();
  const cell = snapshot?.cells.get(cellId);

  // 权威来源：格子 theme 直接声明的 UI 主题令牌（northeast/south/midwest/west），
  // 与 themeTokens 键一一对应。缺失/未知时回退到区域 themeId，再回退默认主题。
  let themeId = getThemeId(cell?.theme);
  if (cell?.theme === null || cell?.theme === undefined) {
    const cellRegionId = cell?.regionId;
    const region = snapshot?.mapRegions.find(candidate => candidate.id === cellRegionId);
    themeId = getRegionThemeId(region ?? { id: 'default' });
  }

  // 主题未变化：直接返回，避免每次位置同步都重刷令牌或误触转场
  if (themeId === appliedRegionThemeId) return;
  const isFirstApply = appliedRegionThemeId === null;
  appliedRegionThemeId = themeId;

  if (isFirstApply) {
    // 首次进入不播转场，直接落主题，避免加载时黑屏一闪
    applyGamePageThemeTokens(page, { tokens: getThemeTokens(themeId) });
  } else {
    // UI 主题切换：由视效层在完全进入黑屏后应用主题令牌（apply），
    // 再按移动/岔路选择状态决定保持或露出；正等待路径选择（棋子未真正移动）时立即应用、不进黑屏。
    gameEffects?.onThemeChange(
      !!snapshot?.isMoving,
      !!snapshot?.isWaitingForChoice,
      () => applyGamePageThemeTokens(page, { tokens: getThemeTokens(themeId) }),
    );
  }

  // 记录当前玩家所在格子的区域主题，供欢迎/登录等独立页面在下次启动时沿用
  if (localStorage.getItem(SAVED_REGION_THEME_KEY) !== themeId) {
    localStorage.setItem(SAVED_REGION_THEME_KEY, themeId);
  }
}

function initTeam(): void {
  // 向服务端查询当前队伍状态（若已组队则服务端返回完整成员显示数据）
  if (gameSocket) {
    gameSocket.emit('client.getTeamState', {}, (result) => {
      if (result.ok && result.data) {
        gameStore?.applyEvent({ sequence: gameStore.nextSequence(), type: 'team', members: result.data.members });
        gameHudShell?.update();
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

  const otherPlayers = gameStore?.getSnapshot().otherPlayers ?? [];
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
  const teamMembers = gameStore?.getSnapshot().teamMembers ?? [];
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
          ${teamMembers.filter(m => m.id !== gameStore?.getSnapshot().currentPlayer?.id).map(m => `
            <div class="management-item">
              <div style="display:flex; flex-direction:column; gap:4px;">
                <span>${m.username}</span>
                <span style="font-size:0.75rem; color:var(--secondary);">${formatTeamValues(m.values, gameStore?.getSnapshot().valueFieldDefs ?? [])} · ${m.status}</span>
              </div>
            </div>
          `).join('')}
        </div>
        <button class="modal-btn btn-danger" onclick="window.leaveTeam()">${t('team.leaveTeam')}</button>
        <button class="modal-btn btn-cancel" onclick="this.closest('.modal-overlay').remove()">${t('common.close')}</button>
      </div>
    </div>
  `;
  
  window.leaveTeam = () => {
    leaveTeam();
    modal.remove();
  };
  
  document.body.appendChild(modal);
}


function syncCellActions(cellId: number): void {
  if (!gameStore || !mapIndex) return;
  const snapshot = gameStore?.getSnapshot();
  const cell = gameStore?.getCell(cellId) ?? mapIndex.getById(cellId);
  if (!cell || !snapshot) {
    gameStore.setCellActions([]);
    return;
  }
  // 移动动画中 currentPlayerPosition 逐格推进：只展示最终停靠格的动作。
  // 防止把移动经过（非停靠）格的 act-btm 弹到按钮簇，误触指向越权操作。
  if (snapshot.isMoving) {
    // 移动期每次广播都会进入本分支；已有 [] 时不再重写，避免「重写 cellActions→再广播→再进入→…」的同步写回死循环
    if (gameStore.getSnapshot().cellActions.length > 0) gameStore.setCellActions([]);
    return;
  }
  // 交通枢纽目的地动作由 loadTransportDestinations 异步获取后写入 act-bar。
  // 若当前已展示带 targetCellId 的目的地动作（非加载态单按钮），保持其展示，
  // 避免被下方单按钮解析结果覆盖；玩家离开该格后 cell 类型变化，解析逻辑自会重置。
  if (cell.type === 'transport' && snapshot.cellActions.some((a) => a.id === 'transport' && typeof a.data?.targetCellId === 'number')) {
    return;
  }
  const runtimeState = snapshot.cellRuntimeStates.get(cellId);
  const ownerships = runtimeState?.ownerships ?? [];
  const currentPlayerId = snapshot.currentPlayer?.id;
  // 持股判定：cellRuntimeStates(实时事件) 在重连/页面重建后可能为空，
  // 需并入 gameState 下发的 ownedProperties，否则已持股 property 被误判为可购买。
  const owned = Boolean(currentPlayerId && (ownerships.some(ownership => ownership.playerId === currentPlayerId && ownership.share > 0)
    || (cell.type === 'property' && snapshot.ownedProperties.has(cellId))));
  const actions = resolveCellActions({
    cell,
    state: {
      owned,
      ownerCount: ownerships.length,
      level: snapshot.propertyLevels.get(cellId) ?? runtimeState?.level ?? 0,
      ownedInvestment: snapshot.ownedInvestments.has(cellId),
      isBankrupt: snapshot.isBankrupt,
      actionUsedThisTurn: snapshot.actionUsedThisTurn,
    },
    currentPlayer: snapshot.currentPlayer,
    valueFieldDefs: snapshot.valueFieldDefs,
    // 动作成本 base → final 展示（同 hover），有 valueModifier 时生效
    resolution: gameViewModel?.getCellResolutionCtx(cell),
  });
  const currentActions = snapshot.cellActions;
  const unchanged = currentActions.length === actions.length && actions.every((action, index) => {
    const current = currentActions[index];
    return current.id === action.id && current.label === action.label && current.detail === action.detail && current.enabled === action.enabled;
  });
  if (!unchanged) gameStore.setCellActions(actions);
}

function formatTeamValues(values: Record<string, number>, definitions: Array<{ id: string; name: string }>): string {
  return Object.entries(values).map(([fieldId, value]) => `${definitions.find((definition) => definition.id === fieldId)?.name ?? fieldId} ${value}`).join(' · ');
}

export function cleanupGamePage(page: HTMLElement): void {
  gameMovementLoop?.stop();
  gameMovementLoop = null;
  pageEventCleanups.get(page)?.();
  pageEventCleanups.delete(page);
  gameHudShell?.destroy();
  gameHudShell = null;
  gameEffects?.destroy();
  gameEffects = null;
  gameViewModel?.destroy();
  gameViewModel = null;
  unsubscribeGameStore?.();
  unsubscribeGameStore = null;
  setChatStore(null);
  gameStore?.reset();
  gameStore = null;
  if (gameSocket) {
    unregisterSocketHandlers(gameSocket);
    gameSocket = null;
  }
  mapIndex = null;
  page.remove();
}
