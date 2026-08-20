declare global {
  interface Window {
    resetTutorial: () => void;
    clearGameData: () => void;
    toggleTutorial: () => void;
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
import { MapIndex, t } from '@game/shared';
import type { Player } from '@game/shared';
import { BoardRenderer } from '../renderer/BoardRenderer.js';
import { createNotificationCenter, type NotificationCenter } from '../components/NotificationCenter.js';
import { GameHudShell } from '../components/GameHudShell.js';
import { InteractiveMapSurface } from '../components/InteractiveMapSurface.js';
import { NoOpEffectHooks } from '../game/GameEffects.js';
import { GameViewModel } from '../game/GameViewModel.js';
import { GameStore } from '../state/GameStore.js';
import type { TypedClientSocket } from '../hooks/useSocket.js';

import {
  loadMapData,
} from '../game/systems/MapLoader.js';

import {
  startTutorial,
} from '../game/systems/TutorialSystem.js';

import {
  addChatMessage, setChatStore,
} from '../game/systems/ChatSystem.js';

import { startRenderLoop, centerCameraOnCell, handleMouseMove, handleClick, handleMouseLeave, handleResize, configureRenderContext, clearRenderContext, updateRendererPlayers } from '../game/ClientRenderLoop.js';
import { registerHudRefresh } from '../game/ClientHudBridge.js';

import { handleRollDice,
  handleBuyProperty, handleUpgradeProperty, handleBuyInvestment, handleCoInvest,
  handleTransport, handleRestoreMonument, type GameRuntime,
} from '../game/systems/GameLogic.js';

import {
  onIntersectionChoice,
} from '../game/systems/MovementSystem.js';

import { registerSocketHandlers, unregisterSocketHandlers } from '../game/systems/SocketEventHandler.js';
import { DesignAdapter } from '../design/DesignAdapter.js';
import { getThemeTokens } from '../design/ThemeConfig.js';

let notificationCenter: NotificationCenter | null = null;
let gameViewModel: GameViewModel | null = null;
let gameStore: GameStore | null = null;
let gameHudShell: GameHudShell | null = null;
let unregisterHudRefresh: (() => void) | null = null;
let unsubscribeGameStore: (() => void) | null = null;
let renderer: BoardRenderer | null = null;
let mapIndex: MapIndex | null = null;
let gameSocket: TypedClientSocket | null = null;
const pageEventCleanups = new WeakMap<HTMLElement, () => void>();

function createGameRuntime(store: GameStore, socket: NonNullable<typeof gameSocket>, index: NonNullable<typeof mapIndex>): GameRuntime {
  return { store, socket, mapIndex: index, cooldownTimer: null };
}

function invokeGameAction(action: (runtime: GameRuntime) => void): void {
  if (gameStore && gameSocket && mapIndex) action(createGameRuntime(gameStore, gameSocket, mapIndex));
}

function toInteractivePlayers(snapshot: ReturnType<GameStore['getSnapshot']>): Player[] {
  return snapshot.currentPlayer
    ? [snapshot.currentPlayer, ...snapshot.otherPlayers.filter(player => player.status !== 'frozen').map(player => ({
      id: player.id,
      username: player.username,
      position: player.position,
      status: player.status as Player['status'],
      values: { money: { id: 'money', name: t('hud.money'), current: player.primaryValue, min: 0 } },
      teamId: null,
      createdAt: 0,
      lastActiveAt: 0,
    }))]
    : [];
}

export function createGamePage(controller: GameController): HTMLElement {
  const container = controller.getContainer();
  const context = controller.getContext();
  const page = document.createElement('div');
  page.className = 'page game-page';
  const designSnapshot = new DesignAdapter(getThemeTokens((globalThis as { __GAME_THEME__?: string }).__GAME_THEME__ ?? 'northeast')).createSnapshot('day');
  applyGamePageThemeSnapshot(page, designSnapshot);
  gameStore = new GameStore();
  setChatStore(gameStore);
  gameViewModel = new GameViewModel(gameStore, context.playerName || t('game.defaultPlayerName'));
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
  const interactiveMap = new InteractiveMapSurface();
  boardContainer.appendChild(interactiveMap.getElement());
  unsubscribeGameStore = gameStore.subscribe((snapshot) => {
    const players = toInteractivePlayers(snapshot);
    interactiveMap.updatePlayers(players);
    interactiveMap.followPlayer(snapshot.currentPlayerPosition);
    syncCellActions(snapshot.currentPlayerPosition);
  });
  page.appendChild(boardContainer);

  renderer = new BoardRenderer(canvas, { theme: designSnapshot });
  renderer!.drawPlaceholder(t('common.loadingMap'));

  const backButton = document.createElement('button');
  backButton.className = 'back-button';
  backButton.textContent = '返回';
  backButton.addEventListener('click', () => controller.setState('start'));
  page.appendChild(backButton);
  gameHudShell = new GameHudShell(gameViewModel, effects, {
    onRoll: () => {
      if (gameStore && gameSocket) {
        const index = mapIndex ?? ({ getById: () => undefined } as unknown as MapIndex);
        handleRollDice(createGameRuntime(gameStore, gameSocket, index));
      }
    },
      onPathChoice: (cellId) => {
      if (gameStore && gameSocket) onIntersectionChoice(gameStore, gameSocket, cellId);
      gameStore?.clearPathChoice();
    },
    onCellAction: (actionId) => {
      const actions: Record<string, () => void> = {
        'buy-property': () => invokeGameAction(handleBuyProperty),
        'upgrade-property': () => invokeGameAction(handleUpgradeProperty),
        'buy-investment': () => invokeGameAction(handleBuyInvestment),
        'co-invest': () => invokeGameAction(handleCoInvest),
        transport: () => invokeGameAction(handleTransport),
        'restore-monument': () => invokeGameAction(handleRestoreMonument),
      };
      actions[actionId]?.();
    },
    onChatSend: (message, channel) => {
      if (!gameSocket) {
        gameStore?.appendChatMessage({ text: t('chat.noConnection'), channel: 'error', timestamp: Date.now() });
        return;
      }
      gameSocket.emit('client.chat', { channel, content: message }, (result) => {
        if (!result.ok) gameStore?.appendChatMessage({ text: t('chat.sendFailed'), channel: 'error', timestamp: Date.now() });
      });
    },
  });
  page.appendChild(gameHudShell.getElement());
  unregisterHudRefresh = registerHudRefresh(() => { gameHudShell?.update(); });

  // Init: load map data, then start game
  if (context.player && context.player.id) {
    gameStore?.applyEvent({ sequence: gameStore.nextSequence(), type: 'player', player: context.player });
  }
  gameHudShell.update();
  initTeam();

  Promise.all([loadMapData()]).then(
    ([mapResult]) => {
      if (!renderer || !mapResult) {
        renderer?.drawPlaceholder(t('game.mapLoadFailed'));
        return;
      }
      const { mapData, regions } = mapResult;
      // 初始化区域繁荣度快照
      gameStore?.setRegions(regions, mapResult.valueFields);
      for (const r of regions) gameStore?.setProsperity(r.id, r.prosperity);
      mapIndex = new MapIndex(mapData);
      gameStore?.setCells(mapData);
      renderer.loadMap(mapData);
      configureRenderContext(renderer, mapIndex!);
      const snapshot = gameStore!.getSnapshot();
      if (snapshot.currentPlayer) {
        interactiveMap.render(mapData, toInteractivePlayers(snapshot));
        interactiveMap.followPlayer(snapshot.currentPlayerPosition);
      }
      updateRendererPlayers(gameStore!);
      const startCell = mapIndex!.getById(0);
      if (startCell) {
        gameStore?.applySnapshot({ sequence: gameStore.nextSequence(), playerDisplayX: startCell.x, playerDisplayY: startCell.y, cameraTargetX: startCell.x, cameraTargetY: startCell.y });
      }
      syncCellActions(snapshot.currentPlayerPosition);
      centerCameraOnCell(snapshot.currentPlayerPosition || 0);
      startRenderLoop(gameStore!);
      gameHudShell?.update();
      addChatMessage(t('game.welcomeMessage'), 'system');
      startTutorial(gameStore!);
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
      primaryValue: p.values?.money?.current,
    }));
    gameStore?.applyEvent({ sequence: gameStore.nextSequence(), type: 'players', players: _otherPlayers });
  }

  // 监听服务端昼夜事件，同步时间
  const socket = controller.getSocket();
  gameSocket = socket;
  if (socket) {
    notificationCenter = createNotificationCenter({
      container: page,
      socket,
      playerId: context.player?.id || '',
    });
    page.appendChild(notificationCenter.getElement());

    registerSocketHandlers(socket, {
      controller,
      store: gameStore!,
      mapIndex: mapIndex ?? undefined,
      onPathChoiceOptions: (options) => gameStore?.setPathChoice(options),
      onPathChoiceCleared: () => gameStore?.clearPathChoice(),
      onEvent: () => gameHudShell?.update(),
      onNotification: (payload) => notificationCenter?.handleNotification({ ...payload, durationMs: payload.durationMs ?? 3000, createdAt: payload.createdAt ?? Date.now() }),
    });
  }

  const interactiveMapElement = interactiveMap.getElement();
  const handleMapHover = (event: Event): void => {
    const detail = (event as CustomEvent).detail;
    const cellId = typeof detail?.cellId === 'number' ? detail.cellId : detail?.cell?.id;
    if (typeof cellId === 'number' && gameHudShell) gameHudShell.showCellHover(cellId, detail.clientX, detail.clientY);
  };
  const handleMapLeave = (): void => gameHudShell?.hideCellHover();
  const handleWindowCellHover = (event: Event): void => {
    const detail = (event as CustomEvent).detail;
    const cellId = typeof detail?.cellId === 'number' ? detail.cellId : detail?.cell?.id;
    if (typeof cellId === 'number' && gameHudShell) gameHudShell.showCellHover(cellId, detail.clientX, detail.clientY);
    else gameHudShell?.hideCellHover();
  };
  const handleWindowCellLeave = (): void => gameHudShell?.hideCellHover();
  const handleCanvasClick = (event: MouseEvent): void => {
    if (gameStore && gameSocket && mapIndex) handleClick(event, createGameRuntime(gameStore, gameSocket, mapIndex));
  };
  interactiveMapElement.addEventListener('map:hover', handleMapHover);
  interactiveMapElement.addEventListener('map:leave', handleMapLeave);
  window.addEventListener('game:cell-hover', handleWindowCellHover);
  window.addEventListener('game:cell-leave', handleWindowCellLeave);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('click', handleCanvasClick);
  canvas.addEventListener('mouseleave', handleMouseLeave);
  window.addEventListener('resize', handleResize);
  pageEventCleanups.set(page, () => {
    interactiveMapElement.removeEventListener('map:hover', handleMapHover);
    interactiveMapElement.removeEventListener('map:leave', handleMapLeave);
    window.removeEventListener('game:cell-hover', handleWindowCellHover);
    window.removeEventListener('game:cell-leave', handleWindowCellLeave);
    canvas.removeEventListener('mousemove', handleMouseMove);
    canvas.removeEventListener('click', handleCanvasClick);
    canvas.removeEventListener('mouseleave', handleMouseLeave);
    window.removeEventListener('resize', handleResize);
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
                <span style="font-size:0.75rem; color:var(--secondary);">金钱 ${m.money} · 信用 ${m.credit} · 环保 ${m.env} · ${m.status}</span>
              </div>
              <button type="button" class="modal-btn btn-secondary" onclick="window.removeTeamMember('${m.id}')">${t('team.removeMember')}</button>
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


function syncCellActions(cellId: number): void {
  if (!gameStore || !mapIndex) return;
  const snapshot = gameStore?.getSnapshot();
  const cell = gameStore?.getCell(cellId) ?? mapIndex.getById(cellId);
  if (!cell || !snapshot) {
    gameStore.setCellActions([]);
    return;
  }
  const extra = cell.extra;
  const type = String(extra.type ?? 'empty');
  const price = Number(extra.price ?? 0);
  const ownerships = Array.isArray(extra.ownerships) ? extra.ownerships as Array<{ playerId: string; share: number }> : [];
  const currentPlayerId = snapshot.currentPlayer?.id;
  const owned = Boolean(currentPlayerId && ownerships.some(ownership => ownership.playerId === currentPlayerId && ownership.share > 0));
  const level = snapshot.propertyLevels.get(cellId) ?? 0;
  const canAfford = snapshot.currentMoney >= price;
  const actions = type === 'property'
    ? owned
      ? snapshot.actionUsedThisTurn
        ? []
        : Number((extra.upgradeCost as number[] | undefined)?.[level] ?? 0) > 0
          ? [{ id: 'upgrade-property', label: '升级', detail: `$${Number((extra.upgradeCost as number[] | undefined)?.[level] ?? 0)}`, enabled: !snapshot.isBankrupt }]
          : []
      : [{ id: 'buy-property', label: '购买', detail: `$${price}`, enabled: !snapshot.isBankrupt && canAfford }]
    : type === 'investment'
      ? snapshot.ownedInvestments.has(cellId)
        ? []
        : [{ id: 'buy-investment', label: '全额投资', detail: `$${price}`, enabled: !snapshot.isBankrupt && canAfford }, { id: 'co-invest', label: '合租投资', detail: '共享份额', enabled: !snapshot.isBankrupt && canAfford }]
      : type === 'transport'
        ? [{ id: 'transport', label: '传送', detail: `$${Number(extra.transportCost ?? 0)}`, enabled: !snapshot.isBankrupt }]
        : type === 'monument'
          ? [{ id: 'restore-monument', label: '修缮', detail: `$${Number(extra.monumentCost ?? 0)}`, enabled: !snapshot.isBankrupt }]
          : [];
  const currentActions = snapshot.cellActions;
  const unchanged = currentActions.length === actions.length && actions.every((action, index) => {
    const current = currentActions[index];
    return current.id === action.id && current.label === action.label && current.detail === action.detail && current.enabled === action.enabled;
  });
  if (!unchanged) gameStore.setCellActions(actions);
}

// ===== Tutorial System =====

export function cleanupGamePage(page: HTMLElement): void {
  pageEventCleanups.get(page)?.();
  pageEventCleanups.delete(page);
  unregisterHudRefresh?.();
  unregisterHudRefresh = null;
  gameHudShell?.destroy();
  gameHudShell = null;
  gameViewModel?.destroy();
  gameViewModel = null;
  unsubscribeGameStore?.();
  unsubscribeGameStore = null;
  clearRenderContext();
  setChatStore(null);
  gameStore?.reset();
  gameStore = null;
  if (notificationCenter) {
    notificationCenter.destroy();
    notificationCenter = null;
  }
  if (gameSocket) {
    unregisterSocketHandlers(gameSocket);
    gameSocket = null;
  }
  renderer = null;
  mapIndex = null;
  page.remove();
}

export function getRenderer(): BoardRenderer | null { return renderer; }
