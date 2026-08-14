/**
 * TeamManager 测试
 */

import { TeamManager, DEFAULT_TEAM_CONFIG } from '../../src/team/index.js';
import { jest } from '@jest/globals';
import type { Player } from '@game/shared';

describe('TeamManager', () => {
  let manager: TeamManager;

  beforeEach(() => {
    manager = new TeamManager();
  });

  afterEach(() => {
    manager.clear();
  });

  describe('队伍创建', () => {
    test('创建队伍成功', () => {
      const team = manager.createTeam('player1', '玩家1');
      expect(team).toBeDefined();
      expect(team.memberIds).toContain('player1');
      expect(team.leaderId).toBe('player1');
      expect(team.disbanded).toBe(false);
    });

    test('队伍分配颜色', () => {
      const team1 = manager.createTeam('player1', '玩家1');
      const color1 = manager.getTeamColor(team1.id);
      expect(color1).toBeDefined();
      expect(color1).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });

  describe('组队邀请', () => {
    test('发送组队邀请成功', () => {
      const invite = manager.sendInvite('player1', '玩家1', 'player2');
      expect(invite).toBeDefined();
      expect(invite?.inviterId).toBe('player1');
      expect(invite?.targetId).toBe('player2');
      expect(invite?.status).toBe('pending');
    });

    test('邀请已组队玩家失败', () => {
      const invite = manager.sendInvite('player1', '玩家1', 'player2');
      manager.respondInvite(invite!.id, 'player2', true); // player2 接受邀请，加入 player1 的队伍
      const invite2 = manager.sendInvite('player3', '玩家3', 'player2'); // player3 邀请已组队的 player2
      expect(invite2).toBeNull();
    });

    test('接受组队邀请成功', () => {
      const invite = manager.sendInvite('player1', '玩家1', 'player2');
      const team = manager.respondInvite(invite!.id, 'player2', true);
      expect(team).toBeDefined();
      expect(team?.memberIds).toContain('player2');
    });

    test('拒绝组队邀请', () => {
      const invite = manager.sendInvite('player1', '玩家1', 'player2');
      const team = manager.respondInvite(invite!.id, 'player2', false);
      expect(team).toBeNull();
    });
  });

  describe('队伍管理', () => {
    test('获取玩家的队伍', () => {
      manager.createTeam('player1', '玩家1');
      const team = manager.getPlayerTeam('player1');
      expect(team).toBeDefined();
      expect(team?.memberIds).toContain('player1');
    });

    test('未组队玩家返回 undefined', () => {
      const team = manager.getPlayerTeam('player999');
      expect(team).toBeUndefined();
    });

    test('获取所有队伍', () => {
      manager.createTeam('player1', '玩家1');
      manager.createTeam('player2', '玩家2');
      const teams = manager.getAllTeams();
      expect(teams.length).toBe(2);
    });
  });

  describe('队伍合并', () => {
    test('合并两个队伍', () => {
      const team1 = manager.createTeam('player1', '玩家1');
      const team2 = manager.createTeam('player2', '玩家2');

      // 先清除绑定（模拟两个独立队伍）
      const merged = manager.mergeTeams(team1.id, team2.id);
      expect(merged).toBeDefined();
      expect(merged?.memberIds.length).toBe(2);
    });

    test('合并超出人数上限失败', () => {
      const team1 = manager.createTeam('player1', '玩家1');
      const team2 = manager.createTeam('player2', '玩家2');
      const team3 = manager.createTeam('player3', '玩家3');
      const team4 = manager.createTeam('player4', '玩家4');

      // 模拟已满员的队伍
      manager.mergeTeams(team1.id, team2.id);

      // 使用自定义配置测试上限
      const limitedManager = new TeamManager({
        ...DEFAULT_TEAM_CONFIG,
        maxTeamSize: 2,
      });
      limitedManager.createTeam('p1', 'P1');
      limitedManager.createTeam('p2', 'P2');
      const t1 = limitedManager.getPlayerTeam('p1')!;
      const t2 = limitedManager.getPlayerTeam('p2')!;
      const result = limitedManager.mergeTeams(t1.id, t2.id);
      expect(result).toBeDefined();
      limitedManager.clear();
    });
  });

  describe('离开队伍', () => {
    test('玩家离开队伍', () => {
      manager.sendInvite('player1', '玩家1', 'player2');
      const team = manager.getPlayerTeam('player1');

      manager.leaveTeam('player2');
      expect(team?.memberIds).not.toContain('player2');
    });

    test('单人队伍离开后解散', () => {
      manager.createTeam('player1', '玩家1');
      manager.leaveTeam('player1');
      const team = manager.getPlayerTeam('player1');
      expect(team).toBeUndefined();
    });
  });

  describe('队伍数值共享', () => {
    test('财产平均分配', () => {
      const team = manager.createTeam('player1', '玩家1');

      const players: Player[] = [
        {
          id: 'player1',
          username: '玩家1',
          teamId: team.id,
          position: { cellId: 0 },
          values: {
            money: { id: 'money', name: '财产', current: 1000 },
            credit: { id: 'credit', name: '信用值', current: 50 },
          },
          status: 'normal',
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
        },
        {
          id: 'player2',
          username: '玩家2',
          teamId: team.id,
          position: { cellId: 0 },
          values: {
            money: { id: 'money', name: '财产', current: 2000 },
            credit: { id: 'credit', name: '信用值', current: 80 },
          },
          status: 'normal',
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
        },
      ];

      // 模拟 player2 加入
      team.memberIds.push('player2');

      const sharedValues = manager.updateTeamSharedValues(team.id, players);
      expect(sharedValues.money.current).toBe(1500); // (1000 + 2000) / 2
    });

    test('信用值取最低值', () => {
      const team = manager.createTeam('player1', '玩家1');
      team.memberIds.push('player2');

      const players: Player[] = [
        {
          id: 'player1',
          username: '玩家1',
          teamId: team.id,
          position: { cellId: 0 },
          values: {
            credit: { id: 'credit', name: '信用值', current: 50 },
          },
          status: 'normal',
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
        },
        {
          id: 'player2',
          username: '玩家2',
          teamId: team.id,
          position: { cellId: 0 },
          values: {
            credit: { id: 'credit', name: '信用值', current: 80 },
          },
          status: 'normal',
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
        },
      ];

      const sharedValues = manager.updateTeamSharedValues(team.id, players);
      // 最低值 50 + 组队加成 5
      expect(sharedValues.credit.current).toBe(55);
    });
  });

  describe('地产交易限制', () => {
    test('禁止玩家间直接交易地产', () => {
      const canTrade = manager.canTradePropertyBetweenPlayers('player1', 'player2');
      expect(canTrade).toBe(false);
    });

    test('队内成员也不能交易地产', () => {
      manager.createTeam('player1', '玩家1');
      const canTrade = manager.canTradePropertyBetweenPlayers('player1', 'player2');
      expect(canTrade).toBe(false);
    });
  });

  describe('队伍解散', () => {
    test('手动解散队伍', () => {
      const team = manager.createTeam('player1', '玩家1');
      manager.disbandTeam(team.id);
      const teams = manager.getAllTeams();
      expect(teams.length).toBe(0);
    });

    test('清理离线队伍', () => {
      // 创建双人队伍：player1 + player2
      manager.createTeam('player1', '玩家1');
      const invite = manager.sendInvite('player1', '玩家1', 'player2');
      manager.respondInvite(invite!.id, 'player2', true);

      // 仅 player1 离线，player2 仍在线，队伍不应解散
      const disbanded = manager.cleanupOfflineTeams(['player1']);
      expect(disbanded.length).toBe(0); // player2 仍在线，保留队伍
    });

    test('自动解散时通知原始成员', () => {
      const team = manager.createTeam('player1', '玩家1');
      const invite = manager.sendInvite('player1', '玩家1', 'player2');
      manager.respondInvite(invite!.id, 'player2', true);
      const onDisbanded = jest.fn();

      manager.onTeamDisbanded(onDisbanded);
      manager.cleanupOfflineTeams(['player1', 'player2']);

      expect(onDisbanded).toHaveBeenCalledWith(team.id, ['player1', 'player2']);
    });
  });
});
