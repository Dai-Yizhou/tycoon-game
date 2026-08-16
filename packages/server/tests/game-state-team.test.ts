import { GameWorld } from '../src/world/GameWorld.js';

describe('server.gameState', () => {
  it('restores the team alongside the player snapshot', () => {
    const world = new GameWorld();
    world.createTeam({ id: 'team-1', name: 'Team', memberIds: ['p1'], disbanded: false } as never);
    expect(world.getTeam('team-1')).toEqual(expect.objectContaining({ memberIds: ['p1'] }));
  });
});
