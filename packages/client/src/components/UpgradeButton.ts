/**
 * 地产升级按钮
 *
 * 负责：
 * - 显示升级按钮（费用、等级信息）
 * - 点击触发升级请求
 * - 与后端 Socket 通信
 *
 * 设计原则：
 * - 按钮显示当前等级、升级费用、等级上限
 * - 财产不足时按钮禁用
 * - 满级后按钮隐藏或显示已满级标识
 */

import type { Cell, AckResult } from '@game/shared';
import { getExtra } from '@game/shared';
import type { Socket } from 'socket.io-client';

/**
 * 升级按钮配置
 */
export interface UpgradeButtonConfig {
  /** 格子数据 */
  cell: Cell;
  /** Socket 连接 */
  socket: Socket;
  /** 玩家当前财产 */
  playerMoney: number;
  /** 容器元素 */
  container: HTMLElement;
  /** 成功回调 */
  onSuccess?: (cell: Cell, cost: number) => void;
  /** 失败回调 */
  onError?: (error: string) => void;
}

/**
 * 升级按钮样式配置
 */
const BUTTON_STYLE = {
  padding: '6px 12px',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: 'bold',
  transition: 'all 0.2s',
  border: 'none',
};

const ENABLED_STYLE = {
  ...BUTTON_STYLE,
  backgroundColor: '#fbbf24',
  color: '#1f2937',
};

const DISABLED_STYLE = {
  ...BUTTON_STYLE,
  backgroundColor: '#6b7280',
  color: '#ffffff',
  cursor: 'not-allowed',
  opacity: '0.5',
};

const MAX_LEVEL_STYLE = {
  ...BUTTON_STYLE,
  backgroundColor: '#10b981',
  color: '#ffffff',
  cursor: 'default',
};

/**
 * 地产升级按钮
 */
export class UpgradeButton {
  private config: UpgradeButtonConfig;
  private buttonElement: HTMLElement | null = null;

  constructor(config: UpgradeButtonConfig) {
    this.config = config;
  }

  /**
   * 渲染按钮
   */
  render(): HTMLElement {
    this.buttonElement = this.createButton();
    return this.buttonElement;
  }

  /**
   * 更新按钮状态（重新渲染）
   */
  update(cell: Cell, playerMoney: number): void {
    this.config.cell = cell;
    this.config.playerMoney = playerMoney;

    if (this.buttonElement && this.buttonElement.parentNode) {
      const newButton = this.createButton();
      this.buttonElement.parentNode.replaceChild(newButton, this.buttonElement);
      this.buttonElement = newButton;
    }
  }

  /**
   * 移除按钮
   */
  remove(): void {
    if (this.buttonElement && this.buttonElement.parentNode) {
      this.buttonElement.parentNode.removeChild(this.buttonElement);
      this.buttonElement = null;
    }
  }

  /**
   * 创建按钮元素
   */
  private createButton(): HTMLElement {
    const cell = this.config.cell;
    const level = getExtra<number>(cell, 'level', 0);
    const upgradeCosts = getExtra<number[]>(cell, 'upgradeCost', []);
    const maxLevel = upgradeCosts.length;

    // 创建按钮容器
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.marginTop = '8px';

    // 显示当前等级
    const levelLabel = document.createElement('div');
    levelLabel.style.fontSize = '10px';
    levelLabel.style.color = '#9ca3af';
    levelLabel.textContent = `当前等级: ${level}`;
    container.appendChild(levelLabel);

    // 创建升级按钮
    const button = document.createElement('button');

    if (level >= maxLevel) {
      // 已满级
      Object.assign(button.style, MAX_LEVEL_STYLE);
      button.textContent = `已满级 (${level})`;
      button.disabled = true;
    } else {
      const upgradeCost = upgradeCosts[level];
      const canUpgrade = this.config.playerMoney >= upgradeCost;

      if (canUpgrade) {
        Object.assign(button.style, ENABLED_STYLE);
        button.textContent = `升级 Lv.${level + 1} (${upgradeCost})`;
        button.onclick = () => this.handleUpgrade(upgradeCost);
      } else {
        Object.assign(button.style, DISABLED_STYLE);
        button.textContent = `升级 Lv.${level + 1} (${upgradeCost})`;
        button.disabled = true;
        button.title = `财产不足！需要 ${upgradeCost}，当前 ${this.config.playerMoney}`;
      }
    }

    container.appendChild(button);

    // 显示升级费用提示（如果可升级）
    if (level < maxLevel) {
      const costHint = document.createElement('div');
      costHint.style.fontSize = '10px';
      costHint.style.color = '#d1d5db';
      costHint.style.marginTop = '4px';
      costHint.textContent = `升级费用: ${upgradeCosts[level]}`;
      container.appendChild(costHint);
    }

    return container;
  }

  /**
   * 处理升级
   */
  private handleUpgrade(expectedCost: number): void {
    this.config.socket.emit(
      'client.upgradeProperty',
      { cellId: this.config.cell.id },
      (result: AckResult<{ cell: Cell; cost: number }>) => {
        if (result.ok) {
          const actualCost = result.data!.cost;
          this.config.onSuccess?.(result.data!.cell, actualCost);
        } else {
          this.config.onError?.(result.error ?? '升级失败');
        }
      },
    );
  }

  /**
   * 显示错误提示
   */
  showError(message: string): void {
    if (!this.buttonElement) return;

    const errorEl = document.createElement('div');
    errorEl.textContent = `❌ ${message}`;
    errorEl.style.color = '#ef4444';
    errorEl.style.fontSize = '12px';
    errorEl.style.marginTop = '8px';
    this.buttonElement.appendChild(errorEl);

    // 3秒后自动消失
    setTimeout(() => {
      if (errorEl.parentNode) {
        errorEl.parentNode.removeChild(errorEl);
      }
    }, 3000);
  }

  /**
   * 显示成功提示
   */
  showSuccess(message: string): void {
    if (!this.buttonElement) return;

    const successEl = document.createElement('div');
    successEl.textContent = `✅ ${message}`;
    successEl.style.color = '#10b981';
    successEl.style.fontSize = '12px';
    successEl.style.marginTop = '8px';
    this.buttonElement.appendChild(successEl);

    // 2秒后自动消失
    setTimeout(() => {
      if (successEl.parentNode) {
        successEl.parentNode.removeChild(successEl);
      }
    }, 2000);
  }
}

/**
 * 创建升级按钮
 */
export function createUpgradeButton(config: UpgradeButtonConfig): UpgradeButton {
  return new UpgradeButton(config);
}