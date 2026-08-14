/**
 * 视野遮罩渲染器
 *
 * 负责渲染视野遮罩效果：
 * - 视野内格子正常显示
 * - 视野外格子雾化/变暗
 * - 视野大小由渲染配置决定
 * - 视野始终小于棋盘（关键设计）
 */

import { VISION_MASK_COLORS } from '../utils/colorScheme';
import type { CameraState } from './Camera';

/**
 * 视野配置
 */
export interface VisionConfig {
  /** 视野半径（像素） */
  radius: number;
  /** 视野形状（圆形） */
  shape: 'circle';
  /** 视野中心（世界坐标） */
  centerX: number;
  centerY: number;
}

/**
 * 视野遮罩渲染器
 */
export class VisionMaskRenderer {
  private ctx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  /**
   * 渲染视野遮罩
   *
   * 使用径向渐变实现视野效果：
   * - 中心：透明（可见）
   * - 边缘：半透明（渐变过渡）
   * - 外部：较暗（遮挡）
   *
   * @param vision 视野配置
   * @param cameraState 相机状态
   */
  render(vision: VisionConfig, cameraState: CameraState): void {
    const { screenX, screenY } = this.worldToScreen(
      vision.centerX,
      vision.centerY,
      cameraState,
    );
    const scaledRadius = vision.radius * cameraState.zoom;

    // 创建径向渐变
    const gradient = this.ctx.createRadialGradient(
      screenX,
      screenY,
      scaledRadius * 0.8, // 内圈（完全可见）
      screenX,
      screenY,
      scaledRadius * 1.5, // 外圈（完全遮挡）
    );

    // 渐变颜色停止点
    gradient.addColorStop(0, `rgba(13, 17, 23, ${VISION_MASK_COLORS.visibleAlpha})`);
    gradient.addColorStop(0.6, `rgba(13, 17, 23, ${VISION_MASK_COLORS.maskedAlpha * 0.3})`);
    gradient.addColorStop(1, `rgba(13, 17, 23, ${VISION_MASK_COLORS.maskedAlpha})`);

    // 绘制遮罩层
    this.ctx.save();
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, cameraState.viewportWidth, cameraState.viewportHeight);
    this.ctx.restore();
  }

  /**
   * 判断格子是否在视野内
   *
   * @param cellX 格子世界坐标 X
   * @param cellY 格子世界坐标 Y
   * @param vision 视野配置
   * @returns 是否在视野内
   */
  isCellVisible(cellX: number, cellY: number, vision: VisionConfig): boolean {
    const dx = cellX - vision.centerX;
    const dy = cellY - vision.centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance <= vision.radius;
  }

  /**
   * 计算格子的透明度（视野渐变）
   *
   * @param cellX 格子世界坐标 X
   * @param cellY 格子世界坐标 Y
   * @param vision 视野配置
   * @returns 透明度（0-1，视野内为 1，视野外渐变降低）
   */
  calculateCellOpacity(cellX: number, cellY: number, vision: VisionConfig): number {
    const dx = cellX - vision.centerX;
    const dy = cellY - vision.centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= vision.radius * 0.8) {
      // 完全可见
      return 1;
    } else if (distance <= vision.radius * 1.5) {
      // 渐变过渡
      const ratio = (distance - vision.radius * 0.8) / (vision.radius * 0.7);
      return 1 - ratio * VISION_MASK_COLORS.maskedAlpha;
    } else {
      // 完全遮挡
      return 1 - VISION_MASK_COLORS.maskedAlpha;
    }
  }

  /**
   * 世界坐标转屏幕坐标
   */
  private worldToScreen(
    worldX: number,
    worldY: number,
    camera: CameraState,
  ): { screenX: number; screenY: number } {
    return {
      screenX: worldX * camera.zoom + camera.offsetX,
      screenY: worldY * camera.zoom + camera.offsetY,
    };
  }
}

/**
 * 默认视野半径（可配置）
 *
 * 重要：视野半径必须小于棋盘尺寸，确保玩家不能看到整个棋盘
 */
export const DEFAULT_VISION_RADIUS = 150;

/**
 * 计算最终视野半径
 *
 * @param baseRadius 基础视野半径
 * @returns 最终视野半径
 */
export function calculateVisionRadius(
  baseRadius: number = DEFAULT_VISION_RADIUS,
  bonus: number = 0,
): number {
  return baseRadius * (1 + bonus / 100);
}
