import { publishValueChanged } from '../../src/net/valuePublisher';

function fakeIo(): { emit: jest.Mock; seen: unknown[] } {
  const seen: unknown[] = [];
  return {
    seen,
    emit: jest.fn((evt: string, payload: unknown) => { seen.push({ evt, payload }); }),
  };
}

describe('publishValueChanged 数值绝对值发布', () => {
  test('广播 server.valueChanged 且必带绝对值 current（delta 固定为 0，表示覆写契约）', () => {
    const io = fakeIo();
    publishValueChanged(io as never, 'p1', 'money', 750);

    expect(io.seen).toHaveLength(1);
    const [e] = io.seen as Array<{ evt: string; payload: any }>;
    expect(e.evt).toBe('server.valueChanged');
    expect(e.payload.playerId).toBe('p1');
    expect(e.payload.fieldId).toBe('money');
    // 绝对值字段必须存在且为 number
    expect('current' in e.payload).toBe(true);
    expect(typeof e.payload.current).toBe('number');
    expect(e.payload.current).toBe(750);
    // delta 固定 0：客户端按 current 直接覆写、不累加
    expect(e.payload.delta).toBe(0);
  });

  test('按结算后权威 current 覆写，不同结算值广播对应绝对值', () => {
    const io = fakeIo();
    publishValueChanged(io as never, 'p1', 'money', 300);
    publishValueChanged(io as never, 'p1', 'money', 100);
    const second = (io.seen[1] as { payload: { current: number } }).payload;
    expect(second.current).toBe(100);
  });
});