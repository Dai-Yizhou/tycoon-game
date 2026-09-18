import { createMovementLoop, type MovementLoopHost } from '../src/game/systems/MovementLoop.js';
import { startServerPathAnimation, startOtherPlayerMove } from '../src/game/systems/MovementSystem.js';
import { GameStore } from '../src/state/GameStore.js';

/** 手动驱动的 RAF 宿主：用 step() 手动触发每帧，step 数由 calls 记录，不用真实 requestAnimationFrame */
function manualHost() {
  let cb: ((t: number) => void) | null = null;
  let id = 0;
  const host: MovementLoopHost = {
    raf: (callback) => {
      cb = callback;
      return ++id;
    },
    cancelRaf: () => {
      cb = null;
    },
  };
  return {
    host,
    calls: () => id,
    step: () => {
      const f = cb;
      cb = null;
      f?.(0);
    },
    isArmed: () => cb !== null,
  };
}

const mapIndex = {
  getById: (id: number) => ({ id, x: id * 10, y: id * 10, destinations: id === 1 ? [2] : id === 2 ? [1] : [] }),
} as never;

function startStore(): GameStore {
  const store = new GameStore();
  store.applySnapshot({
    sequence: store.nextSequence(),
    currentPlayer: {
      id: 'p1', username: '玩家', teamId: null, position: { cellId: 2 }, values: {}, status: 'normal', createdAt: 1, lastActiveAt: 1,
    } as never,
    currentPlayerPosition: 1,
  });
  return store;
}

function hooks() {
  return {
    onStepStart: jest.fn(),
    onStepArrive: jest.fn(),
    onMoveComplete: jest.fn(),
  } as never;
}

function reducedMotionOn() {
  const media = window.matchMedia;
  window.matchMedia = (() => ({ matches: true, media: '', onchange: null, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn() })) as typeof window.matchMedia;
  return () => { window.matchMedia = media; };
}

