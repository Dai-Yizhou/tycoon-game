/**
 * 成就管理器测试
 */

import { AchievementManager } from '../../src/achievements/AchievementManager.js';
import { BUILTIN_ACHIEVEMENTS } from '../../src/achievements/achievementTemplates.js';
import type { Player, PlayerAchievement } from '@game/shared';

describe('AchievementManager', () => {
  let manager: AchievementManager;

  beforeEach(() => {
    manager = new AchievementManager();
    manager.registerAll(BUILTIN_ACHIEVEMENTS);
  });

  describe('register', () => {
    it('should register achievement', () => {
      const achievement = manager.getAchievement('wealth_1000');
      expect(achievement).toBeDefined();
      expect(achievement?.name).toBe('初级富翁');
    });

    it('should register all built-in achievements', () => {
      const achievements = manager.getAllAchievements();
      expect(achievements.length).toBeGreaterThan(0);
    });
  });

  describe('getAchievementsByCategory', () => {
    it('should return achievements by category', () => {
      const wealthAchievements = manager.getAchievementsByCategory('wealth');
      expect(wealthAchievements.length).toBeGreaterThan(0);
      expect(wealthAchievements.every(a => a.category === 'wealth')).toBe(true);
    });
  });

  describe('hasAchievement', () => {
    it('should return true for unlocked achievement', () => {
      const achievements: PlayerAchievement[] = [
        { achievementId: 'wealth_1000', unlockedAt: Date.now(), rewardClaimed: false },
      ];

      expect(manager.hasAchievement(achievements, 'wealth_1000')).toBe(true);
    });

    it('should return false for locked achievement', () => {
      const achievements: PlayerAchievement[] = [];

      expect(manager.hasAchievement(achievements, 'wealth_1000')).toBe(false);
    });
  });

  describe('checkPrerequisites', () => {
    it('should return true for achievement without prerequisites', () => {
      const achievements: PlayerAchievement[] = [];
      const achievement = manager.getAchievement('wealth_1000')!;

      expect(manager.checkPrerequisites(achievements, achievement)).toBe(true);
    });

    it('should return false when prerequisites not met', () => {
      const achievements: PlayerAchievement[] = [];
      const achievement = manager.getAchievement('wealth_5000')!;

      expect(manager.checkPrerequisites(achievements, achievement)).toBe(false);
    });

    it('should return true when prerequisites met', () => {
      const achievements: PlayerAchievement[] = [
        { achievementId: 'wealth_1000', unlockedAt: Date.now(), rewardClaimed: false },
      ];
      const achievement = manager.getAchievement('wealth_5000')!;

      expect(manager.checkPrerequisites(achievements, achievement)).toBe(true);
    });
  });

  describe('checkCondition', () => {
    const mockPlayer: Player = {
      id: 'player1',
      username: 'testuser',
      teamId: null,
      position: { cellId: 0 },
      values: {
        money: { id: 'money', name: '财产', current: 5000 },
        credit: { id: 'credit', name: '信用值', current: 50 },
      },
      items: [],
      status: 'normal',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    it('should check value_threshold condition', () => {
      const condition = {
        type: 'value_threshold' as const,
        fieldId: 'money',
        target: 1000,
        description: '财产达到 1000',
      };

      expect(manager.checkCondition(condition, mockPlayer)).toBe(true);
    });

    it('should check value_threshold condition not met', () => {
      const condition = {
        type: 'value_threshold' as const,
        fieldId: 'money',
        target: 10000,
        description: '财产达到 10000',
      };

      expect(manager.checkCondition(condition, mockPlayer)).toBe(false);
    });

    it('should check ownership condition', () => {
      const condition = {
        type: 'ownership' as const,
        customId: 'propertyCount',
        target: 5,
        description: '拥有 5 处地产',
      };

      expect(manager.checkCondition(condition, mockPlayer, { propertyCount: 5 })).toBe(true);
      expect(manager.checkCondition(condition, mockPlayer, { propertyCount: 3 })).toBe(false);
    });

    it('should check special condition', () => {
      const condition = {
        type: 'special' as const,
        customId: 'joinedTeam',
        description: '首次加入队伍',
      };

      expect(manager.checkCondition(condition, mockPlayer, { joinedTeam: true })).toBe(true);
      expect(manager.checkCondition(condition, mockPlayer, { joinedTeam: false })).toBe(false);
    });
  });

  describe('calculateProgress', () => {
    const mockPlayer: Player = {
      id: 'player1',
      username: 'testuser',
      teamId: null,
      position: { cellId: 0 },
      values: {
        money: { id: 'money', name: '财产', current: 7500 },
      },
      items: [],
      status: 'normal',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    it('should calculate progress correctly', () => {
      const achievement = manager.getAchievement('wealth_5000')!;
      const progress = manager.calculateProgress(achievement, mockPlayer);

      expect(progress['value_threshold']).toBeDefined();
      expect(progress['value_threshold'].current).toBe(7500);
      expect(progress['value_threshold'].target).toBe(5000);
      expect(progress['value_threshold'].percentage).toBe(100);
    });
  });

  describe('checkAchievements', () => {
    it('should unlock achievement when conditions met', async () => {
      const mockPlayer: Player = {
        id: 'player1',
        username: 'testuser',
        teamId: null,
        position: { cellId: 0 },
        values: {
          money: { id: 'money', name: '财产', current: 1000 },
        },
        items: [],
        status: 'normal',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      };

      const achievements: PlayerAchievement[] = [];
      const unlocked = await manager.checkAchievements(mockPlayer, achievements);

      expect(unlocked.length).toBeGreaterThan(0);
      expect(unlocked.some(e => e.achievementId === 'wealth_1000')).toBe(true);
    });

    it('should not unlock achievement when conditions not met', async () => {
      const mockPlayer: Player = {
        id: 'player1',
        username: 'testuser',
        teamId: null,
        position: { cellId: 0 },
        values: {
          money: { id: 'money', name: '财产', current: 500 },
        },
        items: [],
        status: 'normal',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      };

      const achievements: PlayerAchievement[] = [];
      const unlocked = await manager.checkAchievements(mockPlayer, achievements);

      expect(unlocked.length).toBe(0);
    });
  });

  describe('onUnlock callback', () => {
    it('should trigger callback on unlock', async () => {
      const callback = jest.fn();
      manager.onUnlock(callback);

      const mockPlayer: Player = {
        id: 'player1',
        username: 'testuser',
        teamId: null,
        position: { cellId: 0 },
        values: {
          money: { id: 'money', name: '财产', current: 1000 },
        },
        items: [],
        status: 'normal',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      };

      await manager.checkAchievements(mockPlayer, []);

      expect(callback).toHaveBeenCalled();
    });
  });
});