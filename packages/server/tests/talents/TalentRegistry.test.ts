/**
 * 天赋系统测试
 *
 * 测试覆盖：
 * - 天赋注册与查询
 * - 天赋学习与取消
 * - 天赋值管理
 * - 前置天赋与互斥天赋
 * - 天赋效果应用
 * - 视野天赋计算
 * - 字段开关天赋
 * - 机制开关天赋
 */

import { TalentRegistry, createTalentRegistry } from '../../src/talents/TalentRegistry.js';
import { TalentEffects, createTalentEffects } from '../../src/talents/TalentEffects.js';
import { BUILTIN_TALENTS, getBuiltinTalents } from '../../src/talents/talentTemplates.js';
import type { TalentDefinition } from '@game/shared';

describe('TalentRegistry', () => {
  let registry: TalentRegistry;

  beforeEach(() => {
    registry = createTalentRegistry();
    // 注册内置天赋
    registry.registerTalents(getBuiltinTalents());
  });

  afterEach(() => {
    registry.clear();
  });

  // ---------------------------------------------------------------------------
  // TR-1: 天赋注册
  // ---------------------------------------------------------------------------

  describe('registerTalent', () => {
    it('应成功注册新天赋', () => {
      const result = registry.registerTalent({
        id: 'test_talent',
        name: '测试天赋',
        description: '测试用天赋',
        type: 'numeric',
        talentPointsCost: 1,
        effects: [{ visionRange: 10 }],
      });

      expect(result).toBe(true);
      expect(registry.hasTalentDefinition('test_talent')).toBe(true);
    });

    it('应拒绝重复注册相同ID的天赋', () => {
      const talent: TalentDefinition = {
        id: 'test_talent',
        name: '测试天赋',
        description: '测试用天赋',
        type: 'numeric',
        talentPointsCost: 1,
        effects: [],
      };

      registry.registerTalent(talent);
      const result = registry.registerTalent(talent);

      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // TR-2: 天赋学习
  // ---------------------------------------------------------------------------

  describe('learnTalent', () => {
    it('应成功学习天赋（天赋值足够）', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);

      const result = registry.learnTalent(playerId, 'vision_basic');

      expect(result.success).toBe(true);
      expect(result.talent).toBeDefined();
      expect(result.talent!.talentId).toBe('vision_basic');
      expect(result.talent!.enabled).toBe(true);
      expect(registry.getPlayerTalentPoints(playerId)).toBe(9);
    });

    it('应拒绝学习（天赋值不足）', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 0);

      const result = registry.learnTalent(playerId, 'vision_basic');

      expect(result.success).toBe(false);
      expect(result.error).toContain('天赋值不足');
    });

    it('应拒绝学习已学习的天赋', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'vision_basic');

      const result = registry.learnTalent(playerId, 'vision_basic');

      expect(result.success).toBe(false);
      expect(result.error).toContain('已学习天赋');
    });

    it('应检查前置天赋', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);

      // 尝试学习 vision_advanced（需要前置 vision_basic）
      const result = registry.learnTalent(playerId, 'vision_advanced');

      expect(result.success).toBe(false);
      expect(result.error).toContain('前置天赋');
    });

    it('应成功学习有前置天赋的天赋', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);

      // 先学习前置天赋
      registry.learnTalent(playerId, 'vision_basic');

      // 再学习高级天赋
      const result = registry.learnTalent(playerId, 'vision_advanced');

      expect(result.success).toBe(true);
    });

    it('应拒绝学习互斥天赋', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);

      // 先学习 credit_enable
      registry.learnTalent(playerId, 'credit_enable');

      // 尝试学习 credit_disable（互斥）
      const result = registry.learnTalent(playerId, 'credit_disable');

      expect(result.success).toBe(false);
      expect(result.error).toContain('互斥');
    });
  });

  // ---------------------------------------------------------------------------
  // TR-3: 天赋取消学习
  // ---------------------------------------------------------------------------

  describe('unlearnTalent', () => {
    it('应成功取消学习天赋并退还天赋值', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'vision_basic');

      const result = registry.unlearnTalent(playerId, 'vision_basic');

      expect(result.success).toBe(true);
      expect(result.refundedPoints).toBe(1);
      expect(registry.getPlayerTalentPoints(playerId)).toBe(10);
      expect(registry.hasPlayerLearnedTalent(playerId, 'vision_basic')).toBe(false);
    });

    it('应拒绝取消未学习的天赋', () => {
      const playerId = 'player-1';

      const result = registry.unlearnTalent(playerId, 'vision_basic');

      expect(result.success).toBe(false);
      expect(result.error).toContain('未学习天赋');
    });

    it('应拒绝取消有依赖天赋的前置天赋', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'vision_basic');
      registry.learnTalent(playerId, 'vision_advanced');

      // 尝试取消前置天赋（有依赖）
      const result = registry.unlearnTalent(playerId, 'vision_basic');

      expect(result.success).toBe(false);
      expect(result.error).toContain('依赖');
    });
  });

  // ---------------------------------------------------------------------------
  // TR-4: 天赋启用/禁用
  // ---------------------------------------------------------------------------

  describe('toggleTalent', () => {
    it('应成功禁用已学习的天赋', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'vision_basic');

      const result = registry.toggleTalent(playerId, 'vision_basic', false);

      expect(result.success).toBe(true);
      expect(registry.isTalentEnabledForPlayer(playerId, 'vision_basic')).toBe(false);
    });

    it('应成功重新启用已禁用的天赋', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'vision_basic');
      registry.toggleTalent(playerId, 'vision_basic', false);

      const result = registry.toggleTalent(playerId, 'vision_basic', true);

      expect(result.success).toBe(true);
      expect(registry.isTalentEnabledForPlayer(playerId, 'vision_basic')).toBe(true);
    });

    it('应拒绝切换未学习的天赋', () => {
      const playerId = 'player-1';

      const result = registry.toggleTalent(playerId, 'vision_basic', false);

      expect(result.success).toBe(false);
      expect(result.error).toContain('未学习天赋');
    });
  });

  // ---------------------------------------------------------------------------
  // TR-5: 天赋值管理
  // ---------------------------------------------------------------------------

  describe('talentPoints', () => {
    it('应正确初始化天赋值', () => {
      const playerId = 'player-1';

      registry.setPlayerTalentPoints(playerId, 5);

      expect(registry.getPlayerTalentPoints(playerId)).toBe(5);
    });

    it('应正确增加天赋值', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 5);

      const newPoints = registry.addTalentPoints(playerId, 3);

      expect(newPoints).toBe(8);
      expect(registry.getPlayerTalentPoints(playerId)).toBe(8);
    });

    it('应拒绝负数天赋值', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 5);

      registry.setPlayerTalentPoints(playerId, -1);

      expect(registry.getPlayerTalentPoints(playerId)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // TR-6: 天赋查询
  // ---------------------------------------------------------------------------

  describe('query', () => {
    it('应返回所有已注册的天赋', () => {
      const talents = registry.getAllTalents();

      expect(talents.length).toBeGreaterThan(0);
      expect(talents.some(t => t.id === 'vision_basic')).toBe(true);
    });

    it('应返回玩家已学习的天赋', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'vision_basic');
      registry.learnTalent(playerId, 'credit_enable');

      const learned = registry.getPlayerTalents(playerId);

      expect(learned.length).toBe(2);
      expect(learned.some(t => t.talentId === 'vision_basic')).toBe(true);
      expect(learned.some(t => t.talentId === 'credit_enable')).toBe(true);
    });

    it('应正确检查天赋是否已启用', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'vision_basic');

      expect(registry.isTalentEnabledForPlayer(playerId, 'vision_basic')).toBe(true);

      registry.toggleTalent(playerId, 'vision_basic', false);

      expect(registry.isTalentEnabledForPlayer(playerId, 'vision_basic')).toBe(false);
    });
  });
});

