/**
 * 事件弹窗组件（EventModal）
 *
 * 负责：
 * - 显示事件名称、描述、效果
 * - 事件效果动画（数值变化可视化）
 * - 与后端 Socket 通信
 *
 * 设计原则：
 * - 弹窗样式简洁，不遮挡主要游戏区域
 * - 显示事件类型（好事/坏事/中性）
 * - 支持数值变化动画效果
 */

import type { EventEffect } from '@game/shared';

/**
 * 事件弹窗数据
 */
export interface EventModalData {
  /** 事件 ID */
  eventId: string;
  /** 事件名称 */
  eventName: string;
  /** 事件描述/消息 */
  message: string;
  /** 事件效果列表 */
  effects: EventEffect[];
  /** 事件类型（好事/坏事/中性） */
  type: 'good' | 'bad' | 'neutral';
}

/**
 * 弹窗配置
 */
export interface EventModalConfig {
  /** 弹窗数据 */
  data: EventModalData;
  /** 容器元素 */
  container: HTMLElement;
  /** 关闭回调 */
  onClose?: () => void;
  /** 自动关闭延迟（毫秒），0 表示不自动关闭 */
  autoCloseDelay?: number;
}

/**
 * 弹窗样式配置
 */
const MODAL_STYLE = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  backgroundColor: '#1f2937',
  border: '2px solid #374151',
  borderRadius: '12px',
  padding: '24px',
  minWidth: '350px',
  maxWidth: '450px',
  zIndex: '100',
  color: '#f3f4f6',
  fontFamily: 'sans-serif',
  boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
};

const TITLE_STYLE = {
  fontSize: '20px',
  fontWeight: 'bold',
  marginBottom: '16px',
  textAlign: 'center',
};

const CONTENT_STYLE = {
  fontSize: '14px',
  lineHeight: '1.6',
  marginBottom: '16px',
};

const EFFECT_ITEM_STYLE = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 12px',
  marginBottom: '8px',
  borderRadius: '6px',
  backgroundColor: '#374151',
};

const BUTTON_STYLE = {
  width: '100%',
  padding: '12px',
  borderRadius: '8px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  transition: 'all 0.2s',
  border: 'none',
};

/**
 * 事件弹窗组件
 */
