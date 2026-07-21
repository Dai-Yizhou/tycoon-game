/**
 * 掷骰按钮组件
 *
 * 负责：
 * - 显示掷骰按钮
 * - 禁用状态（冷却期间）
 * - 冷却倒计时显示
 * - 点击触发掷骰事件
 */

export interface DiceButtonConfig {
  /** 按钮文本 */
  text: string;
  /** 冷却时间（毫秒） */
  cooldownMs: number;
  /** 按钮大小 */
  size: { width: number; height: number };
  /** 按钮颜色 */
  color: string;
  /** 禁用颜色 */
  disabledColor: string;
}

export const DEFAULT_DICE_BUTTON_CONFIG: DiceButtonConfig = {
  text: '掷骰',
  cooldownMs: 5000,
  size: { width: 120, height: 60 },
  color: '#4CAF50',
  disabledColor: '#9E9E9E',
};

/**
 * 掷骰按钮组件
 */
export class DiceButton {
  private container: HTMLElement;
  private button: HTMLButtonElement;
  private cooldownText: HTMLElement;
  private config: DiceButtonConfig;
  private onClick: () => void;
  private remainingCooldown: number = 0;
  private cooldownInterval: number | null = null;

  constructor(
    parent: HTMLElement,
    config: Partial<DiceButtonConfig> = {},
    onClick: () => void,
  ) {
    this.config = { ...DEFAULT_DICE_BUTTON_CONFIG, ...config };
    this.onClick = onClick;

    this.container = this.createContainer();
    this.button = this.createButton();
    this.cooldownText = this.createCooldownText();

    this.container.appendChild(this.button);
    this.container.appendChild(this.cooldownText);
    parent.appendChild(this.container);
  }

  /**
   * 创建容器
   */
  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'dice-button-container';
    container.style.position = 'absolute';
    container.style.bottom = '20px';
    container.style.right = '20px';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.gap = '5px';
    container.style.zIndex = '100';
    return container;
  }

  /**
   * 创建按钮
   */
  private createButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'dice-button';
    button.textContent = this.config.text;
    button.style.width = `${this.config.size.width}px`;
    button.style.height = `${this.config.size.height}px`;
    button.style.backgroundColor = this.config.color;
    button.style.border = 'none';
    button.style.borderRadius = '8px';
    button.style.color = 'white';
    button.style.fontSize = '18px';
    button.style.fontWeight = 'bold';
    button.style.cursor = 'pointer';
    button.style.transition = 'background-color 0.3s';

    button.addEventListener('click', () => {
      if (!this.isDisabled()) {
        this.onClick();
      }
    });

    button.addEventListener('mouseenter', () => {
      if (!this.isDisabled()) {
        button.style.backgroundColor = this.darkenColor(this.config.color, 20);
      }
    });

    button.addEventListener('mouseleave', () => {
      if (!this.isDisabled()) {
        button.style.backgroundColor = this.config.color;
      }
    });

    return button;
  }

  /**
   * 创建冷却文本
   */
  private createCooldownText(): HTMLElement {
    const text = document.createElement('div');
    text.className = 'cooldown-text';
    text.textContent = '';
    text.style.fontSize = '14px';
    text.style.color = '#FF5722';
    text.style.fontWeight = 'bold';
    return text;
  }

  /**
   * 设置冷却时间（开始倒计时）
   */
  startCooldown(durationMs: number): void {
    this.remainingCooldown = durationMs;
    this.updateButtonState();
    this.startCooldownTimer();
  }

  /**
   * 开始冷却计时器
   */
  private startCooldownTimer(): void {
    if (this.cooldownInterval !== null) {
      clearInterval(this.cooldownInterval);
    }

    const startTime = Date.now();
    const duration = this.remainingCooldown;

    this.cooldownInterval = window.setInterval(() => {
      const elapsed = Date.now() - startTime;
      this.remainingCooldown = Math.max(0, duration - elapsed);
      this.updateCooldownText();

      if (this.remainingCooldown <= 0) {
        this.stopCooldownTimer();
        this.resetButton();
      }
    }, 100);
  }

  /**
   * 停止冷却计时器
   */
  private stopCooldownTimer(): void {
    if (this.cooldownInterval !== null) {
      clearInterval(this.cooldownInterval);
      this.cooldownInterval = null;
    }
  }

  /**
   * 更新按钮状态（禁用/启用）
   */
  private updateButtonState(): void {
    if (this.isDisabled()) {
      this.button.disabled = true;
      this.button.style.backgroundColor = this.config.disabledColor;
      this.button.style.cursor = 'not-allowed';
    } else {
      this.button.disabled = false;
      this.button.style.backgroundColor = this.config.color;
      this.button.style.cursor = 'pointer';
    }
  }

  /**
   * 更新冷却文本
   */
  private updateCooldownText(): void {
    if (this.remainingCooldown > 0) {
      const seconds = Math.ceil(this.remainingCooldown / 1000);
      this.cooldownText.textContent = `冷却: ${seconds}s`;
    } else {
      this.cooldownText.textContent = '';
    }
  }

  /**
   * 重置按钮（冷却结束）
   */
  private resetButton(): void {
    this.remainingCooldown = 0;
    this.updateButtonState();
    this.updateCooldownText();
  }

  /**
   * 检查是否禁用
   */
  private isDisabled(): boolean {
    return this.remainingCooldown > 0;
  }

  /**
   * 加深颜色
   */
  private darkenColor(color: string, percent: number): string {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, (num >> 16) - amt);
    const G = Math.max(0, ((num >> 8) & 0x00FF) - amt);
    const B = Math.max(0, (num & 0x0000FF) - amt);
    return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
  }

  /**
   * 设置可见性
   */
  setVisible(visible: boolean): void {
    this.container.style.display = visible ? 'flex' : 'none';
  }

  /**
   * 销毁组件
   */
  destroy(): void {
    this.stopCooldownTimer();
    this.container.remove();
  }

  /**
   * 获取容器元素
   */
  getContainer(): HTMLElement {
    return this.container;
  }

  /**
   * 获取按钮元素
   */
  getButton(): HTMLButtonElement {
    return this.button;
  }
}