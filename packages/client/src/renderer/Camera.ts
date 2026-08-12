/**
 * 相机控制器（缩放、平移）
 *
 * 负责管理视口状态，支持鼠标滚轮缩放和拖拽平移
 */

export interface CameraState {
  /** 缩放级别（>= 0.1） */
  zoom: number;
  /** 平移偏移（屏幕坐标系） */
  offsetX: number;
  offsetY: number;
  /** 视口尺寸 */
  viewportWidth: number;
  viewportHeight: number;
}

export interface CameraBounds {
  /** 最小缩放级别 */
  minZoom: number;
  /** 最大缩放级别 */
  maxZoom: number;
  /** 每次滚轮缩放的因子 */
  zoomFactor: number;
}

/** 视口类型别名（兼容旧代码） */
export type BoardViewport = CameraState;

export const DEFAULT_CAMERA_BOUNDS: CameraBounds = {
  minZoom: 0.8,
  maxZoom: 0.8,
  zoomFactor: 1.1,
};

/**
 * 相机控制器
 *
 * 维护视口状态，提供缩放和平移的 API
 */
export class Camera {
  private state: CameraState;
  private bounds: CameraBounds;
  private isDragging: boolean = false;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;

  constructor(
    viewportWidth: number,
    viewportHeight: number,
    bounds: CameraBounds = DEFAULT_CAMERA_BOUNDS,
  ) {
    this.state = {
      zoom: bounds.minZoom,
      offsetX: 0,
      offsetY: 0,
      viewportWidth,
      viewportHeight,
    };
    this.bounds = bounds;
  }

  /**
   * 获取当前相机状态（不可变副本）
   */
  getState(): CameraState {
    return { ...this.state };
  }

  /**
   * 设置缩放级别（约束在 bounds 范围内）
   */
  setZoom(zoom: number): void {
    this.state.zoom = Math.max(
      this.bounds.minZoom,
      Math.min(this.bounds.maxZoom, zoom),
    );
  }

  /**
   * 增量缩放（滚轮调用）
   *
   * @param delta 滚轮增量（正值为放大，负值为缩小）
   * @param centerX 缩放中心点 X（屏幕坐标）
   * @param centerY 缩放中心点 Y（屏幕坐标）
   */
  zoomBy(delta: number, centerX: number, centerY: number): void {
    const oldZoom = this.state.zoom;
    const factor = delta > 0 ? this.bounds.zoomFactor : 1 / this.bounds.zoomFactor;
    const newZoom = Math.max(
      this.bounds.minZoom,
      Math.min(this.bounds.maxZoom, oldZoom * factor),
    );

    // 缩放中心点补偿（保持鼠标位置不变）
    const zoomRatio = newZoom / oldZoom;
    this.state.offsetX = centerX - (centerX - this.state.offsetX) * zoomRatio;
    this.state.offsetY = centerY - (centerY - this.state.offsetY) * zoomRatio;
    this.state.zoom = newZoom;
  }

  /**
   * 平移视口
   */
  pan(dx: number, dy: number): void {
    this.state.offsetX += dx;
    this.state.offsetY += dy;
  }

  /**
   * 平移到指定偏移位置
   */
  panTo(offsetX: number, offsetY: number): void {
    this.state.offsetX = offsetX;
    this.state.offsetY = offsetY;
  }

  /**
   * 开始拖拽
   */
  startDrag(mouseX: number, mouseY: number): void {
    this.isDragging = true;
    this.lastMouseX = mouseX;
    this.lastMouseY = mouseY;
  }

  /**
   * 拖拽更新
   */
  updateDrag(mouseX: number, mouseY: number): void {
    if (!this.isDragging) return;
    const dx = mouseX - this.lastMouseX;
    const dy = mouseY - this.lastMouseY;
    this.pan(dx, dy);
    this.lastMouseX = mouseX;
    this.lastMouseY = mouseY;
  }

  /**
   * 结束拖拽
   */
  endDrag(): void {
    this.isDragging = false;
  }

  /**
   * 是否正在拖拽
   */
  isDraggingActive(): boolean {
    return this.isDragging;
  }

  /**
   * 将世界坐标转换为屏幕坐标
   */
  worldToScreen(worldX: number, worldY: number): { screenX: number; screenY: number } {
    return {
      screenX: worldX * this.state.zoom + this.state.offsetX,
      screenY: worldY * this.state.zoom + this.state.offsetY,
    };
  }

  /**
   * 将屏幕坐标转换为世界坐标
   */
  screenToWorld(screenX: number, screenY: number): { worldX: number; worldY: number } {
    return {
      worldX: (screenX - this.state.offsetX) / this.state.zoom,
      worldY: (screenY - this.state.offsetY) / this.state.zoom,
    };
  }

  /**
   * 更新视口尺寸
   */
  updateViewportSize(width: number, height: number): void {
    this.state.viewportWidth = width;
    this.state.viewportHeight = height;
  }

  /**
   * 重置相机状态
   */
  reset(): void {
    this.state.zoom = this.bounds.minZoom;
    this.state.offsetX = 0;
    this.state.offsetY = 0;
    this.isDragging = false;
  }
}