import { EconomyService } from '../../src/economy/EconomyService.js';
import { Bankruptcy } from '../../src/economy/Bankruptcy.js';
import { GameWorld } from '../../src/world/GameWorld.js';

describe('EconomyService', () => {
  it('changes a player value through the world and returns the authoritative result', () => {
    const world = new GameWorld();
    world.addPlayer({
      id: 'p1',
      username: '玩家',
      position: { cellId: 0 },
      status: 'normal',
      values: { money: { id: 'money', name: '财产', current: 100, min: 0 } },
    } as never);
    const service = new EconomyService(world);

    expect(service.changeValue('p1', 'money', -35, 'transport')).toEqual({
      ok: true,
      playerId: 'p1',
      fieldId: 'money',
      previous: 100,
      current: 65,
      delta: -35,
      reason: 'transport',
    });
    expect(world.getPlayer('p1')?.values.money?.current).toBe(65);
  });

  it('允许扣成负数，低于 min（破产阈值）后按负债式破产标记为破产', () => {
    const world = new GameWorld();
    const player = {
      id: 'p1', username: '玩家', position: { cellId: 0 }, status: 'normal',
      values: { money: { id: 'money', name: '财产', current: 5, min: 0 } },
    } as never;
    world.addPlayer(player);
    const bankruptcy = new Bankruptcy({ emit: jest.fn() } as never, world, { clearTaxRecords: jest.fn(), getAllTaxRecords: jest.fn(() => new Map()) } as never);
    const service = new EconomyService(world);

    // 负债口径：不再钳 min，实扣等于配置增量；判定推迟到结算边界
    expect(service.changeValue('p1', 'money', -20, 'rent_payment')).toMatchObject({ ok: true, current: -15, delta: -20 });
    bankruptcy.flushPendingBankruptcies();
    expect(world.getPlayer('p1')?.status).toBe('bankrupt');
    bankruptcy.cleanup();
  });

  it('只钳上界（max），不再钳下界', () => {
    const world = new GameWorld();
    world.addPlayer({
      id: 'p1',
      username: '玩家',
      position: { cellId: 0 },
      status: 'normal',
      values: { credit: { id: 'credit', name: '信用', current: 5, min: 0, max: 100 } },
    } as never);
    const service = new EconomyService(world);

    expect(service.changeValue('p1', 'credit', -20, 'jail')).toMatchObject({ ok: true, current: -15 });
    expect(service.changeValue('p1', 'credit', 200, 'bonus')).toMatchObject({ ok: true, current: 100 });
  });
});
