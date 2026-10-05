import type { BankruptcyPreview, Player, Uct } from '@game/shared';
import type { GameWorld } from '../world/GameWorld.js';

/**
 * 负债式破产预检结果
 *
 * 用于主动操作（购买/升级/投资/修缮/传送）在结算前判断该操作是否会致破产，
 * 以便向客户端回传权威预览、要求二次确认。
 */
export interface UctAssessment {
  /** 引用了玩家身上不存在的字段（非法，直接拒绝） */
  missingField?: string;
  /** 结算后会超过字段上界（非法，直接拒绝） */
  overMax: boolean;
  /** 结算后会有字段低于破产阈值（需要二次确认，含权威预览） */
  preview: BankruptcyPreview | null;
}

/**
 * 评估对玩家应用一份 UCT 的后果（纯函数）
 *
 * - 字段缺失 / 超出上界：非法，应拒绝；
 * - 低于 min（破产阈值）：允许，但返回预览供客户端二次确认。
 */
export function assessUct(player: Player, uct: Uct | undefined, scale = 1): UctAssessment {
  let overMax = false;
  const fields: BankruptcyPreview['fields'] = [];
  for (const [fieldId, configuredDelta] of Object.entries(uct?.player ?? {})) {
    const field = player.values[fieldId];
    if (!field) return { missingField: fieldId, overMax: false, preview: null };
    const next = field.current + configuredDelta * scale;
    if (field.max !== undefined && next > field.max) overMax = true;
    const min = field.min ?? Number.NEGATIVE_INFINITY;
    if (next < min) fields.push({ fieldId, fieldName: field.name, current: next, min });
  }
  return { overMax, preview: fields.length > 0 ? { fields } : null };
}

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
