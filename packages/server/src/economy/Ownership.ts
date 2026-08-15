import type { Cell, Player, PlayerStatus } from '@game/shared';
import { getExtra } from '@game/shared';

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

export function getOwnerships(cell: Cell): Ownership[] {
  return getExtra<Ownership[]>(cell, 'ownerships', []) ?? [];
}

export function getOwners(cell: Cell): string[] {
  return getExtra<string[]>(cell, 'owners', []) ?? [];
}

export function syncOwnerships(cell: Cell, ownerships: Ownership[]): void {
  const normalized = ownerships.filter((ownership) => ownership.share > 0);
  const total = normalized.reduce((sum, ownership) => sum + ownership.share, 0);
  const shares = total > 0 ? normalized.map((ownership) => ({ ...ownership, share: ownership.share / total })) : [];
  cell.extra.ownerships = shares;
  cell.extra.owners = shares.map((ownership) => ownership.playerId);
  if (shares.length === 0) cell.extra.level = 0;
}

export function getAccumulatedValue(cell: Cell): number {
  const explicit = getExtra<number>(cell, 'accumulatedValue');
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
  const price = getExtra<number>(cell, 'price', 0) ?? 0;
  const level = getExtra<number>(cell, 'level', 0) ?? 0;
  const costs = getExtra<number[]>(cell, 'upgradeCost', []) ?? [];
  return price + costs.slice(0, level).reduce((sum, cost) => sum + cost, 0);
}

export function getBuyInPrice(cell: Cell, config: OwnershipConfig): number {
  return getAccumulatedValue(cell) * config.buyInMultiplier;
}

export function addOwnership(cell: Cell, playerId: string, price: number, config: OwnershipConfig): Ownership | null {
  const existing = getOwnerships(cell);
  if (existing.some((ownership) => ownership.playerId === playerId)) return null;
  if (existing.length >= config.maxShareholders) return null;
  const oldValue = getAccumulatedValue(cell);
  const nextValue = oldValue + price;
  const newShare = price / nextValue;
  const next = existing.map((ownership) => ({
    ...ownership,
    share: ownership.share * (oldValue / nextValue),
  }));
  const ownership = { playerId, share: newShare, purchasePrice: price };
  syncOwnerships(cell, [...next, ownership]);
  cell.extra.accumulatedValue = nextValue;
  return ownership;
}

export function distributeByShare(
  cell: Cell,
  amount: number,
  getPlayer: (id: string) => Player | undefined,
  pay: (player: Player, delta: number) => void,
  excludedStatus?: PlayerStatus,
): void {
  for (const ownership of getOwnerships(cell)) {
    const player = getPlayer(ownership.playerId);
    if (!player || player.status === excludedStatus) continue;
    pay(player, Math.floor(amount * ownership.share));
  }
}

export function releaseOwnership(cell: Cell, playerId: string): void {
  syncOwnerships(cell, getOwnerships(cell).filter((ownership) => ownership.playerId !== playerId));
}
