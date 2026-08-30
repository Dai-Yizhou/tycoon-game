import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AchievementRecord } from '@game/shared';
import type { AchievementOwner, AchievementStore } from './AchievementStore.js';

export class FileAchievementStore implements AchievementStore {
  private readonly filePath: string;
  private loaded = false;
  private readonly records = new Map<string, AchievementRecord[]>();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(owner: AchievementOwner): Promise<AchievementRecord[]> {
    this.ensureLoaded();
    return clone(this.records.get(ownerKey(owner)) ?? []);
  }

  async save(owner: AchievementOwner, records: AchievementRecord[]): Promise<void> {
    this.ensureLoaded();
    this.records.set(ownerKey(owner), clone(records));
    this.persist();
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.filePath)) return;
    const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('成就存储文件格式非法');
    for (const [ownerKey, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) throw new Error(`成就存储记录非法: ${ownerKey}`);
      this.records.set(ownerKey, value as AchievementRecord[]);
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, JSON.stringify(Object.fromEntries(this.records)), { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, this.filePath);
  }
}

function ownerKey(owner: AchievementOwner): string {
  return owner.accountId;
}

function clone(records: AchievementRecord[]): AchievementRecord[] {
  return records.map((record) => ({ ...record, progress: { ...record.progress }, seenKeys: [...record.seenKeys] }));
}
