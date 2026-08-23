/**
 * Socket 事件处理器
 *
 * 从 GamePage.ts 中提取的所有 socket 事件处理逻辑。
 * 管理服务端推送的各类事件，同步状态到 GameStore 并触发 UI 更新。
 */

import type { TypedClientSocket } from '../../hooks/useSocket.js';
import { t, localizedText } from '../i18n.js';
import type { OtherPlayerInfo } from '../../state/GameStore.js';
import { addChatMessage } from './ChatSystem.js';
import { startServerPathAnimation } from './MovementSystem.js';
import { requestHudRefresh } from '../ClientHudBridge.js';
import type { GameController } from '../GameController.js';
import { GameStore } from '../../state/GameStore.js';
import type { MapIndex } from '@game/shared';

const registeredSockets = new WeakSet<TypedClientSocket>();
const eventObservers = new WeakMap<TypedClientSocket, (event: string) => void>();

export interface SocketHandlerOptions {
  store: GameStore;
  mapIndex?: MapIndex;
  controller?: GameController;
  onEvent?: (event: string) => void;
  onNotification?: (payload: { id: string; type: 'info' | 'success' | 'warning' | 'error'; title: string; content: string; durationMs?: number; createdAt?: number }) => void;
  onPathChoiceOptions?: (options: Array<{ cellId: number; label: string }>) => void;
  onPathChoiceCleared?: () => void;
}

const SOCKET_EVENTS = [
  'server.dayNightProgress', 'server.dayNightChanged', 'server.timezoneChanged', 'server.pong',
  'server.chat', 'server.playerJoined', 'server.playerLeft', 'server.playerMoved', 'server.askPath',
  'server.valueChanged', 'server.playerJailed', 'server.playerReleased', 'server.playerStatusChanged',
  'server.teamInviteReceived', 'server.teamMemberJoined', 'server.teamMemberLeft', 'server.teamMemberKicked',
  'server.teamUpdated', 'server.teamDisbanded', 'server.prosperityChanged', 'server.gameState',
  'server.valueFieldDefinitions', 'server.diceRolled', 'server.notification', 'server.playerBankrupt', 'server.playerRestarted',
  'server.propertyBought', 'server.propertyUpgraded', 'server.investmentBought',
] as const;

/**
 * 注册所有 socket 事件处理器
 */
