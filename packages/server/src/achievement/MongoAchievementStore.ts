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

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async load(owner: AchievementOwner): Promise<AchievementRecord[]> {
    await this.connect();
    const document = await this.collection.findOne({ _id: key(owner) });
    return clone(document?.records ?? []);
  }

  async save(owner: AchievementOwner, records: AchievementRecord[]): Promise<void> {
    await this.connect();
    await this.collection.replaceOne({ _id: key(owner) }, { _id: key(owner), ownerType: owner.guest ? 'guest' : 'account', ownerId: owner.accountId, records: clone(records) }, { upsert: true });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

function key(owner: AchievementOwner): string {
  return owner.accountId;
}

function clone(records: AchievementRecord[]): AchievementRecord[] {
  return records.map((record) => ({ ...record, progress: { ...record.progress }, seenKeys: [...record.seenKeys] }));
}
