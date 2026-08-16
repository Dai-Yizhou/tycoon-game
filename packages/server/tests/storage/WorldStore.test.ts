import { InMemoryWorldStore, type WorldSnapshot } from '../../src/storage/WorldStore.js';
import type { Cell, EraInfo, Player, Team } from '@game/shared';

describe('WorldStore', () => {
  it('保存并恢复世界关键快照且隔离可变引用', () => {
    const store = new InMemoryWorldStore();
    const snapshot: WorldSnapshot = {
      version: 1,
      savedAt: Date.now(),
      mapData: [{ id: 1, x: 0, y: 0, destinations: [], extra: { type: 'property', owners: ['p1'], ownerships: [{ playerId: 'p1', share: 1, purchasePrice: 100 }], level: 2, accumulatedValue: 300 } } as Cell],
      mapMeta: { id: 'map', valueFieldDefinitions: [] } as never,
      players: [{ id: 'p1', username: 'P1', teamId: 'team', position: { cellId: 1 }, values: {}, status: 'jail', createdAt: 1, lastActiveAt: 1, extra: { jail: { expiresAt: 123 } } } as Player],
      teams: [{ id: 'team', name: 'T', memberIds: ['p1'], disbanded: false } as Team],
      era: { id: 'era', name: 'E', mapId: 'map', startedAt: 1, endsAt: 2, monumentRecords: [], settled: false } as EraInfo,
      taxRecords: { p1: [{ id: 'tax', playerId: 'p1', wealthTax: 1, propertyTax: 2, investmentTax: 3, totalTax: 6, timestamp: 1 }] },
    };

    store.save(snapshot);
    const restored = store.load();
    expect(restored).toEqual(snapshot);
    restored!.mapData[0].extra.owners = [];
    expect(store.load()!.mapData[0].extra.owners).toEqual(['p1']);
  });
});
