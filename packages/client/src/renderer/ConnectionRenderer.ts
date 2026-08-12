/**
 * 连线渲染器
 *
 * 负责渲染格子之间的连线（destinations 字段）
 * 使用虚线表示路径
 */

import type { MapData } from '@game/shared';
import { DEFAULT_CONNECTION_CONFIG } from '../utils/geometry';
import type { CameraState } from './Camera';
import type { ThemeSnapshot } from '../design/DesignAdapter';

/**
 * 连线渲染配置
 */
export interface ConnectionRenderConfig {
  lineWidth: number;
  dashInterval: number[];
  color: string;
}

/**
 * 连线渲染器
 */
export class ConnectionRenderer {
  private ctx: CanvasRenderingContext2D;
  private config: ConnectionRenderConfig;

  constructor(ctx: CanvasRenderingContext2D, config?: Partial<ConnectionRenderConfig> & { theme?: ThemeSnapshot }) {
    this.ctx = ctx;
    this.config = {
      lineWidth: config?.lineWidth ?? DEFAULT_CONNECTION_CONFIG.lineWidth,
      dashInterval: config?.dashInterval ?? DEFAULT_CONNECTION_CONFIG.dashInterval,
      color: config?.theme?.dom['--tycoon-line-map'] ?? config?.color ?? DEFAULT_CONNECTION_CONFIG.color,
    };
  }

  /**
   * 渲染所有连线
   *
   * @param cells 格子数组
   * @param cameraState 相机状态
   * @param opacity 透明度（视野遮罩使用，默认 1）
   */
  render(cells: MapData, cameraState: CameraState, opacity: number = 1): void {
    this.ctx.save();
    this.ctx.globalAlpha = opacity;

    // 设置虚线样式
    this.ctx.strokeStyle = this.config.color;
    this.ctx.lineWidth = this.config.lineWidth * cameraState.zoom;
    this.ctx.setLineDash(this.config.dashInterval.map((d) => d * cameraState.zoom));

    // 遍历所有格子，绘制连接线
    for (const cell of cells) {
      if (!Array.isArray(cell.destinations) || cell.destinations.length === 0) {
        continue;
      }

      const { screenX: fromX, screenY: fromY } = this.worldToScreen(cell.x, cell.y, cameraState);

      for (const destId of cell.destinations) {
        // 查找目标格子（需要 MapIndex 或传入完整的 cells）
        const destCell = cells.find((c) => c.id === destId);
        if (!destCell) continue;

        const { screenX: toX, screenY: toY } = this.worldToScreen(
          destCell.x,
          destCell.y,
          cameraState,
        );

        // 绘制连线
        this.ctx.beginPath();
        this.ctx.moveTo(fromX, fromY);
        this.ctx.lineTo(toX, toY);
        this.ctx.stroke();
        this.ctx.closePath();
      }
    }

    this.ctx.restore();
  }

  /**
   * 世界坐标转屏幕坐标
   */
  private worldToScreen(worldX: number, worldY: number, camera: CameraState): { screenX: number; screenY: number } {
    return {
      screenX: worldX * camera.zoom + camera.offsetX,
      screenY: worldY * camera.zoom + camera.offsetY,
    };
  }
}