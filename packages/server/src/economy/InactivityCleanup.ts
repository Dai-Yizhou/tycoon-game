/**
 * 长期离线清理器
 *
 * 背景：离线玩家以领域状态（Normal）继续参与计税与收租，长期离线者会永久占用
 * 股东位，是地图饱和的主要堆积源（见
 * docs/superpowers/specs/2026-09-22-economy-saturation-and-bankruptcy.md §3.4、§8）。
 *
 * 动作：对离线超过阈值（`map-meta.inactivityCleanup.thresholdMs`）的玩家，释放其
 * 全部股份并置为破产态（复用 `Bankruptcy.triggerBankruptcy` → `clearPlayerAssets`），
 * **不删除账号**，避免排行榜 / 成就 / 纪念碑对玩家 id 的引用悬空。
 *
 * 离线时长以本清理器自身维护的「离线起点」为准，**不使用 `player.lastActiveAt`**：
 * 后者会被服务端侧数值变更（计税扣款、收租到账、区域事件）刷新，恰好会让
 * 「仍在被动收租的离线地产主」永远不被清理，与清理意图相悖。
 *
 * 服务器重启时已处于离线态的玩家，以启动时刻为离线起点重新计时，给予完整宽限期。
 */

import { DEFAULT_INACTIVITY_SWEEP_INTERVAL_MS, type InactivityCleanupConfig } from '@game/shared';
import type { GameWorld } from '../world/GameWorld.js';
import { PlayerEvents } from '../world/PlayerManager.js';
import type { Bankruptcy } from './Bankruptcy.js';

interface PlayerIdPayload {
  playerId: string;
}

export class InactivityCleanup {
  private readonly world: GameWorld;
  private readonly bankruptcy: Bankruptcy;
  private readonly thresholdMs: number;
  private readonly sweepIntervalMs: number;
  /** 各离线玩家的离线起点时间戳，仅由冻结/解冻事件维护 */
  private readonly offlineSince = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly onFrozen = ({ playerId }: PlayerIdPayload): void => {
    if (!this.offlineSince.has(playerId)) this.offlineSince.set(playerId, Date.now());
  };

  private readonly onUnfrozen = ({ playerId }: PlayerIdPayload): void => {
    this.offlineSince.delete(playerId);
  };

  constructor(world: GameWorld, bankruptcy: Bankruptcy, config: InactivityCleanupConfig) {
    this.world = world;
    this.bankruptcy = bankruptcy;
    this.thresholdMs = config.thresholdMs;
    this.sweepIntervalMs = config.sweepIntervalMs ?? DEFAULT_INACTIVITY_SWEEP_INTERVAL_MS;
  }

  /** 订阅离线/重连事件并启动周期扫描 */
  start(): void {
    const manager = this.world.getPlayerManager();
    manager.on(PlayerEvents.Frozen, this.onFrozen);
    manager.on(PlayerEvents.Unfrozen, this.onUnfrozen);
    const now = Date.now();
    for (const playerId of manager.getFrozenPlayerIds()) {
      this.offlineSince.set(playerId, now);
    }
    this.timer = setInterval(() => this.sweep(), this.sweepIntervalMs);
  }

  /**
   * 扫描一次：离线超阈值者清产并置破产态。
   *
   * @returns 本次成功清理的玩家 id
   */
  sweep(now: number = Date.now()): string[] {
    const swept: string[] = [];
    for (const [playerId, since] of [...this.offlineSince]) {
      if (now - since < this.thresholdMs) continue;
      // 无论成功与否都移出待清理集合：已破产者不会重复触发，重连会重新登记离线起点
      this.offlineSince.delete(playerId);
      const result = this.bankruptcy.triggerBankruptcy(playerId, 'inactivity');
      if (result.success) swept.push(playerId);
    }
    return swept;
  }

  /** 离线起点（供测试与观测） */
  getOfflineSince(playerId: string): number | undefined {
    return this.offlineSince.get(playerId);
  }

  cleanup(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const manager = this.world.getPlayerManager();
    manager.off(PlayerEvents.Frozen, this.onFrozen);
    manager.off(PlayerEvents.Unfrozen, this.onUnfrozen);
    this.offlineSince.clear();
  }
}