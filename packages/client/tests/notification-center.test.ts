import { createNotificationCenter } from '../src/components/NotificationCenter.js';

describe('NotificationCenter', () => {
  test('统一事件入口转发 notification 后显示 toast', () => {
    const container = document.createElement('div');
    const socket = { on: jest.fn(), off: jest.fn() };
    const notificationCenter = createNotificationCenter({
      container,
      socket,
      playerId: 'player-1',
    });

    container.appendChild(notificationCenter.getElement());
    notificationCenter.handleNotification({
      id: 'notification-1',
      type: 'success',
      title: '操作成功',
      content: '奖励已到账',
      durationMs: 0,
      createdAt: Date.now(),
      expiresAt: 0,
      status: 'active',
    });

    const toast = container.querySelector('.notification-toast');
    expect(toast?.textContent).toContain('操作成功');
    expect(toast?.textContent).toContain('奖励已到账');
  });
});
