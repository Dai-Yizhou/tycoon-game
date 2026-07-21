/**
 * 几何计算工具
 *
 * 提供碰撞检测、距离计算等几何运算
 */

/**
 * 圆形碰撞检测
 *
 * @param cx 圆心 X
 * @param cy 圆心 Y
 * @param radius 圆半径
 * @param px 点 X
 * @param py 点 Y
 * @returns 点是否在圆内
 */
export function isPointInCircle(
  cx: number,
  cy: number,
  radius: number,
  px: number,
  py: number,
): boolean {
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * 矩形碰撞检测
 *
 * @param rx 矩形左上角 X
 * @param ry 矩形左上角 Y
 * @param rw 矩形宽度
 * @param rh 矩形高度
 * @param px 点 X
 * @param py 点 Y
 * @returns 点是否在矩形内
 */
export function isPointInRect(
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  px: number,
  py: number,
): boolean {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

/**
 * 六边形碰撞检测（正六边形，尖顶）
 *
 * @param hx 六边形中心 X
 * @param hy 六边形中心 Y
 * @param size 六边形半径（外接圆）
 * @param px 点 X
 * @param py 点 Y
 * @returns 点是否在六边形内
 */
export function isPointInHexagon(
  hx: number,
  hy: number,
  size: number,
  px: number,
  py: number,
): boolean {
  // 简化算法：近似为圆形检测
  const dx = px - hx;
  const dy = py - hy;
  const distance = Math.sqrt(dx * dx + dy * dy);
  // 六边形内接圆半径 = size * cos(30°) ≈ size * 0.866
  // 使用外接圆半径作为近似（允许边界误差）
  return distance <= size;
}

/**
 * 计算两点之间的距离
 */
export function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 计算两点之间的角度（弧度）
 */
export function angle(x1: number, y1: number, x2: number, y2: number): number {
  return Math.atan2(y2 - y1, x2 - x1);
}

/**
 * 默认格子尺寸配置
 */
export const DEFAULT_CELL_CONFIG = {
  /** 格子半径（圆形） */
  radius: 40,
  /** 格子宽度（矩形） */
  width: 80,
  /** 格子高度（矩形） */
  height: 60,
  /** 格子边框宽度 */
  borderWidth: 2,
  /** 格子文字大小 */
  fontSize: 12,
  /** 格子间距 */
  spacing: 10,
};

/**
 * 默认连线配置
 */
export const DEFAULT_CONNECTION_CONFIG = {
  /** 线条宽度 */
  lineWidth: 2,
  /** 虚线间隔 */
  dashInterval: [5, 5],
  /** 线条颜色 */
  color: '#8b949e',
};

/**
 * 默认棋子配置
 */
export const DEFAULT_PLAYER_CONFIG = {
  /** 棋子半径 */
  radius: 15,
  /** 棋子高度（棋子小人） */
  height: 30,
  /** 棋子宽度 */
  width: 20,
  /** 棋子边框宽度 */
  borderWidth: 2,
};