/**
 * 组队面板组件（Team Panel）
 *
 * 提供组队功能的 UI 界面：
 * - 队伍信息显示
 * - 组队邀请发送
 * - 队伍成员管理
 * - 离开队伍
 */

import type { Team, Player } from '@game/shared';

/**
 * 组队面板配置
 */
export interface TeamPanelConfig {
  /** 容器元素 */
  container: HTMLElement;
  /** Socket 连接 */
  socket: any;
  /** 当前玩家 ID */
  playerId: string;
  /** 玩家名称 */
  playerName: string;
  /** 队伍更新回调 */
  onTeamUpdate?: (team: Team | null) => void;
  /** 邀请发送回调 */
  onInviteSent?: (targetPlayerId: string) => void;
  /** 离开队伍回调 */
  onLeaveTeam?: () => void;
}

/**
 * 组队面板状态
 */
interface TeamPanelState {
  team: Team | null;
  members: Player[];
  pendingInvites: Array<{ id: string; inviterName: string }>;
  showInviteModal: boolean;
  targetPlayerId: string;
}

/**
 * 创建组队面板
 */
export function createTeamPanel(config: TeamPanelConfig): TeamPanel {
  return new TeamPanel(config);
}

/**
 * 组队面板类
 */
export class TeamPanel {
  private config: TeamPanelConfig;
  private state: TeamPanelState;
  private element: HTMLElement;

  constructor(config: TeamPanelConfig) {
    this.config = config;
    this.state = {
      team: null,
      members: [],
      pendingInvites: [],
      showInviteModal: false,
      targetPlayerId: '',
    };
    this.element = this.create();
    this.bindEvents();
  }

  /**
   * 创建面板元素
   */
  private create(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'team-panel';
    panel.innerHTML = `
      <div class="team-panel-header">
        <span class="team-icon">👥</span>
        <span class="team-title">组队</span>
      </div>
      <div class="team-panel-content">
        <!-- 动态内容 -->
      </div>
    `;
    return panel;
  }

  /**
   * 绑定事件
   */
  private bindEvents(): void {
    this.config.socket.on('server.teamUpdated', (payload: { team: Team }) => {
      this.updateTeam(payload.team);
    });

    this.config.socket.on('server.notification', (payload: any) => {
      if (payload.metadata?.type === 'team-invite') {
        this.addPendingInvite(payload);
      }
    });
  }

  /**
   * 更新队伍信息
   */
  updateTeam(team: Team | null): void {
    this.state.team = team;
    this.render();
    this.config.onTeamUpdate?.(team);
  }

  /**
   * 添加待处理邀请
   */
  private addPendingInvite(notification: any): void {
    const invite = {
      id: notification.id,
      inviterName: notification.metadata.inviterName || '未知玩家',
    };
    this.state.pendingInvites.push(invite);
    this.render();
  }

  /**
   * 发送组队邀请
   */
  sendInvite(targetPlayerId: string): void {
    this.config.socket.emit(
      'client.inviteToTeam',
      { targetPlayerId },
      (result: any) => {
        if (result.ok) {
          this.config.onInviteSent?.(targetPlayerId);
          this.showSuccess('组队邀请已发送');
        } else {
          this.showError(result.error || '邀请失败');
        }
      }
    );
  }

  /**
   * 响应组队邀请
   */
  respondToInvite(inviteId: string, accept: boolean): void {
    // 发送响应
    this.config.socket.emit(
      'client.respondToTeamInvite',
      { inviteId, accept },
      (result: any) => {
        if (result.ok) {
          // 从待处理列表移除
          this.state.pendingInvites = this.state.pendingInvites.filter(
            i => i.id !== inviteId
          );
          this.render();
        } else {
          this.showError(result.error || '响应失败');
        }
      }
    );
  }

  /**
   * 离开队伍
   */
  leaveTeam(): void {
    this.config.socket.emit('client.leaveTeam', {}, (result: any) => {
      if (result.ok) {
        this.updateTeam(null);
        this.config.onLeaveTeam?.();
      } else {
        this.showError(result.error || '离开队伍失败');
      }
    });
  }

  /**
   * 渲染面板
   */
  private render(): void {
    const content = this.element.querySelector('.team-panel-content');
    if (!content) return;

    if (this.state.pendingInvites.length > 0) {
      // 显示邀请弹窗
      content.innerHTML = this.renderInviteModal();
    } else if (this.state.team) {
      // 显示队伍信息
      content.innerHTML = this.renderTeamInfo();
    } else {
      // 显示邀请按钮
      content.innerHTML = this.renderInviteButton();
    }
  }

  /**
   * 渲染邀请弹窗
   */
  private renderInviteModal(): string {
    const invite = this.state.pendingInvites[0];
    return `
      <div class="team-invite-modal">
        <div class="invite-modal-header">
          <span class="invite-icon">📩</span>
          <span class="invite-title">组队邀请</span>
        </div>
        <div class="invite-modal-body">
          <p class="invite-text">${invite.inviterName} 邀请您加入队伍</p>
        </div>
        <div class="invite-modal-footer">
          <button class="accept-btn" data-invite-id="${invite.id}">接受</button>
          <button class="reject-btn" data-invite-id="${invite.id}">拒绝</button>
        </div>
      </div>
    `;
  }

  /**
   * 渲染队伍信息
   */
  private renderTeamInfo(): string {
    if (!this.state.team) return '';

    return `
      <div class="team-info">
        <div class="team-name">${this.state.team.name}</div>
        <div class="team-members">
          ${this.state.team.memberIds.map(id => `
            <div class="member-item">
              <span class="member-icon">👤</span>
              <span class="member-id">${id === this.state.team!.leaderId ? '👑' : ''} ${id}</span>
            </div>
          `).join('')}
        </div>
        <div class="team-actions">
          <button class="invite-more-btn">邀请更多</button>
          <button class="leave-btn">离开队伍</button>
        </div>
      </div>
    `;
  }

  /**
   * 渲染邀请按钮
   */
  private renderInviteButton(): string {
    return `
      <div class="team-empty">
        <p class="empty-text">尚未组队</p>
        <div class="invite-input-group">
          <input type="text" class="target-player-input" placeholder="输入玩家 ID">
          <button class="send-invite-btn">发送邀请</button>
        </div>
      </div>
    `;
  }

  /**
   * 显示成功消息
   */
  private showSuccess(message: string): void {
    this.showNotification('success', message);
  }

  /**
   * 显示错误消息
   */
  private showError(message: string): void {
    this.showNotification('error', message);
  }

  /**
   * 显示通知
   */
  private showNotification(type: string, message: string): void {
    const notification = document.createElement('div');
    notification.className = `team-notification team-notification-${type}`;
    notification.textContent = message;
    this.element.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  /**
   * 获取面板元素
   */
  getElement(): HTMLElement {
    return this.element;
  }

  /**
   * 销毁面板
   */
  destroy(): void {
    this.config.socket.off('server.teamUpdated');
    this.config.socket.off('server.notification');
    this.element.remove();
  }
}