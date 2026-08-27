/**
 * 队伍（Team）类型定义
 *
 * 队伍只保存协作关系与生命周期信息，成员数值由玩家独立持有并只读展示。
 * 队员离队不会导致剩余成员的单人队伍解散，仅显式解散或最后成员离开时结束队伍。
 */

/**
 * 队伍接口
 */
export interface Team {
  /** 队伍唯一 ID */
  id: string;
  /** 队伍名称 */
  name: string;
  /** 队员 ID 列表（顺序无意义） */
  memberIds: string[];
  /** 队伍创建时间（Unix 毫秒） */
  createdAt: number;
  /** 是否已解散 */
  disbanded: boolean;
  /**
   * 队伍解散时间（Unix 毫秒），仅当 disbanded=true 时设置
   */
  disbandedAt?: number;
}

/**
 * 工具函数：判断玩家是否为某队伍成员
 */
export function isTeamMember(team: Team, playerId: string): boolean {
  return team.memberIds.includes(playerId);
}

/**
 * 组队邀请（前后端共享）
 *
 * 由服务端 TeamManager 创建，通过 `server.teamInviteReceived` 推送给被邀请玩家。
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
 * 队伍成员显示数据（服务端权威，供客户端队伍面板渲染）
 *
 * 由服务端 TeamHandler.buildMemberViews 构建，通过 `server.teamUpdated`
 * 和 `client.getTeamState` ack。客户端据此完整重建本地队伍视图，无需本地推测。
 */
export interface TeamMemberView {
  /** 玩家 ID */
  id: string;
  /** 用户名 */
  username: string;
  /** 玩家实时数值 */
  values: Record<string, number>;
  /** 玩家状态（normal / bankrupt / jail 等） */
  status: string;
}
