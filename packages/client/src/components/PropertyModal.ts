/**
 * 地产购买弹窗
 *
 * 负责：
 * - 显示地产购买信息（价格、名称、租金等）
 * - 确认/取消按钮
 * - 与后端 Socket 通信
 *
 * 设计原则：
 * - 弹窗样式简洁，不遮挡主要游戏区域
 * - 显示价格、租金、等级上限等信息
 * - 支持合租购买（显示已有人持股信息）
 */

import type { Cell, AckResult } from '@game/shared';
import { getExtra } from '@game/shared';
import type { Socket } from 'socket.io-client';

/**
 * 弹窗配置
 */
export interface PropertyModalConfig {
  /** 格子数据 */
  cell: Cell;
  /** Socket 连接 */
  socket: Socket;
  /** 玩家当前财产 */
  playerMoney: number;
  /** 容器元素 */
  container: HTMLElement;
  /** 关闭回调 */
  onClose?: () => void;
  /** 成功回调 */
  onSuccess?: (cell: Cell) => void;
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
  padding: '20px',
  minWidth: '300px',
  maxWidth: '400px',
  zIndex: '100',
  color: '#f3f4f6',
  fontFamily: 'sans-serif',
};

const BUTTON_STYLE = {
  padding: '10px 20px',
  borderRadius: '8px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  transition: 'all 0.2s',
};

const BUY_BUTTON_STYLE = {
  ...BUTTON_STYLE,
  backgroundColor: '#10b981',
  color: '#ffffff',
  border: 'none',
};

const CANCEL_BUTTON_STYLE = {
  ...BUTTON_STYLE,
  backgroundColor: '#6b7280',
  color: '#ffffff',
  border: 'none',
};

/**
 * 地产购买弹窗
 */
export class PropertyModal {
  private config: PropertyModalConfig;
  private modalElement: HTMLElement | null = null;

  constructor(config: PropertyModalConfig) {
    this.config = config;
  }

  /**
   * 显示弹窗
   */
  show(): void {
    this.modalElement = this.createModal();
    this.config.container.appendChild(this.modalElement);
  }

  /**
   * 关闭弹窗
   */
  close(): void {
    if (this.modalElement) {
      this.config.container.removeChild(this.modalElement);
      this.modalElement = null;
      this.config.onClose?.();
    }
  }

