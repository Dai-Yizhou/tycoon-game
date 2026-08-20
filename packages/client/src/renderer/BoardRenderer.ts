/**
 * 棋盘主渲染器
 *
 * 协调所有子渲染器（格子、连线、玩家、视野遮罩）
 * 提供完整的棋盘渲染流程
 */

import type { MapData, Player } from '@game/shared';
import { t } from '../game/i18n.js';
import { MapIndex } from '@game/shared';
import { Camera } from './Camera';
import { CellRenderer } from './CellRenderer';
import { ConnectionRenderer } from './ConnectionRenderer';
import { PlayerRenderer, PlayerPieceStyle } from './PlayerRenderer';
import { isPointInCircle } from '../utils/geometry';
import { DEFAULT_CELL_CONFIG } from '../utils/geometry';
import type { ThemeSnapshot } from '../design/DesignAdapter';

/**
 * 棋盘渲染配置
 */
export interface BoardRendererConfig {
  /** 格子半径 */
  cellRadius?: number;
  /** 玩家棋子样式 */
  playerStyle?: PlayerPieceStyle;
  /** 单次生成的主题快照，避免渲染过程中读取令牌树。 */
  theme?: ThemeSnapshot;
}

/**
 * 棋盘主渲染器
 */
export class BoardRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private camera: Camera;
  private cellRenderer: CellRenderer;
  private connectionRenderer: ConnectionRenderer;
  private playerRenderer: PlayerRenderer;
  private theme?: ThemeSnapshot;
  private mapIndex: MapIndex | null = null;
  private players: Player[] = [];
  private lastFrameTime: number = 0;
  private frameCount: number = 0;

  constructor(canvas: HTMLCanvasElement, config?: BoardRendererConfig) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to acquire 2D context');
    }

    this.canvas = canvas;
    this.ctx = ctx;
    this.theme = config?.theme;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.width / dpr || canvas.width;
    const cssHeight = canvas.height / dpr || canvas.height;
    this.camera = new Camera(cssWidth, cssHeight);

    // 初始化子渲染器
    this.cellRenderer = new CellRenderer(this.ctx, {
      radius: config?.cellRadius ?? DEFAULT_CELL_CONFIG.radius,
      theme: config?.theme,
    });
    this.connectionRenderer = new ConnectionRenderer(this.ctx, { theme: config?.theme });
    this.playerRenderer = new PlayerRenderer(this.ctx, {
      style: config?.playerStyle ?? PlayerPieceStyle.Pawn,
    });

    // 初始化 DPR 缩放
    if (canvas.width > 0 && canvas.height > 0) {
      this.resize(cssWidth, cssHeight);
    }
  }

  /**
   * 加载地图数据
   *
   * @param mapData 地图数据（Cell[]）
   */
  loadMap(mapData: MapData): void {
    this.mapIndex = new MapIndex(mapData);
  }

  /**
   * 更新玩家列表
   *
   * @param players 玩家数组
   */
  updatePlayers(players: Player[]): void {
    this.players = players;
  }

  /**
   * 更新单个玩家位置（用于移动动画）
   *
   * @param playerId 玩家 ID
   * @param cellId 新格子 ID
   */
  updatePlayerPosition(playerId: string, cellId: number): void {
    const player = this.players.find(p => p.id === playerId);
    if (player) {
      player.position.cellId = cellId;
    }
  }

  /**
   * 主渲染流程
   */
  render(): void {
    if (!this.mapIndex) {
      this.drawPlaceholder(t('board.loading'));
      return;
    }

    const cameraState = this.camera.getState();

    // 清空画布
    this.clear();

    // 1. 渲染连线
    this.connectionRenderer.render(this.mapIndex.getAll(), cameraState);

    // 2. 渲染格子
    for (const cell of this.mapIndex.getAll()) {
      this.cellRenderer.render(cell, cameraState, 1);
    }

    // 3. 渲染玩家棋子
    for (let i = 0; i < this.players.length; i++) {
      const player = this.players[i];
      const cell = this.mapIndex?.getById(player.position.cellId);
      this.playerRenderer.render(player, cell, cameraState, i);
    }

    // 性能监控
    this.updatePerformanceMetrics();
  }

  /**
   * 清空画布
   */
  clear(): void {
    this.ctx.fillStyle = this.theme?.canvas.board.background ?? '#eef2f6';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * 渲染占位符（加载中状态）
   */
  drawPlaceholder(text: string): void {
    this.clear();
    this.ctx.fillStyle = this.theme?.dom['--tycoon-line-key'] ?? this.theme?.canvas.connection ?? '#58a6ff';
    this.ctx.font = '20px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(text, this.canvas.width / 2, this.canvas.height / 2);
  }

  /**
   * 性能监控
   */
  private updatePerformanceMetrics(): void {
    const now = performance.now();
    this.frameCount++;

    if (now - this.lastFrameTime >= 1000) {
      this.frameCount = 0;
      this.lastFrameTime = now;
    }
  }

  /**
   * 点击检测：返回点击的格子 ID
   *
   * @param screenX 屏幕坐标 X
   * @param screenY 屏幕坐标 Y
   * @returns 格子 ID 或 null
   */
  hitTest(screenX: number, screenY: number): number | null {
    if (!this.mapIndex) return null;

    void this.camera.screenToWorld(screenX, screenY);
    const cameraState = this.camera.getState();
    const scaledRadius = this.cellRenderer.getConfig().radius * cameraState.zoom;

    // 遍历所有格子，检测碰撞
    for (const cell of this.mapIndex.getAll()) {
      const { screenX: cellScreenX, screenY: cellScreenY } = this.camera.worldToScreen(
        cell.x,
        cell.y,
      );
      if (isPointInCircle(cellScreenX, cellScreenY, scaledRadius, screenX, screenY)) {
        return cell.id;
      }
    }

    return null;
  }

  /** 兼容旧调用方，返回当前视口快照。 */
  getViewport(): { width: number; height: number; zoom: number } {
    const state = this.camera.getState();
    return { width: state.viewportWidth, height: state.viewportHeight, zoom: state.zoom };
  }

  /**
   * 获取相机控制器
   */
  getCamera(): Camera {
    return this.camera;
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * 相机居中到指定世界坐标
   */
  centerOn(worldX: number, worldY: number): void {
    const state = this.camera.getState();
    this.camera.panTo(
      state.viewportWidth / 2 - worldX * state.zoom,
      state.viewportHeight / 2 - worldY * state.zoom,
    );
  }

  /**
   * 屏幕坐标转世界坐标
   */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const { worldX, worldY } = this.camera.screenToWorld(screenX, screenY);
    return { x: worldX, y: worldY };
  }

  /**
   * 获取地图索引
   */
  getMapIndex(): MapIndex | null {
    return this.mapIndex;
  }

  /**
   * 更新画布尺寸（使用 CSS 像素，自动处理 devicePixelRatio）
   */
  resize(cssWidth: number, cssHeight: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(cssWidth * dpr);
    this.canvas.height = Math.floor(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.camera.updateViewportSize(cssWidth, cssHeight);
  }
}
