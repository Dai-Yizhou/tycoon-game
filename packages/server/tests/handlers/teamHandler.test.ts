import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { TeamHandler } from '../../src/handlers/teamHandler.js';
import { TeamManager } from '../../src/team/index.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import type { TypedServer, TypedSocket } from '../../src/transport/SocketManager.js';
import { PlayerStatus, type Player } from '@game/shared';

function createPlayer(id: string): Player {
  return { id, username: `player_${id}`, teamId: null, position: { cellId: 0 }, values: {}, status: PlayerStatus.Normal, createdAt: Date.now(), lastActiveAt: Date.now() };
}

function createSocket(id: string, playerId: string): TypedSocket {
  return { id, data: { playerId }, emit: jest.fn(), on: jest.fn() } as unknown as TypedSocket;
}

function getRegisteredHandler(socket: TypedSocket, event: string): (...args: any[]) => void {
  const registration = (socket.on as jest.Mock).mock.calls.find(([registeredEvent]) => registeredEvent === event);
  return registration?.[1];
}

describe('TeamHandler', () => {
  let world: GameWorld;
  let manager: TeamManager;
  let handler: TeamHandler;
  let io: TypedServer;
  let sockets: Record<string, TypedSocket>;

  beforeEach(() => {
    world = new GameWorld();
    manager = new TeamManager();
    sockets = { player1: createSocket('socket-1', 'player1'), player2: createSocket('socket-2', 'player2'), player3: createSocket('socket-3', 'player3') };
    io = { emit: jest.fn(), sockets: { sockets: new Map(Object.values(sockets).map(socket => [socket.id, socket])) } } as unknown as TypedServer;
    handler = new TeamHandler(io, world, manager);
    for (const [playerId, socket] of Object.entries(sockets)) {
      world.addPlayer(createPlayer(playerId), socket.id);
      handler.register(socket);
    }
  });

  it('接受邀请后同步所有成员的 GameWorld teamId', () => {
    const invite = manager.sendInvite('player1', 'player_player1', 'player2');
    getRegisteredHandler(sockets.player2, 'client.respondToTeamInvite')({ inviteId: invite!.id, accept: true });
    const teamId = manager.getPlayerTeam('player1')!.id;
    expect(world.getPlayer('player1')?.teamId).toBe(teamId);
    expect(world.getPlayer('player2')?.teamId).toBe(teamId);
  });

  it('离队者清除 GameWorld teamId 并保留单人队伍', () => {
    const team = manager.createTeam('player1', 'player_player1');
    const invite = manager.sendInvite('player1', 'player_player1', 'player2');
    manager.respondInvite(invite!.id, 'player2', true);
    for (const playerId of team.memberIds) world.updatePlayer({ ...world.getPlayer(playerId)!, teamId: team.id });
    getRegisteredHandler(sockets.player2, 'client.leaveTeam')({});
    expect(world.getPlayer('player2')?.teamId).toBeNull();
    expect(manager.getPlayerTeam('player1')?.id).toBe(team.id);
    expect(sockets.player1.emit).toHaveBeenCalledWith('server.teamUpdated', expect.objectContaining({ team: expect.objectContaining({ id: team.id }) }));
  });

  it('操作权限可执行踢人并清除 teamId', () => {
    const team = manager.createTeam('player1', 'player_player1');
    const invite = manager.sendInvite('player1', 'player_player1', 'player2');
    manager.respondInvite(invite!.id, 'player2', true);
    const secondInvite = manager.sendInvite('player1', 'player_player1', 'player3');
    manager.respondInvite(secondInvite!.id, 'player3', true);
    for (const playerId of team.memberIds) world.updatePlayer({ ...world.getPlayer(playerId)!, teamId: team.id });
    getRegisteredHandler(sockets.player1, 'client.kickTeamMember')({ targetPlayerId: 'player2' });
    expect(world.getPlayer('player2')?.teamId).toBeNull();
    expect(sockets.player2.emit).toHaveBeenCalledWith('server.teamMemberKicked', expect.objectContaining({ teamId: team.id }));
  });

  it('离线不解散队伍，也不清除成员 teamId', () => {
    const team = manager.createTeam('player1', 'player_player1');
    const invite = manager.sendInvite('player1', 'player_player1', 'player2');
    manager.respondInvite(invite!.id, 'player2', true);
    for (const playerId of team.memberIds) world.updatePlayer({ ...world.getPlayer(playerId)!, teamId: team.id });
    manager.cleanupOfflineTeams(['player1', 'player2']);
    expect(manager.getPlayerTeam('player1')?.id).toBe(team.id);
    expect(world.getPlayer('player1')?.teamId).toBe(team.id);
    expect(world.getPlayer('player2')?.teamId).toBe(team.id);
  });
});
