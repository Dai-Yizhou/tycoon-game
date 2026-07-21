/**
 * 测试辅助：构造测试用 Player 对象
 */

import { PlayerStatus, type Player } from '@game/shared';

export function buildPlayer(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    username: `user-${id}`,
    teamId: null,
    position: { cellId: 0 },
    values: {},
    items: [],
    status: PlayerStatus.Normal,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    ...overrides,
  };
}
