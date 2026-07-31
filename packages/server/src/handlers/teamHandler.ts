/**
 * 组队处理器（Team Handler）
 *
 * 负责组队功能的 Socket 事件处理，确保服务端权威：
 * - 所有组队操作（邀请/响应/离开/踢人）由服务端校验并执行
 * - 客户端仅发送请求，不直接修改队伍状态
 * - 服务端广播状态变更给相关玩家
 *
 * 事件协议：
 * 客户端 -> 服务端：
 * - client.inviteToTeam       : 发送组队邀请 { targetPlayerId }
 * - client.respondToTeamInvite: 响应邀请 { inviteId, accept }
 * - client.leaveTeam           : 离开队伍 {}
 * - client.kickTeamMember      : 踢出成员 { targetPlayerId }（仅队长）
 * - client.getTeamState        : 获取队伍状态 {}
 *
 * 服务端 -> 客户端：
 * - server.teamInviteReceived  : 收到邀请 { inviteId, inviterId, inviterName, teamId, expiresAt }
 * - server.teamMemberJoined    : 成员加入 { teamId, playerId, playerName }（仅提示，队伍状态以 teamUpdated 为准）
 * - server.teamMemberLeft      : 成员离开 { teamId, playerId, isLeaderTransferred, newLeaderId? }（仅提示，队伍状态以 teamUpdated 为准）
 * - server.teamMemberKicked    : 成员被踢 { teamId, playerId, kickedBy }（仅提示，队伍状态以 teamUpdated 为准）
 * - server.teamUpdated         : 队伍状态更新 { team, members }（服务端权威：members 携带每个成员的实时显示数据，客户端据此完整重建本地队伍视图）
 * - server.teamDisbanded       : 队伍解散 { teamId }
 * - server.teamInviteResult    : 邀请结果反馈 { ok, error?, invite? }
 * - server.teamState           : 队伍状态响应 { team, members, color }（members 同 teamUpdated，供客户端主动查询）
 *
 * 设计原则：
 * - 与 TeamManager（纯数据层）解耦：Handler 负责 I/O 与协议，Manager 负责状态
 * - 错误统一通过 AckResult 返回，同时 emit server.error 便于诊断
 */

import type { AckResult, Team, Player, ServerToClientEvents } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import { ErrorCodes, emitError } from '../transport/handlers.js';
import { TeamManager, type TeamInvite } from '../team/index.js';

/**
 * 队伍成员显示数据（服务端权威，用于客户端队伍面板渲染）
 */
interface TeamMemberView {
  id: string;
  username: string;
  money: number;
  credit: number;
  env: number;
  status: string;
  isLeader: boolean;
}

/**
 * 队伍状态响应载荷
 */
interface TeamStatePayload {
  team: Team | null;
  members: TeamMemberView[];
  color: string | null;
}

/**
 * 组队处理器
 */
export class TeamHandler {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly teamManager: TeamManager;

  constructor(io: TypedServer, world: GameWorld, teamManager: TeamManager) {
    this.io = io;
    this.world = world;
    this.teamManager = teamManager;
  }

  /**
   * 注册组队相关事件处理器
   */
  register(socket: TypedSocket): void {
    socket.on('client.inviteToTeam', (payload, ack) => {
      this.handleInviteToTeam(socket, payload, ack);
    });

    socket.on('client.respondToTeamInvite', (payload, ack) => {
      this.handleRespondToInvite(socket, payload, ack);
    });

    socket.on('client.leaveTeam', (_payload, ack) => {
      this.handleLeaveTeam(socket, ack);
    });

    socket.on('client.kickTeamMember', (payload, ack) => {
      this.handleKickMember(socket, payload, ack);
    });

    socket.on('client.getTeamState', (_payload, ack) => {
      this.handleGetTeamState(socket, ack);
    });
  }

  // ---------------------------------------------------------------------------
  // 事件处理
  // ---------------------------------------------------------------------------

