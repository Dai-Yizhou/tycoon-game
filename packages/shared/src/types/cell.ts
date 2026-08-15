/**
 * 格子（Cell）类型定义
 *
 * 格子是游戏地图的最小可交互单位。
 * - `id`、`x`、`y`、`destinations` 为内置字段，所有格子必备
 * - 其余字段（如 name、type、price、rent 等）由地图编辑器的属性模板动态决定，
 *   因此统一存放于 `extra` 索引签名中，避免硬编码字段名
 *
 * 地图编辑器导出的 JSON 形如：
 * ```json
 * [
 *   {
 *     "id": 0,
 *     "x": 356,
 *     "y": 109,
 *     "destinations": [],
 *     "name": "",
 *     "type": "",
 *     "price": 0,
 *     "rent": [0, 10],
 *     "level": 0,
 *     "upgradeCost": [],
 *     "owners": []
 *   }
 * ]
 * ```
 */

/**
 * 格子基础类型枚举
 *
 * 共 8 种基础类型，对应地图编辑器约定的 type 字段。
 * 注意：地图编辑器实际导出时 type 字段为字符串，但允许任何字符串值；
 * 此枚举仅用于类型提示与运行时约束，运行时建议用 {@link normalizeCellType} 规范化。
 */
export const CellTypes = {
  /** 地产：可购买、可升级、可收租 */
  Property: 'property',
  /** 空地：不可交互的占位格子 */
  Empty: 'empty',
  /** 事件格：踩中后触发事件 */
  Event: 'event',
  /** 投资项目：可购买并按规则获益 */
  Investment: 'investment',
  /** 交通枢纽：付费传送 */
  Transport: 'transport',
  /** 纪念碑：可修缮 */
  Monument: 'monument',
  /** 起点：经过或停留时获得资金 */
  Start: 'start',
  /** 监狱：踩中进入受限状态 */
  Jail: 'jail',
} as const;

/**
 * 格子基础类型字符串字面量联合
 */
export type CellType = (typeof CellTypes)[keyof typeof CellTypes];

/**
 * 格子自定义属性容器
 *
 * 使用 `Record<string, unknown>` 而非 `any`，以避免类型逃逸。
 * 模板驱动的字段（如 name、type、price、rent、level、owners
 * 等）均通过 `extra` 存放；游戏引擎读取时使用 {@link getExtra} 工具函数获得类型安全。
 */
export type CellExtra = Record<string, unknown>;

/**
 * 地图编辑器导出的格子
 */
export interface Cell {
  /** 格子唯一 ID（必含，number） */
  id: number;
  /** 画布上的 X 坐标（必含，number） */
  x: number;
  /** 画布上的 Y 坐标（必含，number） */
  y: number;
  /**
   * 与该格子双向连接的相邻格子 ID 列表（必含，number[]）
   * 注意：连接是双向的，若 A 的 destinations 包含 B，则 B 的 destinations 也应包含 A
   */
  destinations: number[];
  /**
   * 格子动态扩展属性
   *
   * 包含但不限于以下模板约定字段：
   * - `name`: string - 显示名称
   * - `type`: string - 格子类型（property/event/transport/monument/start/jail/investment/empty）
   * - `price`: number - 购买价格
   * - `rent`: number[] | number - 租金（多级）
   * - `description`: string | string[] - 描述
   * - `behavior`: string - 行为文件名
   * - `icon`: string - 图标文件名
   * - `level`: number - 等级
   * - `upgradeCost`: number[] - 升级费用
   * - `owners`: number[] - 持有者 ID（编辑期使用 number 编号）
   * - `extra`: any[] - 扩展数据
   *
   * 未知字段在解析时会被忽略（向后兼容）。
   */
  extra: CellExtra;
}

/**
 * 地图数据：所有格子的扁平数组
 */
export type MapData = Cell[];

/**
 * 安全读取 cell.extra 中的字段，自动处理 key 不存在的情形
 *
 * 优先用此函数访问模板驱动的动态字段，避免直接解构 `extra`。
 *
 * @param cell 目标格子
 * @param key 字段名
 * @param defaultValue 缺省时的返回值
 * @returns 字段值或 defaultValue
 */
export function getExtra<T = unknown>(
  cell: Cell,
  key: string,
  defaultValue?: T,
): T | undefined {
  if (cell === null || cell === undefined || cell.extra === null || cell.extra === undefined) {
    return defaultValue;
  }
  const value = cell.extra[key];
  return value === undefined ? defaultValue : (value as T);
}

/**
 * 类型守卫：判断格子是否为指定类型
 *
 * @param cell 目标格子
 * @param type 期望的格子类型
 */
export function isCellType(cell: Cell, type: CellType): boolean {
  const raw = getExtra<string>(cell, 'type', '');
  if (typeof raw === 'string') {
    return raw === type;
  }
  return false;
}

/**
 * 将格子 extra.type 字段安全地规范化为 CellType
 *
 * 地图编辑器允许任何字符串写入 type，未知值将回退为 'empty'。
 */
export function normalizeCellType(cell: Cell): CellType {
  const raw = getExtra<string | number>(cell, 'type', '');
  if (typeof raw !== 'string') {
    return CellTypes.Empty;
  }
  const known: ReadonlyArray<CellType> = [
    CellTypes.Property,
    CellTypes.Empty,
    CellTypes.Event,
    CellTypes.Investment,
    CellTypes.Transport,
    CellTypes.Monument,
    CellTypes.Start,
    CellTypes.Jail,
  ];
  return (known.find((t) => t === raw) ?? CellTypes.Empty) as CellType;
}
