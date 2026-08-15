/**
 * Socket 事件处理器
 *
 * 从 GamePage.ts 中提取的所有 socket 事件处理逻辑。
 * 管理服务端推送的各类事件，同步状态到 GameStore 并触发 UI 更新。
 */

import { t } from '@game/shared';
import type { TypedClientSocket } from '../../hooks/useSocket.js';
import {
  currentPlayer,
  currentPlayerPosition,
  otherPlayers,
  isServerAnimating,
  regionProsperityMap,
  rollBtn,
  rollCooldownTimer,
  setDayNightCycle,
  setDayNightStartTime,
  setServerTimeOffset,
  setCurrentPlayerPosition,
  setCurrentMoney,
  setCurrentCredit,
  setCurrentEnv,
  setIsInJail,
  setIsBankrupt,
  setJailEndTime,
  setCanRoll,
  setIsWaitingForChoice,
  setProsperity,
  setTeamMembers,
  setOtherPlayers,
  getRegionByCellId,
} from '../../state/GameStore.js';
import type { OtherPlayerInfo } from '../../state/GameStore.js';
import { addChatMessage } from './ChatSystem.js';
import { startServerPathAnimation, showIntersectionChoice } from './MovementSystem.js';
import { requestHudRefresh } from '../ClientHudBridge.js';
import { updateRendererPlayers, updateBoardTheme, updateTopBarTime } from '../ClientRenderLoop.js';
import { getPlayerTimezone, getLocalDayNight } from './MapLoader.js';
import { applyTeamMembers } from './TeamSystem.js';

const registeredSockets = new WeakSet<TypedClientSocket>();
const eventObservers = new WeakMap<TypedClientSocket, (event: string) => void>();

export interface SocketHandlerOptions {
  onEvent?: (event: string) => void;
  onNotification?: (payload: { id: string; type: 'info' | 'success' | 'warning' | 'error'; title: string; content: string; durationMs?: number; createdAt?: number }) => void;
}

const SOCKET_EVENTS = [
  'server.dayNightProgress', 'server.dayNightChanged', 'server.timezoneChanged', 'server.pong',
  'server.chat', 'server.playerJoined', 'server.playerLeft', 'server.playerMoved', 'server.askPath',
  'server.valueChanged', 'server.playerJailed', 'server.playerReleased', 'server.playerStatusChanged',
  'server.teamInviteReceived', 'server.teamMemberJoined', 'server.teamMemberLeft', 'server.teamMemberKicked',
  'server.teamUpdated', 'server.teamDisbanded', 'server.prosperityChanged', 'server.gameState',
  'server.valueFieldDefinitions', 'server.diceRolled', 'server.notification', 'server.playerBankrupt', 'server.playerRestarted',
] as const;

/**
 * 注册所有 socket 事件处理器
 */
