/**
 * 玩家存储接口
 *
 * 定义玩家数据的持久化操作。所有方法都是异步的，便于替换底层实现。
 */

import type { Player } from '@game/shared';

/**
 * 玩家存储接口
 *
 * - `savePlayer`    : 保存/更新玩家
 * - `loadPlayer`    : 按 ID 加载玩家
 * - `loadAllPlayers`: 加载全部玩家（可选实现；用于迁移/启动恢复）
 * - `deletePlayer`  : 删除玩家
 *
 * 实现要求：
 * - `savePlayer` 应采用「upsert」语义
 * - `loadPlayer` 未找到时返回 null（而非抛错）
 * - `deletePlayer` 幂等：删除不存在的玩家不应抛错
 */
export interface PlayerStore {
  /** 保存或更新玩家 */
  savePlayer(player: Player): Promise<void>;
  /** 按 ID 加载玩家，未找到返回 null */
  loadPlayer(id: string): Promise<Player | null>;
  /** 按用户名加载玩家，未找到返回 null（用于登录时恢复账号） */
  loadPlayerByUsername?(username: string): Promise<Player | null>;
  /** 加载全部玩家（可选实现；不支持时抛 NotImplemented） */
  loadAllPlayers?(): Promise<Player[]>;
  /** 删除玩家（幂等） */
  deletePlayer(id: string): Promise<void>;
}
