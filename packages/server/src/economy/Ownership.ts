import type { Cell, Player, PlayerStatus } from '@game/shared';
import { participatesInEconomy } from '@game/shared';
import type { WorldRuntimeStateStore } from '../state/WorldRuntimeStateStore.js';

export interface Ownership {
  playerId: string;
  share: number;
  purchasePrice: number;
}

export function getOwnerships(cell: Cell, runtime: WorldRuntimeStateStore): Ownership[] {
  const state = runtime.getCellState(cell.id);
  return normalizeOwnerships(state.ownerships, state.accumulatedValue);
}

function normalizeOwnerships(ownerships: Ownership[], accumulatedValue: number): Ownership[] {
  const valid = ownerships
    .filter((ownership) => ownership && typeof ownership.playerId === 'string' && ownership.share > 0 && Number.isFinite(ownership.share) && Number.isFinite(ownership.purchasePrice))
    .reduce<Ownership[]>((result, ownership) => {
      const existing = result.find((current) => current.playerId === ownership.playerId);
      if (existing) {
        existing.share += ownership.share;
        existing.purchasePrice += Number.isFinite(ownership.purchasePrice) ? ownership.purchasePrice : 0;
      } else {
        result.push({ ...ownership });
      }
      return result;
    }, []);
  const total = valid.reduce((sum, ownership) => sum + ownership.share, 0);
  if (total <= 0) return [];
  return valid.map((ownership) => ({
    playerId: ownership.playerId,
    share: ownership.share / total,
    purchasePrice: Number.isFinite(ownership.purchasePrice) ? ownership.purchasePrice : accumulatedValue * ownership.share / total,
  }));
}

export function getOwners(cell: Cell, runtime: WorldRuntimeStateStore): string[] {
  return getOwnerships(cell, runtime).map((ownership) => ownership.playerId);
}

export function syncOwnerships(cell: Cell, ownerships: Ownership[], runtime: WorldRuntimeStateStore): void {
  const normalized = ownerships.filter((ownership) => ownership.share > 0 && Number.isFinite(ownership.share));
  const total = normalized.reduce((sum, ownership) => sum + ownership.share, 0);
  const shares = total > 0 ? normalized.map((ownership) => ({ ...ownership, share: ownership.share / total })) : [];
  runtime.replaceOwnerships(cell.id, shares);
}

export function getAccumulatedValue(cell: Cell, runtime: WorldRuntimeStateStore): number {
  const uctMagnitude = (uct: Cell['price']): number => Object.values(uct?.player ?? {}).reduce((sum, value) => sum + Math.abs(value), 0);
  const level = runtime.getCellState(cell.id).level;
  const calculated = uctMagnitude(cell.price) + (cell.upgradeCost ?? []).slice(0, level).reduce((sum, cost) => sum + uctMagnitude(cost), 0);
  const state = runtime.getCellState(cell.id);
  return state.accumulatedValue > 0 ? state.accumulatedValue : calculated;
}

export function addOwnership(cell: Cell, playerId: string, price: number, runtime: WorldRuntimeStateStore): Ownership | null {
  const existing = getOwnerships(cell, runtime);
  if (existing.some((ownership) => ownership.playerId === playerId)) return null;
  if (existing.length >= cell.maxOwnerCount) return null;
  if (existing.length === 0) {
    const ownership = { playerId, share: 1, purchasePrice: price };
    syncOwnerships(cell, [ownership], runtime);
    runtime.updateCellState(cell.id, (state) => ({ ...state, accumulatedValue: price }));
    return ownership;
  }
  const nextCount = existing.length + 1;
  // 所有股东平均持股（不按买入价配比）
  const shared = 1 / nextCount;
  const next = existing.map((ownership) => ({ ...ownership, share: shared }));
  const ownership = { playerId, share: shared, purchasePrice: price };
  syncOwnerships(cell, [...next, ownership], runtime);
  runtime.updateCellState(cell.id, (state) => ({ ...state, accumulatedValue: state.accumulatedValue + price }));
  return ownership;
}

export function distributeByShare(
  cell: Cell,
  runtime: WorldRuntimeStateStore,
  amount: number,
  getPlayer: (id: string) => Player | undefined,
  pay: (player: Player, delta: number) => void,
  excludedStatus?: PlayerStatus,
): void {
  const payable = getOwnerships(cell, runtime).filter(
    (ownership) => {
      const player = getPlayer(ownership.playerId);
      return !!player && player.status !== excludedStatus && participatesInEconomy(player.status);
    },
  );
  const allocated = distributeByShareFloor(payable, amount);
  for (const [playerId, units] of allocated) {
    const player = getPlayer(playerId);
    if (player === undefined) continue;
    pay(player, units);
  }
}

/**
 * 按持股比例结算（此前决策：丢弃尾数）。
 *
 * 传入一组持股（share 无需归一，按相对比例即可），每个股东取 `Math.floor(amount * share)`
 * 的整数份额，**尾部余数直接丢弃**，不做守恒回补。因此 Σ 分配 <= amount。
 *
 * 用途：租金/投资收益/买入补偿等多方按股权结算时，避免浮点股权比（如 1/3）产生
 * 33.3333… 的小数金额，统一输出整数金额，并对不充分摊的尾数直接舍去。
 */
export function distributeByShareFloor(ownerships: Array<{ playerId: string; share: number }>, amount: number): Map<string, number> {
  const result = new Map<string, number>();
  if (amount <= 0) return result;
  const valid = ownerships.filter((o) => o.share > 0 && Number.isFinite(o.share));
  if (valid.length === 0) return result;
  const total = valid.reduce((sum, o) => sum + o.share, 0);
  if (total <= 0) return result;
  for (const o of valid) {
    const units = Math.floor(amount * (o.share / total));
    if (units > 0) result.set(o.playerId, units);
  }
  return result;
}

export function releaseOwnership(cell: Cell, playerId: string, runtime: WorldRuntimeStateStore): void {
  syncOwnerships(cell, getOwnerships(cell, runtime).filter((ownership) => ownership.playerId !== playerId), runtime);
}
