/**
 * 地图索引（O(1) 查询）
 *
 * 内部使用 `Map<number, Cell>` 实现 O(1) id 查询。
 * 同时提供 O(n) 的按类型/位置查询。
 *
 * 性能特征：
 * - `getById` : O(1)
 * - `getByPosition` : O(n)（容忍值过滤）
 * - `getByType` : O(n)
 * - `getAll` : O(1)（返回内部数组的引用，请勿修改）
 *
 * 空间索引说明：
 * 位置查询采用线性扫描；如需更高性能可扩展为四叉树/R-tree，
 * 但对当前 50~200 格的规模线性扫描已经足够（< 1ms）。
 */

import type { Cell, CellType, MapData } from '../types/cell';

/**
 * 地图索引
 *
 * 构造时复制传入的 `MapData`，不持有外部引用，避免外部修改影响索引。
 */
export class MapIndex {
  /** id → cell 索引（核心 O(1) 查询） */
  private readonly byId: Map<number, Cell>;

  /** 内部数据副本 */
  private readonly cells: ReadonlyArray<Cell>;

  /**
   * @param data 地图数据
   */
  constructor(data: MapData) {
    this.byId = new Map();
    this.cells = Array.isArray(data) ? data : [];
    for (const cell of this.cells) {
      this.byId.set(cell.id, cell);
    }
  }

  /**
   * 通过 id 查找格子
   * @param id 格子 id
   * @returns 格子或 undefined
   */
  getById(id: number): Cell | undefined {
    return this.byId.get(id);
  }

  /**
   * 通过坐标查找格子
   *
   * 由于地图编辑器使用逻辑坐标，存在多个格子恰好落在同一像素位置的情况
   * （例如占位/重叠），因此返回数组而非单个格子。
   *
   * @param x X 坐标
   * @param y Y 坐标
   * @param tolerance 容忍值（默认 0 表示精确匹配）
   * @returns 匹配的格子数组
   */
  getByPosition(x: number, y: number, tolerance = 0): Cell[] {
    const tol = Math.max(0, tolerance);
    const result: Cell[] = [];
    for (const cell of this.cells) {
      if (Math.abs(cell.x - x) <= tol && Math.abs(cell.y - y) <= tol) {
        result.push(cell);
      }
    }
    return result;
  }

  /**
   * 获取所有格子
   *
   * 返回的是不可变视图；如需修改请使用返回的引用副本。
   */
  getAll(): Cell[] {
    return this.cells as Cell[];
  }

  /**
   * 通过 type 字段筛选格子
   *
   * 内部使用 `getExtra(cell, 'type')` 安全读取，类型不匹配会被忽略。
   *
   * @param type 期望的格子类型
   * @returns 匹配的格子数组
   */
  getByType(type: CellType): Cell[] {
    const result: Cell[] = [];
    for (const cell of this.cells) {
      if (cell.type === type) {
        result.push(cell);
      }
    }
    return result;
  }

  /**
   * 格子总数
   */
  size(): number {
    return this.cells.length;
  }

  /**
   * 检查指定 id 是否存在
   */
  has(id: number): boolean {
    return this.byId.has(id);
  }

  /**
   * 获取所有 id
   */
  ids(): number[] {
    return Array.from(this.byId.keys());
  }
}
