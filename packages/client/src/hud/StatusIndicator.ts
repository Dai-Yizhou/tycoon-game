/**
 * 状态指示器
 *
 * 显示玩家状态（正常、监狱、破产、冻结）的可视化指示器
 */

import type { PlayerStatus } from '@game/shared';

/**
 * 状态配置映射
 */
const STATUS_CONFIG: Record<PlayerStatus, { label: string; color: string; icon: string; class: string }> = {
  normal: { label: '正常', color: '#3fb950', icon: '✓', class: 'status-normal' },
  jail: { label: '监狱', color: '#f0883e', icon: '⛓', class: 'status-jail' },
  bankrupt: { label: '破产', color: '#f85149', icon: '✗', class: 'status-bankrupt' },
  frozen: { label: '冻结', color: '#8b949e', icon: '❄', class: 'status-frozen' },
};

/**
 * 状态指示器组件
 */
export class StatusIndicator {
  private container: HTMLElement;
  private iconElement: HTMLElement;
  private labelElement: HTMLElement;
  private currentStatus: PlayerStatus = 'normal';

  constructor() {
    this.container = this.createContainer();
    this.iconElement = this.createIconElement();
    this.labelElement = this.createLabelElement();
  }

  /**
   * 创建容器
   */
  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'status-indicator';
    return container;
  }

  /**
   * 创建图标元素
   */
  private createIconElement(): HTMLElement {
    const icon = document.createElement('span');
    icon.className = 'status-icon';
    this.container.appendChild(icon);
    return icon;
  }

  /**
   * 创建标签元素
   */
  private createLabelElement(): HTMLElement {
    const label = document.createElement('span');
    label.className = 'status-label';
    this.container.appendChild(label);
    return label;
  }

  /**
   * 获取 DOM 元素
   */
  getElement(): HTMLElement {
    return this.container;
  }

  /**
   * 更新状态
   */
  update(status: PlayerStatus): void {
    this.currentStatus = status;
    const config = STATUS_CONFIG[status];

    // 更新样式
    this.container.className = `status-indicator ${config.class}`;
    this.iconElement.textContent = config.icon;
    this.iconElement.style.color = config.color;
    this.labelElement.textContent = config.label;

    // 添加动画（状态变化时）
    this.container.classList.add('status-changed');
    setTimeout(() => {
      this.container.classList.remove('status-changed');
    }, 500);
  }

  /**
   * 获取当前状态
   */
  getStatus(): PlayerStatus {
    return this.currentStatus;
  }

  /**
   * 设置紧凑模式
   */
  setCompact(compact: boolean): void {
    if (compact) {
      this.container.classList.add('compact');
      this.labelElement.style.display = 'none';
    } else {
      this.container.classList.remove('compact');
      this.labelElement.style.display = 'inline';
    }
  }

  /**
   * 销毁组件
   */
  destroy(): void {
    this.container.remove();
  }
}

/**
 * 创建状态指示器
 */
export function createStatusIndicator(): StatusIndicator {
  return new StatusIndicator();
}