  /**
   * 创建弹窗元素
   */
  private createModal(): HTMLElement {
    const modal = document.createElement('div');
    Object.assign(modal.style, MODAL_STYLE);

    const cell = this.config.cell;
    const name = getExtra<string>(cell, 'name', '未命名地产');
    const basePrice = getExtra<number>(cell, 'price', 0);
    const level = getExtra<number>(cell, 'level', 0);
    const upgradeCosts = getExtra<number[]>(cell, 'upgradeCost', []);
    const accumulatedValue = getExtra<number>(cell, 'accumulatedValue', basePrice + upgradeCosts.slice(0, level).reduce((sum, cost) => sum + cost, 0));
    const price = (getExtra<{ playerId: string; share: number; purchasePrice: number }[]>(cell, 'ownerships', []) ?? []).length > 0
      ? accumulatedValue
      : basePrice;
    const rentArray = getExtra<number[]>(cell, 'rent', []);
    const maxLevel = upgradeCosts.length;

    // 弹窗标题
    const title = document.createElement('h3');
    title.textContent = '购买地产';
    title.style.marginBottom = '16px';
    title.style.color = '#60a5fa';
    modal.appendChild(title);

    // 地产名称
    const nameEl = document.createElement('p');
    nameEl.innerHTML = `<strong>名称：</strong>${name}`;
    nameEl.style.marginBottom = '8px';
    modal.appendChild(nameEl);

    // 价格
    const priceEl = document.createElement('p');
    priceEl.innerHTML = `<strong>价格：</strong><span style="color: #fbbf24">${price}</span>`;
    priceEl.style.marginBottom = '8px';
    modal.appendChild(priceEl);

    // 当前租金（等级0）
    const rentEl = document.createElement('p');
    const currentRent = rentArray[0] ?? 0;
    rentEl.innerHTML = `<strong>租金：</strong><span style="color: #10b981">${currentRent}</span>`;
    rentEl.style.marginBottom = '8px';
    modal.appendChild(rentEl);

    // 等级上限
    if (maxLevel > 0) {
      const maxLevelEl = document.createElement('p');
      maxLevelEl.innerHTML = `<strong>可升级：</strong>最高 ${maxLevel} 级`;
      maxLevelEl.style.marginBottom = '8px';
      modal.appendChild(maxLevelEl);
    }

    // 合租信息（如果有）
    const ownerships = getExtra<{ playerId: string; share: number }[]>(cell, 'ownerships', []) ?? [];
    if (ownerships.length > 0) {
      const coownerEl = document.createElement('p');
      coownerEl.innerHTML = `<strong>合租：</strong>${ownerships.length} 人持有`;
      coownerEl.style.marginBottom = '8px';
      coownerEl.style.color = '#9ca3af';
      modal.appendChild(coownerEl);

      // 显示持股比例
      for (const ownership of ownerships) {
        const shareEl = document.createElement('p');
        shareEl.innerHTML = `玩家 ${ownership.playerId.slice(0, 8)}...：${Math.round(ownership.share * 100)}%`;
        shareEl.style.marginBottom = '4px';
        shareEl.style.fontSize = '12px';
        shareEl.style.color = '#d1d5db';
        modal.appendChild(shareEl);
      }
    }

    // 检查财产是否足够
    const canBuy = this.config.playerMoney >= price;
    if (!canBuy) {
      const warningEl = document.createElement('p');
      warningEl.textContent = `⚠️ 财产不足！你需要 ${price}，当前只有 ${this.config.playerMoney}`;
      warningEl.style.color = '#ef4444';
      warningEl.style.marginTop = '12px';
      warningEl.style.marginBottom = '12px';
      modal.appendChild(warningEl);
    }

    // 按钮容器
    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'space-between';
    buttonContainer.style.marginTop = '16px';
    modal.appendChild(buttonContainer);

    // 购买按钮
    const buyButton = document.createElement('button');
    buyButton.textContent = '购买';
    Object.assign(buyButton.style, BUY_BUTTON_STYLE);
    buyButton.disabled = !canBuy;
    if (!canBuy) {
      buyButton.style.opacity = '0.5';
      buyButton.style.cursor = 'not-allowed';
    }
    buyButton.onclick = () => this.handleBuy();
    buttonContainer.appendChild(buyButton);

    // 取消按钮
    const cancelButton = document.createElement('button');
    cancelButton.textContent = '取消';
    Object.assign(cancelButton.style, CANCEL_BUTTON_STYLE);
    cancelButton.onclick = () => this.close();
    buttonContainer.appendChild(cancelButton);

    return modal;
  }

  /**
   * 处理购买
   */
  private handleBuy(): void {
    this.config.socket.emit(
      'client.buyProperty',
      { cellId: this.config.cell.id },
      (result: AckResult<{ cell: Cell }>) => {
        if (result.ok) {
          this.config.onSuccess?.(result.data!.cell);
          this.close();
        } else {
          // 显示错误消息
          this.showError(result.error ?? '购买失败');
        }
      },
    );
  }

  /**
   * 显示错误消息
   */
  private showError(message: string): void {
    if (!this.modalElement) return;

    const errorEl = document.createElement('p');
    errorEl.textContent = `❌ ${message}`;
    errorEl.style.color = '#ef4444';
    errorEl.style.marginTop = '12px';
    this.modalElement.appendChild(errorEl);

    // 3秒后自动消失
    setTimeout(() => {
      if (errorEl.parentNode) {
        errorEl.parentNode.removeChild(errorEl);
      }
    }, 3000);
  }

  /**
   * 是否正在显示
   */
  isShowing(): boolean {
    return this.modalElement !== null;
  }
}

/**
 * 创建地产购买弹窗
 */
export function createPropertyModal(config: PropertyModalConfig): PropertyModal {
  return new PropertyModal(config);
}