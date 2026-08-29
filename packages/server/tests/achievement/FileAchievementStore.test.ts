import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileAchievementStore } from '../../src/achievement/FileAchievementStore.js';

test('文件存储重建实例后恢复成就记录', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'achievement-'));
  const file = join(directory, 'records.json');
  const owner = { accountId: 'user-1', guest: false };
  const record = { achievementId: 'a', scope: 'global' as const, progress: { current: 1, target: 2, visible: true }, unlocked: false, seenKeys: ['1'] };
  try {
    await new FileAchievementStore(file).save(owner, [record]);
    expect(await new FileAchievementStore(file).load(owner)).toEqual([record]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
