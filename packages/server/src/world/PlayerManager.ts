/**
 * 玩家管理器
 *
 * 负责玩家生命周期：
 * - 玩家 ID 生成（UUID v4）
 * - 玩家增删改查（内部存储）
 * - 玩家冻结/解冻（离线时保留数据但不接收事件）
 * - 玩家状态变更追踪
 *
 * 设计原则：
 * - 不依赖 Socket.IO；纯数据层，可独立测试
 * - 同步 API；持久化由 `PlayerStore` 在外部包装
 * - 冻结操作不会清除玩家数据，仅标记状态
 */

import { randomUUID } from 'node:crypto';
import { PlayerStatus, type Player } from '@game/shared';

/**
 * 玩家快照（用于广播）
 */
export interface PlayerSnapshot {
  player: Player;
  /** 是否处于冻结状态 */
  frozen: boolean;
}

/**
 * 玩家事件载荷
 */
export interface PlayerConnectEvent {
  player: Player;
  /** 该玩家加入的 socketId（来自外部调用方） */
  socketId?: string;
}

export interface PlayerDisconnectEvent {
  playerId: string;
  /** 断开时的 socketId */
  socketId?: string;
}

export interface PlayerRemovedEvent {
  playerId: string;
  player: Player;
}

export interface PlayerFreezeEvent {
  playerId: string;
  /** 冻结原因 */
  reason: 'disconnect' | 'manual' | 'kicked';
}

export interface PlayerUnfreezeEvent {
  playerId: string;
  /** 玩家当前 socketId（重连时） */
  socketId?: string;
}

/**
 * 玩家事件监听器
 */
export type PlayerEventListener<T> = (payload: T) => void;

/**
 * 玩家事件类型
 */
export const PlayerEvents = {
  Connect: 'player.connect',
  Disconnect: 'player.disconnect',
  Added: 'player.added',
  Removed: 'player.removed',
  Updated: 'player.updated',
  Frozen: 'player.frozen',
  Unfrozen: 'player.unfrozen',
  StatusChanged: 'player.statusChanged',
} as const;

/** 玩家事件名字符串字面量联合 */
export type PlayerEventName = (typeof PlayerEvents)[keyof typeof PlayerEvents];

/**
 * 玩家管理器
 */
export class PlayerManager {
  private readonly players: Map<string, Player> = new Map();
  private readonly frozen: Set<string> = new Set();
  private readonly socketBindings: Map<string, string> = new Map();
  private readonly listeners: Map<PlayerEventName, Set<PlayerEventListener<unknown>>> = new Map();

  // ---------------------------------------------------------------------------
  // ID 生成
  // ---------------------------------------------------------------------------

  /**
   * 生成新玩家 ID（UUID v4）
   */
  generatePlayerId(): string {
    return randomUUID();
  }

  // ---------------------------------------------------------------------------
  // 玩家 CRUD
  // ---------------------------------------------------------------------------

  /**
   * 添加玩家
   *
   * - 重复添加同一玩家（ID 已存在）将被忽略并返回 false
   * - 触发 `player.added` 事件
   *
   * @returns 是否成功添加
   */
  addPlayer(player: Player, socketId?: string): boolean {
    if (this.players.has(player.id)) {
      return false;
    }
    this.players.set(player.id, player);
    if (socketId) {
      this.socketBindings.set(player.id, socketId);
    }
    this.emit(PlayerEvents.Added, { player });
    if (socketId) {
      this.emit(PlayerEvents.Connect, { player, socketId });
    }
    return true;
  }

  /**
   * 移除玩家（数据也一并清除）
   *
   * - 若玩家处于冻结态，会先解冻再移除
   * - 触发 `player.removed` 事件
   *
   * @returns 被移除的玩家；若不存在返回 undefined
   */
  removePlayer(playerId: string): Player | undefined {
    const player = this.players.get(playerId);
    if (!player) return undefined;
    this.frozen.delete(playerId);
    this.socketBindings.delete(playerId);
    this.players.delete(playerId);
    this.emit(PlayerEvents.Removed, { playerId, player });
    return player;
  }

  /**
   * 更新玩家数据
   *
   * 浅比较 id；要求玩家必须存在。
   * 触发 `player.updated` 事件。
   */
  updatePlayer(player: Player): boolean {
    if (!this.players.has(player.id)) {
      return false;
    }
    this.players.set(player.id, player);
    this.emit(PlayerEvents.Updated, { player });
    return true;
  }

