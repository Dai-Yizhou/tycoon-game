/**
 * 「本次停靠」操作标记复位测试
 *
 * 回归背景：停靠操作标记（地产/投资 actedThisVisit、交通 teleportedThisVisit）此前只在
 * 掷骰落地（handleCellEvent）时复位。经传送、行为位移等非掷骰路径再次落到同一格时，标记
 * 仍是上一次停靠留下的 true，服务端会以 action_used_this_stop 拒绝本次停靠本可执行的动作
 * （症状：此次停留未使用的 action 被误判为已使用，客户端显示可用但操作被拒）。
 *
 * 修复后语义：以「玩家位置真实变化」为唯一锚点复位标记；位置未变化（同格刷新）不复位。
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HandlerRegistry } from '../../src/transport/handlers.js';
import { GameWorld } from '../../src/world/GameWorld.js';
import type { TypedServer } from '../../src/transport/SocketManager.js';
import type { Cell, Player, MapData, MapMeta } from '@game/shared';
import { PlayerStatus } from '@game/shared';

function createMockIO(): TypedServer {
  return { emit: jest.fn(), on: jest.fn() } as unknown as TypedServer;
}

function createBaseCell(id: number, type: string, destinations: number[] = []): Cell {
  return {
    id,
    x: id * 100,
    y: id * 100,
    destinations,
    type,
    name: { 'zh-CN': `格 ${id}`, 'en-US': `Cell ${id}` },
    description: { 'zh-CN': `格 ${id}`, 'en-US': `Cell ${id}` },
    regionId: 'r1',
    timezone: 0,
    theme: 'northeast',
    extra: {},
  };
}

function createTestMapData(): MapData {
  return [
    createBaseCell(0, 'supply', [1]),
    createBaseCell(1, 'property', [2]),
    createBaseCell(2, 'investment', [3]),
    createBaseCell(3, 'transport', [4]),
    createBaseCell(4, 'empty'),
  ];
}

function createTestMapMeta(): MapMeta {
  return {
    id: 'test-map',
    name: { 'zh-CN': '测试地图', 'en-US': 'Test Map' },
    version: '1.0.0',
    regions: [{ id: 'r1', name: { 'zh-CN': '一区', 'en-US': 'Region 1' }, initial: { region: {} } }],
    valueFieldDefinitions: [
      { id: 'money', name: { 'zh-CN': '财产', 'en-US': 'Money' }, scope: 'player', min: 0 },
    ],
    uct: { player: ['money'], region: [] },
    playerInitial: { player: { money: 1000 } },
    dayNightCycle: 15,
    dice: { cooldownMs: 3000, min: 1, max: 6 },
    tax: { baseTax: { rates: { player: {} }, taxInterval: 900000 }, shareTax: { rates: { player: {} }, taxInterval: 900000 } },
    startCellId: 0,
  };
}

function createTestPlayer(id: string): Player {
  return {
    id,
    username: `player_${id}`,
    teamId: null,
    position: { cellId: 0 },
    values: { money: { id: 'money', name: '财产', current: 1000, min: 0 } },
    status: PlayerStatus.Normal,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
}

describe('本次停靠操作标记复位', () => {
  let world: GameWorld;
  let registry: HandlerRegistry;
  let acted: Map<string, boolean>;
  let teleported: Map<string, boolean>;

  beforeEach(() => {
    world = new GameWorld();
    world.loadMap(createTestMapData(), createTestMapMeta());
    registry = new HandlerRegistry(createMockIO(), world);
    world.addPlayer(createTestPlayer('p1'));

    const handlers = registry as unknown as {
      propertyHandler: { actedThisVisit: Map<string, boolean> };
      investmentHandler: { actedThisVisit: Map<string, boolean> };
      transportHandler: { teleportedThisVisit: Map<string, boolean> };
    };
    // 地产与投资共用同一份停靠标记结构，取其一代指两者
    acted = handlers.propertyHandler.actedThisVisit;
    teleported = handlers.transportHandler.teleportedThisVisit;
  });

  /** 模拟非掷骰位移：直接把玩家位置改到目标格（传送 / 行为位移 / 重开均走 updatePlayer） */
  function movePlayerTo(cellId: number): void {
    const player = world.getPlayer('p1')!;
    world.updatePlayer({ ...player, position: { cellId } });
  }

  it('非掷骰位移落到地产/投资/交通格时复位该格停靠标记', () => {
    acted.set('p1:1', true);
    acted.set('p1:2', true);
    teleported.set('p1:3', true);

    movePlayerTo(1);
    expect(acted.get('p1:1')).toBe(false);
    // 其余格标记不受影响（只复位当前落点）
    expect(acted.get('p1:2')).toBe(true);
    expect(teleported.get('p1:3')).toBe(true);

    movePlayerTo(2);
    expect(acted.get('p1:2')).toBe(false);

    movePlayerTo(3);
    expect(teleported.get('p1:3')).toBe(false);
  });

  it('位置未变化（同格刷新）不复位停靠标记，仍保持"停一次只操作一次"', () => {
    movePlayerTo(1);
    acted.set('p1:1', true);

    // 同格 updatePlayer（如数值变化、状态刷新）不应被当成新一次停靠
    movePlayerTo(1);

    expect(acted.get('p1:1')).toBe(true);
  });

  it('投资格停靠标记同样由位置变化复位', () => {
    const investmentHandler = (registry as unknown as { investmentHandler: { actedThisVisit: Map<string, boolean> } }).investmentHandler;
    investmentHandler.actedThisVisit.set('p1:2', true);

    movePlayerTo(2);

    expect(investmentHandler.actedThisVisit.get('p1:2')).toBe(false);
  });
});