  /**
   * 处理发送组队邀请
   */
  private handleInviteToTeam(
    socket: TypedSocket,
    payload: { targetPlayerId: string },
    ack?: (result: AckResult<{ invite: TeamInvite }>) => void,
  ): void {
    const playerId = this.getPlayerId(socket);
    if (!playerId) {
      emitError(socket, ErrorCodes.NotAuthenticated, '未认证');
      ack?.({ ok: false, error: 'not_authenticated' });
      return;
    }

    if (!payload?.targetPlayerId) {
      emitError(socket, ErrorCodes.InvalidPayload, '缺少目标玩家 ID');
      ack?.({ ok: false, error: 'invalid_payload' });
      return;
    }

    // 禁止邀请自己
    if (payload.targetPlayerId === playerId) {
      emitError(socket, ErrorCodes.InvalidOperation, '不能邀请自己');
      ack?.({ ok: false, error: 'cannot_invite_self' });
      return;
    }

    // 校验目标玩家是否存在且在线
    const targetPlayer = this.world.getPlayer(payload.targetPlayerId);
    if (!targetPlayer) {
      emitError(socket, ErrorCodes.PlayerNotFound, '目标玩家不存在');
      ack?.({ ok: false, error: 'player_not_found' });
      return;
    }

    const inviterPlayer = this.world.getPlayer(playerId);
    if (!inviterPlayer) {
      emitError(socket, ErrorCodes.PlayerNotFound, '邀请者不存在');
      ack?.({ ok: false, error: 'player_not_found' });
      return;
    }

    // 调用 TeamManager 发送邀请（服务端权威）
    const invite = this.teamManager.sendInvite(
      playerId,
      inviterPlayer.username,
      payload.targetPlayerId,
    );

    if (!invite) {
      emitError(socket, ErrorCodes.InvalidOperation, '邀请发送失败（队伍已满或目标已在队伍中）');
      ack?.({ ok: false, error: 'invite_failed' });
      return;
    }

    logger.info(`组队邀请：${playerId} -> ${payload.targetPlayerId}（邀请 ID: ${invite.id}）`);

    // 向目标玩家推送邀请通知
    this.emitToPlayer(payload.targetPlayerId, 'server.teamInviteReceived', {
      inviteId: invite.id,
      inviterId: invite.inviterId,
      inviterName: invite.inviterName,
      teamId: this.teamManager.getPlayerTeam(playerId)?.id ?? '',
      expiresAt: invite.expiresAt,
    });

    // 向邀请者返回成功
    ack?.({ ok: true, data: { invite } });
  }

  /**
   * 处理响应组队邀请（接受/拒绝）
   */
  private handleRespondToInvite(
    socket: TypedSocket,
    payload: { inviteId: string; accept: boolean },
    ack?: (result: AckResult<{ team: Team | null }>) => void,
  ): void {
    const playerId = this.getPlayerId(socket);
    if (!playerId) {
      emitError(socket, ErrorCodes.NotAuthenticated, '未认证');
      ack?.({ ok: false, error: 'not_authenticated' });
      return;
    }

    if (!payload?.inviteId || typeof payload.accept !== 'boolean') {
      emitError(socket, ErrorCodes.InvalidPayload, '缺少邀请 ID 或 accept 参数');
      ack?.({ ok: false, error: 'invalid_payload' });
      return;
    }

    const player = this.world.getPlayer(playerId);
    if (!player) {
      emitError(socket, ErrorCodes.PlayerNotFound, '玩家不存在');
      ack?.({ ok: false, error: 'player_not_found' });
      return;
    }

    // 调用 TeamManager 响应邀请（服务端权威）
    const team = this.teamManager.respondInvite(
      payload.inviteId,
      playerId,
      payload.accept,
    );

    if (payload.accept && !team) {
      emitError(socket, ErrorCodes.InvalidOperation, '接受邀请失败（邀请已过期或队伍已满）');
      ack?.({ ok: false, error: 'accept_failed' });
      return;
    }

    if (payload.accept && team) {
      logger.info(`玩家 ${playerId} 接受组队邀请，加入队伍 ${team.id}`);

      // 通知全队有新成员加入
      this.broadcastToTeam(team, 'server.teamMemberJoined', {
        teamId: team.id,
        playerId,
        playerName: player.username,
      });

      // 广播队伍状态更新
      this.notifyTeamUpdated(team);

      ack?.({ ok: true, data: { team } });
    } else {
      logger.info(`玩家 ${playerId} 拒绝了组队邀请`);
      ack?.({ ok: true, data: { team: null } });
    }
  }

