import { MongoClient, type Collection, type Document } from 'mongodb';
import type { AchievementRecord } from '@game/shared';
import type { AchievementOwner, AchievementStore } from './AchievementStore.js';

interface AchievementDocument extends Document {
  _id: string;
  ownerType: 'guest' | 'account';
  ownerId: string;
  records: AchievementRecord[];
}

export class MongoAchievementStore implements AchievementStore {
  private readonly client: MongoClient;
  private readonly collection: Collection<AchievementDocument>;

  constructor(uri: string, dbName = 'monopoly_io', collectionName = 'achievements') {
    this.client = new MongoClient(uri);
    this.collection = this.client.db(dbName).collection<AchievementDocument>(collectionName);
  }

  async load(owner: AchievementOwner): Promise<AchievementRecord[]> {
    await this.client.connect();
    const document = await this.collection.findOne({ _id: key(owner) });
    return clone(document?.records ?? []);
  }

  async save(owner: AchievementOwner, records: AchievementRecord[]): Promise<void> {
    await this.client.connect();
    await this.collection.replaceOne({ _id: key(owner) }, { _id: key(owner), ownerType: owner.guest ? 'guest' : 'account', ownerId: owner.accountId, records: clone(records) }, { upsert: true });
  }

  async merge(from: AchievementOwner, to: AchievementOwner): Promise<AchievementRecord[]> {
    const merged = mergeRecords(await this.load(from), await this.load(to));
    await this.save(to, merged);
    await this.collection.deleteOne({ _id: key(from) });
    return clone(merged);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

function key(owner: AchievementOwner): string {
  return `${owner.guest ? 'guest' : 'account'}:${owner.accountId}`;
}

function mergeRecords(source: AchievementRecord[], target: AchievementRecord[]): AchievementRecord[] {
  const merged = new Map(target.map((record) => [record.achievementId + ':' + (record.mapId ?? ''), clone([record])[0]! ]));
  for (const record of source) {
    const id = record.achievementId + ':' + (record.mapId ?? '');
    const existing = merged.get(id);
    if (!existing) merged.set(id, clone([record])[0]!);
    else {
      existing.unlocked ||= record.unlocked;
      existing.unlockedAt ??= record.unlockedAt;
      existing.progress.current = Math.max(existing.progress.current, record.progress.current);
      existing.seenKeys = [...new Set([...existing.seenKeys, ...record.seenKeys])];
    }
  }
  return [...merged.values()];
}

function clone(records: AchievementRecord[]): AchievementRecord[] {
  return records.map((record) => ({ ...record, progress: { ...record.progress }, seenKeys: [...record.seenKeys] }));
}
