/**
 * 格子渲染器
 *
 * 负责渲染单个格子的外观：形状、颜色、文字、图标等
 * 支持 property 格子的建筑等级标识和所有者标识
 * 时区通过明暗程度区分（越东越亮）
 * 支持自定义格子图标（emoji 或图片 URL）
 */

import type { Cell } from '@game/shared';
import { getExtra, normalizeCellType } from '@game/shared';
import { getColorScheme } from '../utils/colorScheme';
import { DEFAULT_CELL_CONFIG } from '../utils/geometry';
import type { CameraState } from './Camera';
import type { ThemeSnapshot } from '../design/DesignAdapter';

const TIMEZONE_BRIGHTNESS: Record<string, number> = {
  'UTC-8': 0.55,
  'UTC-4': 0.75,
  'UTC+0': 1.0,
  'UTC+4': 1.15,
};

function adjustBrightness(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const nr = Math.min(255, Math.round(r * factor));
  const ng = Math.min(255, Math.round(g * factor));
  const nb = Math.min(255, Math.round(b * factor));
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

// 图片缓存：用于自定义图片URL图标
const imageCache = new Map<string, HTMLImageElement>();

/**
 * 判断图标是否为图片URL（http/https/data:）
 */
function isImageIcon(icon: string): boolean {
  return /^(https?:|data:image)/i.test(icon);
}

/**
 * 获取或创建图片对象（带缓存）
 */
function getOrCreateImage(src: string): HTMLImageElement {
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    imageCache.set(src, img);
  }
  return img;
}

/**
 * 格子渲染配置
 */
export interface CellRenderConfig {
  radius: number;
  borderWidth: number;
  fontSize: number;
  theme?: ThemeSnapshot;
}

/**
 * 格子渲染器
 *
 * 使用 Canvas 2D API 绘制格子
 */
export class CellRenderer {
  private ctx: CanvasRenderingContext2D;
  private config: CellRenderConfig;

  constructor(ctx: CanvasRenderingContext2D, config?: Partial<CellRenderConfig>) {
    this.ctx = ctx;
    this.config = {
      radius: config?.radius ?? DEFAULT_CELL_CONFIG.radius,
      borderWidth: config?.borderWidth ?? DEFAULT_CELL_CONFIG.borderWidth,
      fontSize: config?.fontSize ?? DEFAULT_CELL_CONFIG.fontSize,
      theme: config?.theme,
    };
  }

