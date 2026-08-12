/**
 * 聊天系统
 *
 * 管理聊天消息的历史记录、频道过滤和消息显示。
 */

import {
  chatBoxEl, activeChatChannels, chatChannelDefs,
} from '../../state/GameStore.js';
import { t } from '../i18n.js';

export interface ChatMessage {
  text: string;
  channel: string;
  timestamp: number;
}

// Global chat history (shared across systems)
export const chatHistory: ChatMessage[] = [];

export function addChatMessage(msg: string, channel: string = 'system'): void {
  chatHistory.push({ text: msg, channel, timestamp: Date.now() });
  while (chatHistory.length > 100) chatHistory.shift();
  if (!chatBoxEl) return;
  if (!activeChatChannels.has(channel)) return;
  const el = document.createElement('div');
  el.className = 'chat-message';
  el.dataset.channel = channel;
  const chDef = chatChannelDefs.find(c => c.id === channel);
  if (chDef) {
    const tag = document.createElement('span');
    tag.className = 'chat-msg-tag';
    tag.style.color = chDef.color;
    tag.textContent = `[${t(chDef.label)}]`;
    el.appendChild(tag);
    el.appendChild(document.createTextNode(' ' + msg));
  } else {
    el.textContent = msg;
  }
  chatBoxEl.appendChild(el);
  while (chatBoxEl.children.length > 50) {
    chatBoxEl.firstChild?.remove();
  }
  chatBoxEl.scrollTop = chatBoxEl.scrollHeight;
}

export function refreshChatMessages(): void {
  if (!chatBoxEl) return;
  chatBoxEl.innerHTML = '';
  for (const m of chatHistory) {
    if (!activeChatChannels.has(m.channel)) continue;
    const el = document.createElement('div');
    el.className = 'chat-message';
    el.dataset.channel = m.channel;
    const chDef = chatChannelDefs.find(c => c.id === m.channel);
    if (chDef) {
      const tag = document.createElement('span');
      tag.className = 'chat-msg-tag';
      tag.style.color = chDef.color;
      tag.textContent = `[${chDef.label}]`;
      el.appendChild(tag);
      el.appendChild(document.createTextNode(' ' + m.text));
    } else {
      el.textContent = m.text;
    }
    chatBoxEl.appendChild(el);
  }
  chatBoxEl.scrollTop = chatBoxEl.scrollHeight;
}