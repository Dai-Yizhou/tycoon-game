/**
 * Socket 事件处理器
 *
 * 从 GamePage.ts 中提取的所有 socket 事件处理逻辑。
 * 管理服务端推送的各类事件，同步状态到 GameStore 并触发 UI 更新。
 */

import type { TypedClientSocket } from '../../hooks/useSocket.js';
import { localizedText, t } from '../i18n.js';
import type { OtherPlayerInfo } from '../../state/GameStore.js';
import { addChatMessage } from './ChatSystem.js';
import { startServerPathAnimation, startOtherPlayerMove } from './MovementSystem.js';
import { noopHudRefresh, type HudRefresh } from '../ClientHudBridge.js';
import type { GameController } from '../GameController.js';
import { GameStore } from '../../state/GameStore.js';
import { formatUct, type MapIndex, type Player } from '@game/shared';
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
  /** 进入监狱时触发：用于启动监狱冷却揭示动画 ticker */
  onJailCooldownStart?: () => void;
  movementEffects?: MovementEffectHooks;
}

const SOCKET_EVENTS = [
  'server.dayNightProgress', 'server.dayNightChanged', 'server.pong',
  'server.chat', 'server.leaderboardUpdated', 'connect', 'disconnect',
  'server.playerJoined', 'server.playerLeft', 'server.playerMoved', 'server.askPath',
  'server.valueChanged', 'server.error', 'server.playerJailed', 'server.playerReleased', 'server.playerStatusChanged',
  'server.behaviorMessage',
  'server.teamInviteReceived', 'server.teamMemberJoined', 'server.teamMemberLeft',
  'server.teamUpdated', 'server.teamDisbanded', 'server.regionValueChanged', 'server.teamValueTable', 'server.gameState',
  'server.valueFieldDefinitions', 'server.diceRolled', 'server.notification', 'server.achievementUnlocked', 'server.playerBankrupt', 'server.playerRestarted',
  'server.propertyBought', 'server.propertyUpgraded', 'server.investmentBought', 'server.investmentEventTriggered',
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

  // 阶段切换：同步时间。昼夜状态由 HUD 昼夜指示器直观呈现，不再推送聊天提示
  socket.on('server.dayNightChanged', (payload: { cycleStartTime: number; cycleMinutes: number; globalTime: number; isDay: boolean }) => {
    store.updateDayNight({ dayNightStartTime: payload.cycleStartTime, serverTimeOffset: payload.globalTime - Date.now(), cycleMinutes: payload.cycleMinutes });
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
    const currentSnapshot = store.getSnapshot();
    if (currentSnapshot.leaderboard.status === 'offline') {
      store.setLeaderboard(currentSnapshot.leaderboard.snapshot);
      refresh();
    }
    // 重连对账：若已登录（currentPlayer 存在），此 connect 为断线重连而非首次连接。
    // 重发 client.login（服务端幂等，仅解冻）拉取权威 existingPlayers，重建 otherPlayers，
    // 避免断线期间 playerLeft/playerJoined 增量丢失导致"视野内其他玩家不显示"。
    const currentPlayer = currentSnapshot.currentPlayer;
    const username = currentPlayer?.username;
    if (currentPlayer && username) {
      socket.emit('client.login', { username }, (result) => {
        if (!store || !result?.ok) return;
        const players = (result.data?.existingPlayers ?? []).map((p) => ({
          id: p.id,
          username: p.username,
          position: p.position,
          status: p.status || 'normal',
          primaryValue: Object.values(p.values ?? {}).find((field) => field.scope !== 'region')?.current ?? 0,
        }));
        if (players.length === 0) return;
        store.applyEvent({ sequence: store.nextSequence(), type: 'players', players });
        refresh();
      });
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
    // 登录即以服务端权威 region UCT 覆盖 regionValues，替换静态配置 initial 的过期快照
    if (payload.regionValues && Object.keys(payload.regionValues).length > 0) {
      store.applySnapshot({
        sequence: store.nextSequence(),
        regionValues: new Map(Object.entries(payload.regionValues).map(([id, values]) => [id, { ...values }])),
      });
    }
    // 登录/重连即用服务端权威团队 UCT 汇总表覆盖 teamValueTable
    if (payload.teamValues && payload.player?.id === currentSnapshot.currentPlayer?.id) {
      store.setTeamValueTable(payload.teamValues);
    }
    store.applySnapshot({ sequence: store.nextSequence(), player: payload.player, teamMembers, ownedProperties: payload.ownedProperties, ownedInvestments: payload.ownedInvestments });
  });

  socket.on('server.propertyBought', (payload) => {
    store.setCell(payload.cell);
    store.setCellRuntimeState(payload.cell.id, payload.runtime);
    store.setBoughtPrice(payload.cell.id, payload.price);
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

  // 监听行为消息：仅当当前玩家是目标玩家时推送到其聊天区（系统频道）
  socket.on('server.behaviorMessage', (payload) => {
    const selfId = store.getSnapshot().currentPlayer?.id;
    if (!selfId || !payload.playerIds.includes(selfId)) return;
    store.appendChatMessage({ text: localizedText(payload.msg, payload.behaviorId), channel: 'system', timestamp: payload.timestamp ?? Date.now() });
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
      // 其他玩家：优先做权威带路径的逐格插值动画（避免跳变）；无有效路径则退回瞬移对齐权威格。
      // self 的带路径移动由下方 activePlayer 分支走 startServerPathAnimation。
      const mapIndex = options.getMapIndex?.() ?? options.mapIndex;
      if (mapIndex && payload.path && payload.path.length > 1) {
        startOtherPlayerMove(store, mapIndex, payload.playerId, payload.path);
      } else {
        store.applyEvent({ sequence: store.nextSequence(), type: 'otherPlayerMove', playerId: payload.playerId, cellId: payload.cellId });
      }
    }
    const activePlayer = store.getSnapshot().currentPlayer;
    if (activePlayer && payload.playerId === activePlayer.id) {
      const snapshot = store.getSnapshot();
      const activeMapIndex = options.getMapIndex?.() ?? options.mapIndex;
      // 权威带路径移动：任何时刻都必须启动一段新动画，不能像无路径位置同步那样
      // 在动画期丢弃。否则一旦某次动画中断残留 isServerAnimating=true，后续所有
      // 权威移动都会被拦截——表现为"掷骰后卡在移动状态，但棋子未移动"。
      if (activeMapIndex && payload.path && payload.path.length > 1) {
        startServerPathAnimation(store, activeMapIndex, payload.path, refresh, options.movementEffects, payload.cellId, refresh);
      } else {
        // 无路径位置同步：动画进行中忽略（moveHandler 的 updatePlayer 会额外广播
        // 一个不含 path 的 server.playerMoved，可能先/后到达），避免把动画权威位置
        // 直接当成跳转整格覆盖。带 path 的先生成，随后无 path 的会被此守卫拦截。
        if (snapshot.isServerAnimating) return;
        // 无路径 playerMoved。仅当目标格与当前格不同（真实跳变/传送）才播黑圆转场；
        // 相同格则为位置同步（如掷骰后等待岔路选择前的确认），不进入黑屏，避免误触发。
        const applyMove = (): void => {
          store.applyEvent({ sequence: store.nextSequence(), type: 'move', playerId: payload.playerId, cellId: payload.cellId });
          refresh();
        };
        if (payload.cellId !== snapshot.currentPlayerPosition) {
          if (options.movementEffects) options.movementEffects.onTeleport(payload.cellId, applyMove);
          else applyMove();
        } else {
          applyMove();
        }
      }
    }
  });

  socket.on('server.askPath', (payload: { fromCellId: number; options: Array<{ cellId: number; label?: unknown }> }) => {
    if (!store.getSnapshot().currentPlayer) return;
    store.applySnapshot({ sequence: store.nextSequence(), isWaitingForChoice: true });
    options.onPathChoiceOptions?.(payload.options.map(opt => ({ cellId: opt.cellId, label: opt.label })));
    // 岔路方向已由路径选择器（act-bar A/B 按钮）直观呈现，不再推送聊天提示
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
    if (snapshot.currentPlayer?.id === payload.playerId) store.applyEvent({ sequence: store.nextSequence(), type: 'jail', isInJail: true, jailEndTime: payload.expiresAt ?? Date.now() + payload.durationMs, jailDurationMs: payload.durationMs });
    options.onJailCooldownStart?.();
    // 进出监狱由掷骰按钮的禁用/可用状态直观体现，不再推送聊天提示
    const isCurrentPlayer = snapshot.currentPlayer?.id === payload.playerId;
    if (isCurrentPlayer) {
      store.applyEvent({ sequence: store.nextSequence(), type: 'status', playerId: payload.playerId, status: 'jail' });
    } else {
      const otherPlayer = snapshot.otherPlayers.find(p => p.id === payload.playerId);
      if (otherPlayer) {
        store.applyEvent({ sequence: store.nextSequence(), type: 'otherPlayerStatus', playerId: payload.playerId, status: 'jail' });
      }
    }
  });

  socket.on('server.playerReleased', (payload: { playerId: string }) => {
    const snapshot = store.getSnapshot();
    if (snapshot.currentPlayer?.id === payload.playerId) store.applyEvent({ sequence: store.nextSequence(), type: 'jail', isInJail: false, jailEndTime: 0, jailDurationMs: 0 });
    // 服务端权威：出狱状态由服务端驱动
    const isCurrentPlayer = snapshot.currentPlayer?.id === payload.playerId;
    if (isCurrentPlayer) {
      store.applyEvent({ sequence: store.nextSequence(), type: 'status', playerId: payload.playerId, status: 'normal' });
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

  socket.on('server.investmentEventTriggered', (payload) => {
    const playerId = store.getSnapshot().currentPlayer?.id;
    const affected = playerId ? payload.affectedPlayers.find((item) => item.playerId === playerId) : undefined;
    if (!affected) return;
    options.onNotification?.({
      id: `investment-${payload.investmentId}-${store.nextSequence()}`,
      type: investmentImpactType(affected.amount),
      title: t('investment.title'),
      content: formatInvestmentImpact(affected.amount),
      durationMs: 4000,
    });
    refresh();
  });

  // 监听服务端区域 UCT 数值变化（昼夜切换、纪念碑修缮等统一广播）
  socket.on('server.regionValueChanged', (payload: { regionId?: string; fieldId?: string; value?: number; delta: number; reason?: string; timestamp?: number }) => {
    if (payload.regionId && payload.fieldId && typeof payload.value === 'number') {
      store.setRegionValue(payload.regionId, payload.fieldId, payload.value);
    }
  });

  // 监听当前玩家团队的 UCT 汇总表变化（服务端权威均值，随数值/队伍变更推送）
  socket.on('server.teamValueTable', (payload: { playerId: string; teamValues: Record<string, number> }) => {
    if (payload.playerId === store.getSnapshot().currentPlayer?.id) {
      store.setTeamValueTable(payload.teamValues);
      refresh();
    }
  });
}

/**
 * 注销所有 socket 事件处理器
 */
function formatInvestmentImpact(amount: import('@game/shared').Uct): string {
  return formatUct(amount, []);
}

function investmentImpactType(amount: import('@game/shared').Uct): 'success' | 'warning' | 'info' {
  const values = [...Object.values(amount.player ?? {}), ...Object.values(amount.region ?? {})];
  const total = values.reduce((sum, value) => sum + value, 0);
  return total > 0 ? 'success' : total < 0 ? 'warning' : 'info';
}

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
