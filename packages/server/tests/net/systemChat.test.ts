import type { ValueFieldDefinition } from '@game/shared';
import { broadcastSystemMessage, formatFieldAmounts } from '../../src/net/systemChat';

function fakeIo(): { emit: jest.Mock; seen: Array<{ evt: string; payload: any }> } {
  const seen: Array<{ evt: string; payload: any }> = [];
  return {
    seen,
    emit: jest.fn((evt: string, payload: unknown) => { seen.push({ evt, payload }); }),
  };
}

const definitions: ValueFieldDefinition[] = [
  { id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player', min: 0 },
  { id: 'pros', name: { 'zh-CN': '繁荣', 'en-US': 'Prosperity' }, scope: 'region', min: 0 },
];

describe('broadcastSystemMessage 系统聊天广播', () => {
  test('广播 server.chat，channel 为 system、senderId 为 null 并携带内容', () => {
    const io = fakeIo();
    broadcastSystemMessage(io as never, '测试消息');

    expect(io.seen).toHaveLength(1);
    const [event] = io.seen;
    expect(event.evt).toBe('server.chat');
    expect(event.payload.message.channel).toBe('system');
    expect(event.payload.message.senderId).toBeNull();
    expect(event.payload.message.content).toBe('测试消息');
    expect(event.payload.message.metadata).toEqual({ type: 'game_event' });
  });

  test('连续广播的 id 唯一', () => {
    const io = fakeIo();
    broadcastSystemMessage(io as never, 'a');
    broadcastSystemMessage(io as never, 'b');
    const [first, second] = io.seen.map((item) => item.payload.message.id);
    expect(first).not.toBe(second);
  });
});

describe('formatFieldAmounts 逐字段金额格式化', () => {
  test('取中文名、正数补 +、按 scope 匹配定义', () => {
    expect(formatFieldAmounts({ money: 5 }, definitions)).toBe('财产 +5');
    expect(formatFieldAmounts({ pros: -20 }, definitions, 'region')).toBe('繁荣 -20');
    // scope 不匹配时不认该定义，回退为字段 ID
    expect(formatFieldAmounts({ pros: -20 }, definitions)).toBe('pros -20');
  });

  test('跳过 0 与非有限值', () => {
    expect(formatFieldAmounts({ money: 0, pros: Number.NaN }, definitions)).toBe('');
  });

  test('未声明定义时回退字段 ID', () => {
    expect(formatFieldAmounts({ gold: 3 })).toBe('gold +3');
  });
});