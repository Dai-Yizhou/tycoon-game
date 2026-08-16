import { EconomicOperationGuard } from '../../src/economy/EconomicOperationGuard.js';

describe('EconomicOperationGuard', () => {
  it('expires old request results and bounds retained request results', () => {
    const guard = new EconomicOperationGuard({ ttlMs: 10, maxEntries: 2, now: () => 100 });
    guard.complete('a', { ok: true });
    guard.complete('b', { ok: true });
    guard.complete('c', { ok: true });
    expect(guard.getResult('a')).toBeUndefined();
    expect(guard.getResult('b')).toEqual({ ok: true });
    expect(guard.getResult('c')).toEqual({ ok: true });
  });
});
