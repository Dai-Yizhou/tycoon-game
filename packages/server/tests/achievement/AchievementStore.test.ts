import { InMemoryAchievementStore } from '../../src/achievement/InMemoryAchievementStore.js';

test('游客升级合并时保留已解锁状态和较高进度且重复合并幂等', async () => {
  const store = new InMemoryAchievementStore();
  const guest = { accountId: 'guest-1', guest: true };
  const account = { accountId: 'user-1', guest: false };
  await store.save(guest, [{ achievementId: 'a', scope: 'map', mapId: 'm', progress: { current: 3, target: 5, visible: true }, unlocked: false, seenKeys: ['1', '2', '3'] }]);
  await store.save(account, [{ achievementId: 'a', scope: 'map', mapId: 'm', progress: { current: 2, target: 5, visible: true }, unlocked: true, unlockedAt: 10, seenKeys: ['1', '2'] }]);
  const merged = await store.merge(guest, account);
  expect(merged[0]).toMatchObject({ unlocked: true, unlockedAt: 10, progress: { current: 3 } });
  expect(await store.merge(guest, account)).toEqual(merged);
});