  /**
   * 处理离开队伍
   */
  private handleLeaveTeam(
    socket: TypedSocket,
    ack?: (result: AckResult<{ teamDisbanded: boolean }>) => void,
  ): void {
    const playerId = this.getPlayerId(socket);
    if (!playerId) {
      emitError(socket, ErrorCodes.NotAuthenticated, '未认证');
      ack?.({ ok: false, error: 'not_authenticated' });
      return;
    }

    const team = this.teamManager.getPlayerTeam(playerId);
    if (!team) {
      emitError(socket, ErrorCodes.InvalidOperation, '不在队伍中');
      ack?.({ ok: false, error: 'not_in_team' });
      return;
    }

    const teamId = team.id;
    const remainingMembers = team.memberIds.slice();

    // 调用 TeamManager 离开队伍（服务端权威）
    const result = this.teamManager.leaveTeam(playerId);
    if (!result) {
      emitError(socket, ErrorCodes.InternalError, '离开队伍失败');
      ack?.({ ok: false, error: 'leave_failed' });
      return;
    }

    const isDisbanded = result.team === null;

    logger.info(`玩家 ${playerId} 离开队伍 ${teamId}（解散: ${isDisbanded}）`);

    if (isDisbanded) {
      // 队伍解散：通知所有原成员
      for (const memberId of remainingMembers) {
        this.emitToPlayer(memberId, 'server.teamDisbanded', { teamId });
      }
    } else if (result.team) {
      // 队伍仍存在：通知全队有成员离开
      this.broadcastToTeam(result.team, 'server.teamMemberLeft', {
        teamId: result.team.id,
        playerId,
        isLeaderTransferred: result.team.leaderId !== playerId,
        newLeaderId: result.team.leaderId !== playerId ? result.team.leaderId : undefined,
      });
      this.notifyTeamUpdated(result.team);
    }

    ack?.({ ok: true, data: { teamDisbanded: isDisbanded } });
  }

  /**
   * 处理踢出成员（仅队长）
   */
  private handleKickMember(
    socket: TypedSocket,
    payload: { targetPlayerId: string },
    ack?: (result: AckResult) => void,
  ): void {
    const playerId = this.getPlayerId(socket);
    if (!playerId) {
      emitError(socket, ErrorCodes.NotAuthenticated, '未认证');
      ack?.({ ok: false, error: 'not_authenticated' });
      return;
    }

    if (!payload?.targetPlayerId) {
      emitError(socket, ErrorCodes.InvalidPayload, '缺少目标玩家 ID');
      ack?.({ ok: false, error: 'invalid_payload' });
      return;
    }

    const team = this.teamManager.getPlayerTeam(playerId);
    if (!team) {
      emitError(socket, ErrorCodes.InvalidOperation, '不在队伍中');
      ack?.({ ok: false, error: 'not_in_team' });
      return;
    }

    // 权限校验：仅队长可踢人
    if (team.leaderId !== playerId) {
      emitError(socket, ErrorCodes.InvalidOperation, '仅队长可踢出成员');
      ack?.({ ok: false, error: 'not_leader' });
      return;
    }

    // 校验目标是否在同一队伍
    if (!team.memberIds.includes(payload.targetPlayerId)) {
      emitError(socket, ErrorCodes.InvalidOperation, '目标玩家不在队伍中');
      ack?.({ ok: false, error: 'target_not_in_team' });
      return;
    }

    // 禁止踢自己（应使用离开队伍）
    if (payload.targetPlayerId === playerId) {
      emitError(socket, ErrorCodes.InvalidOperation, '不能踢出自己，请使用离开队伍');
      ack?.({ ok: false, error: 'cannot_kick_self' });
      return;
    }

    const teamId = team.id;

    // 调用 TeamManager 踢出成员（复用 leaveTeam 逻辑）
    const result = this.teamManager.leaveTeam(payload.targetPlayerId);
    if (!result) {
      emitError(socket, ErrorCodes.InternalError, '踢出成员失败');
      ack?.({ ok: false, error: 'kick_failed' });
      return;
    }

    logger.info(`玩家 ${payload.targetPlayerId} 被队长 ${playerId} 踢出队伍 ${teamId}`);

    // 通知被踢玩家
    this.emitToPlayer(payload.targetPlayerId, 'server.teamMemberKicked', {
      teamId,
      playerId: payload.targetPlayerId,
      kickedBy: playerId,
    });

    if (result.team) {
      // 通知全队有成员被踢
      this.broadcastToTeam(result.team, 'server.teamMemberKicked', {
        teamId: result.team.id,
        playerId: payload.targetPlayerId,
        kickedBy: playerId,
      });
      this.notifyTeamUpdated(result.team);
    } else {
      // 队伍解散
      this.emitToPlayer(playerId, 'server.teamDisbanded', { teamId });
    }

    ack?.({ ok: true });
  }

  /**
   * 处理获取队伍状态
   */
  private handleGetTeamState(
    socket: TypedSocket,
    ack?: (result: AckResult<TeamStatePayload>) => void,
  ): void {
    const playerId = this.getPlayerId(socket);
    if (!playerId) {
      emitError(socket, ErrorCodes.NotAuthenticated, '未认证');
      ack?.({ ok: false, error: 'not_authenticated' });
      return;
    }

    const team = this.teamManager.getPlayerTeam(playerId);
    if (!team) {
      ack?.({ ok: true, data: { team: null, members: [], color: null } });
      return;
    }

    const members = this.buildMemberViews(team);
    const color = this.teamManager.getTeamColor(team.id) ?? null;

    ack?.({ ok: true, data: { team, members, color } });
  }

