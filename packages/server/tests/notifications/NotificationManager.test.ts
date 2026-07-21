/**
 * NotificationManager 测试
 */

import { NotificationManager, DEFAULT_NOTIFICATION_CONFIG } from '../../src/notifications/index.js';

describe('NotificationManager', () => {
  let manager: NotificationManager;

  beforeEach(() => {
    manager = new NotificationManager();
  });

  afterEach(() => {
    manager.clear();
  });

  describe('通知创建', () => {
    test('创建普通通知', () => {
      const notification = manager.createNotification(
        'info',
        '系统通知',
        '测试通知内容',
      );
      expect(notification).toBeDefined();
      expect(notification.type).toBe('info');
      expect(notification.title).toBe('系统通知');
      expect(notification.status).toBe('active');
    });

    test('创建带动作的通知', () => {
      const notification = manager.createNotification(
        'warning',
        '组队邀请',
        '玩家1邀请您加入队伍',
        [
          { label: '接受', action: 'accept' },
          { label: '拒绝', action: 'reject' },
        ],
      );
      expect(notification.actions).toBeDefined();
      expect(notification.actions?.length).toBe(2);
    });

    test('使用模板创建通知', () => {
      const notification = manager.createFromTemplate('teamInvite', {
        inviterName: '玩家1',
      });
      expect(notification).toBeDefined();
      expect(notification?.title).toBe('组队邀请');
      expect(notification?.content).toContain('玩家1');
    });
  });

  describe('特定类型通知', () => {
    test('创建组队邀请通知', () => {
      const notification = manager.createTeamInviteNotification(
        '玩家1',
        'player1',
        'invite123',
        'player2',
      );
      expect(notification).toBeDefined();
      expect(notification.title).toBe('组队邀请');
      expect(notification.targetPlayerId).toBe('player2');
    });

    test('创建复活令目标选择通知', () => {
      const notification = manager.createReviveOrderSelectNotification('player1', [
        { id: 'bankrupt1', name: '破产玩家1' },
      ]);
      expect(notification).toBeDefined();
      expect(notification.metadata?.bankruptPlayers).toBeDefined();
    });

    test('创建路径选择通知', () => {
      const notification = manager.createPathSelectNotification('player1', 10, [
        { cellId: 11, label: '路径A' },
        { cellId: 12, label: '路径B' },
      ]);
      expect(notification).toBeDefined();
      expect(notification.actions?.length).toBe(2);
    });

    test('创建道具获得通知', () => {
      const notification = manager.createItemAcquiredNotification('player1', '查封令');
      expect(notification).toBeDefined();
      expect(notification.content).toContain('查封令');
    });
  });

  describe('通知查询', () => {
    test('获取玩家的通知列表', () => {
      manager.createNotification('info', '通知1', '内容1', undefined, undefined, 'player1');
      manager.createNotification('info', '通知2', '内容2', undefined, undefined, 'player1');
      manager.createNotification('info', '全局通知', '全局内容'); // 全局通知

      const notifications = manager.getPlayerNotifications('player1');
      expect(notifications.length).toBe(3);
    });

    test('获取所有活跃通知', () => {
      manager.createNotification('info', '通知1', '内容1');
      manager.createNotification('success', '通知2', '内容2');
      const notifications = manager.getAllActiveNotifications();
      expect(notifications.length).toBe(2);
    });
  });

  describe('通知操作', () => {
    test('执行通知动作', () => {
      const notification = manager.createNotification(
        'info',
        '测试',
        '内容',
        [{ label: '确定', action: 'confirm', payload: { id: '123' } }],
      );
      const payload = manager.executeAction(notification.id, 'confirm');
      expect(payload).toEqual({ id: '123' });
      expect(notification.status).toBe('actioned');
    });

    test('关闭通知', () => {
      const notification = manager.createNotification('info', '测试', '内容');
      manager.dismissNotification(notification.id);
      expect(notification.status).toBe('dismissed');
    });

    test('批量关闭玩家通知', () => {
      manager.createNotification('info', '通知1', '内容1', undefined, undefined, 'player1');
      manager.createNotification('info', '通知2', '内容2', undefined, undefined, 'player1');
      const count = manager.dismissPlayerNotifications('player1');
      expect(count).toBe(2);
    });
  });

  describe('通知清理', () => {
    test('限制通知历史长度', () => {
      // 创建超过限制的通知
      for (let i = 0; i < 110; i++) {
        manager.createNotification('info', `通知${i}`, `内容${i}`);
      }
      const total = manager.getTotalNotificationCount();
      expect(total).toBeLessThanOrEqual(100);
    });

    test('清理过期通知', () => {
      const limitedManager = new NotificationManager({
        ...DEFAULT_NOTIFICATION_CONFIG,
        expireMs: 100, // 100ms 过期
        autoCleanup: false,
      });

      limitedManager.createNotification('info', '测试', '内容');

      // 等待过期
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const count = limitedManager.cleanupExpiredNotifications();
          expect(count).toBe(1);
          limitedManager.clear();
          resolve();
        }, 150);
      });
    });
  });

  describe('通知统计', () => {
    test('获取通知总数', () => {
      manager.createNotification('info', '通知1', '内容1');
      manager.createNotification('success', '通知2', '内容2');
      const total = manager.getTotalNotificationCount();
      expect(total).toBe(2);
    });

    test('获取活跃通知数量', () => {
      manager.createNotification('info', '通知1', '内容1');
      manager.createNotification('success', '通知2', '内容2');
      const active = manager.getActiveNotificationCount();
      expect(active).toBe(2);
    });
  });
});