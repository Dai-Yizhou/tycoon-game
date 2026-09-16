import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameWorld } from '../../src/world/GameWorld.js';
import { MovementHandler } from '../../src/handlers/movementHandler.js';
import { parseMapData, PlayerStatus } from '@game/shared';
import type { Cell, MapMeta, Player } from '@game/shared';
import type { TypedServer, TypedSocket } from '../../src/transport/SocketManager.js';

/**
 * 岔路机制回归测试
 *
 * 背景：换图后"没有岔路选择"的根因是 mini-map 原先为单环，
 * 任何格子 destinations 都只有单一出口，continueMovement 的
 * unvisited.length > 1 永不满足，server.askPath 永不发出。
 *
 * 修复：格 0（起点岔路补给站）改为双向出口 destinations: [1, 7]。
 * 本测试锁定该行为：进入格 0 且仍有剩余步数时必须暂停并询问路径，
 * 服务端权威校验 choosePath 只接受 destinations 内的目标。
 */

function loadMiniMap(): { mapData: Cell[]; mapMeta: MapMeta } {
  const raw = JSON.parse(readFileSync(join(__dirname, '../../mini-map.json'), 'utf8')) as unknown;
  const mapData = parseMapData(raw);
  const mapMeta = JSON.parse(readFileSync(join(__dirname, '../../mini-map-meta.json'), 'utf8')) as MapMeta;
  return { mapData, mapMeta };
}

function makePlayer(id: string, cellId: number, money: number, credit: number): Player {
  return {
    id,
    username: id,
    teamId: null,
    position: { cellId },
    values: {
      money: { id: 'money', name: 'money', current: money, min: 0 },
      credit: { id: 'credit', name: 'credit', current: credit, min: 0 },
    },
    status: PlayerStatus.Normal,
    createdAt: 1,
    lastActiveAt: 1,
  };
}

function createMockSocket(playerId: string): TypedSocket {
  return {
    data: { playerId },
    emit: jest.fn(),
    on: jest.fn(),
  } as unknown as TypedSocket;
}

function createMockIO(): TypedServer {
  return { emit: jest.fn(), on: jest.fn() } as unknown as TypedServer;
}

function setup(): { handler: MovementHandler; world: GameWorld; io: TypedServer } {
  const { mapData, mapMeta } = loadMiniMap();
  const world = new GameWorld();
  world.loadMap(mapData, mapMeta);
  const io = createMockIO();
  const handler = new MovementHandler(io, world);
  return { handler, world, io };
}

describe('mini-map 岔路机制（格 0 destinations=[1,7]）', () => {
  let handler: MovementHandler;
  let world: GameWorld;
  let io: TypedServer;
  let socket: TypedSocket;

  beforeEach(() => {
    ({ handler, world, io } = setup());
    const p1 = makePlayer('p1', 0, 2000, 50);
    world.addPlayer(p1);
    socket = createMockSocket('p1');
  });

  it('进入多出口格 0 且剩余步数 > 0 时暂停，发出 server.askPath（options=1/7），玩家位置保持不动', () => {
    const result = handler.handleMovement('p1', 3, socket);

    expect(result).not.toBeNull();
    expect(result?.finalCellId).toBe(0); // 尚未实际行进，暂停在岔路口
    expect(result?.stepsTaken).toBe(0);

    // 广播 playerMoved（路径只含岔路口本身）
    expect(io.emit).toHaveBeenCalledWith('server.playerMoved', expect.objectContaining({ playerId: 'p1', cellId: 0 }));

    // 向本玩家询问岔路：可选目标为格 1 与格 7
    expect(socket.emit).toHaveBeenCalledWith(
      'server.askPath',
      expect.objectContaining({
        fromCellId: 0,
        options: expect.arrayContaining([
          expect.objectContaining({ cellId: 1 }),
          expect.objectContaining({ cellId: 7 }),
        ]),
      }),
    );

    // 位置未变（等待客户端选择）
    expect(world.getPlayer('p1')?.position.cellId).toBe(0);
  });

  it('handleChoosePath 选中 7 后续走，位置推进且动画路径以岔路口为起点', () => {
    handler.handleMovement('p1', 3, socket);
    // 注册 client.choosePath 回调
    handler.register(socket);
    const choosePathCb = (socket.on as jest.Mock).mock.calls.find(([evt]) => evt === 'client.choosePath')?.[1];
    expect(choosePathCb).toBeDefined();

    const ack = jest.fn();
    choosePathCb({ fromCellId: 0, toCellId: 7 }, ack);

    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    // 从岔路口沿西线推进，位置必然偏离岔路口
    expect(world.getPlayer('p1')?.position.cellId).not.toBe(0);
    // 续走的 playerMoved 路径必须以岔路口开头，动画才不被跳过
    const movedCalls = (io.emit as jest.Mock).mock.calls.filter(([evt]) => evt === 'server.playerMoved');
    const lastPath = movedCalls[movedCalls.length - 1]?.[1]?.path;
    expect(lastPath[0]).toBe(0);
    expect(lastPath[1]).toBe(7);
  });

  it('handleChoosePath 拒绝非 destinations 目标（如 3），不推进位置', () => {
    handler.handleMovement('p1', 3, socket);
    handler.register(socket);
    const choosePathCb = (socket.on as jest.Mock).mock.calls.find(([evt]) => evt === 'client.choosePath')?.[1];

    const ack = jest.fn();
    choosePathCb({ fromCellId: 0, toCellId: 3 }, ack);

    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    expect(world.getPlayer('p1')?.position.cellId).toBe(0);
  });
});