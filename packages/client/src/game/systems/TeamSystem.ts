/**
 * 队伍系统
 *
 * 管理队伍相关操作、邀请、成员管理等。
 */

import { requestHudRefresh } from '../ClientHudBridge.js';

export function updateTeamState(): void {
  requestHudRefresh();
}
