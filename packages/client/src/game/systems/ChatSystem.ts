/**
 * 聊天系统
 *
 * 管理聊天消息的历史记录、频道过滤和消息显示。
 */

import type { GameStore } from '../../state/GameStore.js';

let chatStore: GameStore | null = null;

export function setChatStore(store: GameStore | null): void {
  chatStore = store;
}

export function addChatMessage(msg: string, channel: string = 'system'): void {
  chatStore?.appendChatMessage({ text: msg, channel, timestamp: Date.now() });
}
