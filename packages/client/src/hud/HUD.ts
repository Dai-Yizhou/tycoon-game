/**
 * HUD 主控制器
 *
 * 整合所有 HUD 组件：
 * - 当前玩家数值显示（动态字段）
 * - 玩家状态指示器
 * - 其他玩家列表
 * - 数值变化动画
 */

import type { Player, ValueField, TypedClientSocket } from '@game/shared';
import type { PlayerStateManager, OtherPlayerInfo, ValueChangeListener } from '../hooks/usePlayerState.js';
import { ValueDisplay, createValueDisplay } from './ValueDisplay.js';
import { StatusIndicator, createStatusIndicator } from './StatusIndicator.js';
import { PlayerList, createPlayerList } from './PlayerList.js';

/**
 * HUD 配置
 */
export interface HUDConfig {
  /** HUD 位置 */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** 是否显示其他玩家列表 */
  showOtherPlayers?: boolean;
  /** 其他玩家列表标题 */
  otherPlayersTitle?: string;
  /** 数值字段图标映射 */
  fieldIcons?: Record<string, string>;
}

/**
 * 字段优先级（用于排序显示）
 */
const FIELD_PRIORITY: Record<string, number> = {
  money: 0,
  credit: 1,
  environment: 2,
  reputation: 3,
};

/**
 * HUD 主控制器
 */
export class HUD {
  private container: HTMLElement;
  private playerSection: HTMLElement;
  private playerNameElement: HTMLElement;
  private statusIndicator: StatusIndicator;
  private valuesContainer: HTMLElement;
  private valueDisplays: Map<string, ValueDisplay> = new Map();
  private otherPlayersSection: HTMLElement | null = null;
  private playerList: PlayerList | null = null;
  private stateManager: PlayerStateManager | null = null;
  private config: HUDConfig;
  private valueChangeListener: ValueChangeListener | null = null;

  constructor(config: HUDConfig = {}) {
    this.config = {
      position: config.position ?? 'top-left',
      showOtherPlayers: config.showOtherPlayers ?? true,
      otherPlayersTitle: config.otherPlayersTitle ?? '其他玩家',
      fieldIcons: config.fieldIcons ?? {
        money: '💰',
        credit: '💎',
        environment: '🌿',
        reputation: '⭐',
      },
    };

    this.container = this.createContainer();
    this.playerSection = this.createPlayerSection();
    this.playerNameElement = this.createPlayerNameElement();
    this.statusIndicator = createStatusIndicator();
    this.valuesContainer = this.createValuesContainer();

    // 添加状态指示器
    this.playerSection.appendChild(this.statusIndicator.getElement());

    // 创建其他玩家列表（如果启用）
    if (this.config.showOtherPlayers) {
      this.otherPlayersSection = this.createOtherPlayersSection();
      this.playerList = createPlayerList(this.config.otherPlayersTitle, {
        showPosition: true,
        showStatus: true,
        showPrimaryValue: true,
      });
      this.otherPlayersSection.appendChild(this.playerList.getElement());
    }
  }