describe('TalentEffects', () => {
  let registry: TalentRegistry;
  let effects: TalentEffects;

  beforeEach(() => {
    registry = createTalentRegistry();
    registry.registerTalents(getBuiltinTalents());
    effects = createTalentEffects(registry);
  });

  afterEach(() => {
    registry.clear();
  });

  // ---------------------------------------------------------------------------
  // TR-7: 视野天赋效果
  // ---------------------------------------------------------------------------

  describe('visionEffects', () => {
    it('应正确计算视野半径（无天赋）', () => {
      const playerId = 'player-1';
      const baseRadius = 150;

      const result = effects.calculateVisionRadius(playerId, baseRadius);

      expect(result).toBe(150);
    });

    it('应正确计算视野半径（单天赋）', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'vision_basic');

      const result = effects.calculateVisionRadius(playerId, 150);

      // 150 * (1 + 10/100) = 165
      expect(result).toBe(165);
    });

    it('应正确计算视野半径（多天赋叠加）', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'vision_basic');
      registry.learnTalent(playerId, 'vision_advanced');

      const result = effects.calculateVisionRadius(playerId, 150);

      // 150 * (1 + (10 + 25) / 100) = 150 * 1.35 = 202.5
      expect(result).toBe(202.5);
    });

    it('禁用的天赋不应影响视野', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'vision_basic');
      registry.toggleTalent(playerId, 'vision_basic', false);

      const result = effects.calculateVisionRadius(playerId, 150);

      expect(result).toBe(150);
    });
  });

  // ---------------------------------------------------------------------------
  // TR-8: 字段开关天赋
  // ---------------------------------------------------------------------------

  describe('fieldToggleEffects', () => {
    it('应正确启用字段', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'credit_enable');

      const enabled = effects.isFieldEnabled(playerId, 'credit', false);

      expect(enabled).toBe(true);
    });

    it('应正确禁用字段', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'credit_disable');

      const enabled = effects.isFieldEnabled(playerId, 'credit', true);

      expect(enabled).toBe(false);
    });

    it('应正确获取启用的字段列表', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'credit_enable');
      registry.learnTalent(playerId, 'alternate_field_enable');

      const enabledFields = effects.getEnabledFields(playerId, ['money', 'credit', 'alternate']);

      expect(enabledFields).toContain('money'); // 默认启用
      expect(enabledFields).toContain('credit'); // 天赋启用
      expect(enabledFields).toContain('alternate'); // 天赋启用
    });
  });

  // ---------------------------------------------------------------------------
  // TR-9: 机制开关天赋
  // ---------------------------------------------------------------------------

  describe('featureToggleEffects', () => {
    it('应正确启用游戏机制', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'bank_enable');

      const enabled = effects.isFeatureEnabled(playerId, 'bank', false);

      expect(enabled).toBe(true);
    });

    it('应正确禁用游戏机制', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'bank_disable');

      const enabled = effects.isFeatureEnabled(playerId, 'bank', true);

      expect(enabled).toBe(false);
    });

    it('应正确获取启用的机制列表', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'bank_enable');
      registry.learnTalent(playerId, 'items_enable');

      const enabledFeatures = effects.getEnabledFeatures(playerId, ['bank', 'items', 'team']);

      expect(enabledFeatures).toContain('bank'); // 天赋启用
      expect(enabledFeatures).toContain('items'); // 天赋启用
      expect(enabledFeatures).toContain('team'); // 默认启用
    });
  });

  // ---------------------------------------------------------------------------
  // TR-10: 组合天赋效果
  // ---------------------------------------------------------------------------

  describe('combinedEffects', () => {
    it('应正确应用进阶天赋的组合效果', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'vision_basic');
      registry.learnTalent(playerId, 'explorer');

      const effectResult = effects.applyAllEffects(playerId);

      // explorer 提供视野+20%和启用备选数值
      expect(effectResult.visionRadiusBonus).toBe(20);
      expect(effectResult.enabledFields).toContain('alternate');
    });

    it('应正确应用极简主义者天赋', () => {
      const playerId = 'player-1';
      registry.setPlayerTalentPoints(playerId, 10);
      registry.learnTalent(playerId, 'minimalist');

      const effectResult = effects.applyAllEffects(playerId);

      // minimalist 禁用所有扩展系统
      expect(effectResult.disabledFeatures).toContain('credit');
      expect(effectResult.disabledFeatures).toContain('bank');
      expect(effectResult.disabledFeatures).toContain('items');
      expect(effectResult.disabledFeatures).toContain('team');
    });
  });
});

