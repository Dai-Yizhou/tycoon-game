/**
 * Socket 事件处理器
 *
 * 从 GamePage.ts 中提取的所有 socket 事件处理逻辑。
 * 管理服务端推送的各类事件，同步状态到 GameStore 并触发 UI 更新。
 */

import type { TypedClientSocket } from '../../hooks/useSocket.js';
import { localizedText, t } from '../i18n.js';
import { resolveTimezoneOffsetMinutes } from '../timezone.js';
import type { OtherPlayerInfo } from '../../state/GameStore.js';
import { addChatMessage } from './ChatSystem.js';
import { startServerPathAnimation } from './MovementSystem.js';
import { noopHudRefresh, type HudRefresh } from '../ClientHudBridge.js';
import type { GameController } from '../GameController.js';
import { GameStore } from '../../state/GameStore.js';
import type { MapIndex, Player } from '@game/shared';
import type { MovementEffectHooks } from '../GameEffects.js';

const registeredSockets = new WeakSet<TypedClientSocket>();
const eventObservers = new WeakMap<TypedClientSocket, (event: string) => void>();

export interface SocketHandlerOptions {
  store: GameStore;
  mapIndex?: MapIndex;
  getMapIndex?: () => MapIndex | undefined;
  controller?: GameController;
  onEvent?: (event: string) => void;
  onNotification?: (payload: { id: string; type: 'info' | 'success' | 'warning' | 'error'; title: string; content: string; durationMs?: number; createdAt?: number }) => void;
  onPathChoiceOptions?: (options: Array<{ cellId: number; label: unknown }>) => void;
  onPathChoiceCleared?: () => void;
  onHudRefresh?: HudRefresh;
  movementEffects?: MovementEffectHooks;
}

const SOCKET_EVENTS = [
  'server.dayNightProgress', 'server.dayNightChanged', 'server.timezoneChanged', 'server.pong',
  'server.chat', 'server.leaderboardUpdated', 'connect', 'disconnect',
  'server.playerJoined', 'server.playerLeft', 'server.playerMoved', 'server.askPath',
  'server.valueChanged', 'server.error', 'server.playerJailed', 'server.playerReleased', 'server.playerStatusChanged',
  'server.teamInviteReceived', 'server.teamMemberJoined', 'server.teamMemberLeft',
  'server.teamUpdated', 'server.teamDisbanded', 'server.regionValueChanged', 'server.gameState',
  'server.valueFieldDefinitions', 'server.diceRolled', 'server.notification', 'server.achievementUnlocked', 'server.playerBankrupt', 'server.playerRestarted',
  'server.propertyBought', 'server.propertyUpgraded', 'server.investmentBought',
] as const;

/**
 * 注册所有 socket 事件处理器
 */