  /**
   * 获取玩家
   */
  getPlayer(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  /**
   * 获取全部玩家
   */
  getAllPlayers(): Player[] {
    return Array.from(this.players.values());
  }

  /**
   * 当前玩家数
   */
  getPlayerCount(): number {
    return this.players.size;
  }

  /**
   * 检查玩家是否存在
   */
  hasPlayer(playerId: string): boolean {
    return this.players.has(playerId);
  }

  // ---------------------------------------------------------------------------
  // Socket 绑定
  // ---------------------------------------------------------------------------

  /**
   * 绑定玩家与 socketId
   */
  bindSocket(playerId: string, socketId: string): void {
    if (!this.players.has(playerId)) return;
    this.socketBindings.set(playerId, socketId);
  }

  /**
   * 解除 socket 绑定（不删除玩家）
   */
  unbindSocket(playerId: string): void {
    this.socketBindings.delete(playerId);
  }

  /**
   * 获取玩家绑定的 socketId
   */
  getSocketId(playerId: string): string | undefined {
    return this.socketBindings.get(playerId);
  }

  /**
   * 通过 socketId 反查玩家 ID
   */
  getPlayerIdBySocketId(socketId: string): string | undefined {
    for (const [playerId, sid] of this.socketBindings.entries()) {
      if (sid === socketId) return playerId;
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // 玩家连接/断开
  // ---------------------------------------------------------------------------

  /**
   * 玩家连接
   *
   * - 若玩家不存在则返回 false
   * - 若玩家已绑定别的 socketId，将替换为新 socketId
   * - 触发 `player.connect` 事件
   */
  connectPlayer(playerId: string, socketId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    this.socketBindings.set(playerId, socketId);
    if (this.frozen.has(playerId)) {
      this.unfreezePlayer(playerId, socketId);
    }
    this.emit(PlayerEvents.Connect, { player, socketId });
    return true;
  }

  /**
   * 玩家断开（不删除数据，标记为冻结）
   *
   * - 触发 `player.disconnect` 事件
   * - 自动调用 freezePlayer 保留数据
   */
  disconnectPlayer(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    const socketId = this.socketBindings.get(playerId);
    this.socketBindings.delete(playerId);
    this.emit(PlayerEvents.Disconnect, { playerId, socketId });
    this.freezePlayer(playerId, 'disconnect');
    return true;
  }

  // ---------------------------------------------------------------------------
  // 冻结 / 解冻
  // ---------------------------------------------------------------------------

  /**
   * 冻结玩家（离线时保留数据但不接收事件）
   *
   * - 状态标记为 `PlayerStatus.Frozen`（也会持久化到 player.status 字段）
   * - 重复冻结是幂等的
   */
  freezePlayer(playerId: string, reason: 'disconnect' | 'manual' | 'kicked' = 'manual'): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    if (this.frozen.has(playerId)) return true;
    this.frozen.add(playerId);
    this.updateStatus(playerId, PlayerStatus.Frozen);
    this.emit(PlayerEvents.Frozen, { playerId, reason });
    return true;
  }

  /**
   * 解冻玩家（重连时）
   *
   * - 状态恢复为 `PlayerStatus.Normal`（前提是之前为 frozen；否则仅清除冻结标记）
   */
  unfreezePlayer(playerId: string, newSocketId?: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    if (!this.frozen.has(playerId)) return false;
    this.frozen.delete(playerId);
    this.updateStatus(playerId, PlayerStatus.Normal);
    if (newSocketId) {
      this.socketBindings.set(playerId, newSocketId);
    }
    this.emit(PlayerEvents.Unfrozen, { playerId, socketId: newSocketId });
    return true;
  }

  /**
   * 是否处于冻结状态
   */
  isFrozen(playerId: string): boolean {
    return this.frozen.has(playerId);
  }

  /**
   * 获取全部冻结玩家 ID
   */
  getFrozenPlayerIds(): string[] {
    return Array.from(this.frozen);
  }

  /**
   * 获取全部活跃玩家（未冻结）
   */
  getActivePlayers(): Player[] {
    const result: Player[] = [];
    for (const [id, p] of this.players.entries()) {
      if (!this.frozen.has(id)) {
        result.push(p);
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // 状态变更
  // ---------------------------------------------------------------------------

  /**
   * 修改玩家状态（如 normal/jail/bankrupt/frozen）
   *
   * - 状态变化会写入 player.status 并触发事件
   */
  updateStatus(playerId: string, status: Player['status']): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    if (player.status === status) return true;
    player.status = status;
    player.lastActiveAt = Date.now();
    this.emit(PlayerEvents.Updated, { player });
    this.emit(PlayerEvents.StatusChanged, { playerId, status });
    return true;
  }

  /**
   * 修改玩家位置
   */
  updatePosition(playerId: string, cellId: number): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    player.position = { cellId };
    player.lastActiveAt = Date.now();
    this.emit(PlayerEvents.Updated, { player });
    return true;
  }

  // ---------------------------------------------------------------------------
  // 事件订阅
  // ---------------------------------------------------------------------------

  /**
   * 订阅玩家事件
   */
  on<T = unknown>(event: PlayerEventName, listener: PlayerEventListener<T>): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as PlayerEventListener<unknown>);
  }

  /**
   * 取消订阅
   */
  off<T = unknown>(event: PlayerEventName, listener: PlayerEventListener<T>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(listener as PlayerEventListener<unknown>);
  }

  /**
   * 触发事件
   */
  private emit<T>(event: PlayerEventName, payload: T): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        (listener as PlayerEventListener<T>)(payload);
      } catch {
        // 监听器异常不应影响主流程
      }
    }
  }

  /**
   * 清空全部数据（仅用于测试）
   */
  clear(): void {
    this.players.clear();
    this.frozen.clear();
    this.socketBindings.clear();
    this.listeners.clear();
  }
}
