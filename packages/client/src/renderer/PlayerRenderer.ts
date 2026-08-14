/**
 * 玩家棋子渲染器
 *
 * 负责渲染玩家的棋子（三种样式：圆形、棋子小人、简单标记）
 * 支持移动动画的基础架构
 */

import type { Cell, Player } from '@game/shared';
import { getPlayerColor } from '../utils/colorScheme';
import { DEFAULT_PLAYER_CONFIG } from '../utils/geometry';
import type { CameraState } from './Camera';

/**
 * 玩家棋子样式
 */
export enum PlayerPieceStyle {
  /** 圆形棋子（简单） */
  Circle = 'circle',
  /** 棋子小人（有头和身体） */
  Pawn = 'pawn',
  /** 简单标记（小圆点） */
  Marker = 'marker',
}

/**
 * 玩家渲染配置
 */
export interface PlayerRenderConfig {
  radius: number;
  borderWidth: number;
  style: PlayerPieceStyle;
}

/**
 * 玩家棋子渲染器
 */
export class PlayerRenderer {
  private ctx: CanvasRenderingContext2D;
  private config: PlayerRenderConfig;

  constructor(ctx: CanvasRenderingContext2D, config?: Partial<PlayerRenderConfig>) {
    this.ctx = ctx;
    this.config = {
      radius: config?.radius ?? DEFAULT_PLAYER_CONFIG.radius,
      borderWidth: config?.borderWidth ?? DEFAULT_PLAYER_CONFIG.borderWidth,
      style: config?.style ?? PlayerPieceStyle.Pawn,
    };
  }

  /**
   * 渲染玩家棋子
   *
   * @param player 玩家数据
   * @param cameraState 相机状态
   * @param cell 格子数据（用于获取坐标）
   * @param index 玩家索引（用于颜色）
   */
  render(player: Player, cell: Cell | undefined, cameraState: CameraState, index: number): void {
    if (!cell) return;
    const position = player.position;
    if (position === null || position === undefined || position.cellId < 0) return;

    // 从世界坐标转换到屏幕坐标（格子中心偏移，避免重叠）
    const { screenX, screenY } = this.worldToScreen(
      cell.x,
      cell.y,
      cameraState,
      index,
    );

    const scaledRadius = this.config.radius * cameraState.zoom;
    const color = getPlayerColor(index);

    this.ctx.save();

    // 根据样式绘制棋子
    switch (this.config.style) {
      case PlayerPieceStyle.Circle:
        this.renderCirclePiece(screenX, screenY, scaledRadius, color, cameraState.zoom);
        break;
      case PlayerPieceStyle.Pawn:
        this.renderPawnPiece(screenX, screenY, scaledRadius, color, cameraState.zoom);
        break;
      case PlayerPieceStyle.Marker:
        this.renderMarkerPiece(screenX, screenY, scaledRadius, color, cameraState.zoom);
        break;
    }

    this.ctx.restore();
  }

  /**
   * 渲染圆形棋子
   */
  private renderCirclePiece(
    x: number,
    y: number,
    radius: number,
    color: string,
    zoom: number,
  ): void {
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = color;
    this.ctx.fill();
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = this.config.borderWidth * zoom;
    this.ctx.stroke();
    this.ctx.closePath();
  }

  /**
   * 渲染棋子小人（有头和身体）
   */
  private renderPawnPiece(
    x: number,
    y: number,
    radius: number,
    color: string,
    zoom: number,
  ): void {
    // 头部（小圆）
    const headRadius = radius * 0.6;
    const headY = y - radius * 0.8;

    this.ctx.beginPath();
    this.ctx.arc(x, headY, headRadius, 0, Math.PI * 2);
    this.ctx.fillStyle = color;
    this.ctx.fill();
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = this.config.borderWidth * zoom;
    this.ctx.stroke();
    this.ctx.closePath();

    // 身体（梯形/倒三角形）
    const bodyTop = headY + headRadius;
    const bodyBottom = y + radius;
    const bodyWidthTop = headRadius * 0.8;
    const bodyWidthBottom = radius;

    this.ctx.beginPath();
    this.ctx.moveTo(x - bodyWidthTop, bodyTop);
    this.ctx.lineTo(x + bodyWidthTop, bodyTop);
    this.ctx.lineTo(x + bodyWidthBottom, bodyBottom);
    this.ctx.lineTo(x - bodyWidthBottom, bodyBottom);
    this.ctx.closePath();
    this.ctx.fillStyle = color;
    this.ctx.fill();
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = this.config.borderWidth * zoom;
    this.ctx.stroke();
  }

  /**
   * 渲染简单标记（小圆点）
   */
  private renderMarkerPiece(
    x: number,
    y: number,
    radius: number,
    color: string,
    zoom: number,
  ): void {
    const markerRadius = radius * 0.5;
    this.ctx.beginPath();
    this.ctx.arc(x, y, markerRadius, 0, Math.PI * 2);
    this.ctx.fillStyle = color;
    this.ctx.fill();
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = (this.config.borderWidth * 0.5) * zoom;
    this.ctx.stroke();
    this.ctx.closePath();
  }

  /**
   * 世界坐标转屏幕坐标（带偏移，避免重叠）
   */
  private worldToScreen(
    worldX: number,
    worldY: number,
    camera: CameraState,
    index: number,
  ): { screenX: number; screenY: number } {
    // 基础坐标转换
    const baseX = worldX * camera.zoom + camera.offsetX;
    const baseY = worldY * camera.zoom + camera.offsetY;

    // 偏移（避免多个玩家在同一格子时重叠）
    const offsetX = (index % 3 - 1) * 10 * camera.zoom; // -10, 0, 10
    const offsetY = Math.floor(index / 3) * 10 * camera.zoom; // 0, 10, 20...

    return {
      screenX: baseX + offsetX,
      screenY: baseY + offsetY,
    };
  }
}