export class EventModal {
  private config: EventModalConfig;
  private modalElement: HTMLElement | null = null;
  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: EventModalConfig) {
    this.config = config;
  }

  /**
   * 显示弹窗
   */
  show(): void {
    this.modalElement = this.createModal();
    this.config.container.appendChild(this.modalElement);

    // 启动入场动画
    this.playEntranceAnimation();

    // 设置自动关闭
    if (this.config.autoCloseDelay && this.config.autoCloseDelay > 0) {
      this.autoCloseTimer = setTimeout(() => {
        this.close();
      }, this.config.autoCloseDelay);
    }
  }

  /**
   * 关闭弹窗
   */
  close(): void {
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }

    if (this.modalElement) {
      // 播放退出动画
      this.playExitAnimation(() => {
        if (this.modalElement && this.modalElement.parentNode) {
          this.modalElement.parentNode.removeChild(this.modalElement);
        }
        this.modalElement = null;
        this.config.onClose?.();
      });
    }
  }

  /**
   * 创建弹窗元素
   */
  private createModal(): HTMLElement {
    const modal = document.createElement('div');
    Object.assign(modal.style, MODAL_STYLE);

    // 设置边框颜色（根据事件类型）
    const borderColor = this.getBorderColor();
    modal.style.borderTop = `4px solid ${borderColor}`;

    // 标题（事件名称）
    const title = document.createElement('h3');
    Object.assign(title.style, TITLE_STYLE);
    title.style.color = this.getTitleColor();
    title.textContent = this.config.data.eventName;
    modal.appendChild(title);

    // 事件类型图标
    const icon = document.createElement('div');
    icon.style.textAlign = 'center';
    icon.style.fontSize = '32px';
    icon.style.marginBottom = '12px';
    icon.textContent = this.getTypeIcon();
    modal.appendChild(icon);

    // 事件描述
    const content = document.createElement('p');
    Object.assign(content.style, CONTENT_STYLE);
    content.textContent = this.config.data.message;
    modal.appendChild(content);

    // 效果列表
    if (this.config.data.effects.length > 0) {
      const effectTitle = document.createElement('h4');
      effectTitle.textContent = '效果';
      effectTitle.style.marginTop = '12px';
      effectTitle.style.marginBottom = '8px';
      effectTitle.style.fontSize = '14px';
      effectTitle.style.color = '#9ca3af';
      modal.appendChild(effectTitle);

      const effectList = document.createElement('div');
      for (const effect of this.config.data.effects) {
        const effectItem = this.createEffectItem(effect);
        effectList.appendChild(effectItem);
      }
      modal.appendChild(effectList);
    }

    // 确认按钮
    const button = document.createElement('button');
    Object.assign(button.style, BUTTON_STYLE);
    button.style.backgroundColor = this.getButtonColor();
    button.style.color = '#ffffff';
    button.textContent = '确定';
    button.onclick = () => this.close();
    modal.appendChild(button);

    return modal;
  }

  /**
   * 创建效果项
   */
  private createEffectItem(effect: EventEffect): HTMLElement {
    const item = document.createElement('div');
    Object.assign(item.style, EFFECT_ITEM_STYLE);

    // 字段名
    const fieldName = document.createElement('span');
    fieldName.textContent = this.getFieldDisplayName(effect.field);
    item.appendChild(fieldName);

    // 数值变化
    const delta = document.createElement('span');
    const sign = effect.delta >= 0 ? '+' : '';
    delta.textContent = `${sign}${effect.delta}`;
    delta.style.color = effect.delta >= 0 ? '#10b981' : '#ef4444';
    delta.style.fontWeight = 'bold';
    delta.style.fontSize = '16px';
    item.appendChild(delta);

    return item;
  }

  /**
   * 获取字段显示名称
   */
  private getFieldDisplayName(fieldId: string): string {
    const fieldNames: Record<string, string> = {
      money: '财产',
      credit: '信用值',
      environment: '环保值',
    };
    return fieldNames[fieldId] || fieldId;
  }

  /**
   * 获取边框颜色（根据事件类型）
   */
  private getBorderColor(): string {
    switch (this.config.data.type) {
      case 'good':
        return '#10b981'; // 绿色
      case 'bad':
        return '#ef4444'; // 红色
      case 'neutral':
        return '#6b7280'; // 灰色
      default:
        return '#374151';
    }
  }

  /**
   * 获取标题颜色（根据事件类型）
   */
  private getTitleColor(): string {
    switch (this.config.data.type) {
      case 'good':
        return '#10b981';
      case 'bad':
        return '#ef4444';
      case 'neutral':
        return '#9ca3af';
      default:
        return '#f3f4f6';
    }
  }

  /**
   * 获取类型图标
   */
  private getTypeIcon(): string {
    switch (this.config.data.type) {
      case 'good':
        return '🎉';
      case 'bad':
        return '⚠️';
      case 'neutral':
        return '📢';
      default:
        return '📋';
    }
  }

  /**
   * 获取按钮颜色
   */
  private getButtonColor(): string {
    switch (this.config.data.type) {
      case 'good':
        return '#10b981';
      case 'bad':
        return '#ef4444';
      case 'neutral':
        return '#6b7280';
      default:
        return '#374151';
    }
  }

  /**
   * 播放入场动画
   */
  private playEntranceAnimation(): void {
    if (!this.modalElement) return;

    this.modalElement.style.opacity = '0';
    this.modalElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
    this.modalElement.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

    requestAnimationFrame(() => {
      if (this.modalElement) {
        this.modalElement.style.opacity = '1';
        this.modalElement.style.transform = 'translate(-50%, -50%) scale(1)';
      }
    });
  }

  /**
   * 播放退出动画
   */
  private playExitAnimation(callback: () => void): void {
    if (!this.modalElement) {
      callback();
      return;
    }

    this.modalElement.style.opacity = '0';
    this.modalElement.style.transform = 'translate(-50%, -50%) scale(0.9)';

    setTimeout(callback, 300);
  }

  /**
   * 是否正在显示
   */
  isShowing(): boolean {
    return this.modalElement !== null;
  }
}

/**
 * 创建事件弹窗
 */
export function createEventModal(config: EventModalConfig): EventModal {
  return new EventModal(config);
}