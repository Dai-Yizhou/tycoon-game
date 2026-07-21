/**
 * MongoPlayerStore 占位实现测试
 *
 * 验证：
 * 1. 构造与配置
 * 2. 描述信息
 * 3. 占位方法抛出 NotImplemented 错误
 */

import { buildPlayer } from '../helpers';
import { MongoPlayerStore } from '../../src/storage/MongoPlayerStore';

describe('MongoPlayerStore (placeholder)', () => {
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

  it('savePlayer throws not-implemented error', async () => {
    const store = new MongoPlayerStore('mongodb://localhost:27017');
    await expect(store.savePlayer(buildPlayer('p1'))).rejects.toThrow(/尚未实现/);
  });

  it('loadPlayer throws not-implemented error', async () => {
    const store = new MongoPlayerStore('mongodb://localhost:27017');
    await expect(store.loadPlayer('p1')).rejects.toThrow(/尚未实现/);
  });

  it('deletePlayer throws not-implemented error', async () => {
    const store = new MongoPlayerStore('mongodb://localhost:27017');
    await expect(store.deletePlayer('p1')).rejects.toThrow(/尚未实现/);
  });
});
