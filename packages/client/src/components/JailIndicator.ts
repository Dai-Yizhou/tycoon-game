/**
 * 监狱状态指示器
 *
 * 负责：
 * - 监狱状态的视觉标识
 * - 显示剩余回合数
 * - 显示信用值扣除提示
 * - 出狱倒计时显示
 *
 * 设计：
 * - 使用 HUD/StatusIndicator 的监狱样式
 * - 支持紧凑模式和详细模式
 * - 实时更新状态
 */

import { PlayerStatus } from '@game/shared';

/**
 * 监狱指示器配置
 */
export interface JailIndicatorConfig {
  /** 紧凑模式（仅显示图标和剩余回合） */
  compact?: boolean;
  /** 自定义容器 ID */
  containerId?: string;
  /** 自定义类名 */
  customClass?: string;
}

/**
 * 监狱状态数据
 */
export interface JailStatusData {
  /** 玩家状态 */
  status: PlayerStatus;
  /** 剩余回合数 */
  remainingTurns?: number;
  /** 入狱时间 */
  jailedAt?: number;
  /** 信用值扣除 */
  creditPenalty?: number;
  /** 冷却时间延长（毫秒） */
  cooldownMs?: number;
}

/**
 * 监狱状态指示器
 */
export class JailIndicator {
  private readonly element: HTMLElement;
  private readonly config: JailIndicatorConfig;
  private currentData: JailStatusData | null = null;

  constructor(config: JailIndicatorConfig = {}) {
    this.config = config;
    this.element = this.createElement();
  }

  /**
   * 创建 DOM 元素
   */
  private createElement(): HTMLElement {
    const container = document.createElement('div');
    container.id = this.config.containerId ?? 'jail-indicator';
    container.className = `jail-indicator ${this.config.customClass ?? ''} ${this.config.compact ? 'jail-indicator-compact' : 'jail-indicator-full'}`;

    // 创建监狱图标区域
    const iconArea = document.createElement('div');
    iconArea.className = 'jail-icon-area';

    // 监狱图标
    const icon = document.createElement('span');
    icon.className = 'jail-icon';
    icon.textContent = '⛓';
    iconArea.appendChild(icon);

    // 状态标签
    const label = document.createElement('span');
    label.className = 'jail-label';
    label.textContent = '监狱';
    iconArea.appendChild(label);

    container.appendChild(iconArea);

    // 详细信息区域（非紧凑模式）
    if (!this.config.compact) {
      const infoArea = document.createElement('div');
      infoArea.className = 'jail-info-area';

      // 剩余回合
      const turnsInfo = document.createElement('div');
      turnsInfo.className = 'jail-turns-info';
      turnsInfo.innerHTML = `<span class="jail-turns-label">剩余回合：</span><span class="jail-turns-value">0</span>`;
      infoArea.appendChild(turnsInfo);

      // 信用值扣除
      const creditInfo = document.createElement('div');
      creditInfo.className = 'jail-credit-info';
      creditInfo.innerHTML = `<span class="jail-credit-label">每次扣除：</span><span class="jail-credit-value">0</span>`;
      infoArea.appendChild(creditInfo);

      // 冷却时间
      const cooldownInfo = document.createElement('div');
      cooldownInfo.className = 'jail-cooldown-info';
      cooldownInfo.innerHTML = `<span class="jail-cooldown-label">掷骰冷却：</span><span class="jail-cooldown-value">10秒</span>`;
      infoArea.appendChild(cooldownInfo);

      container.appendChild(infoArea);
    }

    // 提示信息
    const hintArea = document.createElement('div');
    hintArea.className = 'jail-hint-area';
    hintArea.textContent = '监狱中无法收取租金';
    container.appendChild(hintArea);

    // 默认隐藏
    container.style.display = 'none';

    return container;
  }

  /**
   * 更新监狱状态
   */
  update(data: JailStatusData): void {
    this.currentData = data;

    // 更新显示状态
    if (data.status === PlayerStatus.Jail) {
      this.show();
      this.updateDisplay(data);
    } else {
      this.hide();
    }
  }

