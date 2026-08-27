/**
 * 组队管理器（Team Manager）
 *
 * 负责队伍生命周期管理：
 * - 组队邀请发送与接受
 * - 队伍合并与分离逻辑
 * - 队伍标识（棋盘上的队伍颜色）
 * - 队员离线队伍不解散
 * - 禁止玩家之间直接交易地产
 *
 * 设计原则：
 * - 不依赖 Socket.IO；纯数据层，可独立测试
 * - 同步 API；持久化由外部包装
 * - 队伍成员离线不解散
 */

import { randomUUID } from 'node:crypto';
import type { Team } from '@game/shared';
import { logger } from '../utils/logger.js';

/**
 * 组队邀请
 */
export interface TeamInvite {
  /** 邀请唯一 ID */
  id: string;
  /** 邀请者 ID */
  inviterId: string;
  /** 邀请者名称（用于显示） */
  inviterName: string;
  /** 目标玩家 ID */
  targetId: string;
  /** 邀请创建时间（Unix 毫秒） */
  createdAt: number;
  /** 邀请过期时间（Unix 毫秒） */
  expiresAt: number;
  /** 邀请状态 */
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
}

/**
 * 组队配置
 */
export interface TeamConfig {
  /** 组队邀请有效期（毫秒），默认 60 秒 */
  inviteExpireMs: number;
  /** 最大队伍人数，默认 4 */
  maxTeamSize: number;
}

/**
 * 默认组队配置
 */
export const DEFAULT_TEAM_CONFIG: TeamConfig = {
  inviteExpireMs: 60_000,
  maxTeamSize: 4,
};

/**
 * 队伍颜色列表
 */
const TEAM_COLORS = [
  '#FF6B6B', // 红色
  '#4ECDC4', // 青色
  '#45B7D1', // 蓝色
  '#96CEB4', // 绿色
  '#FFEAA7', // 黄色
  '#DDA0DD', // 紫色
  '#98D8C8', // 浅绿
  '#F7DC6F', // 金色
];

/**
 * 组队管理器
 */
export class TeamManager {
  private readonly teams: Map<string, Team> = new Map();
  private readonly invites: Map<string, TeamInvite> = new Map();
  private readonly playerTeamBindings: Map<string, string> = new Map();
  private readonly teamColors: Map<string, string> = new Map();
  private readonly teamOperators: Map<string, string> = new Map();
  private readonly config: TeamConfig;
  private readonly teamDisbandedListeners: Array<(teamId: string, memberIds: string[]) => void> = [];

  constructor(config: TeamConfig = DEFAULT_TEAM_CONFIG) {
    this.config = config;
  }

  // ---------------------------------------------------------------------------
  // 队伍创建与管理
  // ---------------------------------------------------------------------------

  /**
   * 创建新队伍
   *
   * @param inviterId 邀请者 ID
   * @param inviterName 邀请者名称
   * @returns 新创建的队伍
   */
  createTeam(inviterId: string, inviterName: string): Team {
    const teamId = randomUUID();
    const colorIndex = this.teams.size % TEAM_COLORS.length;
    const color = TEAM_COLORS[colorIndex];

    const team: Team = {
      id: teamId,
      name: `${inviterName}的队伍`,
      memberIds: [inviterId],
      createdAt: Date.now(),
      disbanded: false,
    };

    this.teams.set(teamId, team);
    this.playerTeamBindings.set(inviterId, teamId);
    this.teamColors.set(teamId, color);
    this.teamOperators.set(teamId, inviterId);

    logger.info(`队伍创建成功：${teamId}`);
    return team;
  }

  /**
   * 获取队伍
   */
  getTeam(teamId: string): Team | undefined {
    return this.teams.get(teamId);
  }

  /**
   * 获取玩家的队伍
   */
  getPlayerTeam(playerId: string): Team | undefined {
    const teamId = this.playerTeamBindings.get(playerId);
    if (!teamId) return undefined;
    return this.teams.get(teamId);
  }

  ensurePlayerTeam(playerId: string, username: string): Team {
    return this.getPlayerTeam(playerId) ?? this.createTeam(playerId, username);
  }

  canOperateTeam(teamId: string, playerId: string): boolean {
    const team = this.getTeam(teamId);
    return Boolean(
      team
      && !team.disbanded
      && team.memberIds.includes(playerId)
      && this.teamOperators.get(teamId) === playerId,
    );
  }

  /**
   * 获取队伍颜色
   */
  getTeamColor(teamId: string): string | undefined {
    return this.teamColors.get(teamId);
  }

  /**
   * 获取全部队伍
   */
  getAllTeams(): Team[] {
    return Array.from(this.teams.values()).filter(t => !t.disbanded);
  }

  onTeamDisbanded(listener: (teamId: string, memberIds: string[]) => void): void {
    this.teamDisbandedListeners.push(listener);
  }

  // ---------------------------------------------------------------------------
  // 组队邀请
  // ---------------------------------------------------------------------------

