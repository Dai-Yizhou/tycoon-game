/**
 * MongoWorldStore 跨进程快照恢复测试
 *
 * 内测口径要求「局内进度跨进程保持」：启动时指定存档（WORLD_ID），下次启动读回同一存档。
 * 启动脚本强制使用 Mongo 存储，故此处以同一份假集合模拟 MongoDB 在两次进程启动之间持续存在，
 * 验证 GameWorld 能在新实例中完整恢复玩家与运行时状态。
 */

import { PlayerStatus, type Cell, type MapData, type MapMeta, type Player } from '@game/shared';
import { GameWorld } from '../../src/world/GameWorld.js';
import { MongoWorldStore } from '../../src/storage/MongoWorldStore.js';

/** 模拟持久化的集合文档：跨 store 实例共享，等价于「同一个 MongoDB」 */
const mockDocuments = new Map<string, Record<string, unknown>>();

const mockCreateIndex = jest.fn().mockResolvedValue('idx');
const mockFindOne = jest.fn(async (filter: { _id: string }) => mockDocuments.get(filter._id) ?? null);
const mockInsertOne = jest.fn(async (doc: Record<string, unknown>) => {
  const id = doc._id as string;
  if (mockDocuments.has(id)) throw Object.assign(new Error('duplicate'), { code: 11000 });
  mockDocuments.set(id, structuredClone(doc));
  return { acknowledged: true, matchedCount: 1 };
});
const mockReplaceOne = jest.fn(async (filter: Record<string, unknown>, doc: Record<string, unknown>) => {
  const id = filter._id as string;
  const revision = filter.revision as number | undefined;
  const existing = mockDocuments.get(id);
  if (!existing && revision !== undefined) return { acknowledged: true, matchedCount: 0 };
  if (existing && revision !== undefined && existing.revision !== revision) return { acknowledged: true, matchedCount: 0 };
  mockDocuments.set(id, structuredClone(doc));
  return { acknowledged: true, matchedCount: 1 };
});

jest.mock('mongodb', () => ({
  MongoClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    db: jest.fn().mockReturnValue({
      collection: jest.fn().mockReturnValue({
        createIndex: mockCreateIndex,
        findOne: mockFindOne,
        insertOne: mockInsertOne,
        replaceOne: mockReplaceOne,
      }),
    }),
  })),
}));

function buildPlayer(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    username: `user-${id}`,
    teamId: null,
    position: { cellId: 0 },
    values: { money: { id: 'money', name: '金钱', current: 800 } },
    status: PlayerStatus.Normal,
    createdAt: 1,
    lastActiveAt: 2,
    ...overrides,
  };
}

function buildLinearMap(n: number): MapData {
  const cells: Cell[] = [];
  for (let i = 0; i < n; i++) {
    const destinations: number[] = [];
    if (i > 0) destinations.push(i - 1);
    if (i < n - 1) destinations.push(i + 1);
    cells.push({ id: i, x: i * 10, y: 0, destinations, teleportDestinations: [], type: 'property', name: { 'zh-CN': `格子${i}`, 'en-US': `Cell ${i}` }, description: { 'zh-CN': `格子${i}`, 'en-US': `Cell ${i}` }, theme: 'northeast', regionId: 'test-region', timezone: 480, extra: {} });
  }
  return cells;
}

function buildMapMeta(id = 'map-1'): MapMeta {
  return {
    id,
    name: { 'zh-CN': `地图 ${id}`, 'en-US': `Map ${id}` },
    version: '1.0.0',
    regions: [{ id: 'test-region', name: { 'zh-CN': '测试区域', 'en-US': 'Test Region' }, initial: { region: { prosperity: 100 } } }],
    valueFieldDefinitions: [
      { id: 'money', name: { 'zh-CN': '金钱', 'en-US': 'Money' }, scope: 'player', min: 0 },
      { id: 'prosperity', name: { 'zh-CN': '繁荣', 'en-US': 'Prosperity' }, scope: 'region', min: 0 },
    ],
    uct: { player: ['money'], region: ['prosperity'] },
    playerInitial: { player: { money: 1000 } },
    startCellId: 0,
    dayNightCycle: 15,
    dice: { cooldownMs: 1000, min: 1, max: 3 },
    tax: { baseTax: { rates: {}, taxInterval: 1000 }, shareTax: { rates: {}, taxInterval: 1000 } },
  };
}

describe('MongoWorldStore', () => {
  beforeEach(() => {
    mockDocuments.clear();
    jest.clearAllMocks();
    mockFindOne.mockImplementation(async (filter: { _id: string }) => mockDocuments.get(filter._id) ?? null);
  });

  it('同一存档在两次进程启动之间恢复玩家与运行时状态', async () => {
    const worldId = 'beta-save';
    const map = buildLinearMap(3);
    const meta = buildMapMeta();
    const options = { worldId, namespace: 'local', temporary: false };
    const worldIdentity = { worldId, namespace: 'local', temporary: false };

    // 第一次启动：产出进度并落库
    const firstStore = new MongoWorldStore('mongodb://localhost:27017', options);
    const firstWorld = new GameWorld({ worldStore: firstStore, worldIdentity });
    firstWorld.loadMap(map, meta, { skipValidation: true });
    firstWorld.addPlayer(buildPlayer('p1'));
    firstWorld.getRuntimeState().replaceOwnerships(1, [{ playerId: 'p1', share: 1, purchasePrice: 500 }]);
    firstWorld.getRuntimeState().updateCellState(1, (state) => ({ ...state, level: 2, accumulatedValue: 1500 }));
    await firstWorld.flushPersistence();
    await firstStore.close();

    // 第二次启动：指定同名存档，应读回同一份进度
    const secondStore = new MongoWorldStore('mongodb://localhost:27017', options);
    await secondStore.ready;
    const secondWorld = new GameWorld({ worldStore: secondStore, worldIdentity });
    secondWorld.loadMap(map, meta, { skipValidation: true });
    const restored = secondWorld.restoreSnapshot();

    expect(restored?.worldId).toBe(worldId);
    expect(secondWorld.getPlayer('p1')?.username).toBe('user-p1');
    expect(secondWorld.getRuntimeState().getCellState(1)).toMatchObject({ level: 2, accumulatedValue: 1500 });
    expect(secondWorld.getRuntimeState().getOwnerships(1)).toEqual([{ playerId: 'p1', share: 1, purchasePrice: 500 }]);
    await secondStore.close();
  });

  it('不同存档名之间互不串档', async () => {
    const map = buildLinearMap(3);
    const meta = buildMapMeta();

    const saveStore = new MongoWorldStore('mongodb://localhost:27017', { worldId: 'save-a', namespace: 'local', temporary: false });
    const saveWorld = new GameWorld({ worldStore: saveStore });
    saveWorld.loadMap(map, meta, { skipValidation: true });
    saveWorld.addPlayer(buildPlayer('p1'));
    await saveWorld.flushPersistence();
    await saveStore.close();

    const otherStore = new MongoWorldStore('mongodb://localhost:27017', { worldId: 'save-b', namespace: 'local', temporary: false });
    await otherStore.ready;
    const otherWorld = new GameWorld({ worldStore: otherStore });
    otherWorld.loadMap(map, meta, { skipValidation: true });

    expect(otherWorld.restoreSnapshot()).toBeNull();
    expect(otherWorld.getPlayerCount()).toBe(0);
    await otherStore.close();
  });
});