  /**
   * 更新显示内容
   */
  private updateDisplay(data: JailStatusData): void {
    // 紧凑模式：仅更新图标和回合数
    if (this.config.compact) {
      const turnsValue = this.element.querySelector('.jail-turns-value') as HTMLElement;
      if (turnsValue && data.remainingTurns !== undefined) {
        turnsValue.textContent = String(data.remainingTurns);
      }
      return;
    }

    // 详细模式：更新所有信息
    const turnsValue = this.element.querySelector('.jail-turns-value') as HTMLElement;
    if (turnsValue && data.remainingTurns !== undefined) {
      turnsValue.textContent = String(data.remainingTurns);
    }

    const creditValue = this.element.querySelector('.jail-credit-value') as HTMLElement;
    if (creditValue && data.creditPenalty !== undefined) {
      creditValue.textContent = `${data.creditPenalty}`;
    }

    const cooldownValue = this.element.querySelector('.jail-cooldown-value') as HTMLElement;
    if (cooldownValue && data.cooldownMs !== undefined) {
      const seconds = Math.ceil(data.cooldownMs / 1000);
      cooldownValue.textContent = `${seconds}秒`;
    }
  }

  /**
   * 显示监狱指示器
   */
  show(): void {
    this.element.style.display = 'block';
    this.element.classList.add('jail-active');
  }

  /**
   * 隐藏监狱指示器
   */
  hide(): void {
    this.element.style.display = 'none';
    this.element.classList.remove('jail-active');
  }

  /**
   * 获取 DOM 元素
   */
  getElement(): HTMLElement {
    return this.element;
  }

  /**
   * 获取当前状态数据
   */
  getCurrentData(): JailStatusData | null {
    return this.currentData;
  }

  /**
   * 设置紧凑模式
   */
  setCompact(compact: boolean): void {
    this.config.compact = compact;
    if (compact) {
      this.element.classList.add('jail-indicator-compact');
      this.element.classList.remove('jail-indicator-full');

      // 移除详细信息区域
      const infoArea = this.element.querySelector('.jail-info-area');
      if (infoArea) {
        infoArea.remove();
      }
    } else {
      this.element.classList.remove('jail-indicator-compact');
      this.element.classList.add('jail-indicator-full');

      // 添加详细信息区域（如果不存在）
      if (!this.element.querySelector('.jail-info-area')) {
        const infoArea = document.createElement('div');
        infoArea.className = 'jail-info-area';

        const turnsInfo = document.createElement('div');
        turnsInfo.className = 'jail-turns-info';
        turnsInfo.innerHTML = `<span class="jail-turns-label">剩余回合：</span><span class="jail-turns-value">0</span>`;
        infoArea.appendChild(turnsInfo);

        const creditInfo = document.createElement('div');
        creditInfo.className = 'jail-credit-info';
        creditInfo.innerHTML = `<span class="jail-credit-label">每次扣除：</span><span class="jail-credit-value">0</span>`;
        infoArea.appendChild(creditInfo);

        const cooldownInfo = document.createElement('div');
        cooldownInfo.className = 'jail-cooldown-info';
        cooldownInfo.innerHTML = `<span class="jail-cooldown-label">掷骰冷却：</span><span class="jail-cooldown-value">10秒</span>`;
        infoArea.appendChild(cooldownInfo);

        this.element.insertBefore(infoArea, this.element.querySelector('.jail-hint-area'));
      }
    }
  }

  /**
   * 更新剩余回合数（动画效果）
   */
  updateRemainingTurns(turns: number): void {
    if (!this.currentData) return;

    const turnsValue = this.element.querySelector('.jail-turns-value') as HTMLElement;
    if (turnsValue) {
      const oldTurns = parseInt(turnsValue.textContent ?? '0', 10);
      if (oldTurns !== turns) {
        // 触发动画
        turnsValue.classList.add('jail-turns-change');

        // 更新数值
        turnsValue.textContent = String(turns);

        // 移除动画类（延迟）
        setTimeout(() => {
          turnsValue.classList.remove('jail-turns-change');
        }, 500);
      }
    }

    this.currentData.remainingTurns = turns;
  }

  /**
   * 显示出狱动画
   */
  showReleaseAnimation(): void {
    this.element.classList.add('jail-releasing');

    // 显示出狱提示
    const hintArea = this.element.querySelector('.jail-hint-area') as HTMLElement;
    if (hintArea) {
      hintArea.textContent = '即将出狱！';
      hintArea.classList.add('jail-hint-success');
    }

    // 1秒后隐藏
    setTimeout(() => {
      this.hide();
      this.element.classList.remove('jail-releasing');
      if (hintArea) {
        hintArea.textContent = '监狱中无法收取租金';
        hintArea.classList.remove('jail-hint-success');
      }
    }, 1000);
  }

  /**
   * 添加到容器
   */
  appendTo(container: HTMLElement): void {
    container.appendChild(this.element);
  }

  /**
   * 从容器移除
   */
  remove(): void {
    this.element.remove();
  }

  /**
   * 销毁组件
   */
  destroy(): void {
    this.remove();
    this.currentData = null;
  }
}