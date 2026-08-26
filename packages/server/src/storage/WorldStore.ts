import type { EraInfo, Player, Team } from '@game/shared';
import type { TaxRecord } from '../economy/Taxation.js';
import type { SerializedWorldRuntimeState } from '../state/WorldRuntimeState.js';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface WorldSnapshot {
  version: 2;
  worldId?: string;
  namespace?: string;
  temporary?: boolean;
  expiresAt?: number;
  revision: number;
  savedAt: number;
  mapId: string;
  players: Player[];
  teams: Team[];
  runtime: SerializedWorldRuntimeState;
  era: EraInfo | null;
  taxRecords: Record<string, TaxRecord[]>;
  jailStates: Record<string, { jailedAt: number; expiresAt: number; jailCellId: number }>;
}

export interface WorldStore {
  load(): WorldSnapshot | null;
  initialize(snapshot: WorldSnapshot): Promise<void>;
  save(snapshot: WorldSnapshot, expectedRevision?: number): Promise<void>;
  close?(): Promise<void>;
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

  async initialize(snapshot: WorldSnapshot): Promise<void> {
    if (this.snapshot) throw new Error('world snapshot already initialized');
    this.snapshot = clone(snapshot);
  }

  async save(snapshot: WorldSnapshot, expectedRevision?: number): Promise<void> {
    if (expectedRevision !== undefined && (!this.snapshot || this.snapshot.revision !== expectedRevision)) throw new Error('world snapshot revision conflict');
    this.snapshot = clone(snapshot);
  }
}

export class FileWorldStore implements WorldStore {
  constructor(private readonly filePath: string) {}

  load(): WorldSnapshot | null {
    let foundFile = false;
    for (const candidate of [this.filePath, `${this.filePath}.bak`]) {
      if (!existsSync(candidate)) continue;
      foundFile = true;
      try {
        const snapshot = JSON.parse(readFileSync(candidate, 'utf8')) as WorldSnapshot;
        if (isWorldSnapshot(snapshot)) return snapshot;
      } catch {
        continue;
      }
    }
    if (foundFile) throw new Error('world snapshot files are corrupted');
    return null;
  }

  async initialize(snapshot: WorldSnapshot): Promise<void> {
    if (!isWorldSnapshot(snapshot)) throw new Error('invalid world snapshot');
    if (this.load()) throw new Error('world snapshot already initialized');
    await this.save(snapshot);
  }

  async save(snapshot: WorldSnapshot, expectedRevision?: number): Promise<void> {
    if (!isWorldSnapshot(snapshot)) throw new Error('invalid world snapshot');
    const current = this.load();
    if (expectedRevision !== undefined && (!current || current.revision !== expectedRevision)) throw new Error('world snapshot revision conflict');
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
  return snapshot.version === 2 && typeof snapshot.revision === 'number' && typeof snapshot.savedAt === 'number'
    && (snapshot.worldId === undefined || typeof snapshot.worldId === 'string')
    && (snapshot.namespace === undefined || typeof snapshot.namespace === 'string')
    && (snapshot.temporary === undefined || typeof snapshot.temporary === 'boolean')
    && (snapshot.expiresAt === undefined || typeof snapshot.expiresAt === 'number')
    && typeof snapshot.mapId === 'string' && Boolean(snapshot.runtime)
    && Array.isArray(snapshot.players) && Array.isArray(snapshot.teams)
    && (snapshot.era === null || typeof snapshot.era === 'object')
    && Boolean(snapshot.taxRecords) && Boolean(snapshot.jailStates);
}
