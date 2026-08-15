/**
 * 路径查找测试
 *
 * 覆盖：
 * 1. 基本行走（链状地图）
 * 2. 多岔路处理（pathSelector 回调）
 * 3. BFS findAllPaths
 * 4. 边界情况（0 步、负数步、孤立格子、超长路径）
 * 5. 性能（单次查找 < 5ms）
 */

import { findAllPaths, findPath, getNeighbors } from '../../src/map/path-finder';
import { MapIndex } from '../../src/map/map-index';
import type { Cell, MapData } from '../../src/types/cell';

/**
 * 构造一个分叉的地图：
 *
 *         1
 *         |
 * 0 - 1' - 2 - 3
 *         |
 *         1''
 *
 * - 0 起点
 * - 1, 1', 1'' 是分叉候选
 * - 后续线性到 3
 */
function buildBranchedMap(): MapData {
  const cells: Cell[] = [
    { id: 0, x: 0, y: 0, destinations: [1], extra: { type: 'start', name: 'Start' } },
    { id: 1, x: 10, y: 0, destinations: [0, 2, 3, 4], extra: { type: 'property', name: 'Hub' } },
    { id: 2, x: 20, y: 0, destinations: [1, 5], extra: { type: 'property', name: 'A' } },
    { id: 3, x: 10, y: 10, destinations: [1], extra: { type: 'property', name: 'B' } },
    { id: 4, x: 10, y: -10, destinations: [1], extra: { type: 'property', name: 'C' } },
    { id: 5, x: 30, y: 0, destinations: [2], extra: { type: 'jail', name: 'Jail' } },
  ];
  // 修复双向性
  cells[0]!.destinations = [1];
  return cells;
}

/**
 * 构造纯线性地图 0 - 1 - ... - n-1
 */
function buildLinearMap(n: number): MapData {
  const cells: Cell[] = [];
  for (let i = 0; i < n; i++) {
    const dests: number[] = [];
    if (i > 0) dests.push(i - 1);
    if (i < n - 1) dests.push(i + 1);
    cells.push({
      id: i,
      x: i * 10,
      y: 0,
      destinations: dests,
      extra: { type: i === 0 ? 'start' : 'property' },
    });
  }
  return cells;
}