  /**
   * 渲染单个格子
   */
  render(cell: Cell, cameraState: CameraState, opacity: number = 1): void {
    const { screenX, screenY } = this.worldToScreen(cell.x, cell.y, cameraState);
    const scaledRadius = this.config.radius * cameraState.zoom;

    const cellType = normalizeCellType(cell);
    const colorScheme = getColorScheme(cellType);
    const themeFill = cellType === 'property' ? this.config.theme?.canvas.cell.property.fill
      : cellType === 'event' ? this.config.theme?.canvas.cell.event.fill
      : cellType === 'transport' ? this.config.theme?.canvas.cell.transport.fill : undefined;

    const timezone = getExtra<string>(cell, 'timezone', '');
    const brightness = timezone ? TIMEZONE_BRIGHTNESS[timezone] ?? 1.0 : 1.0;
    const fillColor = adjustBrightness(themeFill ?? colorScheme.fill, brightness);
    const strokeColor = adjustBrightness(this.config.theme?.dom['--tycoon-cell-border'] ?? colorScheme.stroke, brightness);

    this.ctx.save();
    this.ctx.globalAlpha = opacity;

    // 填充圆形
    this.ctx.beginPath();
    this.ctx.arc(screenX, screenY, scaledRadius, 0, Math.PI * 2);
    this.ctx.fillStyle = fillColor;
    this.ctx.fill();

    // 边框
    this.ctx.lineWidth = this.config.borderWidth * cameraState.zoom;
    this.ctx.strokeStyle = strokeColor;
    this.ctx.stroke();
    this.ctx.closePath();

    // 绘制时区标签（在格子下方）
    if (timezone && scaledRadius > 25) {
      this.ctx.font = `${9 * cameraState.zoom}px sans-serif`;
      this.ctx.fillStyle = brightness < 0.7 ? '#94a3b8' : '#6366f1';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'top';
      this.ctx.fillText(timezone, screenX, screenY + scaledRadius + 6 * cameraState.zoom);
    }

    // 读取自定义图标
    const icon = getExtra<string>(cell, 'icon', '') ?? '';
    const name = getExtra<string>(cell, 'name', '') ?? '';

    if (scaledRadius > 20) {
      if (icon) {
        // 有图标：图标居中偏上，名称在下方
        const iconSize = scaledRadius * 0.9;
        if (isImageIcon(icon)) {
          // 图片URL图标
          const img = getOrCreateImage(icon);
          if (img.complete && img.naturalWidth > 0) {
            this.ctx.drawImage(
              img,
              screenX - iconSize / 2,
              screenY - iconSize / 2 - (name ? scaledRadius * 0.18 : 0),
              iconSize,
              iconSize
            );
          }
        } else {
          // emoji/文字图标
          this.ctx.font = `${iconSize * 0.85}px sans-serif`;
          this.ctx.fillStyle = colorScheme.icon;
          this.ctx.textAlign = 'center';
          this.ctx.textBaseline = 'middle';
          this.ctx.fillText(
            icon,
            screenX,
            screenY - (name ? scaledRadius * 0.22 : 0)
          );
        }

        // 名称显示在图标下方
        if (name) {
          this.ctx.font = `${this.config.fontSize * cameraState.zoom}px sans-serif`;
          this.ctx.fillStyle = colorScheme.text;
          this.ctx.textAlign = 'center';
          this.ctx.textBaseline = 'middle';
          const displayName = name.length > 6 ? name.slice(0, 6) + '...' : name;
          this.ctx.fillText(displayName, screenX, screenY + scaledRadius * 0.42);
        }
      } else {
        // 无图标：仅显示名称（居中）
        if (name) {
          this.ctx.font = `${this.config.fontSize * cameraState.zoom}px sans-serif`;
          this.ctx.fillStyle = colorScheme.text;
          this.ctx.textAlign = 'center';
          this.ctx.textBaseline = 'middle';
          const displayName = name.length > 6 ? name.slice(0, 6) + '...' : name;
          this.ctx.fillText(displayName, screenX, screenY);
        }
      }
    }

    // 绘制建筑等级标识
    if (cellType === 'property') {
      const level = getExtra<number>(cell, 'level', 0) ?? 0;
      if (level > 0 && scaledRadius > 30) {
        this.renderLevelBadge(screenX, screenY - scaledRadius - 5, level, cameraState.zoom);
      }
    }

    // 绘制所有者标识
    const owners = getExtra<number[]>(cell, 'owners', []) ?? [];
    if (owners.length > 0 && scaledRadius > 30) {
      this.renderOwnerIndicator(screenX, screenY + scaledRadius + 5, cameraState.zoom);
    }

    this.ctx.restore();
  }

  private renderLevelBadge(x: number, y: number, level: number, zoom: number): void {
    const badgeRadius = 8 * zoom;
    this.ctx.beginPath();
    this.ctx.arc(x, y, badgeRadius, 0, Math.PI * 2);
    this.ctx.fillStyle = '#fbbf24';
    this.ctx.fill();
    this.ctx.strokeStyle = '#d97706';
    this.ctx.lineWidth = 1 * zoom;
    this.ctx.stroke();
    this.ctx.closePath();

    this.ctx.font = `${10 * zoom}px sans-serif`;
    this.ctx.fillStyle = '#1f2937';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(`${level}`, x, y);
  }

  private renderOwnerIndicator(x: number, y: number, zoom: number): void {
    const indicatorRadius = 5 * zoom;
    this.ctx.beginPath();
    this.ctx.arc(x, y, indicatorRadius, 0, Math.PI * 2);
    this.ctx.fillStyle = '#10b981';
    this.ctx.fill();
    this.ctx.strokeStyle = '#059669';
    this.ctx.lineWidth = 1 * zoom;
    this.ctx.stroke();
    this.ctx.closePath();
  }

  private worldToScreen(worldX: number, worldY: number, camera: CameraState): { screenX: number; screenY: number } {
    return {
      screenX: worldX * camera.zoom + camera.offsetX,
      screenY: worldY * camera.zoom + camera.offsetY,
    };
  }

  getConfig(): CellRenderConfig {
    return { ...this.config };
  }
}
