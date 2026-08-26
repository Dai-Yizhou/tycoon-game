import { MongoClient, type Collection, type Document } from 'mongodb';
import type { WorldStore, WorldSnapshot } from './WorldStore.js';

interface WorldDocument extends Document {
  _id: string;
  namespace: string;
  temporary: boolean;
  expiresAt?: Date;
  revision: number;
  snapshot: WorldSnapshot;
  createdAt: Date;
  updatedAt: Date;
}

export interface MongoWorldStoreOptions {
  worldId: string;
  namespace: string;
  temporary: boolean;
  expiresAt?: number;
  dbName?: string;
  collectionName?: string;
}

export class MongoWorldStore implements WorldStore {
  readonly ready: Promise<void>;
  private readonly uri: string;
  private readonly options: Required<Pick<MongoWorldStoreOptions, 'worldId' | 'namespace' | 'temporary'>> & Pick<MongoWorldStoreOptions, 'expiresAt' | 'dbName' | 'collectionName'>;
  private client: MongoClient | null = null;
  private collection: Collection<WorldDocument> | null = null;
  private snapshot: WorldSnapshot | null = null;
  private writeQueue: Promise<void> = Promise.resolve(undefined);

  constructor(uri: string, options: MongoWorldStoreOptions) {
    this.uri = uri;
    this.options = { dbName: 'monopoly_io', collectionName: 'world_snapshots', ...options };
    this.ready = this.connect();
  }

  private async connect(): Promise<void> {
    this.client = new MongoClient(this.uri);
    await this.client.connect();
    const collection = this.client.db(this.options.dbName ?? 'monopoly_io').collection<WorldDocument>(this.options.collectionName ?? 'world_snapshots');
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    this.collection = collection;
    const document = await collection.findOne({ _id: this.options.worldId, namespace: this.options.namespace });
    if (document && (!document.expiresAt || document.expiresAt.getTime() > Date.now())) this.snapshot = clone(document.snapshot);
  }

  load(): WorldSnapshot | null {
    return this.snapshot ? clone(this.snapshot) : null;
  }

  async initialize(snapshot: WorldSnapshot): Promise<void> {
    const next = clone(snapshot);
    const task = this.writeQueue.catch(() => undefined).then(async () => {
      await this.ready;
      await this.persist(next, undefined, true);
      this.snapshot = next;
    });
    this.writeQueue = task;
    await task;
  }

  async save(snapshot: WorldSnapshot, expectedRevision?: number): Promise<void> {
    const next = clone(snapshot);
    const task = this.writeQueue.catch(() => undefined).then(async () => {
      await this.ready;
      if (expectedRevision !== undefined && (!this.snapshot || this.snapshot.revision !== expectedRevision)) {
        throw new Error('world snapshot revision conflict');
      }
      await this.persist(next, expectedRevision, false);
      this.snapshot = next;
    });
    this.writeQueue = task;
    await task;
  }

  private async persist(snapshot: WorldSnapshot, expectedRevision: number | undefined, initialize: boolean): Promise<void> {
    await this.ready;
    if (!this.collection) throw new Error('MongoDB world collection not initialized');
    const now = new Date();
    const document = {
      _id: this.options.worldId,
      namespace: this.options.namespace,
      temporary: this.options.temporary,
      ...(this.options.expiresAt ? { expiresAt: new Date(this.options.expiresAt) } : {}),
      revision: snapshot.revision,
      snapshot,
      createdAt: now,
      updatedAt: now,
    } satisfies WorldDocument;
    const filter = initialize
      ? { _id: this.options.worldId, namespace: this.options.namespace }
      : expectedRevision === undefined
        ? { _id: this.options.worldId, namespace: this.options.namespace }
        : { _id: this.options.worldId, namespace: this.options.namespace, revision: expectedRevision };
    let result: Awaited<ReturnType<Collection<WorldDocument>['insertOne']>> | Awaited<ReturnType<Collection<WorldDocument>['replaceOne']>>;
    try {
      result = initialize
        ? await this.collection.insertOne(document)
        : await this.collection.replaceOne(filter, document, { upsert: expectedRevision === undefined });
    } catch (error) {
      if (initialize && isDuplicateKeyError(error)) throw new Error('world snapshot already initialized');
      throw error;
    }
    if (!result.acknowledged) throw new Error('world snapshot persistence failed');
    if (!initialize && expectedRevision !== undefined && 'matchedCount' in result && result.matchedCount !== 1) throw new Error('world snapshot revision conflict');
    if (!initialize && expectedRevision === undefined && 'matchedCount' in result && result.matchedCount !== 1) throw new Error('world snapshot does not exist');
  }

  async close(): Promise<void> {
    await this.ready;
    await this.writeQueue.catch(() => undefined);
    await this.client?.close();
    this.client = null;
    this.collection = null;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 11000);
}
