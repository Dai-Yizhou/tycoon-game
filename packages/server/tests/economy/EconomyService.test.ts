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

  it('触底后按现有破产机制立即将玩家标记为破产', () => {
    const world = new GameWorld();
    const player = {
      id: 'p1', username: '玩家', position: { cellId: 0 }, status: 'normal',
      values: { money: { id: 'money', name: '财产', current: 5, min: 0 } },
    } as never;
    world.addPlayer(player);
    const bankruptcy = new Bankruptcy({ emit: jest.fn() } as never, world, { clearTaxRecords: jest.fn(), getAllTaxRecords: jest.fn(() => new Map()) } as never);
    const service = new EconomyService(world);

    expect(service.changeValue('p1', 'money', -20, 'rent_payment')).toMatchObject({ ok: true, current: 0, delta: -5 });
    expect(world.getPlayer('p1')?.status).toBe('bankrupt');
    bankruptcy.cleanup();
  });

  it('clamps values to their configured bounds', () => {
    const world = new GameWorld();
    world.addPlayer({
      id: 'p1',
      username: '玩家',
      position: { cellId: 0 },
      status: 'normal',
      values: { credit: { id: 'credit', name: '信用', current: 5, min: 0, max: 100 } },
    } as never);
    const service = new EconomyService(world);

    expect(service.changeValue('p1', 'credit', -20, 'jail')).toMatchObject({ ok: true, current: 0 });
  });
});