export function registerSocketHandlers(socket: TypedClientSocket, options: SocketHandlerOptions = { store: new GameStore() }): void {
  if (registeredSockets.has(socket)) return;
  registeredSockets.add(socket);
  const store = options.store;
  const refresh = options.onHudRefresh ?? noopHudRefresh;
  if (options.onEvent && socket.onAny) {
    const observer = (event: string) => {
      queueMicrotask(() => options.onEvent?.(event));
    };
    eventObservers.set(socket, observer);
    socket.onAny(observer);
  }
  // 每秒进度更新：同步 cycleStartTime 和计算时钟偏移
  socket.on('server.dayNightProgress', (payload: { cycleStartTime: number; cycleMinutes: number; globalTime: number }) => {
    store.updateDayNight({ dayNightStartTime: payload.cycleStartTime, serverTimeOffset: payload.globalTime - Date.now(), cycleMinutes: payload.cycleMinutes });
  });

  // 阶段切换：同步时间
  socket.on('server.dayNightChanged', (payload: { cycleStartTime: number; cycleMinutes: number; globalTime: number; isDay: boolean }) => {
    store.updateDayNight({ dayNightStartTime: payload.cycleStartTime, serverTimeOffset: payload.globalTime - Date.now(), cycleMinutes: payload.cycleMinutes });
    const phaseMsg = payload.isDay ? t('dayNight.day') : t('dayNight.night');
    addChatMessage(t('dayNight.dayChanged', { phase: phaseMsg }), 'system');
  });

  // 时区变化
  socket.on('server.timezoneChanged', (payload: { toTimezoneName?: string; toTimezoneId?: string }) => {
    const tzName = payload.toTimezoneName || payload.toTimezoneId || '';
    const snapshot = store.getSnapshot();
    const cell = snapshot.cells.get(snapshot.currentPlayerPosition);
    const offsetMinutes = resolveTimezoneOffsetMinutes(cell, snapshot.mapTimezones);
    const serverElapsed = Date.now() + snapshot.serverTimeOffset - snapshot.dayNightStartTime;
    const localProgress = ((serverElapsed / (snapshot.cycleMinutes * 60 * 1000)) + offsetMinutes / (24 * 60)) % 1;
    const totalMinutes = Math.floor(localProgress * 24 * 60);
    const timeStr = `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
    const isDay = totalMinutes >= 6 * 60 && totalMinutes < 18 * 60;
    addChatMessage(t('dayNight.timezoneChanged', { tz: tzName, time: timeStr, dayNight: isDay ? t('dayNight.dayTime') : t('dayNight.nightTime') }), 'system');
  });

  // 心跳校正时钟偏移
  socket.on('server.pong', (payload: { serverTime: number }) => {
    store.updateDayNight({ serverTimeOffset: payload.serverTime - Date.now() });
  });

  socket.on('server.notification', (payload: { id: string; type: 'info' | 'success' | 'warning' | 'error'; title: string; content: string; durationMs?: number }) => {
    options.onNotification?.(payload);
  });

  socket.on('server.leaderboardUpdated', (payload) => {
    store.setLeaderboard(payload);
    refresh();
  });

  socket.on('server.achievementUnlocked', (payload) => {
    const current = store.getSnapshot().achievements.snapshot;
    store.setAchievements(current ? { ...current, generatedAt: Date.now(), achievements: current.achievements.map((item) => item.id === payload.achievement.id ? payload.achievement : item) } : { enabled: true, mapId: payload.achievement.record.mapId ?? '', generatedAt: Date.now(), achievements: [payload.achievement] });
    options.onNotification?.({ id: `achievement-${payload.achievement.id}`, type: 'success', title: t('hud.achievements'), content: localizedText(payload.achievement.name), durationMs: 3000 });
    refresh();
  });

  socket.on('server.error', (payload) => {
    if (payload.code.toLowerCase().includes('leaderboard') || payload.message.toLowerCase().includes('榜单')) {
      store.setLeaderboardError(payload.message);
      refresh();
    }
  });

  socket.on('disconnect', () => {
    store.setAchievementsOffline();
    store.setLeaderboardOffline();
    refresh();
  });

  socket.on('connect', () => {
    if (store.getSnapshot().leaderboard.status === 'offline') {
      store.setLeaderboard(store.getSnapshot().leaderboard.snapshot);
      refresh();
    }
  });

  socket.on('server.playerBankrupt', (payload) => {
    if (payload.playerId === store.getSnapshot().currentPlayer?.id) {
      store.applyEvent({ sequence: store.nextSequence(), type: 'status', playerId: payload.playerId, status: 'bankrupt' });
      options.controller?.setBankrupt();
    }
    refresh();
  });

  socket.on('server.gameState', (payload) => {
    const currentSnapshot = store.getSnapshot();
    if (currentSnapshot.isServerAnimating && payload.player?.id === currentSnapshot.currentPlayer?.id) return;
    const teamMembers = payload.members ?? [];
    if (payload.leaderboard) store.setLeaderboard(payload.leaderboard);
    if (payload.achievements) store.setAchievements(payload.achievements);
    if (payload.visibleCells?.length) store.setCells(payload.visibleCells);
    store.applySnapshot({ sequence: store.nextSequence(), player: payload.player, teamMembers, ownedProperties: payload.ownedProperties, ownedInvestments: payload.ownedInvestments });
  });

  socket.on('server.propertyBought', (payload) => {
    store.setCell(payload.cell);
    store.setCellRuntimeState(payload.cell.id, payload.runtime);
    store.applyEvent({ sequence: store.nextSequence(), type: 'property', playerId: payload.playerId, cellId: payload.cell.id, level: 0 });
    refresh();
  });

  socket.on('server.propertyUpgraded', (payload) => {
    store.setCell(payload.cell);
    store.setCellRuntimeState(payload.cell.id, payload.runtime);
    store.applyEvent({ sequence: store.nextSequence(), type: 'property', playerId: payload.playerId, cellId: payload.cell.id, level: payload.newLevel });
    refresh();
  });

  socket.on('server.investmentBought', (payload) => {
    store.setCell(payload.cell);
    store.setCellRuntimeState(payload.cell.id, payload.runtime);
    const ownerships = payload.runtime.ownerships;
    const ownership = ownerships.find((item) => item.playerId === payload.playerId);
    if (ownership) store.applyEvent({ sequence: store.nextSequence(), type: 'investment', playerId: payload.playerId, cellId: payload.cell.id, share: ownership.share });
    refresh();
  });

  socket.on('server.playerRestarted', (payload) => {
    if (payload.playerId === store.getSnapshot().currentPlayer?.id) {
      store.applySnapshot({ sequence: store.nextSequence(), currentPlayer: payload.player, isBankrupt: false, isInJail: false, currentPlayerPosition: payload.player.position.cellId });
      options.controller?.setRestarted(payload.player);
    }
    refresh();
  });

  // 监听聊天消息
  socket.on('server.chat', (payload) => {
    const { message } = payload;
    if (message?.content) {
      store.appendChatMessage(message);
    }
  });

  // 监听其他玩家事件（payload 为服务端权威 Player，字段由 valueFieldDefinitions 动态定义）
  socket.on('server.playerJoined', (payload: Player) => {
    // 添加新玩家或更新已有玩家（重连场景）
    const currentPlayers = store.getSnapshot().otherPlayers;
    const existingIndex = currentPlayers.findIndex(p => p.id === payload.id);
    if (payload.status === 'frozen') return;
    // primaryValue 仅为 UI 展示投影，非业务数值来源：取该玩家第一个可用 UCT 字段，不写死 `money`/不捏造默认值
    const fieldIds = payload.values ? Object.keys(payload.values) : [];
    const primaryField = fieldIds.length > 0 ? payload.values[fieldIds[0]!] : undefined;
    const playerData: OtherPlayerInfo = {
      id: payload.id,
      username: payload.username,
      position: { cellId: payload.position?.cellId || 0 },
      status: (payload.status as OtherPlayerInfo['status']) || 'normal',
      primaryValue: primaryField ? primaryField.current ?? 0 : 0,
    };
    const nextPlayers = [...currentPlayers];
    if (existingIndex === -1) {
      nextPlayers.push(playerData);
      addChatMessage(t('player.joined', { name: payload.username }), 'system');
    } else {
      nextPlayers[existingIndex] = playerData;
    }
    store.applyEvent({ sequence: store.nextSequence(), type: 'players', players: nextPlayers });
  });

  socket.on('server.playerLeft', (payload: { playerId: string }) => {
    // 从列表移除玩家
    const currentPlayers = store.getSnapshot().otherPlayers;
    const player = currentPlayers.find(p => p.id === payload.playerId);
    if (player) {
      const nextPlayers = currentPlayers.filter(p => p.id !== payload.playerId);
      store.applyEvent({ sequence: store.nextSequence(), type: 'players', players: nextPlayers });
      addChatMessage(t('player.left', { name: player.username }), 'system');
    }
    // 队伍成员状态由 server.teamUpdated / server.teamDisbanded 事件权威维护，此处不本地修改 teamMembers
    // 仅清理邀请面板中对应条目
    const inviteItem = document.querySelector(`[data-player-id="${payload.playerId}"]`);
    if (inviteItem) {
      const item = inviteItem.closest('.management-item');
      if (item) item.remove();
    }
  });

  socket.on('server.playerMoved', (payload: { playerId: string; cellId: number; path?: number[] }) => {
    const currentPlayers = store.getSnapshot().otherPlayers;
    const player = currentPlayers.find(p => p.id === payload.playerId);
    if (player) {
      store.applyEvent({ sequence: store.nextSequence(), type: 'otherPlayerMove', playerId: payload.playerId, cellId: payload.cellId });
    }
    const activePlayer = store.getSnapshot().currentPlayer;
    if (activePlayer && payload.playerId === activePlayer.id) {
      const snapshot = store.getSnapshot();
      const activeMapIndex = options.getMapIndex?.() ?? options.mapIndex;
      console.warn('[DBG-PLAYERMOVED]', JSON.stringify(payload), 'isServerAnimating=', snapshot.isServerAnimating, 'hasMap=', !!activeMapIndex, 'curPos=', snapshot.currentPlayerPosition);
      // 动画进行中：moveHandler 的 updatePlayer 会额外广播一个不含 path 的
      // server.playerMoved 位置同步（可能先/后到达）。此时必须忽略，避免把
      // 动画权威位置直接当成跳转整格覆盖，导致棋子停留在原地而视野已被拉走。
      if (snapshot.isServerAnimating) return;
      if (activeMapIndex && payload.path && payload.path.length > 1) {
        const started = startServerPathAnimation(store, activeMapIndex, payload.path, refresh, options.movementEffects, payload.cellId, refresh);
        console.warn('[DBG-START-ANIM] started=', started);
      } else {
        console.warn('[DBG-JUMP-MOVE] no path, direct jump');
        store.applyEvent({ sequence: store.nextSequence(), type: 'move', playerId: payload.playerId, cellId: payload.cellId });
        refresh();
      }
    }
  });

  socket.on('server.askPath', (payload: { fromCellId: number; options: Array<{ cellId: number; label?: unknown }> }) => {
    if (!store.getSnapshot().currentPlayer) return;
    store.applySnapshot({ sequence: store.nextSequence(), isWaitingForChoice: true });
    options.onPathChoiceOptions?.(payload.options.map(opt => ({ cellId: opt.cellId, label: opt.label })));
    const directionLabels = payload.options.map(o => localizedText(o.label));
    addChatMessage(t('intersection.chooseDirection', { options: directionLabels.join(' / ') }), 'system');
  });

  socket.on('server.valueChanged', (payload: { playerId: string; fieldId: string; current: number; delta: number }) => {
    if (!store) return;
    const snapshot = store.getSnapshot();
    const isCurrentPlayer = snapshot.currentPlayer?.id === payload.playerId;
    const isOtherPlayer = snapshot.otherPlayers.some(player => player.id === payload.playerId);
    if (!isCurrentPlayer && !isOtherPlayer) return;
    store.applyEvent({ sequence: store.nextSequence(), type: 'value', playerId: payload.playerId, fieldId: payload.fieldId, current: payload.current });
    if (isCurrentPlayer) {
      refresh();
    }
  });

  socket.on('server.playerJailed', (payload: { playerId: string; durationMs: number; expiresAt?: number }) => {
    const snapshot = store.getSnapshot();
    if (snapshot.currentPlayer?.id === payload.playerId) store.applyEvent({ sequence: store.nextSequence(), type: 'jail', isInJail: true, jailEndTime: payload.expiresAt ?? Date.now() + payload.durationMs });
    addChatMessage(t('jail.enteredDetailed', { playerId: payload.playerId, duration: payload.durationMs }), 'system');
    // 服务端权威：监狱状态由服务端驱动
    const isCurrentPlayer = snapshot.currentPlayer?.id === payload.playerId;
    if (isCurrentPlayer) {
      store.applyEvent({ sequence: store.nextSequence(), type: 'status', playerId: payload.playerId, status: 'jail' });
      addChatMessage(t('jail.inJail'), 'system');
    } else {
      const otherPlayer = snapshot.otherPlayers.find(p => p.id === payload.playerId);
      if (otherPlayer) {
        store.applyEvent({ sequence: store.nextSequence(), type: 'otherPlayerStatus', playerId: payload.playerId, status: 'jail' });
      }
    }
  });

  socket.on('server.playerReleased', (payload: { playerId: string }) => {
    const snapshot = store.getSnapshot();
    if (snapshot.currentPlayer?.id === payload.playerId) store.applyEvent({ sequence: store.nextSequence(), type: 'jail', isInJail: false, jailEndTime: 0 });
    // 服务端权威：出狱状态由服务端驱动
    const isCurrentPlayer = snapshot.currentPlayer?.id === payload.playerId;
    if (isCurrentPlayer) {
      store.applyEvent({ sequence: store.nextSequence(), type: 'status', playerId: payload.playerId, status: 'normal' });
      addChatMessage(t('jail.released'), 'system');
      refresh();
    } else {
      const otherPlayer = snapshot.otherPlayers.find(p => p.id === payload.playerId);
      if (otherPlayer) {
        store.applyEvent({ sequence: store.nextSequence(), type: 'otherPlayerStatus', playerId: payload.playerId, status: 'normal' });
      }
    }
  });

  socket.on('server.playerStatusChanged', (payload: { playerId: string; status: string }) => {
    if (payload.status === 'frozen') {
      const currentPlayers = store.getSnapshot().otherPlayers;
      const nextPlayers = currentPlayers.filter(player => player.id !== payload.playerId);
      store.applyEvent({ sequence: store.nextSequence(), type: 'players', players: nextPlayers });
      return;
    }
    // 更新玩家状态
    const player = store.getSnapshot().otherPlayers.find(p => p.id === payload.playerId);
    if (player) {
      store.applyEvent({ sequence: store.nextSequence(), type: 'otherPlayerStatus', playerId: payload.playerId, status: payload.status as OtherPlayerInfo['status'] });
    }
    if (payload.playerId === store.getSnapshot().currentPlayer?.id) {
      store.applyEvent({ sequence: store.nextSequence(), type: 'status', playerId: payload.playerId, status: payload.status as import('@game/shared').Player['status'] });
      if (payload.status === 'bankrupt') options.controller?.setBankrupt();
    }
  });

  socket.on('server.teamInviteReceived', (payload: { inviterName: string; inviteId: string }) => {
    addChatMessage(t('team.inviteReceived', { name: payload.inviterName }), 'system');

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">${t('team.inviteTitle')}</div>
        <div class="modal-body">
          <div>${t('team.inviteDescription', { name: payload.inviterName })}</div>
          <div class="modal-actions" style="margin-top: 20px;">
            <button data-action="accept" style="padding: 8px 24px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">${t('team.inviteAccept')}</button>
            <button data-action="reject" style="padding: 8px 24px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">${t('team.inviteReject')}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const respond = (accept: boolean): void => {
      const buttons = modal.querySelectorAll('button');
      buttons.forEach(button => { button.disabled = true; });
      socket.emit('client.respondToTeamInvite', { inviteId: payload.inviteId, accept }, (result: { ok: boolean; error?: string }) => {
        if (result.ok) {
          modal.remove();
          addChatMessage(t(accept ? 'team.inviteAccepted' : 'team.inviteRejected', { name: payload.inviterName }), 'system');
        } else {
          buttons.forEach(button => { button.disabled = false; });
          addChatMessage(t(accept ? 'team.joinFailed' : 'team.rejectFailed', { error: result.error || t('common.unknown') }), 'system');
        }
      });
    };
    modal.querySelector('[data-action="accept"]')?.addEventListener('click', () => respond(true));
    modal.querySelector('[data-action="reject"]')?.addEventListener('click', () => respond(false));
  });

  // 监听成员加入队伍（仅显示提示，队伍状态以 server.teamUpdated 为准）
  socket.on('server.teamMemberJoined', (payload: { playerName: string }) => {
    addChatMessage(t('team.memberJoined', { name: payload.playerName }), 'system');
    // teamMembers 由 server.teamUpdated 事件权威更新
  });

  // 监听成员离开队伍（仅显示提示，队伍状态以 server.teamUpdated 为准）
  socket.on('server.teamMemberLeft', (payload: { playerId: string }) => {
    addChatMessage(t('team.memberLeft', { name: payload.playerId }), 'system');
  });

  // 监听队伍状态更新（服务端权威：完整重建本地队伍视图）
  socket.on('server.teamUpdated', (payload) => {
    if (payload.team && store.getSnapshot().currentPlayer) {
      // 用服务端推送的成员显示数据完整重建 teamMembers
      if (payload.members) {
        store.applyEvent({ sequence: store.nextSequence(), type: 'team', members: payload.members });
      }
      refresh();
    }
  });

  // 监听队伍解散（服务端权威）
  socket.on('server.teamDisbanded', () => {
    store.applyEvent({ sequence: store.nextSequence(), type: 'team', members: [] });
    addChatMessage(t('team.teamDisbanded'), 'system');
    refresh();
  });

  // 监听服务端区域 UCT 数值变化（昼夜切换、纪念碑修缮等统一广播）
  socket.on('server.regionValueChanged', (payload: { regionId?: string; fieldId?: string; value?: number; delta: number; reason?: string; timestamp?: number }) => {
    if (payload.regionId && payload.fieldId && typeof payload.value === 'number') {
      store.setRegionValue(payload.regionId, payload.fieldId, payload.value);
    }
  });
}

/**
 * 注销所有 socket 事件处理器
 */
export function unregisterSocketHandlers(socket: TypedClientSocket): void {
  if (!registeredSockets.has(socket)) return;
  for (const event of SOCKET_EVENTS) {
    socket.off(event);
  }
  const observer = eventObservers.get(socket);
  if (observer && socket.offAny) {
    socket.offAny(observer);
  }
  eventObservers.delete(socket);
  registeredSockets.delete(socket);
}
