/**
 * 天赋选择面板
 *
 * 负责：
 * - 显示天赋列表（可学习、已学习）
 * - 天赋详情展示（名称、描述、消耗、效果）
 * - 学习/取消天赋按钮
 * - 启用/禁用天赋开关
 * - 与后端 Socket 通信
 *
 * 设计原则：
 * - 面板样式简洁，易于理解
 * - 显示天赋值、消耗、效果等信息
 * - 支持天赋分类显示（视野、字段开关、机制开关）
 */

import type { AckResult, PlayerTalent, TalentDefinition } from '@game/shared';
import type { Socket } from 'socket.io-client';

/**
 * 面板配置
 */
export interface TalentPanelConfig {
  /** Socket 连接 */
  socket: Socket;
  /** 容器元素 */
  container: HTMLElement;
  /** 关闭回调 */
  onClose?: () => void;
  /** 学习成功回调 */
  onTalentLearned?: (talentId: string) => void;
  /** 取消成功回调 */
  onTalentUnlearned?: (talentId: string) => void;
}

/**
 * 面板样式配置
 */
const PANEL_STYLE = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  backgroundColor: '#1f2937',
  border: '2px solid #374151',
  borderRadius: '12px',
  padding: '20px',
  minWidth: '500px',
  maxWidth: '700px',
  maxHeight: '80vh',
  overflowY: 'auto',
  zIndex: '100',
  color: '#f3f4f6',
  fontFamily: 'sans-serif',
};

const BUTTON_STYLE = {
  padding: '8px 16px',
  borderRadius: '8px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  transition: 'all 0.2s',
};

const LEARN_BUTTON_STYLE = {
  ...BUTTON_STYLE,
  backgroundColor: '#10b981',
  color: '#ffffff',
  border: 'none',
};

const UNLEARN_BUTTON_STYLE = {
  ...BUTTON_STYLE,
  backgroundColor: '#ef4444',
  color: '#ffffff',
  border: 'none',
};

const CLOSE_BUTTON_STYLE = {
  ...BUTTON_STYLE,
  backgroundColor: '#6b7280',
  color: '#ffffff',
  border: 'none',
};

const TALENT_CARD_STYLE = {
  backgroundColor: '#374151',
  border: '1px solid #4b5563',
  borderRadius: '8px',
  padding: '12px',
  marginBottom: '8px',
};

/**
 * 天赋选择面板
 */
export class TalentPanel {
  private config: TalentPanelConfig;
  private panelElement: HTMLElement | null = null;
  private availableTalents: TalentDefinition[] = [];
  private learnedTalents: PlayerTalent[] = [];
  private talentPoints: number = 0;

  constructor(config: TalentPanelConfig) {
    this.config = config;
  }

  /**
   * 显示面板
   */
  async show(): Promise<void> {
    // 先获取天赋信息
    await this.fetchTalentInfo();

    this.panelElement = this.createPanel();
    this.config.container.appendChild(this.panelElement);
  }

  /**
   * 关闭面板
   */
  close(): void {
    if (this.panelElement) {
      this.config.container.removeChild(this.panelElement);
      this.panelElement = null;
      this.config.onClose?.();
    }
  }

  /**
   * 获取天赋信息
   */
  private async fetchTalentInfo(): Promise<void> {
    return new Promise((resolve) => {
      this.config.socket.emit('client.getTalentInfo', {}, (result: AckResult<{
        availableTalents: TalentDefinition[];
        learnedTalents: PlayerTalent[];
        talentPoints: number;
      }>) => {
        if (result.ok) {
          this.availableTalents = result.data!.availableTalents;
          this.learnedTalents = result.data!.learnedTalents;
          this.talentPoints = result.data!.talentPoints;
        }
        resolve();
      });
    });
  }

  /**
   * 创建面板元素
   */
  private createPanel(): HTMLElement {
    const panel = document.createElement('div');
    Object.assign(panel.style, PANEL_STYLE);

    // 标题
    const title = document.createElement('h2');
    title.textContent = '天赋系统';
    title.style.marginBottom = '16px';
    title.style.color = '#60a5fa';
    title.style.textAlign = 'center';
    panel.appendChild(title);

    // 天赋值显示
    const pointsEl = document.createElement('p');
    pointsEl.innerHTML = `<strong>当前天赋值：</strong><span style="color: #fbbf24">${this.talentPoints}</span>`;
    pointsEl.style.marginBottom = '16px';
    pointsEl.style.textAlign = 'center';
    panel.appendChild(pointsEl);

    // 分组显示天赋
    this.createTalentGroups(panel);

    // 关闭按钮
    const closeButton = document.createElement('button');
    closeButton.textContent = '关闭';
    Object.assign(closeButton.style, CLOSE_BUTTON_STYLE);
    closeButton.style.marginTop = '16px';
    closeButton.style.width = '100%';
    closeButton.onclick = () => this.close();
    panel.appendChild(closeButton);

    return panel;
  }

