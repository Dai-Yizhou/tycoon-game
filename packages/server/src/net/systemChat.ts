/**
 * 系统聊天广播（单一发射点）
 *
 * 经济与世界类事件（计税、收/交租、昼夜数值变化、投资项目钩子触发）的运行时提示，
 * 统一经本模块向所有连接广播一条 `channel = 'system'` 的聊天消息，由客户端聊天框展示。
 *
 * 与 ChatManager.sendSystemMessage 的区别：后者维护频道历史与限频，用于玩家可见的公告；
 * 本模块面向运行时可观测性，只发不收，不进入频道历史，便于这些结算路径「看得见」。
 */

import type { ChatMessage, ValueFieldDefinition } from '@game/shared';
import { ChatChannels } from '@game/shared';

/** 广播所需的最小 io 结构（handler 传入的 TypedServer 满足此结构） */
export interface SystemChatIO {
  emit(event: 'server.chat', payload: { message: ChatMessage }): void;
}

let sequence = 0;

/**
 * 向所有连接广播一条系统聊天消息
 *
 * @param io 服务端 socket.io 实例（TypedServer）
 * @param content 消息内容（纯文本，中文）
 */
export function broadcastSystemMessage(io: SystemChatIO, content: string): void {
  sequence += 1;
  const message: ChatMessage = {
    id: `system-${Date.now()}-${sequence}`,
    channel: ChatChannels.System,
    senderId: null,
    content,
    timestamp: Date.now(),
    metadata: { type: 'game_event' },
  };
  io.emit('server.chat', { message });
}

/**
 * 把逐字段数值变化格式化为可读文本（如「财产 +5，繁荣 -20」）
 *
 * 字段名优先取地图元数据的中文名，未声明时回退字段 ID。
 */
export function formatFieldAmounts(
  amounts: Record<string, number>,
  definitions: ValueFieldDefinition[] = [],
  scope: 'player' | 'region' = 'player',
): string {
  return Object.entries(amounts)
    .filter(([, value]) => Number.isFinite(value) && value !== 0)
    .map(([fieldId, value]) => {
      const definition = definitions.find((item) => item.id === fieldId && item.scope === scope);
      const name = definition?.name['zh-CN'] ?? definition?.name['en-US'] ?? fieldId;
      return `${name} ${value >= 0 ? '+' : ''}${value}`;
    })
    .join('，');
}