describe('MovementLoop', () => {
  it('驱动权威移动直到完成：isMoving 复位、循环停表、落格回调触发', () => {
    const restoreReduced = reducedMotionOn();
    const store = startStore();
    startServerPathAnimation(store, mapIndex, [1, 2], jest.fn(), hooks(), 2);
    const host = manualHost();
    const onSettled = jest.fn();

    const loop = createMovementLoop(store, host.host, {
      getMapIndex: () => mapIndex,
      onArrived: jest.fn(),
      onDisplay: jest.fn(),
      onSettled,
    });

    loop.ensureRunning();
    expect(host.isArmed()).toBe(true);

    host.step();
    expect(store.getSnapshot().isMoving).toBe(false);
    expect(host.isArmed()).toBe(false);
    expect(onSettled).toHaveBeenCalledWith('p1', 20, 20);
    restoreReduced();
  });

  it('ensureRunning 幂等：循环运行中重复调用不会排入并发链', () => {
    const restoreReduced = reducedMotionOn();
    const store = startStore();
    startServerPathAnimation(store, mapIndex, [1, 2], jest.fn(), hooks(), 2);
    const host = manualHost();
    const loop = createMovementLoop(store, host.host, {
      getMapIndex: () => mapIndex,
      onArrived: jest.fn(),
      onDisplay: jest.fn(),
      onSettled: jest.fn(),
    });

    loop.ensureRunning();
    loop.ensureRunning();
    // 幂等：两次调用只排入一帧（单链），而非两帧并发
    expect(host.calls()).toBe(1);

    host.step();
    expect(store.getSnapshot().isMoving).toBe(false);
    expect(host.isArmed()).toBe(false);
    restoreReduced();
  });

  it('单帧抛错自愈：onStepArrive 抛错时循环不死亡，重试帧仍能推进到完成且不残留卡死态', () => {
    const restoreReduced = reducedMotionOn();
    const store = startStore();
    const onStepArrive = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('step 故障');
      })
      .mockImplementation(() => undefined);
    const effects = { onStepStart: jest.fn(), onStepArrive, onMoveComplete: jest.fn() } as never;
    startServerPathAnimation(store, mapIndex, [1, 2], jest.fn(), effects, 2);
    const host = manualHost();
    const onSettled = jest.fn();
    const loop = createMovementLoop(store, host.host, {
      getMapIndex: () => mapIndex,
      onArrived: jest.fn(),
      effects,
      onDisplay: jest.fn(),
      onSettled,
    });

    loop.ensureRunning();
    expect(host.isArmed()).toBe(true);

    // 第 1 帧：onStepArrive 抛错（isMoving 尚未复位的中间态）→ 单帧故障被吞，循环必须仍在运行
    host.step();
    expect(host.isArmed()).toBe(true);
    expect(store.getSnapshot().isMoving).toBe(true);

    // 第 2 帧：重试成功 → 推进到完成，isMoving 复位、循环停表、落格
    host.step();
    expect(store.getSnapshot().isMoving).toBe(false);
    expect(host.isArmed()).toBe(false);
    expect(onSettled).toHaveBeenCalledWith('p1', 20, 20);

    // 关键回归：抛错帧不得残留"卡死门禁"——下一次移动仍能正常启动并完成
    startServerPathAnimation(store, mapIndex, [1, 2], jest.fn(), hooks(), 2);
    loop.ensureRunning();
    expect(host.isArmed()).toBe(true);
    host.step();
    expect(store.getSnapshot().isMoving).toBe(false);
    restoreReduced();
  });

  it('驱动其他玩家带路径移动直到完成：逐步投影、落格到权威格并停表', () => {
    const store = new GameStore();
    // 独立的 1→2→3 连通地图（模块级 mapIndex 仅连接 1↔2，不支持 3 格路径）
    const otherMap = { getById: (id: number) => ({ id, x: id * 10, y: id * 10, destinations: id === 1 ? [2] : id === 2 ? [3] : [] }) } as never;
    store.applySnapshot({ sequence: store.nextSequence(), otherPlayers: [{ id: 'p2', username: '乙', position: { cellId: 1 }, status: 'normal', primaryValue: 0 }] });
    startOtherPlayerMove(store, otherMap, 'p2', [1, 2, 3]);
    const anim = store.getSnapshot().otherPlayerMoves.get('p2')!;
    // 把第一步 startTime 拨到过去，让单步在下一帧到达（280ms 步长）
    store.applySnapshot({ sequence: store.nextSequence(), otherPlayerMoves: new Map([['p2', { ...anim, startTime: performance.now() - 280 }]]) });

    const host = manualHost();
    const onDisplay = jest.fn();
    const loop = createMovementLoop(store, host.host, {
      getMapIndex: () => otherMap,
      onArrived: jest.fn(),
      onDisplay,
      onSettled: jest.fn(),
    });

    loop.ensureRunning();
    expect(host.isArmed()).toBe(true);

    // 第 1 帧：第一步到达 → 推进到第 2 步（仍在移动），投影输出，循环续排
    host.step();
    expect(store.getSnapshot().otherPlayerMoves.size).toBe(1);
    expect(store.getSnapshot().otherPlayers.find(p => p.id === 'p2')!.position.cellId).toBe(1);
    expect(host.isArmed()).toBe(true);
    expect(onDisplay).toHaveBeenCalled();

    // 拨快第二步时间后完成：动画移除、落格到 path 终点格3、循环停表
    const anim2 = store.getSnapshot().otherPlayerMoves.get('p2')!;
    store.applySnapshot({ sequence: store.nextSequence(), otherPlayerMoves: new Map([['p2', { ...anim2, startTime: performance.now() - 280 }]]) });
    host.step();
    expect(store.getSnapshot().otherPlayerMoves.size).toBe(0);
    expect(store.getSnapshot().otherPlayers.find(p => p.id === 'p2')!.position.cellId).toBe(3);
    expect(host.isArmed()).toBe(false);
  });
});