  /**
   * 创建天赋分组
   */
  private createTalentGroups(panel: HTMLElement): void {
    // 视野天赋
    const visionTalents = this.availableTalents.filter(t =>
      t.effects.some(e => e.visionRange !== undefined),
    );
    if (visionTalents.length > 0) {
      this.createTalentSection(panel, '视野天赋', visionTalents, '#3b82f6');
    }

    // 字段开关天赋
    const fieldToggleTalents = this.availableTalents.filter(t => t.type === 'field_toggle');
    if (fieldToggleTalents.length > 0) {
      this.createTalentSection(panel, '数值字段开关', fieldToggleTalents, '#8b5cf6');
    }

    // 机制开关天赋
    const featureToggleTalents = this.availableTalents.filter(t => t.type === 'feature_toggle');
    if (featureToggleTalents.length > 0) {
      this.createTalentSection(panel, '游戏机制开关', featureToggleTalents, '#ec4899');
    }

    // 进阶天赋（组合效果）
    const advancedTalents = this.availableTalents.filter(t =>
      t.effects.length > 1 && !t.effects.some(e => e.visionRange !== undefined),
    );
    if (advancedTalents.length > 0) {
      this.createTalentSection(panel, '进阶天赋', advancedTalents, '#f97316');
    }
  }

  /**
   * 创建天赋分组区域
   */
  private createTalentSection(
    panel: HTMLElement,
    title: string,
    talents: TalentDefinition[],
    color: string,
  ): void {
    const section = document.createElement('div');
    section.style.marginBottom = '16px';
    panel.appendChild(section);

    // 分组标题
    const sectionTitle = document.createElement('h3');
    sectionTitle.textContent = title;
    sectionTitle.style.color = color;
    sectionTitle.style.marginBottom = '8px';
    section.appendChild(sectionTitle);

    // 天赋卡片
    for (const talent of talents) {
      const card = this.createTalentCard(talent);
      section.appendChild(card);
    }
  }

  /**
   * 创建天赋卡片
   */
  private createTalentCard(talent: TalentDefinition): HTMLElement {
    const card = document.createElement('div');
    Object.assign(card.style, TALENT_CARD_STYLE);

    const isLearned = this.learnedTalents.some(t => t.talentId === talent.id);
    const learnedTalent = this.learnedTalents.find(t => t.talentId === talent.id);
    const canLearn = this.talentPoints >= talent.talentPointsCost && !isLearned;

    // 天赋名称
    const nameEl = document.createElement('p');
    nameEl.innerHTML = `<strong>${talent.name}</strong>`;
    nameEl.style.marginBottom = '4px';
    if (isLearned) {
      nameEl.style.color = '#10b981';
    }
    card.appendChild(nameEl);

    // 天赋描述
    const descEl = document.createElement('p');
    descEl.textContent = talent.description;
    descEl.style.marginBottom = '4px';
    descEl.style.fontSize = '13px';
    descEl.style.color = '#d1d5db';
    card.appendChild(descEl);

    // 消耗
    const costEl = document.createElement('p');
    costEl.innerHTML = `<strong>消耗：</strong><span style="color: #fbbf24">${talent.talentPointsCost}</span>`;
    costEl.style.marginBottom = '4px';
    costEl.style.fontSize = '12px';
    card.appendChild(costEl);

    // 前置天赋（如果有）
    if (talent.prerequisites && talent.prerequisites.length > 0) {
      const prereqEl = document.createElement('p');
      const prereqNames = talent.prerequisites.map(id => {
        const prereqTalent = this.availableTalents.find(t => t.id === id);
        return prereqTalent?.name ?? id;
      }).join('、');
      prereqEl.innerHTML = `<strong>前置：</strong>${prereqNames}`;
      prereqEl.style.marginBottom = '4px';
      prereqEl.style.fontSize = '12px';
      prereqEl.style.color = '#9ca3af';
      card.appendChild(prereqEl);
    }

    // 互斥天赋（如果有）
    if (talent.mutuallyExclusiveWith && talent.mutuallyExclusiveWith.length > 0) {
      const mutexEl = document.createElement('p');
      const mutexNames = talent.mutuallyExclusiveWith.map(id => {
        const mutexTalent = this.availableTalents.find(t => t.id === id);
        return mutexTalent?.name ?? id;
      }).join('、');
      mutexEl.innerHTML = `<strong>互斥：</strong>${mutexNames}`;
      mutexEl.style.marginBottom = '4px';
      mutexEl.style.fontSize = '12px';
      mutexEl.style.color = '#9ca3af';
      card.appendChild(mutexEl);
    }

    // 已学习状态显示
    if (isLearned && learnedTalent) {
      const statusEl = document.createElement('p');
      statusEl.innerHTML = `<strong>状态：</strong>${learnedTalent.enabled ? '✅ 已启用' : '⏸️ 已禁用'}`;
      statusEl.style.marginBottom = '8px';
      statusEl.style.fontSize = '12px';
      card.appendChild(statusEl);

      // 启用/禁用开关按钮
      const toggleButton = document.createElement('button');
      toggleButton.textContent = learnedTalent.enabled ? '禁用' : '启用';
      Object.assign(toggleButton.style, BUTTON_STYLE);
      toggleButton.style.backgroundColor = learnedTalent.enabled ? '#6b7280' : '#10b981';
      toggleButton.style.marginTop = '4px';
      toggleButton.onclick = () => this.handleToggle(talent.id, !learnedTalent.enabled);
      card.appendChild(toggleButton);

      // 取消学习按钮
      const unlearnButton = document.createElement('button');
      unlearnButton.textContent = '取消学习';
      Object.assign(unlearnButton.style, UNLEARN_BUTTON_STYLE);
      unlearnButton.style.marginTop = '4px';
      unlearnButton.style.marginLeft = '8px';
      unlearnButton.onclick = () => this.handleUnlearn(talent.id);
      card.appendChild(unlearnButton);
    } else {
      // 学习按钮
      const learnButton = document.createElement('button');
      learnButton.textContent = '学习';
      Object.assign(learnButton.style, LEARN_BUTTON_STYLE);
      learnButton.disabled = !canLearn;
      if (!canLearn) {
        learnButton.style.opacity = '0.5';
        learnButton.style.cursor = 'not-allowed';
      }
      learnButton.onclick = () => this.handleLearn(talent.id);
      card.appendChild(learnButton);

      // 前置天赋未满足提示
      if (talent.prerequisites && !this.checkPrerequisites(talent.prerequisites)) {
        const warningEl = document.createElement('p');
        warningEl.textContent = '⚠️ 前置天赋未满足';
        warningEl.style.color = '#ef4444';
        warningEl.style.fontSize = '12px';
        warningEl.style.marginTop = '4px';
        card.appendChild(warningEl);
      }

      // 与已学习天赋互斥提示
      if (talent.mutuallyExclusiveWith && this.checkMutexConflict(talent.mutuallyExclusiveWith)) {
        const warningEl = document.createElement('p');
        warningEl.textContent = '⚠️ 与已学习天赋互斥';
        warningEl.style.color = '#ef4444';
        warningEl.style.fontSize = '12px';
        warningEl.style.marginTop = '4px';
        card.appendChild(warningEl);
      }
    }

    return card;
  }