  // ---------------------------------------------------------------------------
  // 辅助方法
  // ---------------------------------------------------------------------------

  /**
   * 从 socket 获取已认证的玩家 ID
   */
  private getPlayerId(socket: TypedSocket): string | undefined {
    return socket.data.playerId
      ?? this.world.getPlayerManager().getPlayerIdBySocketId(socket.id);
  }

  /**
   * 向指定玩家发送事件（通过其绑定的 socket）
   *
   * 注意：event 使用 keyof ServerToClientEvents 保证类型安全，payload 为 unknown
   * 因为各事件的 payload 类型不同，由调用处保证正确性。
   */
  private emitToPlayer<K extends keyof ServerToClientEvents>(
    playerId: string,
    event: K,
    payload: Parameters<ServerToClientEvents[K]>[0],
  ): void {
    const socketId = this.world.getPlayerManager().getSocketId(playerId);
    if (!socketId) {
      logger.debug(`玩家 ${playerId} 离线，无法发送事件 ${String(event)}`);
      return;
    }
    const socket = this.io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit(event, ...([payload] as Parameters<ServerToClientEvents[K]>));
    } else {
      logger.debug(`玩家 ${playerId} 的 socket ${socketId} 不存在，无法发送事件 ${String(event)}`);
    }
  }

  /**
   * 向全队成员广播事件
   */
  private broadcastToTeam<K extends keyof ServerToClientEvents>(
    team: Team,
    event: K,
    payload: Parameters<ServerToClientEvents[K]>[0],
  ): void {
    for (const memberId of team.memberIds) {
      this.emitToPlayer(memberId, event, payload);
    }
  }

  /**
   * 通知队伍状态更新（包含共享数值同步）
   *
   * 服务端权威：payload 携带完整的队伍对象和每个成员的显示数据，
   * 客户端据此完整重建本地队伍视图，无需任何本地推测。
   */
  private notifyTeamUpdated(team: Team): void {
    // 收集队员数据
    const players: Player[] = [];
    for (const memberId of team.memberIds) {
      const player = this.world.getPlayer(memberId);
      if (player) {
        players.push(player);
      }
    }

    // 步骤1：计算队伍共享数值（服务端权威）
    this.teamManager.updateTeamSharedValues(team.id, players);

    // 步骤2：同步共享数值回每个队员 player.values（组队附带效果 - 服务端权威）
    const syncedPlayers = this.teamManager.syncTeamValuesToMembers(team.id, players);
    for (const synced of syncedPlayers) {
      const original = this.world.getPlayer(synced.id);
      if (original) {
        // 检测数值差异，发送 valueChanged 广播（客户端权威同步）
        for (const fieldId of Object.keys(synced.values)) {
          const oldVal = original.values[fieldId]?.current;
          const newVal = synced.values[fieldId]?.current;
          if (oldVal !== undefined && newVal !== undefined && oldVal !== newVal) {
            const payload: Parameters<ServerToClientEvents['server.valueChanged']>[0] = {
              playerId: synced.id,
              fieldId,
              current: newVal,
              delta: newVal - oldVal,
            };
            this.io.emit('server.valueChanged', payload);
          }
        }
      }
      // 保存更新后的玩家状态（含共享值同步后的 teamId 和 values）
      this.world.updatePlayer(synced);
    }

    // 步骤3：推送最新队伍状态（含 members）给全体队员
    const updatedTeam = this.teamManager.getTeam(team.id);
    if (updatedTeam) {
      const members = this.buildMemberViews(updatedTeam);
      this.broadcastToTeam(updatedTeam, 'server.teamUpdated', {
        team: updatedTeam,
        members,
      });
    }
  }

  /**
   * 构建队伍成员显示数据（服务端权威）
   *
   * 从 GameWorld 读取每个成员的实时数值与状态，供客户端直接渲染。
   */
  private buildMemberViews(team: Team): TeamMemberView[] {
    return team.memberIds.map(id => {
      const player = this.world.getPlayer(id);
      const v = player?.values ?? {};
      return {
        id,
        username: player?.username ?? '未知玩家',
        money: v.money?.current ?? 0,
        credit: v.credit?.current ?? 0,
        env: v.environment?.current ?? v.env?.current ?? 0,
        status: player?.status ?? 'normal',
        isLeader: team.leaderId === id,
      };
    });
  }
}
