import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAchievementDefinitions } from '../../src/achievement/AchievementConfigLoader.js';

test('配置数组元素不是对象时给出稳定的索引错误', () => {
  const directory = mkdtempSync(join(tmpdir(), 'achievement-config-'));
  const file = join(directory, 'bad.json');
  try {
    writeFileSync(file, JSON.stringify([null]));
    expect(() => loadAchievementDefinitions(file)).toThrow('成就配置项必须是对象: [0]');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