  /**
   * 检查前置天赋是否满足
   */
  private checkPrerequisites(prerequisites: string[]): boolean {
    return prerequisites.every(prereqId =>
      this.learnedTalents.some(t => t.talentId === prereqId),
    );
  }

  /**
   * 检查互斥天赋冲突
   */
  private checkMutexConflict(mutexIds: string[]): boolean {
    return mutexIds.some(mutexId =>
      this.learnedTalents.some(t => t.talentId === mutexId),
    );
  }

  /**
   * 处理学习天赋
   */
  private async handleLearn(talentId: string): Promise<void> {
    return new Promise((resolve) => {
      this.config.socket.emit(
        'client.learnTalent',
        { talentId },
        (result: AckResult<{ talentId: string; pointsRemaining: number }>) => {
          if (result.ok) {
            this.talentPoints = result.data!.pointsRemaining;
            this.config.onTalentLearned?.(talentId);
            // 刷新面板
            this.refresh();
          } else {
            this.showError(result.error ?? '学习失败');
          }
          resolve();
        },
      );
    });
  }

  /**
   * 处理取消学习天赋
   */
  private async handleUnlearn(talentId: string): Promise<void> {
    return new Promise((resolve) => {
      this.config.socket.emit(
        'client.unlearnTalent',
        { talentId },
        (result: AckResult<{ talentId: string; refundedPoints: number; pointsRemaining: number }>) => {
          if (result.ok) {
            this.talentPoints = result.data!.pointsRemaining;
            this.config.onTalentUnlearned?.(talentId);
            // 刷新面板
            this.refresh();
          } else {
            this.showError(result.error ?? '取消失败');
          }
          resolve();
        },
      );
    });
  }

  /**
   * 处理启用/禁用天赋
   */
  private async handleToggle(talentId: string, enabled: boolean): Promise<void> {
    return new Promise((resolve) => {
      this.config.socket.emit(
        'client.toggleTalent',
        { talentId, enabled },
        (result: AckResult<{ talentId: string; enabled: boolean }>) => {
          if (result.ok) {
            // 刷新面板
            this.refresh();
          } else {
            this.showError(result.error ?? '切换失败');
          }
          resolve();
        },
      );
    });
  }

  /**
   * 刷新面板
   */
  private async refresh(): Promise<void> {
    await this.fetchTalentInfo();
    if (this.panelElement) {
      const newPanel = this.createPanel();
      this.config.container.removeChild(this.panelElement);
      this.config.container.appendChild(newPanel);
      this.panelElement = newPanel;
    }
  }

  /**
   * 显示错误消息
   */
  private showError(message: string): void {
    if (!this.panelElement) return;

    const errorEl = document.createElement('p');
    errorEl.textContent = `❌ ${message}`;
    errorEl.style.color = '#ef4444';
    errorEl.style.marginTop = '12px';
    errorEl.style.textAlign = 'center';
    this.panelElement.appendChild(errorEl);

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
    return this.panelElement !== null;
  }
}

/**
 * 创建天赋选择面板
 */
export function createTalentPanel(config: TalentPanelConfig): TalentPanel {
  return new TalentPanel(config);
}