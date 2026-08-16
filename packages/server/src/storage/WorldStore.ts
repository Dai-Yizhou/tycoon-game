import type { Cell, EraInfo, MapMeta, Player, Team } from '@game/shared';
import type { TaxRecord } from '../economy/Taxation.js';

export interface WorldSnapshot {
  version: number;
  savedAt: number;
  mapData: Cell[];
  mapMeta: MapMeta;
  players: Player[];
  teams: Team[];
  era: EraInfo | null;
  taxRecords: Record<string, TaxRecord[]>;
  jailStates?: Record<string, { jailedAt: number; expiresAt: number; jailCellId: number }>;
}

export interface WorldStore {
  load(): WorldSnapshot | null;
  save(snapshot: WorldSnapshot): void;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryWorldStore implements WorldStore {
  private snapshot: WorldSnapshot | null = null;

  constructor(initial?: WorldSnapshot | null) {
    this.snapshot = initial ? clone(initial) : null;
  }

  load(): WorldSnapshot | null {
    return this.snapshot ? clone(this.snapshot) : null;
  }

  save(snapshot: WorldSnapshot): void {
    this.snapshot = clone(snapshot);
  }
}
