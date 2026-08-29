import { validateAchievementDefinitions, type AchievementDefinition } from '../src/types/achievement';

function definition(overrides: Partial<AchievementDefinition> = {}): AchievementDefinition {
  return {
    id: 'visit-all',
    scope: 'map',
    name: { 'zh-CN': '探索者', 'en-US': 'Explorer' },
    description: { 'zh-CN': '访问目标格', 'en-US': 'Visit cells' },
    category: 'movement',
    progress: { visible: true, target: 2 },
    trigger: { type: 'visitCells', cellIds: [1, 2] },
    ...overrides,
  };
}

test('接受合法成就定义并拒绝重复 ID', () => {
  expect(() => validateAchievementDefinitions([definition()])).not.toThrow();
  expect(() => validateAchievementDefinitions([definition(), definition()])).toThrow('成就 ID 重复');
});

test('拒绝与触发规则冲突的 scope 和非法引用', () => {
  expect(() => validateAchievementDefinitions([definition({ scope: 'global' })])).toThrow('scope');
  expect(() => validateAchievementDefinitions([definition({ trigger: { type: 'ranking', targetRank: 0 }, scope: 'global' })])).toThrow('targetRank');
});
