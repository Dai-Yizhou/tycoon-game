import { ChatManager, DEFAULT_CHAT_CONFIG } from '../../src/chat/index.js';

describe('聊天区限频', () => {
  it('同一玩家在一分钟内超过限制时拒绝发送', () => {
    const manager = new ChatManager({
      ...DEFAULT_CHAT_CONFIG,
      maxPlayerMessagesPerMinute: 2,
    });

    expect(manager.sendMessage('global', 'player-1', '玩家1', '消息1', undefined, 1)).not.toBeNull();
    expect(manager.sendMessage('global', 'player-1', '玩家1', '消息2', undefined, 2)).not.toBeNull();
    expect(manager.sendMessage('global', 'player-1', '玩家1', '消息3', undefined, 3)).toBeNull();
  });

  it('不能通过切换频道绕过玩家限频', () => {
    const manager = new ChatManager({
      ...DEFAULT_CHAT_CONFIG,
      maxPlayerMessagesPerMinute: 1,
    });

    expect(manager.sendMessage('global', 'player-1', '玩家1', '世界消息', undefined, 1)).not.toBeNull();
    expect(manager.sendMessage('region', 'player-1', '玩家1', '区域消息', undefined, 2)).toBeNull();
  });

  it('一分钟窗口过期后允许继续发送', () => {
    const manager = new ChatManager({
      ...DEFAULT_CHAT_CONFIG,
      maxPlayerMessagesPerMinute: 1,
    });

    expect(manager.sendMessage('global', 'player-1', '玩家1', '消息1', undefined, 1)).not.toBeNull();
    expect(manager.sendMessage('global', 'player-1', '玩家1', '消息2', undefined, 60_001)).not.toBeNull();
  });
});