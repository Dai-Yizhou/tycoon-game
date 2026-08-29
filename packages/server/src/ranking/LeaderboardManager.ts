import type { LeaderboardSnapshot, MapMeta, Player, RankingConfig } from '@game/shared';

export interface LeaderboardManagerOptions {
  worldId: string;
  mapMeta: MapMeta;
  getPlayers: () => Player[];
  getRegionId: (cellId: number) => string | undefined;
  getRegionValue: (regionId: string, fieldId: string) => number;
  broadcast: (snapshot: LeaderboardSnapshot, playerId?: string) => void;
  now?: () => number;
}

const MIN_REFRESH_MS = 250;

export class LeaderboardManager {
  private readonly config: RankingConfig | undefined;
  private readonly options: LeaderboardManagerOptions;
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly subscribers = new Set<() => void>();

  get enabled(): boolean {
    return this.config?.enabled === true;
  }

  constructor(options: LeaderboardManagerOptions) {
    this.options = options;
    this.config = options.mapMeta.ranking;
    if (this.config?.enabled) {
      validateRankingConfig(this.config, options.mapMeta);
      this.timer = setInterval(() => this.flush(), this.config.refreshMs);
      if (typeof this.timer === 'object' && 'unref' in this.timer) this.timer.unref();
    }
  }

  markDirty(): void {
    if (this.config?.enabled) this.dirty = true;
  }

  flush(now = this.options.now?.() ?? Date.now()): LeaderboardSnapshot | null {
    if (!this.config?.enabled || !this.dirty) return null;
    this.dirty = false;
    const snapshot = this.buildSnapshot(this.options.getPlayers(), undefined, now);
    this.options.broadcast(snapshot);
    for (const subscriber of this.subscribers) {
      subscriber();
    }
    return snapshot;
  }

  buildSnapshot(players = this.options.getPlayers(), currentPlayerId?: string, now = this.options.now?.() ?? Date.now()): LeaderboardSnapshot {
    if (!this.config?.enabled) {
      return { worldId: this.options.worldId, generatedAt: now, top: [], currentPlayer: null };
    }
    const ranked = players
      .map((player) => ({ player, score: this.calculateScore(player) }))
      .sort((a, b) => b.score - a.score || a.player.createdAt - b.player.createdAt || a.player.id.localeCompare(b.player.id));
    const entries: LeaderboardSnapshot['top'] = ranked.map((item, index) => ({
      rank: index + 1,
      playerId: item.player.id,
      username: item.player.username,
      score: item.score,
    }));
    const top = entries.slice(0, this.config.topN);
    const current = currentPlayerId ? entries.find((entry) => entry.playerId === currentPlayerId) : undefined;
    if (current) {
      const topEntry = top.find((entry) => entry.playerId === current.playerId);
      if (topEntry) topEntry.isCurrentPlayer = true;
    }
    return {
      worldId: this.options.worldId,
      generatedAt: now,
      top,
      currentPlayer: current ?? null,
    };
  }

  calculateScore(player: Player): number {
    if (!this.config?.enabled) return 0;
    let score = this.config.score.constant;
    for (const [fieldId, coefficient] of Object.entries(this.config.score.player)) {
      const field = player.values[fieldId];
      if (!field) throw new Error(`榜单运行时缺少玩家字段: ${fieldId}`);
      score += field.current * coefficient;
    }
    const regionId = this.options.getRegionId(player.position.cellId);
    for (const [fieldId, coefficient] of Object.entries(this.config.score.region)) {
      if (!regionId) throw new Error(`玩家所在区域不存在: ${player.position.cellId}`);
      score += this.options.getRegionValue(regionId, fieldId) * coefficient;
    }
    if (!Number.isFinite(score)) throw new Error(`榜单积分计算结果非法: ${player.id}`);
    return score;
  }

  getCurrentSnapshot(currentPlayerId?: string, now = this.options.now?.() ?? Date.now()): LeaderboardSnapshot | null {
    if (!this.config?.enabled) return null;
    return this.buildSnapshot(this.options.getPlayers(), currentPlayerId, now);
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function validateRankingConfig(config: RankingConfig, meta: MapMeta): void {
  if (typeof config.enabled !== 'boolean') throw new Error('ranking.enabled 必须是布尔值');
  if (!Number.isInteger(config.topN) || config.topN < 1 || config.topN > 50) throw new Error('ranking.topN 必须是 1 到 50 的整数');
  if (!Number.isFinite(config.refreshMs) || config.refreshMs < MIN_REFRESH_MS) throw new Error(`ranking.refreshMs 不能小于 ${MIN_REFRESH_MS}`);
  if (!Number.isFinite(config.score.constant)) throw new Error('ranking.score.constant 必须是有限数字');
  const definitions = new Map(meta.valueFieldDefinitions.map((field) => [field.id, field]));
  for (const [fieldId, coefficient] of Object.entries(config.score.player)) {
    const definition = definitions.get(fieldId);
    if (!definition) throw new Error(`ranking.score.player 引用了未定义字段: ${fieldId}`);
    if (definition.scope !== 'player') throw new Error(`ranking.score.player 字段 scope 不匹配: ${fieldId}`);
    if (!Number.isFinite(coefficient)) throw new Error(`ranking.score.player.${fieldId} 必须是有限数字`);
  }
  for (const [fieldId, coefficient] of Object.entries(config.score.region)) {
    const definition = definitions.get(fieldId);
    if (!definition) throw new Error(`ranking.score.region 引用了未定义字段: ${fieldId}`);
    if (definition.scope !== 'region') throw new Error(`ranking.score.region 字段 scope 不匹配: ${fieldId}`);
    if (!Number.isFinite(coefficient)) throw new Error(`ranking.score.region.${fieldId} 必须是有限数字`);
  }
}
