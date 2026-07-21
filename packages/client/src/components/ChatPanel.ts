/**
 * 聊天面板组件（Chat Panel）
 *
 * 提供聊天功能的 UI 界面：
 * - 消息列表显示
 * - 频道切换
 * - 消息输入与发送
 * - 系统消息显示
 */

import type { ChatChannel, ChatMessage } from '@game/shared';

/**
 * 聊天面板配置
 */
export interface ChatPanelConfig {
  /** 容器元素 */
  container: HTMLElement;
  /** Socket 连接 */
  socket: any;
  /** 当前玩家 ID */
  playerId: string;
  /** 玩家名称 */
  playerName: string;
  /** 默认频道，默认 'global' */
  defaultChannel?: ChatChannel;
  /** 消息发送回调 */
  onMessageSent?: (message: ChatMessage) => void;
}

/**
 * 聊天面板状态
 */
interface ChatPanelState {
  currentChannel: ChatChannel;
  messages: Map<ChatChannel, ChatMessage[]>;
  inputText: string;
  showChannels: boolean;
}

/**
 * 创建聊天面板
 */
export function createChatPanel(config: ChatPanelConfig): ChatPanel {
  return new ChatPanel(config);
}

/**
 * 聊天面板类
 */
export class ChatPanel {
  private config: ChatPanelConfig;
  private state: ChatPanelState;
  private element: HTMLElement;
  private messagesElement: HTMLElement | null = null;
  private inputElement: HTMLInputElement | null = null;

  constructor(config: ChatPanelConfig) {
    this.config = {
      defaultChannel: 'global',
      ...config,
    };
    this.state = {
      currentChannel: this.config.defaultChannel!,
      messages: new Map(),
      inputText: '',
      showChannels: false,
    };
    this.element = this.create();
    this.bindEvents();
  }

  /**
   * 创建面板元素
   */
  private create(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'chat-panel';
    panel.innerHTML = `
      <div class="chat-header">
        <div class="channel-tabs">
          <button class="channel-tab active" data-channel="global">世界</button>
          <button class="channel-tab" data-channel="team">队伍</button>
          <button class="channel-tab" data-channel="region">区域</button>
          <button class="channel-tab" data-channel="system">系统</button>
        </div>
      </div>
      <div class="chat-messages"></div>
      <div class="chat-input-area">
        <input type="text" class="chat-input" placeholder="输入消息..." maxlength="500">
        <button class="chat-send-btn">发送</button>
      </div>
    `;
    return panel;
  }

  /**
   * 绑定事件
   */
  private bindEvents(): void {
    // Socket 事件
    this.config.socket.on('server.chat', (payload: { message: ChatMessage }) => {
      this.addMessage(payload.message);
    });

    // DOM 事件
    this.element.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      // 频道切换
      if (target.classList.contains('channel-tab')) {
        const channel = target.dataset.channel as ChatChannel;
        if (channel) {
          this.switchChannel(channel);
        }
      }

      // 发送消息
      if (target.classList.contains('chat-send-btn')) {
        this.sendMessage();
      }
    });

    // 输入事件
    this.element.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendMessage();
      }
    });

    this.inputElement = this.element.querySelector('.chat-input');
    if (this.inputElement) {
      this.inputElement.addEventListener('input', (e) => {
        this.state.inputText = (e.target as HTMLInputElement).value;
      });
    }

    this.messagesElement = this.element.querySelector('.chat-messages');
  }

  /**
   * 切换频道
   */
  switchChannel(channel: ChatChannel): void {
    this.state.currentChannel = channel;

    // 更新标签页状态
    const tabs = this.element.querySelectorAll('.channel-tab');
    tabs.forEach((tab) => {
      if ((tab as HTMLElement).dataset.channel === channel) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    // 渲染消息
    this.renderMessages();
  }

  /**
   * 添加消息
   */
  addMessage(message: ChatMessage): void {
    const channelMessages = this.state.messages.get(message.channel) || [];
    channelMessages.push(message);

    // 限制历史长度（默认 50）
    if (channelMessages.length > 50) {
      channelMessages.shift();
    }

    this.state.messages.set(message.channel, channelMessages);

    // 如果是当前频道，渲染消息
    if (message.channel === this.state.currentChannel) {
      this.renderMessages();
    }
  }

  /**
   * 发送消息
   */
  sendMessage(): void {
    if (!this.state.inputText.trim()) {
      return;
    }

    const content = this.state.inputText.trim();

    this.config.socket.emit(
      'client.chat',
      {
        channel: this.state.currentChannel,
        content,
      },
      (result: any) => {
        if (result.ok) {
          this.state.inputText = '';
          if (this.inputElement) {
            this.inputElement.value = '';
          }
          this.config.onMessageSent?.(result.data.message);
        } else {
          this.showError(result.error || '发送失败');
        }
      }
    );
  }

  /**
   * 渲染消息列表
   */
  private renderMessages(): void {
    if (!this.messagesElement) return;

    const messages = this.state.messages.get(this.state.currentChannel) || [];

    this.messagesElement.innerHTML = messages.map((msg) => this.renderMessage(msg)).join('');

    // 滚动到底部
    this.messagesElement.scrollTop = this.messagesElement.scrollHeight;
  }

  /**
   * 渲染单条消息
   */
  private renderMessage(msg: ChatMessage): string {
    const time = this.formatTime(msg.timestamp);
    const isSystem = msg.senderId === null;

    if (isSystem) {
      return `
        <div class="chat-message system-message">
          <span class="message-content">${this.escapeHtml(msg.content)}</span>
        </div>
      `;
    }

    return `
      <div class="chat-message">
        <span class="message-time">${time}</span>
        <span class="message-sender">${this.escapeHtml(msg.senderName || '未知')}</span>
        <span class="message-content">${this.escapeHtml(msg.content)}</span>
      </div>
    `;
  }

  /**
   * 格式化时间
   */
  private formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  /**
   * XSS 防护：转义 HTML
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 显示错误消息
   */
  private showError(message: string): void {
    const errorElement = document.createElement('div');
    errorElement.className = 'chat-error';
    errorElement.textContent = message;
    this.element.appendChild(errorElement);

    setTimeout(() => {
      errorElement.remove();
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
    this.config.socket.off('server.chat');
    this.element.remove();
  }
}