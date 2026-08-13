/**
 * 队伍系统
 *
 * 管理队伍相关操作、邀请、成员管理等。
 */

import {
  setTeamMembers, type TeamMember,
} from '../../state/GameStore.js';
import { addChatMessage } from './ChatSystem.js';
import { requestHudRefresh } from '../ClientHudBridge.js';
import { t } from '../i18n.js';

export function initTeamSystem(): void {
  window.showTeamInvite = function() {
    addChatMessage(t('team.inviteNeedsServer'), 'system');
  };

  window.showTeamManagement = function() {
    addChatMessage(t('team.manageNeedsServer'), 'system');
  };
}

export function showTeamInvite(): void {
  addChatMessage(t('team.inviteNeedsServer'), 'system');
}

export function showTeamManagement(): void {
  addChatMessage(t('team.manageNeedsServer'), 'system');
}

export function updateTeamState(members: TeamMember[]): void {
  setTeamMembers(members);
  requestHudRefresh();
}

export function applyTeamMembers(members: TeamMember[]): void {
  setTeamMembers(members);
  requestHudRefresh();
}