import type { Cell, Player, PlayerStatus } from '@game/shared';
import { participatesInEconomy } from '@game/shared';
import type { WorldRuntimeStateStore } from '../state/WorldRuntimeStateStore.js';

export interface Ownership {
  playerId: string;
  share: number;
  purchasePrice: number;
}

export interface OwnershipConfig {
  buyInMultiplier: number;
  maxShareholders: number;
}

export const DEFAULT_OWNERSHIP_CONFIG: OwnershipConfig = {
  buyInMultiplier: 1,
  maxShareholders: 8,
};

export function resolveOwnershipConfig(raw: unknown): OwnershipConfig {
  const config = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    buyInMultiplier: typeof config.buyInMultiplier === 'number' && Number.isFinite(config.buyInMultiplier) && config.buyInMultiplier >= 0
      ? config.buyInMultiplier
      : DEFAULT_OWNERSHIP_CONFIG.buyInMultiplier,
    maxShareholders: typeof config.maxShareholders === 'number' && Number.isFinite(config.maxShareholders)
      ? Math.max(1, Math.floor(config.maxShareholders))
      : DEFAULT_OWNERSHIP_CONFIG.maxShareholders,
  };
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

export function getBuyInPrice(cell: Cell, config: OwnershipConfig, runtime: WorldRuntimeStateStore): number {
  return Math.floor(getAccumulatedValue(cell, runtime) * config.buyInMultiplier);
}

export function addOwnership(cell: Cell, playerId: string, price: number, config: OwnershipConfig, runtime: WorldRuntimeStateStore): Ownership | null {
  const existing = getOwnerships(cell, runtime);
  if (existing.some((ownership) => ownership.playerId === playerId)) return null;
  if (existing.length >= config.maxShareholders) return null;
  if (existing.length === 0) {
    const ownership = { playerId, share: 1, purchasePrice: price };
    syncOwnerships(cell, [ownership], runtime);
    runtime.updateCellState(cell.id, (state) => ({ ...state, accumulatedValue: price }));
    return ownership;
  }
  const oldValue = getAccumulatedValue(cell, runtime);
  const nextValue = oldValue + price;
  const newShare = nextValue > 0 ? price / nextValue : 0;
  const next = existing.map((ownership) => ({
    ...ownership,
    share: ownership.share * (oldValue / nextValue),
  }));
  const ownership = { playerId, share: newShare, purchasePrice: price };
  syncOwnerships(cell, [...next, ownership], runtime);
  runtime.updateCellState(cell.id, (state) => ({ ...state, accumulatedValue: nextValue }));
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
  for (const ownership of getOwnerships(cell, runtime)) {
    const player = getPlayer(ownership.playerId);
    if (!player || player.status === excludedStatus || !participatesInEconomy(player.status)) continue;
    pay(player, Math.floor(amount * ownership.share));
  }
}

export function releaseOwnership(cell: Cell, playerId: string, runtime: WorldRuntimeStateStore): void {
  syncOwnerships(cell, getOwnerships(cell, runtime).filter((ownership) => ownership.playerId !== playerId), runtime);
}
