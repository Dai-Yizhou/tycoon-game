import { EconomicOperationGuard } from '../../src/economy/EconomicOperationGuard.js';

describe('EconomicOperationGuard', () => {
  it('serializes a cell lock and returns the same request result', () => {
    const guard = new EconomicOperationGuard<{ ok: boolean }>();
    expect(guard.tryLock('cell:1')).toBe(true);
    expect(guard.tryLock('cell:1')).toBe(false);
    guard.unlock('cell:1');
    expect(guard.tryLock('cell:1')).toBe(true);
    guard.complete('request-1', { ok: true });
    expect(guard.getResult('request-1')).toEqual({ ok: true });
  });

  it('atomically validates and advances an economic version', () => {
    const guard = new EconomicOperationGuard();
    expect(guard.compareAndSwapVersion('resource', 0)).toBe(true);
    expect(guard.compareAndSwapVersion('resource', 0)).toBe(false);
    expect(guard.compareAndSwapVersion('resource', 1)).toBe(true);
  });
});
