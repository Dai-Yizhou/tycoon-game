/**
 * 相机控制器
 */

export interface CameraState {
  /** 平移偏移（屏幕坐标系） */
  offsetX: number;
  offsetY: number;
  /** 视口尺寸 */
  viewportWidth: number;
  viewportHeight: number;
}


/**
 * 相机控制器
 *
 * 维护视口状态
 */
export class Camera {
  private state: CameraState;

  constructor(
    viewportWidth: number,
    viewportHeight: number,
  ) {
    this.state = {
      offsetX: 0,
      offsetY: 0,
      viewportWidth,
      viewportHeight,
    };
  }

  /**
   * 获取当前相机状态（不可变副本）
   */
  getState(): CameraState {
    return { ...this.state };
  }
  
  /**
   * 平移到指定偏移位置
   */
  panTo(offsetX: number, offsetY: number): void {
    this.state.offsetX = offsetX;
    this.state.offsetY = offsetY;
  }

  /**
   * 将世界坐标转换为屏幕坐标
   */
  worldToScreen(worldX: number, worldY: number): { screenX: number; screenY: number } {
    return {
      screenX: worldX,
      screenY: worldY,
    };
  }

  /**
   * 更新视口尺寸
   */
  updateViewportSize(width: number, height: number): void {
    this.state.viewportWidth = width;
    this.state.viewportHeight = height;
  }
}