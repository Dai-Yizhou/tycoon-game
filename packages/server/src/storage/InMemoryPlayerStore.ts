/**
 * 内存版玩家存储
 *
 * 使用 `Map<string, Player>` 实现，适用于：
 * - 开发模式（无需外部依赖）
 * - 单元测试（快速、隔离）
 *
 * 数据生命周期与进程一致；进程重启即丢失。
 * 生产环境应替换为 MongoDB / Redis 等持久化实现。
 */

import type { Player } from '@game/shared';
import type { PlayerStore } from './PlayerStore.js';

/**
 * 内存版玩家存储
 */
export class InMemoryPlayerStore implements PlayerStore {
  private readonly players: Map<string, Player>;

  constructor(initial?: Iterable<Player>) {
    this.players = new Map();
    if (initial) {
      for (const p of initial) {
        this.players.set(p.id, p);
      }
    }
  }

  async savePlayer(player: Player): Promise<void> {
    this.players.set(player.id, player);
  }

  async loadPlayer(id: string): Promise<Player | null> {
    return this.players.get(id) ?? null;
  }

  async loadPlayerByUsername(username: string): Promise<Player | null> {
    for (const player of this.players.values()) {
      if (player.username === username) {
        return player;
      }
    }
    return null;
  }

  async loadAllPlayers(): Promise<Player[]> {
    return Array.from(this.players.values());
  }

  async deletePlayer(id: string): Promise<void> {
    this.players.delete(id);
  }

  /**
   * 同步访问（仅用于测试/内部）
   *
   * 直接返回内部引用以便快速断言；外部不应修改。
   */
  getSync(id: string): Player | undefined {
    return this.players.get(id);
  }

  /**
   * 当前存储的玩家数量（同步）
   */
  size(): number {
    return this.players.size;
  }

  /**
   * 清空全部数据（仅用于测试）
   */
  clear(): void {
    this.players.clear();
  }
}
