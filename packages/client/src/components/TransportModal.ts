/**
 * 交通枢纽传送选择弹窗
 *
 * 负责：
 * - 显示交通枢纽传送信息（费用、目的地列表）
 * - 目的地选择
 * - 传送操作
 * - 与后端 Socket 通信
 *
 * 设计原则：
 * - 弹窗样式简洁，不遮挡主要游戏区域
 * - 显示费用、目的地信息
 * - 支持目的地选择
 * - 交通枢纽状态标识
 */

import type { Cell, AckResult } from '@game/shared';
import { getExtra } from '@game/shared';
import type { Socket } from 'socket.io-client';

/**
 * 弹窗配置
 */
export interface TransportModalConfig {
  /** 交通枢纽格子数据 */
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
  onSuccess?: (result: { fromCellId: number; toCellId: number; cost: number }) => void;
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
  maxWidth: '450px',
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
  marginBottom: '8px',
};

const TRANSPORT_BUTTON_STYLE = {
  ...BUTTON_STYLE,
  backgroundColor: '#3b82f6',
  color: '#ffffff',
  border: 'none',
  width: '100%',
};

const CANCEL_BUTTON_STYLE = {
  ...BUTTON_STYLE,
  backgroundColor: '#6b7280',
  color: '#ffffff',
  border: 'none',
};

const TRANSPORT_ICON = '🚉';
const SUCCESS_COLOR = '#10b981';
const ERROR_COLOR = '#ef4444';

/**
 * 交通枢纽传送选择弹窗
 */
export class TransportModal {
  private config: TransportModalConfig;
  private modalElement: HTMLElement | null = null;
  private destinations: Array<{ cellId: number; name: string; cost: number }> = [];

  constructor(config: TransportModalConfig) {
    this.config = config;
    this.fetchDestinations();
  }

  /**
   * 获取交通枢纽目的地列表
   */
  private fetchDestinations(): void {
    this.config.socket.emit(
      'client.getTransportDestinations',
      { hubCellId: this.config.cell.id },
      (result: AckResult<{ destinations: Array<{ cellId: number; name: string; cost: number }> }>) => {
        if (result.ok && result.data) {
          this.destinations = result.data.destinations;
          if (this.modalElement) {
            this.updateDestinationList();
          }
        }
      },
    );
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
    const name = getExtra<string>(cell, 'name', '未命名交通枢纽');
    const cost = getExtra<number>(cell, 'transportCost', 50);

    // 弹窗标题
    const title = document.createElement('h3');
    title.textContent = `${TRANSPORT_ICON} 交通枢纽传送`;
    title.style.marginBottom = '16px';
    title.style.color = '#60a5fa';
    title.style.fontSize = '18px';
    modal.appendChild(title);

    // 交通枢纽名称
    const nameEl = document.createElement('p');
    nameEl.innerHTML = `<strong>枢纽名称：</strong>${name}`;
    nameEl.style.marginBottom = '8px';
    modal.appendChild(nameEl);

    // 传送费用
    const costEl = document.createElement('p');
    costEl.innerHTML = `<strong>传送费用：</strong><span style="color: #fbbf24">${cost}</span>`;
    costEl.style.marginBottom = '12px';
    modal.appendChild(costEl);

    // 目的地列表标题
    const destTitle = document.createElement('p');
    destTitle.innerHTML = `<strong>可用目的地：</strong>`;
    destTitle.style.marginBottom = '8px';
    modal.appendChild(destTitle);

    // 目的地列表容器
    const destContainer = document.createElement('div');
    destContainer.id = 'destination-list';
    destContainer.style.marginBottom = '16px';
    modal.appendChild(destContainer);

    // 检查财产是否足够
    const canTransport = this.config.playerMoney >= cost;
    if (!canTransport) {
      const warningEl = document.createElement('p');
      warningEl.textContent = `⚠️ 财产不足！你需要 ${cost}，当前只有 ${this.config.playerMoney}`;
      warningEl.style.color = ERROR_COLOR;
      warningEl.style.marginTop = '12px';
      warningEl.style.marginBottom = '12px';
      modal.appendChild(warningEl);
    }

    // 传送说明
    const infoEl = document.createElement('p');
    infoEl.innerHTML = `<strong>传送说明：</strong>选择目的地后立即传送，传送费用从财产中扣除`;
    infoEl.style.marginBottom = '12px';
    infoEl.style.fontSize = '12px';
    infoEl.style.color = '#9ca3af';
    infoEl.style.lineHeight = '1.5';
    modal.appendChild(infoEl);

    // 取消按钮
    const cancelButton = document.createElement('button');
    cancelButton.textContent = '取消';
    Object.assign(cancelButton.style, CANCEL_BUTTON_STYLE);
    cancelButton.onclick = () => this.close();
    modal.appendChild(cancelButton);

    return modal;
  }

  /**
   * 更新目的地列表
   */
  private updateDestinationList(): void {
    const destContainer = this.modalElement?.querySelector('#destination-list');
    if (!destContainer) return;

    // 清空现有列表
    destContainer.innerHTML = '';

    if (this.destinations.length === 0) {
      const noDestEl = document.createElement('p');
      noDestEl.textContent = '暂无可用目的地';
      noDestEl.style.color = '#9ca3af';
      noDestEl.style.fontSize = '12px';
      destContainer.appendChild(noDestEl);
      return;
    }

    const cost = getExtra<number>(this.config.cell, 'transportCost', 50);
    const canTransport = this.config.playerMoney >= cost;

    // 添加每个目的地按钮
    for (const dest of this.destinations) {
      const destButton = document.createElement('button');
      destButton.innerHTML = `📍 ${dest.name} <span style="color: #fbbf24; font-size: 12px;">(费用: ${dest.cost})</span>`;
      Object.assign(destButton.style, TRANSPORT_BUTTON_STYLE);
      destButton.disabled = !canTransport;
      if (!canTransport) {
        destButton.style.opacity = '0.5';
        destButton.style.cursor = 'not-allowed';
      }
      destButton.onclick = () => this.handleTransport(dest.cellId);
      destContainer.appendChild(destButton);
    }
  }

  /**
   * 处理传送
   */
  private handleTransport(targetCellId: number): void {
    this.config.socket.emit(
      'client.useTransport',
      { hubCellId: this.config.cell.id, targetCellId },
      (result: AckResult<{ playerId: string; fromCellId: number; toCellId: number; cost: number; cell: Cell }>) => {
        if (result.ok && result.data) {
          this.config.onSuccess?.({
            fromCellId: result.data.fromCellId,
            toCellId: result.data.toCellId,
            cost: result.data.cost,
          });
          this.close();
        } else {
          // 显示错误消息
          this.showError(result.error ?? '传送失败');
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
    errorEl.style.color = ERROR_COLOR;
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
 * 创建交通枢纽传送选择弹窗
 */
export function createTransportModal(config: TransportModalConfig): TransportModal {
  return new TransportModal(config);
}