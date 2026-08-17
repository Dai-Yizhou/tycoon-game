import type { Cell, EraInfo, MapMeta, Player, Team } from '@game/shared';
import type { TaxRecord } from '../economy/Taxation.js';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
    for (const candidate of [this.filePath, `${this.filePath}.bak`]) {
      if (!existsSync(candidate)) continue;
      try {
        const snapshot = JSON.parse(readFileSync(candidate, 'utf8')) as WorldSnapshot;
        if (isWorldSnapshot(snapshot)) return snapshot;
      } catch {
        continue;
      }
    }
    return null;
  }

  save(snapshot: WorldSnapshot): void {
    if (!isWorldSnapshot(snapshot)) throw new Error('invalid world snapshot');
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    if (existsSync(this.filePath)) copyFileSync(this.filePath, `${this.filePath}.bak`);
    writeFileSync(temporaryPath, JSON.stringify(snapshot), { encoding: 'utf8', flag: 'wx' });
    renameSync(temporaryPath, this.filePath);
  }
}

function isWorldSnapshot(value: unknown): value is WorldSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<WorldSnapshot>;
  return snapshot.version === 1 && typeof snapshot.savedAt === 'number'
    && Array.isArray(snapshot.mapData) && Boolean(snapshot.mapMeta)
    && Array.isArray(snapshot.players) && Array.isArray(snapshot.teams)
    && (snapshot.era === null || typeof snapshot.era === 'object')
    && Boolean(snapshot.taxRecords);
}
