/**
 * 其他玩家列表组件
 *
 * 显示其他玩家的简要信息：
 * - 玩家名称
 * - 当前位置（格子 ID）
 * - 状态指示
 * - 主要数值（可选）
 */

import type { PlayerStatus } from '@game/shared';
import type { OtherPlayerInfo } from '../hooks/usePlayerState.js';
import { StatusIndicator, createStatusIndicator } from './StatusIndicator.js';

/**
 * 玩家列表项配置
 */
export interface PlayerListItemConfig {
  /** 是否显示位置 */
  showPosition?: boolean;
  /** 是否显示状态 */
  showStatus?: boolean;
  /** 是否显示主要数值 */
  showPrimaryValue?: boolean;
  /** 位置标签 */
  positionLabel?: string;
}

/**
 * 玩家列表项
 */
class PlayerListItem {
  private container: HTMLElement;
  private nameElement: HTMLElement;
  private positionElement: HTMLElement | null = null;
  private statusIndicator: StatusIndicator | null = null;
  private valueElement: HTMLElement | null = null;
  private config: PlayerListItemConfig;
  private playerInfo: OtherPlayerInfo | null = null;

  constructor(config: PlayerListItemConfig = {}) {
    this.config = {
      showPosition: config.showPosition ?? true,
      showStatus: config.showStatus ?? true,
      showPrimaryValue: config.showPrimaryValue ?? false,
      positionLabel: config.positionLabel ?? '位置',
    };
    this.container = this.createContainer();
    this.nameElement = this.createNameElement();

    if (this.config.showPosition) {
      this.positionElement = this.createPositionElement();
    }

    if (this.config.showStatus) {
      this.statusIndicator = createStatusIndicator();
      this.statusIndicator.setCompact(true);
      this.container.appendChild(this.statusIndicator.getElement());
    }

    if (this.config.showPrimaryValue) {
      this.valueElement = this.createValueElement();
    }
  }

  /**
   * 创建容器
   */
  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'player-list-item';
    return container;
  }

  /**
   * 创建名称元素
   */
  private createNameElement(): HTMLElement {
    const name = document.createElement('span');
    name.className = 'player-list-name';
    this.container.appendChild(name);
    return name;
  }

  /**
   * 创建位置元素
   */
  private createPositionElement(): HTMLElement {
    const position = document.createElement('span');
    position.className = 'player-list-position';
    this.container.appendChild(position);
    return position;
  }

  /**
   * 创建数值元素
   */
  private createValueElement(): HTMLElement {
    const value = document.createElement('span');
    value.className = 'player-list-value';
    this.container.appendChild(value);
    return value;
  }

  /**
   * 获取 DOM 元素
   */
  getElement(): HTMLElement {
    return this.container;
  }

  /**
   * 更新玩家信息
   */
  update(info: OtherPlayerInfo): void {
    this.playerInfo = info;

    // 更新名称
    this.nameElement.textContent = info.username;

    // 更新位置
    if (this.positionElement) {
      this.positionElement.textContent = `${this.config.positionLabel}: ${info.position.cellId}`;
    }

    // 更新状态
    if (this.statusIndicator) {
      this.statusIndicator.update(info.status);
    }

    // 更新数值
    if (this.valueElement && info.primaryValue !== undefined) {
      this.valueElement.textContent = `$${info.primaryValue}`;
    }
  }

  /**
   * 获取玩家信息
   */
  getPlayerInfo(): OtherPlayerInfo | null {
    return this.playerInfo;
  }

  /**
   * 销毁
   */
  destroy(): void {
    if (this.statusIndicator) {
      this.statusIndicator.destroy();
    }
    this.container.remove();
  }
}

/**
 * 其他玩家列表组件
 */
export class PlayerList {
  private container: HTMLElement;
  private titleElement: HTMLElement;
  private listContainer: HTMLElement;
  private items: Map<string, PlayerListItem> = new Map();
  private config: PlayerListItemConfig;

  constructor(title: string = '其他玩家', config: PlayerListItemConfig = {}) {
    this.config = config;
    this.container = this.createContainer();
    this.titleElement = this.createTitleElement(title);
    this.listContainer = this.createListContainer();
  }

  /**
   * 创建容器
   */
  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'player-list';
    return container;
  }

  /**
   * 创建标题元素
   */
  private createTitleElement(title: string): HTMLElement {
    const titleEl = document.createElement('div');
    titleEl.className = 'player-list-title';
    titleEl.textContent = title;
    this.container.appendChild(titleEl);
    return titleEl;
  }

  /**
   * 创建列表容器
   */
  private createListContainer(): HTMLElement {
    const list = document.createElement('div');
    list.className = 'player-list-items';
    this.container.appendChild(list);
    return list;
  }

  /**
   * 获取 DOM 元素
   */
  getElement(): HTMLElement {
    return this.container;
  }

  /**
   * 更新玩家列表
   */
  update(players: OtherPlayerInfo[]): void {
    // 移除已离开的玩家
    const currentIds = new Set(players.map(p => p.id));
    for (const [id, item] of this.items) {
      if (!currentIds.has(id)) {
        item.destroy();
        this.items.delete(id);
      }
    }

    // 更新或添加玩家
    for (const player of players) {
      if (this.items.has(player.id)) {
        this.items.get(player.id)!.update(player);
      } else {
        const item = new PlayerListItem(this.config);
        item.update(player);
        this.items.set(player.id, item);
        this.listContainer.appendChild(item.getElement());
      }
    }

    // 排序（按位置或名称）
    this.sortItems();
  }

  /**
   * 排序列表项
   */
  private sortItems(): void {
    const sortedItems = Array.from(this.items.values())
      .sort((a, b) => {
        const aInfo = a.getPlayerInfo();
        const bInfo = b.getPlayerInfo();
        if (!aInfo || !bInfo) return 0;
        return aInfo.position.cellId - bInfo.position.cellId;
      });

    // 重新排列 DOM
    for (const item of sortedItems) {
      this.listContainer.appendChild(item.getElement());
    }
  }

  /**
   * 设置标题
   */
  setTitle(title: string): void {
    this.titleElement.textContent = title;
  }

  /**
   * 获取玩家数量
   */
  getPlayerCount(): number {
    return this.items.size;
  }

  /**
   * 清空列表
   */
  clear(): void {
    for (const item of this.items.values()) {
      item.destroy();
    }
    this.items.clear();
  }

  /**
   * 销毁组件
   */
  destroy(): void {
    this.clear();
    this.container.remove();
  }
}

/**
 * 创建玩家列表组件
 */
export function createPlayerList(title?: string, config?: PlayerListItemConfig): PlayerList {
  return new PlayerList(title, config);
}