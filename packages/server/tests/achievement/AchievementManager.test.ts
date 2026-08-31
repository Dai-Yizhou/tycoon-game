import type { AchievementDefinition, Player } from '@game/shared';
import { AchievementManager } from '../../src/achievement/AchievementManager.js';
import { InMemoryAchievementStore } from '../../src/achievement/InMemoryAchievementStore.js';

const player = (id = 'p1', current = 0): Player => ({ id, username: id, teamId: null, position: { cellId: 1 }, values: { score: { id: 'score', name: 'score', current } }, status: 'normal', createdAt: 1, lastActiveAt: 1 });
const defs: AchievementDefinition[] = [
  { id: 'visit', scope: 'map', name: { 'zh-CN': '访问', 'en-US': 'Visit' }, description: { 'zh-CN': '访问格子', 'en-US': 'Visit cells' }, category: 'movement', progress: { visible: true, target: 2 }, trigger: { type: 'visitCells', cellIds: [1, 2] } },
  { id: 'event', scope: 'map', name: { 'zh-CN': '事件', 'en-US': 'Event' }, description: { 'zh-CN': '完成事件', 'en-US': 'Complete events' }, category: 'event', progress: { visible: true, target: 2 }, trigger: { type: 'completeEvents', cellIds: [1, 2], eventIds: ['e1', 'e2'] } },
  { id: 'uct', scope: 'map', name: { 'zh-CN': '财富', 'en-US': 'Wealth' }, description: { 'zh-CN': '达到阈值', 'en-US': 'Reach threshold' }, category: 'economy', progress: { visible: true, target: 10 }, trigger: { type: 'uctThreshold', fieldId: 'score', target: 10 } },
  { id: 'owned', scope: 'map', name: { 'zh-CN': '持有', 'en-US': 'Owned' }, description: { 'zh-CN': '持有格子', 'en-US': 'Own cells' }, category: 'economy', progress: { visible: true, target: 2 }, trigger: { type: 'ownedCells', target: 2 } },
  { id: 'buy', scope: 'global', name: { 'zh-CN': '购买', 'en-US': 'Buy' }, description: { 'zh-CN': '购买格子', 'en-US': 'Buy cells' }, category: 'economy', progress: { visible: true, target: 2 }, trigger: { type: 'purchasedCells', target: 2 } },
  { id: 'rank', scope: 'global', name: { 'zh-CN': '榜单', 'en-US': 'Rank' }, description: { 'zh-CN': '进入榜单', 'en-US': 'Reach rank' }, category: 'ranking', progress: { visible: true, target: 2 }, trigger: { type: 'ranking', targetRank: 2 } },
];

test('六类触发均通过服务端入口推进且只解锁一次', async () => {
  const unlocked: string[] = [];
  const manager = new AchievementManager(defs, new InMemoryAchievementStore(), (payload) => unlocked.push(payload.achievement.id));
  const owner = { accountId: 'p1', guest: true };
  await manager.initialize(owner, 'map-a');
  await manager.recordCellVisit(owner, 'map-a', 1);
  await manager.recordCellVisit(owner, 'map-a', 1);
  await manager.recordCellVisit(owner, 'map-a', 2);
  await manager.recordEvent(owner, 'map-a', 1, 'e1');
  await manager.recordEvent(owner, 'map-a', 1, 'e1');
  await manager.recordEvent(owner, 'map-a', 2, 'e2');
  await manager.recordUct(owner, 'map-a', player('p1', 10));
  await manager.refreshOwnedCells(owner, 'map-a', [1, 2]);
  await manager.refreshOwnedCells(owner, 'map-a', [1]);
  await manager.recordPurchase(owner, 'map-a', 1);
  await manager.recordPurchase(owner, 'map-a', 2);
  await manager.recordRanking(owner, 2);
  expect(unlocked.sort()).toEqual(['buy', 'event', 'owned', 'rank', 'uct', 'visit'].sort());
  expect((await manager.getSnapshot(owner, 'map-a')).achievements.every((item) => item.record.unlocked)).toBe(true);
});

test('持久化失败时丢弃 owner 缓存且不发送解锁通知', async () => {
  const stored: Awaited<ReturnType<InMemoryAchievementStore['load']>> = [];
  let failSave = true;
  const store = {
    load: jest.fn(async () => stored.map((record) => ({ ...record, progress: { ...record.progress }, seenKeys: [...record.seenKeys] }))),
    save: jest.fn(async (_owner: { accountId: string; guest: boolean }, records: typeof stored) => {
      if (failSave) throw new Error('save failed');
      stored.splice(0, stored.length, ...records.map((record) => ({ ...record, progress: { ...record.progress }, seenKeys: [...record.seenKeys] })));
    }),
  };
  const unlocked: string[] = [];
  const manager = new AchievementManager([defs[0]!], store, (payload) => unlocked.push(payload.achievement.id));
  const owner = { accountId: 'p-save', guest: false };
  await manager.initialize(owner, 'map-a');

  await expect(manager.recordCellVisit(owner, 'map-a', 1)).rejects.toThrow('save failed');
  failSave = false;
  await manager.recordCellVisit(owner, 'map-a', 2);

  expect(unlocked).toEqual([]);
  expect((await manager.getSnapshot(owner, 'map-a')).achievements[0]?.record.progress.current).toBe(1);
});

test('同一 owner 的并发事件不丢失去重进度或重复通知', async () => {
  const unlocked: string[] = [];
  const manager = new AchievementManager([defs[0]!], new InMemoryAchievementStore(), (payload) => unlocked.push(payload.achievement.id));
  const owner = { accountId: 'p2', guest: true };
  await Promise.all([1, 1, 2].map((cellId) => manager.recordCellVisit(owner, 'map-a', cellId)));
  expect(unlocked).toEqual(['visit']);
});
