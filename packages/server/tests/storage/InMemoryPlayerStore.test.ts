/**
 * InMemoryPlayerStore 测试
 *
 * 覆盖：
 * 1. 保存与加载
 * 2. 删除（幂等）
 * 3. 全部加载
 * 4. 大小查询
 * 5. 构造时初始化
 */

import { PlayerStatus, type Player } from '@game/shared';
import { InMemoryPlayerStore } from '../../src/storage/InMemoryPlayerStore';

function buildPlayer(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    username: `user-${id}`,
    teamId: null,
    position: { cellId: 0 },
    values: {},
    status: PlayerStatus.Normal,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    ...overrides,
  };
}

describe('InMemoryPlayerStore', () => {
  describe('basic operations', () => {
    it('starts empty', async () => {
      const store = new InMemoryPlayerStore();
      expect(store.size()).toBe(0);
      expect(await store.loadPlayer('ghost')).toBeNull();
      expect(await store.loadAllPlayers()).toEqual([]);
    });

    it('savePlayer + loadPlayer roundtrip', async () => {
      const store = new InMemoryPlayerStore();
      const p = buildPlayer('p1', { username: 'alice' });
      await store.savePlayer(p);
      const loaded = await store.loadPlayer('p1');
      expect(loaded).toEqual(p);
    });

    it('savePlayer overwrites existing data (upsert)', async () => {
      const store = new InMemoryPlayerStore();
      await store.savePlayer(buildPlayer('p1', { username: 'alice' }));
      await store.savePlayer(buildPlayer('p1', { username: 'bob' }));
      const loaded = await store.loadPlayer('p1');
      expect(loaded?.username).toBe('bob');
    });

    it('deletePlayer removes player', async () => {
      const store = new InMemoryPlayerStore();
      await store.savePlayer(buildPlayer('p1'));
      await store.deletePlayer('p1');
      expect(await store.loadPlayer('p1')).toBeNull();
    });

    it('deletePlayer is idempotent (no error on missing)', async () => {
      const store = new InMemoryPlayerStore();
      await expect(store.deletePlayer('ghost')).resolves.toBeUndefined();
    });
  });

  describe('loadAllPlayers', () => {
    it('returns all players', async () => {
      const store = new InMemoryPlayerStore();
      await store.savePlayer(buildPlayer('p1'));
      await store.savePlayer(buildPlayer('p2'));
      await store.savePlayer(buildPlayer('p3'));
      const all = await store.loadAllPlayers();
      expect(all).toHaveLength(3);
      expect(all.map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3']);
    });
  });

  describe('initial data', () => {
    it('can be constructed with initial players', () => {
      const initial = [buildPlayer('p1'), buildPlayer('p2')];
      const store = new InMemoryPlayerStore(initial);
      expect(store.size()).toBe(2);
      expect(store.getSync('p1')?.id).toBe('p1');
    });
  });

  describe('persistence across operations', () => {
    it('data persists through multiple save/load/delete cycles', async () => {
      const store = new InMemoryPlayerStore();
      await store.savePlayer(buildPlayer('p1', { username: 'alice' }));
      await store.savePlayer(buildPlayer('p2', { username: 'bob' }));
      await store.deletePlayer('p1');
      await store.savePlayer(buildPlayer('p3', { username: 'charlie' }));

      const all = await store.loadAllPlayers();
      expect(all.map((p) => p.id).sort()).toEqual(['p2', 'p3']);
      expect(store.size()).toBe(2);
    });
  });

  describe('clear (test utility)', () => {
    it('removes all data', async () => {
      const store = new InMemoryPlayerStore();
      await store.savePlayer(buildPlayer('p1'));
      await store.savePlayer(buildPlayer('p2'));
      store.clear();
      expect(store.size()).toBe(0);
      expect(await store.loadAllPlayers()).toEqual([]);
    });
  });
});
