/**
 * 路径查找算法
 *
 * 提供基于 `destinations` 字段的图遍历：
 * - {@link findPath} : 沿边走指定步数，支持多岔路分支选择
 * - {@link findAllPaths} : BFS 找出在 maxSteps 步内可达的所有格子
 * - {@link getNeighbors} : 获取直接相邻的格子
 *
 * 性能目标：单次路径查找 < 5ms（50~200 格子规模）
 */

import type { Cell } from '../types/cell';
import type { MapIndex } from './map-index';

/**
 * 路径选择器
 *
 * 当一个格子有多条 destinations 时，由调用方决定走哪一条。
 * - 返回单个 Cell 表示唯一选择
 * - 返回 Cell[] 表示按顺序尝试（先返回的优先）
 * - 不返回 / 返回空数组表示「拒绝移动」并终止
 */
export type PathSelector = (
  currentCell: Cell,
  candidates: Cell[],
) => Cell | Cell[] | null | undefined;

/**
 * 路径查找结果
 */
export interface PathResult {
  /** 走过的格子序列（含起点和终点） */
  path: Cell[];
  /** 最终到达的格子 */
  finalCell: Cell;
  /** 路径中是否遇到分岔 */
  hasChoices: boolean;
  /** 第一个分岔点的信息（若有） */
  choiceAt?: {
    cell: Cell;
    candidates: Cell[];
  };
  /** 实际走的步数（<= 请求的步数） */
  stepsTaken: number;
}

/**
 * 默认路径选择器：返回第一个候选
 */
function defaultSelector(
  _current: Cell,
  candidates: Cell[],
): Cell | Cell[] | null {
  return candidates[0];
}

/**
 * 从 startId 出发，沿 destinations 走 steps 步
 *
 * 算法说明：
 * 1. 从起点开始，每一步查询当前格子的 destinations
 * 2. 通过 destinations 解析出候选 Cell 列表
 * 3. 通过 `pathSelector` 回调决定下一步
 * 4. 遇到 candidates 为空 / 起点不存在时立即终止
 * 5. **自动避免循环**：已访问过的格子不再作为下一步候选（除非无其他选择）
 *
 * @param startId 起点格子 id
 * @param steps 行走步数（> 0）
 * @param options.pathSelector 分岔选择器（默认选第一个）
 * @param options.mapIndex 地图索引
 * @param options.allowRevisit 是否允许回访已访问的格子（默认 false）
 * @returns 路径结果
 */
export function findPath(
  startId: number,
  steps: number,
  options: {
    mapIndex: MapIndex;
    pathSelector?: PathSelector;
    allowRevisit?: boolean;
  },
): PathResult {
  if (!options || !options.mapIndex) {
    throw new Error('findPath: 必须提供 mapIndex');
  }
  if (!Number.isInteger(steps) || steps < 0) {
    throw new Error(`findPath: steps 必须是非负整数（收到 ${steps}）`);
  }

  const mapIndex = options.mapIndex;
  const selector = options.pathSelector ?? defaultSelector;
  const allowRevisit = options.allowRevisit ?? false;

  const start = mapIndex.getById(startId);
  if (!start) {
    throw new Error(`findPath: 起点格子 #${startId} 不存在`);
  }

  const path: Cell[] = [start];
  let current = start;
  const visited = new Set<number>([start.id]);
  let hasChoices = false;
  let choiceAt: { cell: Cell; candidates: Cell[] } | undefined;

  for (let step = 0; step < steps; step++) {
    const rawCandidates = getNeighbors(current.id, mapIndex);
    if (rawCandidates.length === 0) {
      // 孤立点：终止
      break;
    }

    // 过滤未访问的格子
    const unvisited = rawCandidates.filter((c) => !visited.has(c.id));

    // 「分岔」只对未访问的多个候选计数（已访问的仅是回退方向，不算分岔）
    if (unvisited.length > 1 && !hasChoices) {
      hasChoices = true;
      choiceAt = { cell: current, candidates: unvisited };
    }

    // 决定提供给 selector 的候选：
    // - 优先未访问格子
    // - 若全部已访问且不允许回访：终止
    // - 若允许回访：使用全部候选
    let candidates: Cell[];
    if (unvisited.length > 0) {
      candidates = unvisited;
    } else if (allowRevisit) {
      candidates = rawCandidates;
    } else {
      // 走投无路：终止
      break;
    }

    const chosen = selector(current, candidates);
    let next: Cell | undefined;
    if (chosen === null || chosen === undefined) {
      // 调用方拒绝移动
      break;
    } else if (Array.isArray(chosen)) {
      // 取第一个非空项
      next = chosen.find((c) => c !== null && c !== undefined);
      if (!next) break;
    } else {
      next = chosen;
    }

    // 防止 selector 选中当前 cell 造成原地踏步（异常情况）
    if (next.id === current.id) {
      break;
    }

    path.push(next);
    current = next;
    visited.add(next.id);
  }

  return {
    path,
    finalCell: current,
    hasChoices,
    choiceAt,
    stepsTaken: path.length - 1,
  };
}