  /**
   * 发送组队邀请
   *
   * @param inviterId 邀请者 ID
   * @param inviterName 邀请者名称
   * @param targetId 目标玩家 ID
   * @returns 组队邀请
   */
  sendInvite(inviterId: string, inviterName: string, targetId: string): TeamInvite | null {
    // 检查邀请者是否已有队伍
    let inviterTeam = this.getPlayerTeam(inviterId);
    if (!inviterTeam) {
      // 邀请者没有队伍，先创建一个
      const newTeam = this.createTeam(inviterId, inviterName);
      inviterTeam = newTeam;
    }

    // 检查队伍人数上限
    if (inviterTeam.memberIds.length >= this.config.maxTeamSize) {
      logger.warn(`队伍 ${inviterTeam.id} 已达人数上限，无法邀请`);
      return null;
    }

    const targetTeam = this.getPlayerTeam(targetId);
    if (targetTeam && (targetTeam.memberIds.length !== 1 || targetTeam.memberIds[0] !== targetId)) {
      logger.warn(`玩家 ${targetId} 已在队伍中，无法邀请`);
      return null;
    }

    // 创建邀请
    const inviteId = randomUUID();
    const invite: TeamInvite = {
      id: inviteId,
      inviterId,
      inviterName,
      targetId,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.inviteExpireMs,
      status: 'pending',
    };

    this.invites.set(inviteId, invite);
    logger.info(`组队邀请发送成功：${inviterId} -> ${targetId}`);

    // 设置定时过期检查
    this.scheduleInviteExpire(inviteId);

    return invite;
  }

  /**
   * 响应组队邀请
   *
   * @param inviteId 邀请 ID
   * @param targetId 目标玩家 ID
   * @param accept 是否接受
   * @returns 成功后返回队伍；失败返回 null
   */
  respondInvite(inviteId: string, targetId: string, accept: boolean): Team | null {
    const invite = this.invites.get(inviteId);
    if (!invite) {
      logger.warn(`邀请 ${inviteId} 不存在`);
      return null;
    }

    // 检查邀请是否过期
    if (invite.expiresAt < Date.now() || invite.status !== 'pending') {
      logger.warn(`邀请 ${inviteId} 已过期或已处理`);
      invite.status = 'expired';
      return null;
    }

    // 检查目标玩家是否匹配
    if (invite.targetId !== targetId) {
      logger.warn(`邀请 ${inviteId} 的目标玩家不匹配`);
      return null;
    }

    if (accept) {
      // 接受邀请
      // 获取邀请者的队伍
      const team = this.getPlayerTeam(invite.inviterId);
      if (!team) {
        logger.error(`邀请者 ${invite.inviterId} 的队伍不存在`);
        return null;
      }

      // 检查队伍人数上限
      if (team.memberIds.length >= this.config.maxTeamSize) {
        logger.warn(`队伍 ${team.id} 已达人数上限`);
        return null;
      }

      const targetTeam = this.getPlayerTeam(targetId);
      if (targetTeam && targetTeam.id !== team.id) {
        this.leaveTeam(targetId);
      }

      // 加入队伍
      invite.status = 'accepted';
      team.memberIds.push(targetId);
      this.playerTeamBindings.set(targetId, team.id);

      logger.info(`玩家 ${targetId} 加入队伍 ${team.id}`);

      // 移除邀请
      this.invites.delete(inviteId);

      return team;
    } else {
      // 拒绝邀请
      invite.status = 'rejected';
      this.invites.delete(inviteId);

      logger.info(`玩家 ${targetId} 拒绝了组队邀请`);
      return null;
    }
  }

  /**
   * 获取玩家的待处理邀请
   */
  getPlayerPendingInvites(playerId: string): TeamInvite[] {
    return Array.from(this.invites.values()).filter(
      i => i.targetId === playerId && i.status === 'pending' && i.expiresAt > Date.now()
    );
  }

  /**
   * 定时检查邀请过期
   */
  private scheduleInviteExpire(inviteId: string): void {
    const invite = this.invites.get(inviteId);
    if (!invite) return;

    const timeout = invite.expiresAt - Date.now();
    if (timeout <= 0) {
      invite.status = 'expired';
      return;
    }

    const timer = setTimeout(() => {
      const currentInvite = this.invites.get(inviteId);
      if (currentInvite && currentInvite.status === 'pending') {
        currentInvite.status = 'expired';
        logger.debug(`邀请 ${inviteId} 已过期`);
      }
    }, timeout);
    timer.unref();
  }

  // ---------------------------------------------------------------------------
  // 队伍合并与分离
  // ---------------------------------------------------------------------------