describe('path-finder - findPath', () => {
  it('在线性地图上走 N 步', () => {
    const idx = new MapIndex(buildLinearMap(10));
    const result = findPath(0, 5, { mapIndex: idx });
    expect(result.path.map((c) => c.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.stepsTaken).toBe(5);
    expect(result.hasChoices).toBe(false);
  });

  it('默认 selector 在分叉处选择第一个候选', () => {
    const idx = new MapIndex(buildBranchedMap());
    const result = findPath(0, 2, { mapIndex: idx });
    // 0 → 1 → (destinations[0] = 2)
    expect(result.path.map((c) => c.id)).toEqual([0, 1, 2]);
    expect(result.hasChoices).toBe(true);
    expect(result.choiceAt?.cell.id).toBe(1);
    // 已访问的 0 不计入分岔候选
    expect(result.choiceAt?.candidates.map((c) => c.id)).toEqual([2, 3, 4]);
  });

  it('自定义 pathSelector 决定分叉选择', () => {
    const idx = new MapIndex(buildBranchedMap());
    // 总是选 id 最大的候选
    const result = findPath(0, 2, {
      mapIndex: idx,
      pathSelector: (current, candidates) => {
        return candidates.reduce((a, b) => (a.id > b.id ? a : b));
      },
    });
    // 0 → 1 (Hub) → 4 (C, id 最大)
    expect(result.path.map((c) => c.id)).toEqual([0, 1, 4]);
  });

  it('selector 返回 null 时终止行走', () => {
    const idx = new MapIndex(buildBranchedMap());
    const result = findPath(0, 10, {
      mapIndex: idx,
      pathSelector: () => null,
    });
    expect(result.path).toHaveLength(1);
    expect(result.stepsTaken).toBe(0);
  });

  it('selector 返回数组时按顺序取第一个非空', () => {
    const idx = new MapIndex(buildBranchedMap());
    const result = findPath(0, 2, {
      mapIndex: idx,
      pathSelector: (current, candidates) => {
        // 在 cell 1 (Hub) 处选择 candidates 中 id 最小的一个
        if (current.id !== 1) return candidates[0];
        const sorted = [...candidates].sort((a, b) => a.id - b.id);
        return [sorted[0]];
      },
    });
    // 0 → 1 (Hub) → 0 (id 最小)
    expect(result.path[0]?.id).toBe(0);
    expect(result.path[1]?.id).toBe(1);
  });

  it('起点不存在时抛错', () => {
    const idx = new MapIndex(buildLinearMap(3));
    expect(() => findPath(99, 1, { mapIndex: idx })).toThrow(/起点格子/);
  });

  it('0 步返回仅起点的路径', () => {
    const idx = new MapIndex(buildLinearMap(3));
    const result = findPath(0, 0, { mapIndex: idx });
    expect(result.path).toHaveLength(1);
    expect(result.path[0]?.id).toBe(0);
    expect(result.stepsTaken).toBe(0);
    expect(result.hasChoices).toBe(false);
  });

  it('负数步抛错', () => {
    const idx = new MapIndex(buildLinearMap(3));
    expect(() => findPath(0, -1, { mapIndex: idx })).toThrow(/非负整数/);
  });

  it('非整数步抛错', () => {
    const idx = new MapIndex(buildLinearMap(3));
    expect(() => findPath(0, 1.5, { mapIndex: idx })).toThrow(/非负整数/);
  });

  it('孤立格子走 0 步后停止', () => {
    const idx = new MapIndex([
      { id: 0, x: 0, y: 0, destinations: [], extra: { type: 'property' } },
    ]);
    const result = findPath(0, 10, { mapIndex: idx });
    expect(result.path).toHaveLength(1);
    expect(result.hasChoices).toBe(false);
  });

  it('超出地图边界的步数被截断到 maxSteps', () => {
    const idx = new MapIndex(buildLinearMap(3));
    const result = findPath(0, 100, { mapIndex: idx });
    expect(result.path).toHaveLength(3);
    expect(result.stepsTaken).toBe(2);
  });
});

describe('path-finder - findAllPaths', () => {
  it('BFS 找出所有 N 步内可达的格子', () => {
    const idx = new MapIndex(buildLinearMap(5));
    const all = findAllPaths(0, 4, idx);
    // 0..4 全部可达（4 步足够遍历 5 个线性节点）
    expect(all.size).toBe(5);
    expect(all.get(0)).toEqual([idx.getById(0)]);
    expect(all.get(3)?.map((c) => c.id)).toEqual([0, 1, 2, 3]);
    expect(all.get(4)?.map((c) => c.id)).toEqual([0, 1, 2, 3, 4]);
  });

  it('BFS 短步数仅覆盖附近节点', () => {
    const idx = new MapIndex(buildLinearMap(5));
    const all = findAllPaths(0, 2, idx);
    // 0 (step 0), 1 (step 1), 2 (step 2)
    expect(all.size).toBe(3);
  });

  it('0 步仅返回起点', () => {
    const idx = new MapIndex(buildLinearMap(5));
    const all = findAllPaths(0, 0, idx);
    expect(all.size).toBe(1);
    expect(all.has(0)).toBe(true);
  });

  it('起点不存在时返回空 map', () => {
    const idx = new MapIndex(buildLinearMap(3));
    const all = findAllPaths(99, 5, idx);
    expect(all.size).toBe(0);
  });

  it('孤立格子 BFS 仅返回自身', () => {
    const idx = new MapIndex([
      { id: 0, x: 0, y: 0, destinations: [], extra: { type: 'property' } },
    ]);
    const all = findAllPaths(0, 3, idx);
    expect(all.size).toBe(1);
  });

  it('分叉地图 1 步可达起点 + 邻居', () => {
    const idx = new MapIndex(buildBranchedMap());
    const all = findAllPaths(0, 1, idx);
    // 0 和 1
    expect(all.size).toBe(2);
    expect(all.has(0)).toBe(true);
    expect(all.has(1)).toBe(true);
  });
});

describe('path-finder - getNeighbors', () => {
  it('返回直接相邻的格子', () => {
    const idx = new MapIndex(buildLinearMap(5));
    const neighbors = getNeighbors(2, idx);
    expect(neighbors.map((c) => c.id)).toEqual([1, 3]);
  });

  it('边界格子仅返回单侧邻居', () => {
    const idx = new MapIndex(buildLinearMap(5));
    expect(getNeighbors(0, idx).map((c) => c.id)).toEqual([1]);
    expect(getNeighbors(4, idx).map((c) => c.id)).toEqual([3]);
  });

  it('不存在的 cellId 返回空数组', () => {
    const idx = new MapIndex(buildLinearMap(3));
    expect(getNeighbors(99, idx)).toEqual([]);
  });

  it('孤立格子返回空数组', () => {
    const idx = new MapIndex([
      { id: 0, x: 0, y: 0, destinations: [], extra: {} },
    ]);
    expect(getNeighbors(0, idx)).toEqual([]);
  });
});

describe('path-finder - 性能', () => {
  it('单次 findPath（200 格子，走 50 步）< 5ms', () => {
    const idx = new MapIndex(buildLinearMap(200));
    findPath(0, 50, { mapIndex: idx });
    const start = process.hrtime.bigint();
    findPath(0, 50, { mapIndex: idx });
    const end = process.hrtime.bigint();
    const elapsedMs = Number(end - start) / 1_000_000;
    expect(elapsedMs).toBeLessThan(5);
  });

  it('单次 findAllPaths（200 格子，BFS 10 步）< 5ms', () => {
    const idx = new MapIndex(buildLinearMap(200));
    const start = process.hrtime.bigint();
    findAllPaths(0, 10, idx);
    const end = process.hrtime.bigint();
    const elapsedMs = Number(end - start) / 1_000_000;
    expect(elapsedMs).toBeLessThan(5);
  });
});