export function registerSocketHandlers(socket: TypedClientSocket, options: SocketHandlerOptions = {}): void {
  if (registeredSockets.has(socket)) return;
  registeredSockets.add(socket);
  if (options.onEvent && socket.onAny) {
    const observer = (event: string) => {
      queueMicrotask(() => options.onEvent?.(event));
    };
    eventObservers.set(socket, observer);
    socket.onAny(observer);
  }
  // 每秒进度更新：同步 cycleStartTime 和计算时钟偏移
  socket.on('server.dayNightProgress', (payload: { cycleStartTime: number; cycleMinutes: number; globalTime: number }) => {
    setDayNightStartTime(payload.cycleStartTime);
    setDayNightCycle(payload.cycleMinutes * 60 * 1000);
    // 校正客户端时钟：serverTime - Date.now() = offset
    setServerTimeOffset(payload.globalTime - Date.now());
  });

  // 阶段切换：同步时间
  socket.on('server.dayNightChanged', (payload: { cycleStartTime: number; cycleMinutes: number; globalTime: number; isDay: boolean }) => {
    setDayNightStartTime(payload.cycleStartTime);
    setDayNightCycle(payload.cycleMinutes * 60 * 1000);
    setServerTimeOffset(payload.globalTime - Date.now());
    const phaseMsg = payload.isDay ? t('dayNight.day') : t('dayNight.night');
    addChatMessage(t('dayNight.dayChanged', { phase: phaseMsg }), 'system');
  });

  // 时区变化
  socket.on('server.timezoneChanged', (payload: { toTimezoneName?: string; toTimezoneId?: string }) => {
    const tzName = payload.toTimezoneName || payload.toTimezoneId || '';
    const tz = getPlayerTimezone();
    const { timeStr, isDay } = getLocalDayNight(tz);
    addChatMessage(t('dayNight.timezoneChanged', { tz: tzName, time: timeStr, dayNight: isDay ? t('dayNight.dayTime') : t('dayNight.nightTime') }), 'system');
    updateTopBarTime();
    updateBoardTheme();
  });

  // 心跳校正时钟偏移
  socket.on('server.pong', (payload: { serverTime: number }) => {
    setServerTimeOffset(payload.serverTime - Date.now());
  });

  socket.on('server.notification', (payload: { id: string; type: 'info' | 'success' | 'warning' | 'error'; title: string; content: string; durationMs?: number }) => {
    options.onNotification?.(payload);
  });

  socket.on('server.playerBankrupt', (payload) => {
    if (payload.playerId === currentPlayer?.id) setIsBankrupt(true);
    requestHudRefresh();
  });

  socket.on('server.playerRestarted', (payload) => {
    if (payload.playerId === currentPlayer?.id) setIsBankrupt(false);
    requestHudRefresh();
  });

  // 监听聊天消息
  socket.on('server.chat', (payload: { message: { content: string; senderName?: string; channel?: string } }) => {
    const { message } = payload;
    if (message && message.content) {
      const senderName = message.senderName || t('chat.anonymous');
      const channel = message.channel || 'system';
      addChatMessage(`${senderName}: ${message.content}`, channel);
    }
  });

  // 监听其他玩家事件
  socket.on('server.playerJoined', (payload: { id: string; username: string; position?: { cellId: number }; status?: string; values?: { money?: { current?: number } } }) => {
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
      addChatMessage(t('player.joined', { name: payload.username }), 'system');
    } else {
      otherPlayers[existingIndex] = playerData;
    }
    updateRendererPlayers();
  });

  socket.on('server.playerLeft', (payload: { playerId: string }) => {
    // 从列表移除玩家
    const player = otherPlayers.find(p => p.id === payload.playerId);
    if (player) {
      setOtherPlayers(otherPlayers.filter(p => p.id !== payload.playerId));
      addChatMessage(t('player.left', { name: player.username }), 'system');
      updateRendererPlayers();
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
    const player = otherPlayers.find(p => p.id === payload.playerId);
    if (player) {
      player.position.cellId = payload.cellId;
      updateRendererPlayers();
    }
    if (currentPlayer && payload.playerId === currentPlayer.id) {
      if (payload.path && payload.path.length > 1 && !isServerAnimating) {
        startServerPathAnimation(payload.path);
      } else {
        setCurrentPlayerPosition(payload.cellId);
      }
    }
  });

  socket.on('server.askPath', (payload: { fromCellId: number; options: Array<{ cellId: number; label?: string }> }) => {
    if (!currentPlayer) return;
    setIsWaitingForChoice(true);
    const optionIds = payload.options.map(opt => opt.cellId);
    showIntersectionChoice(optionIds);
    addChatMessage(t('intersection.chooseDirection', { options: payload.options.map(o => o.label).join(' / ') }), 'system');
  });

  socket.on('server.valueChanged', (payload: { playerId: string; fieldId: string; current: number; delta: number }) => {
    // 服务端权威：所有数值变更以服务端推送为准
    const isCurrentPlayer = currentPlayer && payload.playerId === currentPlayer.id;
    if (payload.fieldId === 'money') {
      // 更新其他玩家显示数值
      const otherPlayer = otherPlayers.find(p => p.id === payload.playerId);
      if (otherPlayer) {
        otherPlayer.primaryValue = payload.current;
      }
      // 更新当前玩家：服务端权威同步
      if (isCurrentPlayer) {
        currentPlayer!.values.money.current = payload.current;
        setCurrentMoney(payload.current);
      }
      if (otherPlayer || isCurrentPlayer) {
        updateRendererPlayers();
      }
      if (isCurrentPlayer) requestHudRefresh();
    } else if (payload.fieldId === 'credit') {
      if (isCurrentPlayer) {
        currentPlayer!.values.credit.current = payload.current;
        setCurrentCredit(payload.current);
      }
    } else if (payload.fieldId === 'environment' || payload.fieldId === 'env') {
      if (isCurrentPlayer) {
        const env = currentPlayer!.values.environment || currentPlayer!.values.env;
        if (env) env.current = payload.current;
        setCurrentEnv(payload.current);
      }
    }
    // 数值变更后刷新顶部面板
    if (isCurrentPlayer) {
      requestHudRefresh();
    }
  });

  socket.on('server.playerJailed', (payload: { playerId: string; durationMs: number }) => {
    // 服务端权威：监狱状态由服务端驱动
    const isCurrentPlayer = currentPlayer && payload.playerId === currentPlayer.id;
    if (isCurrentPlayer) {
      setIsInJail(true);
      setJailEndTime(Date.now() + payload.durationMs);
      currentPlayer!.status = 'jail';
      // 禁用掷骰按钮
      if (rollBtn) {
        rollBtn.disabled = true;
        rollBtn.classList.add('disabled', 'cooldown');
      }
      addChatMessage(t('jail.inJail'), 'system');
    } else {
      const otherPlayer = otherPlayers.find(p => p.id === payload.playerId);
      if (otherPlayer) {
        otherPlayer.status = 'jail';
        updateRendererPlayers();
      }
    }
  });

  socket.on('server.playerReleased', (payload: { playerId: string }) => {
    // 服务端权威：出狱状态由服务端驱动
    const isCurrentPlayer = currentPlayer && payload.playerId === currentPlayer.id;
    if (isCurrentPlayer) {
      setIsInJail(false);
      setJailEndTime(0);
      currentPlayer!.status = 'normal';
      // 冷却结束后恢复掷骰能力
      setCanRoll(true);
      if (rollBtn && !rollCooldownTimer) {
        rollBtn.disabled = false;
        rollBtn.classList.remove('disabled', 'cooldown');
        rollBtn.textContent = t('dice.roll');
        rollBtn.style.background = '';
      }
      addChatMessage(t('jail.released'), 'system');
      requestHudRefresh();
    } else {
      const otherPlayer = otherPlayers.find(p => p.id === payload.playerId);
      if (otherPlayer) {
        otherPlayer.status = 'normal';
        updateRendererPlayers();
      }
    }
  });

  socket.on('server.playerStatusChanged', (payload: { playerId: string; status: string }) => {
    // 更新玩家状态
    const player = otherPlayers.find(p => p.id === payload.playerId);
    if (player) {
      player.status = payload.status as OtherPlayerInfo['status'];
      updateRendererPlayers();
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
    if (payload.playerId === currentPlayer?.id) {
      addChatMessage(t('team.youWereKicked'), 'system');
    } else {
      addChatMessage(t('team.memberKicked', { name: payload.playerId }), 'system');
    }
    // teamMembers 由 server.teamUpdated / server.teamDisbanded 事件权威更新
  });

  // 监听队伍状态更新（服务端权威：完整重建本地队伍视图）
  socket.on('server.teamUpdated', (payload: { team?: { id: string }; members?: Array<{ id: string; username: string; money: number; credit: number; env: number; status: string }> }) => {
    if (payload.team && currentPlayer) {
      currentPlayer.teamId = payload.team.id;
      // 用服务端推送的成员显示数据完整重建 teamMembers
      if (payload.members) {
        applyTeamMembers(payload.members);
      }
      requestHudRefresh();
    }
  });

  // 监听队伍解散（服务端权威）
  socket.on('server.teamDisbanded', () => {
    setTeamMembers([]);
    if (currentPlayer) {
      currentPlayer.teamId = null;
    }
    addChatMessage(t('team.teamDisbanded'), 'system');
    requestHudRefresh();
  });

  // 监听服务端繁荣度变化
  socket.on('server.prosperityChanged', (payload: { regionId?: string; monumentId?: number; prosperity: number; delta: number; reason?: string; timestamp?: number }) => {
    if (payload.regionId) {
      regionProsperityMap.set(payload.regionId, payload.prosperity);
      // 如果玩家在当前区域，更新显示
      const currentRegion = getRegionByCellId(currentPlayerPosition);
      if (currentRegion && currentRegion.id === payload.regionId) {
        setProsperity(payload.prosperity);
      }
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