  /**
   * 创建 HUD 容器
   */
  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = `hud hud-${this.config.position}`;
    return container;
  }

  /**
   * 创建玩家信息区域
   */
  private createPlayerSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'hud-player-section';
    this.container.appendChild(section);
    return section;
  }

  /**
   * 创建玩家名称元素
   */
  private createPlayerNameElement(): HTMLElement {
    const nameEl = document.createElement('div');
    nameEl.className = 'hud-player-name';
    this.playerSection.appendChild(nameEl);
    return nameEl;
  }

  /**
   * 创建数值字段容器
   */
  private createValuesContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'hud-values-container';
    this.playerSection.appendChild(container);
    return container;
  }

  /**
   * 创建其他玩家区域
   */
  private createOtherPlayersSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'hud-other-players-section';
    this.container.appendChild(section);
    return section;
  }

  /**
   * 获取 DOM 元素
   */
  getElement(): HTMLElement {
    return this.container;
  }

  /**
   * 绑定玩家状态管理器
   */
  bindStateManager(manager: PlayerStateManager): void {
    this.stateManager = manager;

    // 监听状态变化
    this.stateManager.addStateListener((state) => {
      this.updateFromState(state);
    });

    // 监听数值变化（用于动画）
    this.valueChangeListener = (payload) => {
      this.handleValueChange(payload);
    };
    this.stateManager.addValueListener(this.valueChangeListener);

    // 监听其他玩家变化
    if (this.playerList) {
      this.stateManager.addOtherPlayersListener((players) => {
        this.playerList!.update(players);
      });
    }

    // 初始化显示
    this.updateFromState(manager.getState());
    if (this.playerList) {
      this.playerList.update(manager.getOtherPlayers());
    }
  }

  /**
   * 解绑状态管理器
   */
  unbindStateManager(): void {
    if (this.stateManager) {
      if (this.valueChangeListener) {
        this.stateManager.removeValueListener(this.valueChangeListener);
        this.valueChangeListener = null;
      }
      this.stateManager = null;
    }
  }

  /**
   * 从状态更新显示
   */
  private updateFromState(state: { player: Player | null; valueFieldDefinitions: ValueField[] }): void {
    if (!state.player) {
      this.container.classList.add('hud-loading');
      return;
    }

    this.container.classList.remove('hud-loading');

    // 更新玩家名称
    this.playerNameElement.textContent = state.player.username;

    // 更新状态指示器
    this.statusIndicator.update(state.player.status);

    // 动态渲染数值字段
    this.updateValueDisplays(state.player.values, state.valueFieldDefinitions);
  }

  /**
   * 更新数值显示组件
   */
  private updateValueDisplays(values: Record<string, ValueField>, definitions: ValueField[]): void {
    // 使用定义的字段列表（确保按定义顺序显示）
    const enabledFieldIds = definitions.map(d => d.id);

    // 移除不再启用的字段
    for (const [fieldId, display] of this.valueDisplays) {
      if (!enabledFieldIds.includes(fieldId)) {
        display.destroy();
        this.valueDisplays.delete(fieldId);
      }
    }

    // 添加或更新字段
    for (const fieldId of enabledFieldIds) {
      const field = values[fieldId];
      if (!field) continue;

      if (!this.valueDisplays.has(fieldId)) {
        // 创建新的显示组件
        const display = createValueDisplay({
          fieldId,
          showIcon: true,
          icon: this.config.fieldIcons?.[fieldId],
        });
        this.valueDisplays.set(fieldId, display);
        this.valuesContainer.appendChild(display.getElement());
      }

      // 更新数值
      this.valueDisplays.get(fieldId)!.update(field);
    }

    // 按优先级排序
    this.sortValueDisplays();
  }

  /**
   * 排序数值显示
   */
  private sortValueDisplays(): void {
    const sortedDisplays = Array.from(this.valueDisplays.entries())
      .sort(([aId], [bId]) => {
        const aPriority = FIELD_PRIORITY[aId] ?? 100;
        const bPriority = FIELD_PRIORITY[bId] ?? 100;
        return aPriority - bPriority;
      });

    // 重新排列 DOM
    for (const [, display] of sortedDisplays) {
      this.valuesContainer.appendChild(display.getElement());
    }
  }

  /**
   * 处理数值变化（触发动画）
   */
  private handleValueChange(payload: { fieldId: string; current: number; oldValue: number }): void {
    const display = this.valueDisplays.get(payload.fieldId);
    if (display) {
      display.showChangeAnimation(payload.oldValue, payload.current);
    }
  }

  /**
   * 手动更新玩家信息（用于测试或调试）
   */
  setPlayer(player: Player): void {
    this.playerNameElement.textContent = player.username;
    this.statusIndicator.update(player.status);

    for (const [fieldId, field] of Object.entries(player.values)) {
      const display = this.valueDisplays.get(fieldId);
      if (display) {
        display.update(field);
      }
    }
  }

  /**
   * 手动更新其他玩家列表
   */
  setOtherPlayers(players: OtherPlayerInfo[]): void {
    if (this.playerList) {
      this.playerList.update(players);
    }
  }

  /**
   * 显示 HUD
   */
  show(): void {
    this.container.style.display = 'flex';
  }

  /**
   * 隐藏 HUD
   */
  hide(): void {
    this.container.style.display = 'none';
  }

  /**
   * 清理 HUD
   */
  reset(): void {
    // 清空数值显示
    for (const display of this.valueDisplays.values()) {
      display.destroy();
    }
    this.valueDisplays.clear();

    // 清空玩家列表
    if (this.playerList) {
      this.playerList.clear();
    }

    // 重置状态
    this.playerNameElement.textContent = '';
    this.statusIndicator.update('normal');

    this.unbindStateManager();
  }

  /**
   * 销毁 HUD
   */
  destroy(): void {
    this.reset();
    this.statusIndicator.destroy();
    if (this.playerList) {
      this.playerList.destroy();
    }
    this.container.remove();
  }
}

/**
 * 创建 HUD
 */
export function createHUD(config?: HUDConfig): HUD {
  return new HUD(config);
}