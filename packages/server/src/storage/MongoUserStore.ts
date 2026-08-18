import { MongoClient, type Collection, type Document } from 'mongodb';
import type { UserAccount } from '@game/shared';
import type { UserStore } from '../auth/AuthService.js';
import { logger } from '../utils/logger.js';

interface UserDocument extends Document {
  _id: string;
  username: string;
  passwordHash: string | null;
  isGuest: boolean;
  createdAt: number;
  lastLoginAt: number;
}

export class MongoUserStore implements UserStore {
  private readonly uri: string;
  private readonly dbName: string;
  private readonly collectionName: string;
  private client: MongoClient | null = null;
  private collection: Collection<UserDocument> | null = null;
  private connectionPromise: Promise<void> | null = null;

  constructor(
    uri: string,
    dbName: string = 'monopoly_io',
    collectionName: string = 'users',
  ) {
    this.uri = uri;
    this.dbName = dbName;
    this.collectionName = collectionName;
  }

  private async connect(): Promise<void> {
    if (this.collection) return;
    if (this.connectionPromise) return this.connectionPromise;
    this.connectionPromise = this._connect();
    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  private async _connect(): Promise<void> {
    this.client = new MongoClient(this.uri);
    await this.client.connect();
    const db = this.client.db(this.dbName);
    this.collection = db.collection<UserDocument>(this.collectionName);
    await this.collection.createIndex({ _id: 1 }, { unique: true });
    await this.collection.createIndex({ username: 1 }, { unique: true });
    logger.info(`MongoDB UserStore connected: ${this.uri}/${this.dbName}/${this.collectionName}`);
  }

  private serialize(user: UserAccount): UserDocument {
    return {
      _id: user.id,
      username: user.username,
      passwordHash: user.passwordHash,
      isGuest: user.isGuest,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  }

  private deserialize(document: UserDocument): UserAccount {
    return {
      id: document._id,
      username: document.username,
      passwordHash: document.passwordHash,
      isGuest: document.isGuest,
      createdAt: document.createdAt,
      lastLoginAt: document.lastLoginAt,
    };
  }

  async saveUser(user: UserAccount): Promise<void> {
    await this.connect();
    if (!this.collection) throw new Error('MongoDB user collection not initialized');
    await this.collection.updateOne(
      { _id: user.id },
      { $set: this.serialize(user) },
      { upsert: true },
    );
  }

  async loadUserById(id: string): Promise<UserAccount | null> {
    await this.connect();
    if (!this.collection) throw new Error('MongoDB user collection not initialized');
    const document = await this.collection.findOne({ _id: id });
    return document ? this.deserialize(document) : null;
  }

  async loadUserByUsername(username: string): Promise<UserAccount | null> {
    await this.connect();
    if (!this.collection) throw new Error('MongoDB user collection not initialized');
    const document = await this.collection.findOne({ username });
    return document ? this.deserialize(document) : null;
  }

  async deleteUser(id: string): Promise<void> {
    await this.connect();
    if (!this.collection) throw new Error('MongoDB user collection not initialized');
    await this.collection.deleteOne({ _id: id });
  }

  async close(): Promise<void> {
    if (!this.client) return;
    await this.client.close();
    this.client = null;
    this.collection = null;
  }

  describe(): { uri: string; dbName: string; collectionName: string } {
    return { uri: this.uri, dbName: this.dbName, collectionName: this.collectionName };
  }
}
