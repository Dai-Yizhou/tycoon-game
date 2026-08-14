/**
 * MongoDB 版玩家存储（完整实现）
 *
 * 实现 PlayerStore 接口，支持玩家数据的持久化存储。
 * 包含连接池管理、序列化/反序列化、索引优化。
 */

import { MongoClient, type Collection, type Document } from 'mongodb';
import type { Player } from '@game/shared';
import type { PlayerStore } from './PlayerStore.js';
import { logger } from '../utils/logger.js';

/**
 * MongoDB 玩家文档结构
 *
 * 用于序列化 Player 对象到 MongoDB。
 */
interface PlayerDocument extends Document {
  /** 玩家唯一 ID */
  _id: string;
  /** 用户名（游戏内昵称，唯一） */
  username: string;
  /** 所属队伍 ID；未组队时为 null */
  teamId: string | null;
  /** 玩家位置 */
  position: { cellId: number };
  /** 动态数值字段集合 */
  values: Record<string, { id: string; name: string; current: number; min?: number; max?: number }>;
  /** 玩家当前状态 */
  status: string;
  /** 玩家创建时间（Unix 毫秒） */
  createdAt: number;
  /** 最近活跃时间（Unix 毫秒） */
  lastActiveAt: number;
}

/**
 * MongoDB 版玩家存储
 *
 * 构造时仅保存 `uri`，首次操作时建立连接（懒连接）。
 */
export class MongoPlayerStore implements PlayerStore {
  private readonly uri: string;
  private readonly dbName: string;
  private readonly collectionName: string;
  private client: MongoClient | null = null;
  private collection: Collection<PlayerDocument> | null = null;
  private connectionPromise: Promise<void> | null = null;

  /**
   * @param uri MongoDB 连接字符串
   * @param dbName 数据库名（默认 'monopoly_io'）
   * @param collectionName 集合名（默认 'players'）
   */
  constructor(
    uri: string,
    dbName: string = 'monopoly_io',
    collectionName: string = 'players',
  ) {
    this.uri = uri;
    this.dbName = dbName;
    this.collectionName = collectionName;
  }

  /**
   * 建立连接（懒连接，首次操作时触发）
   */
  private async connect(): Promise<void> {
    if (this.collection) {
      return;
    }

    // 防止并发连接
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this._connect();
    await this.connectionPromise;
    this.connectionPromise = null;
  }

  /**
   * 内部连接实现
   */
  private async _connect(): Promise<void> {
    try {
      this.client = new MongoClient(this.uri);
      await this.client.connect();

      const db = this.client.db(this.dbName);
      this.collection = db.collection<PlayerDocument>(this.collectionName);

      // 创建索引
      await this.collection.createIndex({ _id: 1 }, { unique: true });
      await this.collection.createIndex({ username: 1 }, { unique: true });
      await this.collection.createIndex({ teamId: 1 });

      logger.info(`MongoDB PlayerStore connected: ${this.uri}/${this.dbName}/${this.collectionName}`);
    } catch (error) {
      logger.error('MongoDB PlayerStore connection error:', error);
      throw error;
    }
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.collection = null;
      logger.info('MongoDB PlayerStore connection closed');
    }
  }

  /**
   * 序列化 Player 对象到 MongoDB 文档
   */
  private serialize(player: Player): PlayerDocument {
    return {
      _id: player.id,
      username: player.username,
      teamId: player.teamId,
      position: { cellId: player.position.cellId },
      values: player.values,
      status: player.status,
      createdAt: player.createdAt,
      lastActiveAt: player.lastActiveAt,
    };
  }

  /**
   * 反序列化 MongoDB 文档到 Player 对象
   */
  private deserialize(doc: PlayerDocument): Player {
    return {
      id: doc._id,
      username: doc.username,
      teamId: doc.teamId,
      position: { cellId: doc.position.cellId },
      values: doc.values,
      status: doc.status as Player['status'],
      createdAt: doc.createdAt,
      lastActiveAt: doc.lastActiveAt,
    };
  }

  /**
   * 保存或更新玩家
   */
  async savePlayer(player: Player): Promise<void> {
    await this.connect();
    if (!this.collection) {
      throw new Error('MongoDB collection not initialized');
    }

    const doc = this.serialize(player);
    await this.collection.updateOne(
      { _id: player.id },
      { $set: doc },
      { upsert: true },
    );

    logger.debug(`Player saved: ${player.id}`);
  }

  /**
   * 按 ID 加载玩家
   */
  async loadPlayer(id: string): Promise<Player | null> {
    await this.connect();
    if (!this.collection) {
      throw new Error('MongoDB collection not initialized');
    }

    const doc = await this.collection.findOne({ _id: id });
    if (!doc) {
      return null;
    }

    return this.deserialize(doc);
  }

  /**
   * 按用户名加载玩家
   */
  async loadPlayerByUsername(username: string): Promise<Player | null> {
    await this.connect();
    if (!this.collection) {
      throw new Error('MongoDB collection not initialized');
    }

    const doc = await this.collection.findOne({ username });
    if (!doc) {
      return null;
    }

    return this.deserialize(doc);
  }

  /**
   * 加载全部玩家
   */
  async loadAllPlayers(): Promise<Player[]> {
    await this.connect();
    if (!this.collection) {
      throw new Error('MongoDB collection not initialized');
    }

    const docs = await this.collection.find({}).toArray();
    return docs.map((doc) => this.deserialize(doc));
  }

  /**
   * 删除玩家（幂等）
   */
  async deletePlayer(id: string): Promise<void> {
    await this.connect();
    if (!this.collection) {
      throw new Error('MongoDB collection not initialized');
    }

    await this.collection.deleteOne({ _id: id });
    logger.debug(`Player deleted: ${id}`);
  }

  /**
   * 暴露连接信息（调试用）
   */
  describe(): { uri: string; dbName: string; collectionName: string } {
    return {
      uri: this.uri,
      dbName: this.dbName,
      collectionName: this.collectionName,
    };
  }
}
