import type { AchievementRecord } from '@game/shared';
import type { AchievementOwner, AchievementStore } from './AchievementStore.js';

export class InMemoryAchievementStore implements AchievementStore {
  private readonly records = new Map<string, AchievementRecord[]>();

  async load(owner: AchievementOwner): Promise<AchievementRecord[]> {
    return clone(this.records.get(key(owner)) ?? []);
  }

  async save(owner: AchievementOwner, records: AchievementRecord[]): Promise<void> {
    this.records.set(key(owner), clone(records));
  }

  async merge(from: AchievementOwner, to: AchievementOwner): Promise<AchievementRecord[]> {
    if (key(from) === key(to)) return this.load(to);
    const source = await this.load(from);
    const target = await this.load(to);
    const merged = new Map(target.map((record) => [record.achievementId, record]));
    for (const record of source) {
      const current = merged.get(record.achievementId);
      if (!current) {
        merged.set(record.achievementId, record);
        continue;
      }
      merged.set(record.achievementId, {
        ...current,
        progress: current.progress.current >= record.progress.current ? current.progress : record.progress,
        unlocked: current.unlocked || record.unlocked,
        unlockedAt: current.unlockedAt ?? record.unlockedAt,
        seenKeys: [...new Set([...current.seenKeys, ...record.seenKeys])],
      });
    }
    const result = [...merged.values()];
    await this.save(to, result);
    await this.save(from, []);
    return result;
  }
}

function key(owner: AchievementOwner): string {
  return `${owner.guest ? 'guest' : 'account'}:${owner.accountId}`;
}

function clone(records: AchievementRecord[]): AchievementRecord[] {
  return records.map((record) => ({ ...record, progress: { ...record.progress }, seenKeys: [...record.seenKeys] }));
}
