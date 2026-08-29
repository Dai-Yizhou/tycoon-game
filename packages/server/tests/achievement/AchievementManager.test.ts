import type { AchievementDefinition, Player } from '@game/shared';
import { AchievementManager } from '../../src/achievement/AchievementManager.js';
import { InMemoryAchievementStore } from '../../src/achievement/InMemoryAchievementStore.js';

const defs: AchievementDefinition[] = [
  { id: 'visit', scope: 'map', name: { 'zh-CN': '访问', 'en-US': 'Visit' }, description: { 'zh-CN': '访问格子', 'en-US': 'Visit cells' }, category: 'movement', progress: { visible: true, target: 2 }, trigger: { type: 'visitCells', cellIds: [1, 2] } },
  { id: 'buy', scope: 'global', name: { 'zh-CN': '购买', 'en-US': 'Buy' }, description: { 'zh-CN': '购买格子', 'en-US': 'Buy cells' }, category: 'economy', progress: { visible: true, target: 2 }, trigger: { type: 'purchasedCells', target: 2 } },
];

const player = { id: 'p1' } as Player;

test('服务端按去重事件推进并只通知一次解锁', async () => {
  const unlocked: string[] = [];
  const manager = new AchievementManager(defs, new InMemoryAchievementStore(), (payload) => unlocked.push(payload.achievement.id));
  await manager.initialize({ accountId: player.id, guest: true }, 'map-a');
  await manager.recordCellVisit({ accountId: player.id, guest: true }, 'map-a', 1);
  await manager.recordCellVisit({ accountId: player.id, guest: true }, 'map-a', 1);
  await manager.recordCellVisit({ accountId: player.id, guest: true }, 'map-a', 2);
  await manager.recordPurchase({ accountId: player.id, guest: true }, 1);
  await manager.recordPurchase({ accountId: player.id, guest: true }, 1);
  await manager.recordPurchase({ accountId: player.id, guest: true }, 2);
  expect(unlocked).toEqual(['visit', 'buy']);
  expect((await manager.getSnapshot({ accountId: player.id, guest: true }, 'map-a')).achievements.find((item) => item.id === 'visit')?.record.unlocked).toBe(true);
});
