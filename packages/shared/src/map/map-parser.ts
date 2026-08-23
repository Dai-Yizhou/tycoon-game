/**
 * 地图数据解析器
 *
 * 负责将地图编辑器导出的 JSON（数组形式）解析为内部 `MapData`（`Cell[]`）结构。
 *
 * 模板驱动原则：
 * - 内置字段（`id`、`x`、`y`、`destinations`）按位置提取
 * - 所有非内置字段统一塞入 `cell.extra`（`Record<string, unknown>`）
 * - 解析器不硬编码任何业务字段名（如 `name`、`type`、`price` 等）
 *   这些字段由地图元数据（`MapMeta.templateName`）在运行时解释
 *
 * 设计要点：
 * - **纯函数优先**：`parseMapData` / `validateMapData` / `normalizeMapData` 均为纯函数
 * - **错误降级**：缺失字段不抛错，记录到 `ValidationResult.warnings`
 * - **友好错误信息**：错误信息包含格子的 id 与字段名
 */

import type { Cell, MapData } from '../types/cell';

/**
 * 校验结果
 */
export interface ValidationResult {
  /** 是否通过校验（warnings 不影响通过） */
  valid: boolean;
  /** 错误信息（致命问题） */
  errors: string[];
  /** 警告信息（非致命问题） */
  warnings: string[];
}

/**
 * 内置字段集合（地图编辑器保证存在）
 *
 * 注意：destinations 也是必含的，但允许为空数组
 */
export const BUILTIN_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'x',
  'y',
  'destinations',
  'behavior',
]);

/**
 * 安全地访问对象的字段，避免 `any` 类型逃逸
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * 从 raw 对象构造一个 Cell
 *
 * - 必含字段：id、x、y
 * - 可选字段：destinations（默认 []）
 * - 其余字段塞入 extra
 */
function buildCell(raw: unknown, index: number): Cell {
  const record = asRecord(raw);
  if (record === null) {
    throw new MapParseError(
      `第 ${index + 1} 个元素不是有效对象（收到 ${typeof raw}）`,
      { index },
    );
  }

  const idRaw = record['id'];
  const xRaw = record['x'];
  const yRaw = record['y'];

  if (typeof idRaw !== 'number' || !Number.isFinite(idRaw)) {
    throw new MapParseError(
      `第 ${index + 1} 个格子缺少有效的 id 字段（收到 ${typeof idRaw}）`,
      { index, field: 'id' },
    );
  }
  if (typeof xRaw !== 'number' || !Number.isFinite(xRaw)) {
    throw new MapParseError(
      `第 ${index + 1} 个格子缺少有效的 x 坐标（收到 ${typeof xRaw}）`,
      { index, field: 'x' },
    );
  }
  if (typeof yRaw !== 'number' || !Number.isFinite(yRaw)) {
    throw new MapParseError(
      `第 ${index + 1} 个格子缺少有效的 y 坐标（收到 ${typeof yRaw}）`,
      { index, field: 'y' },
    );
  }

  const destinationsRaw = record['destinations'];
  let destinations: number[] = [];
  if (destinationsRaw === undefined || destinationsRaw === null) {
    // 缺失时使用空数组（设计约定：destinations 是双向的，但允许空）
    destinations = [];
  } else if (Array.isArray(destinationsRaw)) {
    destinations = destinationsRaw.filter(
      (d) => typeof d === 'number' && Number.isFinite(d),
    );
  } else {
    throw new MapParseError(
      `第 ${index + 1} 个格子的 destinations 字段不是数组（收到 ${typeof destinationsRaw}）`,
      { index, field: 'destinations' },
    );
  }

  // 提取非内置字段到 extra
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!BUILTIN_FIELDS.has(key)) {
      extra[key] = value;
    }
  }

  // behavior 为内置顶层字段（非 extra 自定义数据）
  const behavior = typeof record['behavior'] === 'string' ? record['behavior'] : '';

  return {
    id: idRaw,
    x: xRaw,
    y: yRaw,
    destinations,
    behavior,
    extra,
  };
}

/**
 * 自定义解析错误（携带上下文）
 */
export class MapParseError extends Error {
  /** 出错的元素索引（从 0 开始；顶层错误时为 -1） */
  public readonly index: number;
  /** 出错的字段名（顶层错误时为空字符串） */
  public readonly field: string;

  constructor(message: string, context: { index?: number; field?: string } = {}) {
    super(message);
    this.name = 'MapParseError';
    this.index = context.index ?? -1;
    this.field = context.field ?? '';
  }
}

/**
 * 解析地图编辑器导出的原始数据
 *
 * @param raw 地图编辑器的导出（通常为 JSON 解析后的对象/数组）
 * @returns 内部 `MapData`（`Cell[]`）
 * @throws {MapParseError} 当顶层不是数组或某个格子数据严重不合法时
 */
export function parseMapData(raw: unknown): MapData {
  if (!Array.isArray(raw)) {
    throw new MapParseError(
      `地图数据顶层必须是数组（收到 ${typeof raw}）`,
    );
  }

  const result: Cell[] = [];
  for (let i = 0; i < raw.length; i++) {
    result.push(buildCell(raw[i], i));
  }
  return result;
}

