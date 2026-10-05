import type { Player } from '@game/shared';
import type { GameWorld } from '../world/GameWorld.js';

export interface EconomyChangeResult {
  ok: boolean;
  playerId: string;
  fieldId: string;
  previous: number;
  current: number;
  delta: number;
  reason: string;
  error?: string;
}

export class EconomyService {
  private onPlayerValueChanged?: (player: Player) => void;

  constructor(private readonly world: GameWorld) {}

  setPlayerValueChangedHandler(handler: (player: Player) => void): void {
    this.onPlayerValueChanged = handler;
  }

  changeValue(playerId: string, fieldId: string, delta: number, reason: string, createIfMissing = true): EconomyChangeResult {
    const player = this.world.getPlayer(playerId);
    const base = { ok: false, playerId, fieldId, previous: 0, current: 0, delta, reason };
    if (!player) return { ...base, error: 'player_not_found' };
    if (!Number.isFinite(delta)) return { ...base, error: 'invalid_delta' };
    const field = player.values[fieldId] ?? (createIfMissing
      ? (player.values[fieldId] = { id: fieldId, name: fieldId, current: 0, min: 0 })
      : undefined);
    if (!field) return { ...base, error: 'value_field_not_found' };
    const previous = field.current;
    // 负债式破产口径：数值只钳上界（max），不钳下界。
    // `min` 不再是「数值下限」，而是该字段的破产阈值——允许扣成负数，
    // 由 Bankruptcy 在结算后判定 `current < min` 触发破产。若仍钳 min，
    // 玩家永远停在 min，破产判定与回收通道均无法生效。
    const current = Math.min(field.max ?? Number.POSITIVE_INFINITY, previous + delta);
    field.current = current;
    player.lastActiveAt = Date.now();
    this.world.updatePlayer(player);
    this.onPlayerValueChanged?.(player);
    return { ok: true, playerId, fieldId, previous, current, delta: current - previous, reason };
  }

  getValue(player: Player, fieldId: string): number {
    return player.values[fieldId]?.current ?? 0;
  }
}
