/**
 * 队伍（Team）类型定义
 *
 * 队伍与玩家一样使用动态数值字段：
 * - `sharedValues` 是队伍共享池（如合租财产、共享信用值等）
 * - 数值字段由 `MapMeta.valueFieldDefinitions` 决定
 *
 * 队员离队不会导致队伍解散（`disbanded=false` 即可保留），
 * 仅当显式调用解散操作时才置为 `true`。
 */

import type { ValueField } from './player.js';

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
  /**
   * 队伍共享数值字段
   *
   * 字段 ID 与玩家 values 对齐，便于复用同一套字段定义。
   */
  sharedValues: Record<string, ValueField>;
  /** 队伍创建时间（Unix 毫秒） */
  createdAt: number;
  /** 是否已解散 */
  disbanded: boolean;
  /**
   * 队伍解散时间（Unix 毫秒），仅当 disbanded=true 时设置
   */
  disbandedAt?: number;
  /**
   * 队伍领导 ID（可选）
   * 队长在某些操作（如踢人、解散）上有更高权限
   */
  leaderId?: string;
}

/**
 * 工具函数：判断玩家是否为某队伍成员
 */
export function isTeamMember(team: Team, playerId: string): boolean {
  return team.memberIds.includes(playerId);
}

/**
 * 工具函数：获取队伍共享的某个数值字段
 */
export function getTeamSharedValue(
  team: Team,
  fieldId: string,
): ValueField | undefined {
  return team.sharedValues?.[fieldId];
}
