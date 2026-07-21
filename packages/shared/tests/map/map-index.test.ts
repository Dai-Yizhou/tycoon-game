/**
 * 地图索引测试
 *
 * 覆盖：
 * 1. 基本 CRUD（getById / getByPosition / getByType / size）
 * 2. O(1) 查询性能
 * 3. 边界情况（空地图、不存在的 id、容差查询等）
 */

import { MapIndex } from '../../src/map/map-index';
import { CellTypes, type Cell, type MapData } from '../../src/types/cell';

/**
 * 构造线性 0..n-1 的格子链
 * 0 - 1 - 2 - ... - n-1
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
      extra: {
        type: i === 0 ? 'start' : 'property',
        name: `cell-${i}`,
      },
    });
  }
  return cells;
}

describe('MapIndex', () => {
  describe('基本 API', () => {
    it('构造空数据不报错', () => {
      const idx = new MapIndex([]);
      expect(idx.size()).toBe(0);
      expect(idx.getAll()).toEqual([]);
      expect(idx.getById(0)).toBeUndefined();
    });

    it('getById 返回正确的格子', () => {
      const map = buildLinearMap(5);
      const idx = new MapIndex(map);
      expect(idx.getById(0)?.id).toBe(0);
      expect(idx.getById(3)?.extra['name']).toBe('cell-3');
      expect(idx.getById(99)).toBeUndefined();
    });

    it('has / ids 正常工作', () => {
      const map = buildLinearMap(3);
      const idx = new MapIndex(map);
      expect(idx.has(0)).toBe(true);
      expect(idx.has(99)).toBe(false);
      expect(idx.ids().sort((a, b) => a - b)).toEqual([0, 1, 2]);
    });

    it('getByPosition 精确匹配', () => {
      const map = buildLinearMap(3);
      const idx = new MapIndex(map);
      const found = idx.getByPosition(20, 0);
      expect(found).toHaveLength(1);
      expect(found[0]?.id).toBe(2);
    });

    it('getByPosition 在容差范围内匹配', () => {
      const map = buildLinearMap(3);
      const idx = new MapIndex(map);
      const found = idx.getByPosition(22, 0, 5);
      expect(found).toHaveLength(1);
      expect(found[0]?.id).toBe(2);
    });

    it('getByPosition 没有命中时返回空数组', () => {
      const map = buildLinearMap(3);
      const idx = new MapIndex(map);
      expect(idx.getByPosition(999, 999)).toEqual([]);
    });

    it('getByType 筛选指定类型', () => {
      const map = buildLinearMap(5);
      const idx = new MapIndex(map);
      const starts = idx.getByType(CellTypes.Start);
      expect(starts).toHaveLength(1);
      expect(starts[0]?.id).toBe(0);
      const properties = idx.getByType(CellTypes.Property);
      expect(properties).toHaveLength(4);
    });

    it('getByType 对未匹配类型返回空数组', () => {
      const idx = new MapIndex(buildLinearMap(3));
      expect(idx.getByType(CellTypes.Jail)).toEqual([]);
    });

    it('size 返回格子数量', () => {
      const idx = new MapIndex(buildLinearMap(10));
      expect(idx.size()).toBe(10);
    });

    it('getAll 返回所有格子', () => {
      const map = buildLinearMap(3);
      const idx = new MapIndex(map);
      expect(idx.getAll()).toHaveLength(3);
    });
  });

  describe('性能', () => {
    it('getById 在 1000 次查询中 < 5ms（O(1) 验证）', () => {
      const N = 1000;
      const idx = new MapIndex(buildLinearMap(N));

      const start = process.hrtime.bigint();
      for (let i = 0; i < N; i++) {
        idx.getById(i % N);
      }
      const end = process.hrtime.bigint();
      const elapsedMs = Number(end - start) / 1_000_000;
      // 1000 次查询应该 < 5ms
      expect(elapsedMs).toBeLessThan(5);
    });

    it('构造 200 格子索引 < 5ms', () => {
      const N = 200;
      const start = process.hrtime.bigint();
      const idx = new MapIndex(buildLinearMap(N));
      const end = process.hrtime.bigint();
      const elapsedMs = Number(end - start) / 1_000_000;
      expect(idx.size()).toBe(N);
      expect(elapsedMs).toBeLessThan(5);
    });
  });

  describe('防御', () => {
    it('非数组输入安全降级为空', () => {
      // 故意传入非法值
      const idx = new MapIndex(null as unknown as MapData);
      expect(idx.size()).toBe(0);
    });
  });
});