export function registerSocketHandlers(socket: TypedClientSocket, options: SocketHandlerOptions = { store: new GameStore() }): void {
  if (registeredSockets.has(socket)) return;
  registeredSockets.add(socket);
  const store = options.store;
  if (options.onEvent && socket.onAny) {
    const observer = (event: string) => {
      queueMicrotask(() => options.onEvent?.(event));
    };
    eventObservers.set(socket, observer);
    socket.onAny(observer);
  }
  // 每秒进度更新：同步 cycleStartTime 和计算时钟偏移
  socket.on('server.dayNightProgress', (payload: { cycleStartTime: number; cycleMinutes: number; globalTime: number }) => {
    store.updateDayNight({ dayNightStartTime: payload.cycleStartTime, serverTimeOffset: payload.globalTime - Date.now() });
  });

  // 阶段切换：同步时间
  socket.on('server.dayNightChanged', (payload: { cycleStartTime: number; cycleMinutes: number; globalTime: number; isDay: boolean }) => {
    store.updateDayNight({ dayNightStartTime: payload.cycleStartTime, serverTimeOffset: payload.globalTime - Date.now() });
    const phaseMsg = payload.isDay ? t('dayNight.day') : t('dayNight.night');
    addChatMessage(t('dayNight.dayChanged', { phase: phaseMsg }), 'system');
  });

  // 时区变化
  socket.on('server.timezoneChanged', (payload: { toTimezoneName?: string; toTimezoneId?: string }) => {
    const tzName = payload.toTimezoneName || payload.toTimezoneId || '';
    const cell = store.getSnapshot().cells.get(store.getSnapshot().currentPlayerPosition);
    const timezone = typeof cell?.extra.timezone === 'string' ? store.getSnapshot().mapTimezones.find(item => item.id === cell.extra.timezone) : undefined;
    const serverElapsed = Date.now() + store.getSnapshot().serverTimeOffset - store.getSnapshot().dayNightStartTime;
    const localProgress = ((serverElapsed / (15 * 60 * 1000)) + (timezone?.offsetMinutes ?? 0) / (24 * 60)) % 1;
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

  socket.on('server.playerBankrupt', (payload) => {
    if (payload.playerId === store.getSnapshot().currentPlayer?.id) {
      store.applyEvent({ sequence: store.nextSequence(), type: 'status', playerId: payload.playerId, status: 'bankrupt' });
      options.controller?.setBankrupt();
    }
    requestHudRefresh();
  });

  socket.on('server.gameState', (payload) => {
    const teamMembers = payload.members ?? [];
    if (payload.visibleCells?.length) store.setCells(payload.visibleCells);
    store.applySnapshot({ sequence: store.nextSequence(), player: payload.player, teamMembers, ownedProperties: payload.ownedProperties, ownedInvestments: payload.ownedInvestments });
  });

  socket.on('server.propertyBought', (payload) => {
    store.setCell(payload.cell);
    store.applyEvent({ sequence: store.nextSequence(), type: 'property', playerId: payload.playerId, cellId: payload.cell.id, level: 0 });
    requestHudRefresh();
  });

  socket.on('server.propertyUpgraded', (payload) => {
    store.setCell(payload.cell);
    store.applyEvent({ sequence: store.nextSequence(), type: 'property', playerId: payload.playerId, cellId: payload.cell.id, level: payload.newLevel });
    requestHudRefresh();
  });

  socket.on('server.investmentBought', (payload) => {
    store.setCell(payload.cell);
    const ownerships = Array.isArray(payload.cell.extra?.ownerships) ? payload.cell.extra.ownerships as Array<{ playerId: string; share: number }> : [];
    const ownership = ownerships.find((item) => item.playerId === payload.playerId);
    if (ownership) store.applyEvent({ sequence: store.nextSequence(), type: 'investment', playerId: payload.playerId, cellId: payload.cell.id, share: ownership.share });
    requestHudRefresh();
  });

  socket.on('server.playerRestarted', (payload) => {
    if (payload.playerId === store.getSnapshot().currentPlayer?.id) {
      store.applySnapshot({ sequence: store.nextSequence(), currentPlayer: payload.player, isBankrupt: false, isInJail: false, currentPlayerPosition: payload.player.position.cellId, currentMoney: payload.player.values.money?.current ?? 0, currentCredit: payload.player.values.credit?.current ?? 0 });
      options.controller?.setRestarted(payload.player);
    }
    requestHudRefresh();
  });

  // 监听聊天消息
  socket.on('server.chat', (payload: { message: { content: string; senderName?: string; channel?: string } }) => {
    const { message } = payload;
    if (message && message.content) {
      store.appendChatMessage({
        id: `server-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        channel: message.channel || 'system',
        senderId: null,
        senderName: message.senderName || t('chat.anonymous'),
        content: message.content,
        timestamp: Date.now(),
      });
    }
  });

  // 监听其他玩家事件
  socket.on('server.playerJoined', (payload: { id: string; username: string; position?: { cellId: number }; status?: string; values?: { money?: { current?: number } } }) => {
    // 添加新玩家或更新已有玩家（重连场景）
    const currentPlayers = store.getSnapshot().otherPlayers;
    const existingIndex = currentPlayers.findIndex(p => p.id === payload.id);
    const playerMoney = payload.values?.money?.current ?? 2000;
    if (payload.status === 'frozen') return;
    const playerData: OtherPlayerInfo = {
      id: payload.id,
      username: payload.username,
      position: { cellId: payload.position?.cellId || 0 },
      status: (payload.status as OtherPlayerInfo['status']) || 'normal',
      primaryValue: playerMoney,
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
      store.applyEvent({ sequence: store.nextSequence(), type: 'move', playerId: payload.playerId, cellId: payload.cellId });
      const snapshot = store.getSnapshot();
      if (store && options.mapIndex && payload.path && payload.path.length > 1 && !snapshot?.isServerAnimating) {
        startServerPathAnimation(store, options.mapIndex, payload.path, () => requestHudRefresh());
      } else {
        requestHudRefresh();
      }
    }
  });

  socket.on('server.askPath', (payload: { fromCellId: number; options: Array<{ cellId: number; label?: string }> }) => {
    if (!store.getSnapshot().currentPlayer) return;
    store.applySnapshot({ sequence: store.nextSequence(), isWaitingForChoice: true });
    options.onPathChoiceOptions?.(payload.options.map(opt => ({ cellId: opt.cellId, label: opt.label || `格子 ${opt.cellId}` })));
    const directionLabels = payload.options.map(o => localizedText(o.label, `格子 ${o.cellId}`));
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
      requestHudRefresh();
    }
  });

  socket.on('server.playerJailed', (payload: { playerId: string; durationMs: number; expiresAt?: number }) => {
    const snapshot = store.getSnapshot();
    if (snapshot.currentPlayer?.id === payload.playerId) store.applyEvent({ sequence: store.nextSequence(), type: 'jail', isInJail: true, jailEndTime: payload.expiresAt ?? Date.now() + payload.durationMs });
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
      requestHudRefresh();
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
            <button onclick="window.acceptTeamInvite()" style="padding: 8px 24px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">${t('team.inviteAccept')}</button>
            <button onclick="window.rejectTeamInvite()" style="padding: 8px 24px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">${t('team.inviteReject')}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    window.rejectTeamInvite = function (): void {
      socket.emit('client.respondToTeamInvite', { inviteId: payload.inviteId, accept: false }, (result: { ok: boolean; error?: string }) => {
        modal.remove();
        if (result.ok) {
          addChatMessage(t('team.inviteRejected', { name: payload.inviterName }), 'system');
        } else {
          addChatMessage(t('team.rejectFailed', { error: result.error || t('common.unknown') }), 'system');
        }
      });
    };

    window.acceptTeamInvite = function (): void {
      socket.emit('client.respondToTeamInvite', { inviteId: payload.inviteId, accept: true }, (result: { ok: boolean; error?: string }) => {
        if (result.ok) {
          modal.remove();
          addChatMessage(t('team.inviteAccepted', { name: payload.inviterName }), 'system');
          // 队伍状态由 server.teamMemberJoined / server.teamUpdated 事件推送，本地不修改
        } else {
          addChatMessage(t('team.joinFailed', { error: result.error || t('common.unknown') }), 'system');
        }
      });
    };
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

  // 监听成员被踢出（仅显示提示，队伍状态以 server.teamUpdated 为准）
  socket.on('server.teamMemberKicked', (payload: { playerId: string }) => {
    if (payload.playerId === store.getSnapshot().currentPlayer?.id) {
      addChatMessage(t('team.youWereKicked'), 'system');
    } else {
      addChatMessage(t('team.memberKicked', { name: payload.playerId }), 'system');
    }
    // teamMembers 由 server.teamUpdated / server.teamDisbanded 事件权威更新
  });

  // 监听队伍状态更新（服务端权威：完整重建本地队伍视图）
  socket.on('server.teamUpdated', (payload: { team?: { id: string }; members?: Array<{ id: string; username: string; money: number; credit: number; env: number; status: string }> }) => {
    if (payload.team && store.getSnapshot().currentPlayer) {
      // 用服务端推送的成员显示数据完整重建 teamMembers
      if (payload.members) {
        store.applyEvent({ sequence: store.nextSequence(), type: 'team', members: payload.members });
      }
      requestHudRefresh();
    }
  });

  // 监听队伍解散（服务端权威）
  socket.on('server.teamDisbanded', () => {
    store.applyEvent({ sequence: store.nextSequence(), type: 'team', members: [] });
    addChatMessage(t('team.teamDisbanded'), 'system');
    requestHudRefresh();
  });

  // 监听服务端繁荣度变化
  socket.on('server.prosperityChanged', (payload: { regionId?: string; monumentId?: number; prosperity: number; delta: number; reason?: string; timestamp?: number }) => {
    if (payload.regionId) {
      store.setProsperity(payload.regionId, payload.prosperity);
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
