import type { Cell, EraInfo, MapMeta, Player, Team } from '@game/shared';
import type { TaxRecord } from '../economy/Taxation.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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

export class FileWorldStore implements WorldStore {
  constructor(private readonly filePath: string) {}

  load(): WorldSnapshot | null {
    if (!existsSync(this.filePath)) return null;
    return JSON.parse(readFileSync(this.filePath, 'utf8')) as WorldSnapshot;
  }

  save(snapshot: WorldSnapshot): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(snapshot), 'utf8');
  }
}
