/**
 * ChatManager 测试
 */

import { ChatManager, DEFAULT_CHAT_CONFIG } from '../../src/chat/index.js';

describe('ChatManager', () => {
  let manager: ChatManager;

  beforeEach(() => {
    manager = new ChatManager();
  });

  afterEach(() => {
    manager.clear();
  });

  describe('消息发送', () => {
    test('发送普通消息成功', () => {
      const message = manager.sendMessage('global', 'player1', '玩家1', '你好');
      expect(message).toBeDefined();
      expect(message?.content).toBe('你好');
      expect(message?.senderId).toBe('player1');
      expect(message?.senderName).toBe('玩家1');
    });

    test('发送系统消息成功', () => {
      const message = manager.sendSystemMessage('system', '系统维护中', 'announcement');
      expect(message).toBeDefined();
      expect(message?.content).toBe('系统维护中');
      expect(message?.senderId).toBeNull();
    });

    test('发送队伍消息成功', () => {
      const message = manager.sendTeamMessage('player1', '玩家1', '集合', 'team123');
      expect(message).toBeDefined();
      expect(message?.channel).toBe('team');
      expect(message?.metadata?.teamId).toBe('team123');
    });

    test('发送区域消息成功', () => {
      const message = manager.sendRegionMessage('player1', '玩家1', '有人吗', 'region456');
      expect(message).toBeDefined();
      expect(message?.channel).toBe('region');
      expect(message?.metadata?.regionId).toBe('region456');
    });
  });

  describe('消息历史', () => {
    test('获取频道历史', () => {
      manager.sendMessage('global', 'player1', '玩家1', '消息1');
      manager.sendMessage('global', 'player2', '玩家2', '消息2');
      const history = manager.getChannelHistory('global');
      expect(history.length).toBe(2);
    });

    test('限制历史长度', () => {
      // 发送超过限制的消息
      for (let i = 0; i < 60; i++) {
        manager.sendMessage('global', 'player1', '玩家1', `消息${i}`);
      }
      const history = manager.getChannelHistory('global');
      expect(history.length).toBeLessThanOrEqual(50);
    });

    test('清空频道历史', () => {
      manager.sendMessage('global', 'player1', '玩家1', '消息');
      manager.clearChannelHistory('global');
      const history = manager.getChannelHistory('global');
      expect(history.length).toBe(0);
    });
  });

  describe('XSS 防护', () => {
    test('移除 HTML 标签', () => {
      const message = manager.sendMessage('global', 'player1', '玩家1', '<script>alert("xss")</script>你好');
      expect(message?.content).not.toContain('<script>');
      expect(message?.content).not.toContain('</script>');
    });

    test('移除 javascript: 协议', () => {
      const message = manager.sendMessage('global', 'player1', '玩家1', 'javascript:alert("xss")');
      expect(message?.content).not.toContain('javascript:');
    });

    test('移除事件处理器', () => {
      const message = manager.sendMessage('global', 'player1', '玩家1', '<img onerror="alert(1)">');
      expect(message?.content).not.toContain('onerror');
    });
  });

  describe('内容过滤', () => {
    test('过滤禁止词', () => {
      const filteredManager = new ChatManager({
        ...DEFAULT_CHAT_CONFIG,
        bannedWords: ['敏感词', 'badword'],
      });
      const message = filteredManager.sendMessage('global', 'player1', '玩家1', '这是敏感词测试');
      expect(message?.content).toBe('这是***测试');
      filteredManager.clear();
    });

    test('动态添加禁止词', () => {
      manager.addBannedWord('测试词');
      const message = manager.sendMessage('global', 'player1', '玩家1', '这是测试词');
      expect(message?.content).toBe('这是***');
    });

    test('移除禁止词', () => {
      manager.addBannedWord('测试词');
      manager.removeBannedWord('测试词');
      const message = manager.sendMessage('global', 'player1', '玩家1', '这是测试词');
      expect(message?.content).toBe('这是测试词');
    });
  });

  describe('消息长度限制', () => {
    test('截断超长消息', () => {
      const longMessage = 'a'.repeat(600);
      const message = manager.sendMessage('global', 'player1', '玩家1', longMessage);
      expect(message?.content.length).toBe(500);
    });
  });

  describe('频道管理', () => {
    test('获取所有活跃频道', () => {
      const channels = manager.getActiveChannels();
      expect(channels).toContain('system');
      expect(channels).toContain('global');
      expect(channels).toContain('team');
      expect(channels).toContain('region');
    });

    test('检查频道是否允许玩家发送消息', () => {
      expect(manager.canPlayerSendMessage('global')).toBe(true);
      expect(manager.canPlayerSendMessage('system')).toBe(false);
    });
  });

  describe('消息统计', () => {
    test('获取消息总数', () => {
      manager.sendMessage('global', 'player1', '玩家1', '消息1');
      manager.sendMessage('global', 'player2', '玩家2', '消息2');
      manager.sendMessage('team', 'player1', '玩家1', '消息3');
      const total = manager.getTotalMessageCount();
      expect(total).toBe(3);
    });
  });
});