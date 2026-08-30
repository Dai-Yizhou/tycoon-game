import type { AchievementRecord } from '@game/shared';
import type { AchievementOwner, AchievementStore } from './AchievementStore.js';

export class InMemoryAchievementStore implements AchievementStore {
  private readonly records = new Map<string, AchievementRecord[]>();

  async load(owner: AchievementOwner): Promise<AchievementRecord[]> {
    return clone(this.records.get(ownerKey(owner)) ?? []);
  }

  async save(owner: AchievementOwner, records: AchievementRecord[]): Promise<void> {
    this.records.set(ownerKey(owner), clone(records));
  }

}

function ownerKey(owner: AchievementOwner): string {
  return owner.accountId;
}

function clone(records: AchievementRecord[]): AchievementRecord[] {
  return records.map((record) => ({ ...record, progress: { ...record.progress }, seenKeys: [...record.seenKeys] }));
}
