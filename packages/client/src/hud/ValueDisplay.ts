/**
 * 数值显示组件
 *
 * 动态渲染玩家的数值字段，支持：
 * - 数值变化动画（增加绿色，减少红色）
 * - 最大/最小值显示
 * - 自定义字段名称
 */

import type { ValueField } from '@game/shared';

/**
 * 数值变化动画类型
 */
export type ValueChangeType = 'increase' | 'decrease' | 'none';

/**
 * 数值显示配置
 */
export interface ValueDisplayConfig {
  /** 字段 ID */
  fieldId: string;
  /** 显示名称（可覆盖 ValueField.name） */
  displayName?: string;
  /** 是否显示图标 */
  showIcon?: boolean;
  /** 图标（emoji 或 URL） */
  icon?: string;
  /** 是否紧凑显示 */
  compact?: boolean;
  /** 数值格式化函数 */
  formatter?: (value: number) => string;
}

/**
 * 数值显示组件
 */
export class ValueDisplay {
  private container: HTMLElement;
  private valueElement: HTMLElement;
  private changeIndicator: HTMLElement;
  private currentField: ValueField | null = null;
  private animationTimeout: number | null = null;
  private config: ValueDisplayConfig;

  constructor(config: ValueDisplayConfig) {
    this.config = config;
    this.container = this.createContainer();
    this.valueElement = this.createValueElement();
    this.changeIndicator = this.createChangeIndicator();
  }

  /**
   * 创建容器
   */
  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = `value-display value-display-${this.config.fieldId}`;
    if (this.config.compact) {
      container.classList.add('compact');
    }
    return container;
  }

  /**
   * 创建数值显示元素
   */
  private createValueElement(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'value-wrapper';

    // 图标
    if (this.config.showIcon && this.config.icon) {
      const iconEl = document.createElement('span');
      iconEl.className = 'value-icon';
      iconEl.textContent = this.config.icon;
      wrapper.appendChild(iconEl);
    }

    // 名称
    const nameEl = document.createElement('span');
    nameEl.className = 'value-name';
    nameEl.textContent = this.config.displayName || this.config.fieldId;
    wrapper.appendChild(nameEl);

    // 数值
    const valueEl = document.createElement('span');
    valueEl.className = 'value-number';
    valueEl.textContent = '0';
    wrapper.appendChild(valueEl);

    // 添加到容器
    this.container.appendChild(wrapper);

    return valueEl;
  }

  /**
   * 创建变化指示器（用于动画）
   */
  private createChangeIndicator(): HTMLElement {
    const indicator = document.createElement('div');
    indicator.className = 'value-change-indicator';
    indicator.style.display = 'none';
    this.container.appendChild(indicator);
    return indicator;
  }

  /**
   * 获取 DOM 元素
   */
  getElement(): HTMLElement {
    return this.container;
  }

  /**
   * 更新数值字段
   */
  update(field: ValueField | null): void {
    this.currentField = field;

    if (!field) {
      this.container.style.display = 'none';
      return;
    }

    this.container.style.display = 'flex';

    // 更新名称（如果配置中没有指定）
    const nameEl = this.container.querySelector('.value-name') as HTMLElement;
    if (!this.config.displayName) {
      nameEl.textContent = field.name;
    }

    // 更新数值
    const formattedValue = this.config.formatter
      ? this.config.formatter(field.current)
      : this.formatValue(field.current);
    this.valueElement.textContent = formattedValue;

    // 显示边界值（如果有）
    this.updateBoundaries(field);
  }

  /**
   * 格式化数值显示
   */
  private formatValue(value: number): string {
    // 大数值显示为简写（如 1.5K, 2.3M）
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(1)}K`;
    }
    return value.toString();
  }

  /**
   * 更新边界显示
   */
  private updateBoundaries(field: ValueField): void {
    // 检查是否已有边界元素
    let boundsEl = this.container.querySelector('.value-bounds') as HTMLElement;

    if (field.min !== undefined || field.max !== undefined) {
      if (!boundsEl) {
        boundsEl = document.createElement('span');
        boundsEl.className = 'value-bounds';
        this.container.querySelector('.value-wrapper')!.appendChild(boundsEl);
      }

      const parts: string[] = [];
      if (field.min !== undefined) parts.push(`min ${field.min}`);
      if (field.max !== undefined) parts.push(`max ${field.max}`);
      boundsEl.textContent = ` (${parts.join(', ')})`;
    } else if (boundsEl) {
      boundsEl.remove();
    }
  }

  /**
   * 显示数值变化动画
   */
  showChangeAnimation(oldValue: number, newValue: number): void {
    const delta = newValue - oldValue;
    if (delta === 0) return;

    const changeType: ValueChangeType = delta > 0 ? 'increase' : 'decrease';

    // 清除之前的动画
    if (this.animationTimeout) {
      clearTimeout(this.animationTimeout);
      this.changeIndicator.style.display = 'none';
    }

    // 设置变化指示器文本和样式
    const sign = delta > 0 ? '+' : '';
    const formattedDelta = this.config.formatter
      ? this.config.formatter(Math.abs(delta))
      : Math.abs(delta).toString();

    this.changeIndicator.textContent = `${sign}${delta > 0 ? delta : -delta}`;
    this.changeIndicator.className = `value-change-indicator ${changeType}`;
    this.changeIndicator.style.display = 'block';

    // 数值元素也添加动画类
    this.valueElement.classList.add(`value-${changeType}`);

    // 动画持续时间
    const animationDuration = 1500;

    this.animationTimeout = window.setTimeout(() => {
      this.changeIndicator.style.display = 'none';
      this.valueElement.classList.remove('value-increase', 'value-decrease');
      this.animationTimeout = null;
    }, animationDuration);
  }

  /**
   * 获取当前字段
   */
  getCurrentField(): ValueField | null {
    return this.currentField;
  }

  /**
   * 销毁组件
   */
  destroy(): void {
    if (this.animationTimeout) {
      clearTimeout(this.animationTimeout);
    }
    this.container.remove();
  }
}

/**
 * 创建数值显示组件
 */
export function createValueDisplay(config: ValueDisplayConfig): ValueDisplay {
  return new ValueDisplay(config);
}