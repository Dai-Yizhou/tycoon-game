/**
 * MongoPlayerStore 测试
 *
 * MongoPlayerStore 已是完整实现（懒连接 MongoDB）。
 * 测试通过 mock 驱动层验证序列化/反序列化与 CRUD 逻辑，不依赖真实数据库。
 */

import { buildPlayer } from '../helpers';
import { MongoPlayerStore } from '../../src/storage/MongoPlayerStore';
import { MongoClient } from 'mongodb';
import type { Player } from '@game/shared';

// 共享的 Mock 客户端/集合（jest.mock 工厂允许引用 mock* 前缀变量）
const mockUpdateOne = jest.fn().mockResolvedValue({ upsertedId: null });
const mockFindOne = jest.fn().mockResolvedValue(null);
const mockDeleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
const mockCreateIndex = jest.fn().mockResolvedValue('idx');
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockConnect = jest.fn().mockResolvedValue(undefined);

const mockClient = {
  connect: mockConnect,
  close: mockClose,
  db: jest.fn().mockReturnValue({
    collection: jest.fn().mockReturnValue({
      createIndex: mockCreateIndex,
      updateOne: mockUpdateOne,
      findOne: mockFindOne,
      deleteOne: mockDeleteOne,
    }),
  }),
};

jest.mock('mongodb', () => {
  return {
    MongoClient: jest.fn().mockImplementation(() => mockClient),
  };
});

describe('MongoPlayerStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores connection info from constructor', () => {
    const store = new MongoPlayerStore('mongodb://localhost:27017', 'mydb', 'players');
    expect(store.describe()).toEqual({
      uri: 'mongodb://localhost:27017',
      dbName: 'mydb',
      collectionName: 'players',
    });
  });

  it('uses default db and collection names', () => {
    const store = new MongoPlayerStore('mongodb://localhost:27017');
    const desc = store.describe();
    expect(desc.dbName).toBe('monopoly_io');
    expect(desc.collectionName).toBe('players');
  });

  it('savePlayer upserts serialized player document', async () => {
    const store = new MongoPlayerStore('mongodb://localhost:27017');
    const player = buildPlayer('p1', { username: 'alice' });

    await store.savePlayer(player);

    expect(mockConnect).toHaveBeenCalled();
    expect(mockUpdateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'p1' });
    expect(update.$set.username).toBe('alice');
    expect(update.$set._id).toBe('p1');
  });

  it('loadPlayer returns deserialized player when found', async () => {
    const store = new MongoPlayerStore('mongodb://localhost:27017');
    mockFindOne.mockResolvedValueOnce({
      _id: 'p1',
      username: 'alice',
      teamId: null,
      position: { cellId: 3 },
      values: {},
      status: 'normal',
      createdAt: 100,
      lastActiveAt: 200,
    });

    const player = await store.loadPlayer('p1');

    expect(mockFindOne).toHaveBeenCalledWith({ _id: 'p1' });
    expect(player?.username).toBe('alice');
    expect(player?.position.cellId).toBe(3);
    expect(player?.id).toBe('p1');
  });

  it('loadPlayer returns null when player not found', async () => {
    const store = new MongoPlayerStore('mongodb://localhost:27017');
    mockFindOne.mockResolvedValueOnce(null);

    const player = await store.loadPlayer('missing');
    expect(player).toBeNull();
  });

  it('deletePlayer removes document', async () => {
    const store = new MongoPlayerStore('mongodb://localhost:27017');
    await store.deletePlayer('p1');
    expect(mockDeleteOne).toHaveBeenCalledWith({ _id: 'p1' });
  });

  it('close closes the underlying client', async () => {
    const store = new MongoPlayerStore('mongodb://localhost:27017');
    await store.savePlayer(buildPlayer('p1'));
    await store.close();
    expect(mockClose).toHaveBeenCalled();
  });
});
