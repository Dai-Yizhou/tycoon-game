/**
 * 时代状态（占位实现，后续 Task 24 扩展）
 */

export interface EraInfo {
  id: string;
  name: string;
  mapId: string;
  startAt: string;
  status: 'active' | 'pending' | 'archived';
}

export class EraManager {
  private current: EraInfo | null = null;

  setCurrent(era: EraInfo): void {
    this.current = era;
  }

  getCurrent(): EraInfo | null {
    return this.current;
  }

  /**
   * 占位接口：触发时代结算
   * 实际实现将在 Task 24 中完成
   */
  triggerSettlement(): { success: boolean; message: string } {
    if (!this.current) {
      return { success: false, message: '当前无活跃时代' };
    }
    // 占位返回
    return {
      success: true,
      message: `时代 ${this.current.name} 结算已请求（占位实现）`,
    };
  }
}