  /**
   * 合并队伍（将小队伍合并到大队伍）
   *
   * @param teamId1 队伍 1 ID
   * @param teamId2 队伍 2 ID
   * @returns 合并后的队伍；失败返回 null
   */
  mergeTeams(teamId1: string, teamId2: string): Team | null {
    const team1 = this.teams.get(teamId1);
    const team2 = this.teams.get(teamId2);

    if (!team1 || !team2) {
      logger.warn(`合并失败：队伍不存在`);
      return null;
    }

    if (team1.disbanded || team2.disbanded) {
      logger.warn(`合并失败：队伍已解散`);
      return null;
    }

    // 检查人数上限
    const newMemberCount = team1.memberIds.length + team2.memberIds.length;
    if (newMemberCount > this.config.maxTeamSize) {
      logger.warn(`合并失败：超出人数上限`);
      return null;
    }

    // 合并到人数较多的队伍
    const targetTeam = team1.memberIds.length >= team2.memberIds.length ? team1 : team2;
    const sourceTeam = targetTeam === team1 ? team2 : team1;

    // 合并成员
    for (const memberId of sourceTeam.memberIds) {
      if (!targetTeam.memberIds.includes(memberId)) {
        targetTeam.memberIds.push(memberId);
        this.playerTeamBindings.set(memberId, targetTeam.id);
      }
    }

    // 标记源队伍为解散
    sourceTeam.disbanded = true;
    sourceTeam.disbandedAt = Date.now();
    this.teamOperators.delete(sourceTeam.id);

    logger.info(`队伍合并成功：${sourceTeam.id} -> ${targetTeam.id}`);
    return targetTeam;
  }

  /**
   * 离开队伍
   *
   * @param playerId 离开的玩家 ID
   * @returns 离开后的队伍状态
   */
  leaveTeam(playerId: string): { team: Team | null; remainingMembers: string[] } | null {
    const team = this.getPlayerTeam(playerId);
    if (!team) {
      logger.warn(`玩家 ${playerId} 不在队伍中`);
      return null;
    }

    const originalMemberIds = team.memberIds.slice();

    // 移除玩家
    const memberIndex = team.memberIds.indexOf(playerId);
    if (memberIndex === -1) {
      return null;
    }

    team.memberIds.splice(memberIndex, 1);
    this.playerTeamBindings.delete(playerId);

    const remainingMembers = team.memberIds.slice();

    if (remainingMembers.length === 0) {
      team.disbanded = true;
      team.disbandedAt = Date.now();
      for (const listener of this.teamDisbandedListeners) {
        listener(team.id, originalMemberIds);
      }
      logger.info(`队伍 ${team.id} 已解散`);
      return { team: null, remainingMembers };
    }

    logger.info(`玩家 ${playerId} 离开队伍 ${team.id}`);
    return { team, remainingMembers };
  }

  /**
   * 申请分离队伍（需其他成员同意）
   *
   * @param playerId 申请分离的玩家 ID
   * @returns 分离申请
   */
  requestSeparation(playerId: string): { id: string; playerId: string; teamId: string } | null {
    const team = this.getPlayerTeam(playerId);
    if (!team) {
      logger.warn(`玩家 ${playerId} 不在队伍中`);
      return null;
    }

    // 单人队伍无需分离
    if (team.memberIds.length <= 1) {
      logger.warn(`队伍 ${team.id} 只有单人，无需分离`);
      return null;
    }

    const separationId = randomUUID();
    logger.info(`玩家 ${playerId} 申请分离队伍 ${team.id}`);

    // 这里返回申请信息，实际分离需其他成员同意（由外部处理）
    return {
      id: separationId,
      playerId,
      teamId: team.id,
    };
  }

  // ---------------------------------------------------------------------------
  // 地产交易限制
  // ---------------------------------------------------------------------------

  /**
   * 检查是否允许玩家间地产交易
   *
   * 规则：禁止玩家之间直接交易地产（组队成员之间也不允许）
   *
   * @param fromPlayerId 卖方 ID
   * @param toPlayerId 买方 ID
   * @returns 是否允许交易
   */
  canTradePropertyBetweenPlayers(fromPlayerId: string, toPlayerId: string): boolean {
    // 禁止玩家之间直接交易地产
    logger.warn(`禁止玩家 ${fromPlayerId} 和 ${toPlayerId} 直接交易地产`);
    return false;
  }

  // ---------------------------------------------------------------------------
  // 队伍解散与清理
  // ---------------------------------------------------------------------------

  /**
   * 解散队伍
   *
   * @param teamId 队伍 ID
   * @returns 是否成功解散
   */
  disbandTeam(teamId: string): boolean {
    const team = this.teams.get(teamId);
    if (!team) {
      return false;
    }

    const originalMemberIds = team.memberIds.slice();
    for (const memberId of team.memberIds) {
      this.playerTeamBindings.delete(memberId);
    }

    team.disbanded = true;
    team.disbandedAt = Date.now();
    this.teamOperators.delete(team.id);

    for (const listener of this.teamDisbandedListeners) {
      listener(teamId, originalMemberIds);
    }

    logger.info(`队伍 ${teamId} 已解散`);
    return true;
  }

  cleanupOfflineTeams(_offlinePlayerIds: string[]): string[] {
    return [];
  }

  /**
   * 清空全部数据（仅用于测试）
   */
  clear(): void {
    this.teams.clear();
    this.invites.clear();
    this.playerTeamBindings.clear();
    this.teamColors.clear();
    this.teamOperators.clear();
  }
}