describe('BUILTIN_TALENTS', () => {
  it('应包含视野天赋', () => {
    const visionTalents = BUILTIN_TALENTS.filter(t =>
      t.effects.some(e => e.visionRange !== undefined),
    );

    expect(visionTalents.length).toBeGreaterThan(0);
    expect(visionTalents.some(t => t.id === 'vision_basic')).toBe(true);
    expect(visionTalents.some(t => t.id === 'vision_advanced')).toBe(true);
    expect(visionTalents.some(t => t.id === 'vision_master')).toBe(true);
  });

  it('应包含字段开关天赋', () => {
    const fieldToggleTalents = BUILTIN_TALENTS.filter(t => t.type === 'field_toggle');

    expect(fieldToggleTalents.length).toBeGreaterThan(0);
    expect(fieldToggleTalents.some(t => t.id === 'credit_enable')).toBe(true);
    expect(fieldToggleTalents.some(t => t.id === 'credit_disable')).toBe(true);
  });

  it('应包含机制开关天赋', () => {
    const featureToggleTalents = BUILTIN_TALENTS.filter(t => t.type === 'feature_toggle');

    expect(featureToggleTalents.length).toBeGreaterThan(0);
    expect(featureToggleTalents.some(t => t.id === 'bank_enable')).toBe(true);
    expect(featureToggleTalents.some(t => t.id === 'bank_disable')).toBe(true);
  });

  it('应包含进阶天赋', () => {
    const advancedTalents = BUILTIN_TALENTS.filter(t => t.effects.length > 1);

    expect(advancedTalents.length).toBeGreaterThan(0);
    expect(advancedTalents.some(t => t.id === 'explorer')).toBe(true);
    expect(advancedTalents.some(t => t.id === 'economist')).toBe(true);
    expect(advancedTalents.some(t => t.id === 'minimalist')).toBe(true);
  });

  it('应正确设置互斥关系', () => {
    const creditEnable = BUILTIN_TALENTS.find(t => t.id === 'credit_enable');
    const creditDisable = BUILTIN_TALENTS.find(t => t.id === 'credit_disable');

    expect(creditDisable?.mutuallyExclusiveWith).toContain('credit_enable');
  });

  it('应正确设置前置关系', () => {
    const visionAdvanced = BUILTIN_TALENTS.find(t => t.id === 'vision_advanced');
    const visionMaster = BUILTIN_TALENTS.find(t => t.id === 'vision_master');

    expect(visionAdvanced?.prerequisites).toContain('vision_basic');
    expect(visionMaster?.prerequisites).toContain('vision_advanced');
  });
});