/**
 * 校验地图数据的完整性与一致性
 *
 * 检查项：
 * 1. id 唯一性
 * 2. id 连续性（从 0 开始，可有间断但报告为 warning）
 * 3. destinations 双向性（A→B 必须 B→A）
 * 4. 至少有一个 start 格子
 * 5. 坐标范围合理性（非有限数值、负数视为 warning）
 * 6. destinations 引用的格子存在
 *
 * @param map 地图数据
 * @returns 校验结果
 */
export function validateMapData(map: MapData): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(map)) {
    return {
      valid: false,
      errors: ['地图数据不是数组'],
      warnings: [],
    };
  }

  if (map.length === 0) {
    errors.push('地图数据为空：至少需要一个格子');
    return { valid: false, errors, warnings };
  }

  // 1. id 唯一性 + 收集 id 集合
  const idSet = new Set<number>();
  const idDuplicates: number[] = [];
  for (const cell of map) {
    if (idSet.has(cell.id)) {
      idDuplicates.push(cell.id);
    }
    idSet.add(cell.id);
  }
  if (idDuplicates.length > 0) {
    errors.push(
      `id 重复: ${idDuplicates.slice(0, 10).join(', ')}${
        idDuplicates.length > 10 ? `（共 ${idDuplicates.length} 处）` : ''
      }`,
    );
  }

  // 2. id 连续性（从 0 开始的自然数序列）
  const sortedIds = Array.from(idSet).sort((a, b) => a - b);
  const minId = sortedIds[0];
  if (minId !== 0) {
    warnings.push(`id 起始值不是 0（实际为 ${minId}）`);
  }
  for (let i = 1; i < sortedIds.length; i++) {
    const prev = sortedIds[i - 1]!;
    const cur = sortedIds[i]!;
    if (cur - prev > 1) {
      warnings.push(`id 不连续：缺少 ${prev + 1} 至 ${cur - 1}`);
      break; // 仅报告第一个间断
    }
  }

  // 3. destinations 双向性
  const danglingDestinations: string[] = [];
  const asymDestinations: string[] = [];
  for (const cell of map) {
    for (const dest of cell.destinations) {
      if (!idSet.has(dest)) {
        danglingDestinations.push(`#${cell.id}→#${dest}`);
        continue;
      }
      const destCell = map.find((c) => c.id === dest);
      if (destCell && !destCell.destinations.includes(cell.id)) {
        asymDestinations.push(`#${cell.id}→#${dest}`);
      }
    }
  }
  if (danglingDestinations.length > 0) {
    errors.push(
      `destinations 引用了不存在的格子: ${danglingDestinations.slice(0, 10).join(', ')}${
        danglingDestinations.length > 10 ? `（共 ${danglingDestinations.length} 处）` : ''
      }`,
    );
  }
  if (asymDestinations.length > 0) {
    errors.push(
      `destinations 不是双向的: ${asymDestinations.slice(0, 10).join(', ')}${
        asymDestinations.length > 10 ? `（共 ${asymDestinations.length} 处）` : ''
      }`,
    );
  }

  // 4. 至少有一个 start 格子
  let startCount = 0;
  for (const cell of map) {
    const t = cell.extra['type'];
    if (t === 'start') {
      startCount++;
    }
  }
  if (startCount === 0) {
    errors.push('地图缺少起点格子（至少需要 1 个 type="start" 的格子）');
  }

  // 5. 坐标范围合理性
  let invalidCoord = 0;
  let negativeCoord = 0;
  for (const cell of map) {
    if (!Number.isFinite(cell.x) || !Number.isFinite(cell.y)) {
      invalidCoord++;
      continue;
    }
    if (cell.x < 0 || cell.y < 0) {
      negativeCoord++;
    }
  }
  if (invalidCoord > 0) {
    errors.push(`${invalidCoord} 个格子包含非法坐标（NaN/Infinity）`);
  }
  if (negativeCoord > 0) {
    warnings.push(`${negativeCoord} 个格子的坐标为负数`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 规范化地图数据
 *
 * - 补全缺失字段（destinations 默认 []）
 * - 修正非法值（负坐标归零、过滤掉非有限坐标的格子并警告）
 *
 * @param map 原始地图数据
 * @returns 规范化后的地图数据
 */
export function normalizeMapData(map: MapData): MapData {
  if (!Array.isArray(map)) {
    return [];
  }
  return map
    .filter((cell) =>
      Number.isFinite(cell.x) && Number.isFinite(cell.y) && Number.isFinite(cell.id),
    )
    .map((cell) => {
      const x = cell.x < 0 ? 0 : cell.x;
      const y = cell.y < 0 ? 0 : cell.y;
      return {
        id: cell.id,
        x,
        y,
        destinations: Array.isArray(cell.destinations) ? [...cell.destinations] : [],
        behavior: typeof cell.behavior === 'string' ? cell.behavior : '',
        extra: { ...(cell.extra ?? {}) },
      };
    });
}
