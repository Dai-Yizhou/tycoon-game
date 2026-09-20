/**
 * 数值绝对值发布（单一发射点）
 *
 * 客户端对数值字段采用"按域绝对值覆写、不累加"的同步契约：
 * 服务端所有 handler 不再各自手填 delta 发射，统一走本函数，
 * 以结算后的权威 current 广播，delta 固定为 0 以表示"可直接覆写"。
 */

/** 广播所需的最小 io 结构（handler 传入的 TypedServer 满足此结构） */
export interface ValueChangedIO {
  emit(event: 'server.valueChanged', payload: { playerId: string; fieldId: string; current: number; delta: number }): void;
}

/**
 * 广播 server.valueChanged，携带结算后权威绝对值 current。
 *
 * @param io 服务端 socket.io 实例（TypedServer）
 * @param playerId 目标玩家 ID
 * @param fieldId 数值字段 ID（如 money）
 * @param current 结算后的权威字段值
 */
export function publishValueChanged(
  io: ValueChangedIO,
  playerId: string,
  fieldId: string,
  current: number,
): void {
  io.emit('server.valueChanged', { playerId, fieldId, current, delta: 0 });
}