/**
 * BFS 找出在 maxSteps 步内可达的所有格子
 *
 * 返回 `Map<id, 路径>`，键为目标格子的 id，值为从 startId 出发到达该格子的最短路径。
 * 起点自身也会包含在结果中（路径为 [start]）。
 *
 * @param startId 起点格子 id
 * @param maxSteps 最大步数（> 0）
 * @param mapIndex 地图索引
 * @returns 终点 id → 路径数组
 */
export function findAllPaths(
  startId: number,
  maxSteps: number,
  mapIndex: MapIndex,
): Map<number, Cell[]> {
  if (!mapIndex) {
    throw new Error('findAllPaths: 必须提供 mapIndex');
  }
  if (!Number.isInteger(maxSteps) || maxSteps < 0) {
    throw new Error(`findAllPaths: maxSteps 必须是非负整数（收到 ${maxSteps}）`);
  }

  const start = mapIndex.getById(startId);
  if (!start) {
    return new Map();
  }

  const result = new Map<number, Cell[]>();
  result.set(start.id, [start]);

  if (maxSteps === 0) {
    return result;
  }

  // BFS：每层记录 step 编号
  let frontier: Cell[] = [start];
  const visited = new Set<number>([start.id]);

  for (let step = 0; step < maxSteps; step++) {
    const nextFrontier: Cell[] = [];
    for (const cell of frontier) {
      const neighbors = getNeighbors(cell.id, mapIndex);
      for (const neighbor of neighbors) {
        if (visited.has(neighbor.id)) continue;
        visited.add(neighbor.id);
        // 复制并扩展父路径
        const parentPath = result.get(cell.id)!;
        const newPath = [...parentPath, neighbor];
        result.set(neighbor.id, newPath);
        nextFrontier.push(neighbor);
      }
    }
    if (nextFrontier.length === 0) break;
    frontier = nextFrontier;
  }

  return result;
}

/**
 * 获取指定格子的直接相邻格子
 *
 * 通过 `cell.destinations` 解析，缺失的引用会被忽略。
 *
 * @param cellId 格子 id
 * @param mapIndex 地图索引
 * @returns 相邻格子列表（顺序与 destinations 一致）
 */
export function getNeighbors(cellId: number, mapIndex: MapIndex): Cell[] {
  if (!mapIndex) {
    throw new Error('getNeighbors: 必须提供 mapIndex');
  }
  const cell = mapIndex.getById(cellId);
  if (!cell) {
    return [];
  }
  const result: Cell[] = [];
  for (const destId of cell.destinations) {
    const neighbor = mapIndex.getById(destId);
    if (neighbor) {
      result.push(neighbor);
    }
  }
  return result;
}
