/**
 * LLM 驱动的决策引擎
 *
 * 使用大语言模型生成 AI 玩家的决策，使其行为更接近真实玩家。
 * 支持用户自定义提示词，可调整 AI 玩家的性格和策略。
 * 当 LLM 不可用时自动回退到规则引擎。
 */

import type { LLMAdapter } from './LLMAdapter.js';
import { DecisionEngine, type Decision } from './DecisionEngine.js';
import type { GameStateSnapshot, BotConfig } from './types.js';

export interface LLMDecisionConfig {
  llmAdapter?: LLMAdapter;
  fallbackEngine: DecisionEngine;
  customPersonality?: string;
  customStrategy?: string;
  decisionTimeoutMs?: number;
}

const DEFAULT_PERSONALITY = `你是一个大富翁游戏玩家，性格稳健且有策略性。
你会：
- 优先购买优质地段的地产
- 合理管理资金，保留足够的应急资金
- 适时升级地产以增加收入
- 积极与其他玩家组队以获得优势
- 在资金紧张时考虑抵押或贷款
- 学习有用的天赋来增强能力
- 偶尔聊天互动，保持社交活跃度`;

const DEFAULT_STRATEGY = `游戏策略：
1. 早期：积极购买地产，建立资产基础
2. 中期：升级核心地产，稳定现金流
3. 后期：组队合作，追求最终胜利
4. 遇到岔路口时选择有更多地产的方向
5. 资金低于保留线时避免大额支出`;

export class LLMDecisionEngine {
  private readonly llmAdapter?: LLMAdapter;
  private readonly fallbackEngine: DecisionEngine;
  private readonly customPersonality: string;
  private readonly customStrategy: string;
  private readonly decisionTimeoutMs: number;
  private lastDecisionTime = 0;
  private consecutiveFallbackCount = 0;
  private readonly maxConsecutiveFallback = 5;

  constructor(config: LLMDecisionConfig) {
    this.llmAdapter = config.llmAdapter;
    this.fallbackEngine = config.fallbackEngine;
    this.customPersonality = config.customPersonality || DEFAULT_PERSONALITY;
    this.customStrategy = config.customStrategy || DEFAULT_STRATEGY;
    this.decisionTimeoutMs = config.decisionTimeoutMs || 15000;
  }

  /**
   * 生成决策
   * 优先使用 LLM，失败或超时时回退到规则引擎
   */
  async decide(state: GameStateSnapshot): Promise<Decision> {
    if (!this.llmAdapter || !this.llmAdapter.isAvailable()) {
      return this.fallbackEngine.decide(state);
    }

    if (this.consecutiveFallbackCount >= this.maxConsecutiveFallback) {
      return this.fallbackEngine.decide(state);
    }

    try {
      const prompt = this.buildPrompt(state);
      const response = await Promise.race([
        this.llmAdapter.generate(prompt),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('LLM decision timeout')), this.decisionTimeoutMs)
        ),
      ]);

      const decision = this.parseResponse(response, state);
      this.consecutiveFallbackCount = 0;
      this.lastDecisionTime = Date.now();
      return decision;
    } catch {
      this.consecutiveFallbackCount++;
      return this.fallbackEngine.decide(state);
    }
  }

  /**
   * 构建 LLM 提示词
   */
  private buildPrompt(state: GameStateSnapshot): string {
    const otherPlayersInfo = Array.from(state.otherPlayers.values())
      .map(p => `- ${p.username} (位置: ${p.position}, 状态: ${p.status})`)
      .join('\n');

    const cellInfo = state.currentCell
      ? `类型: ${state.currentCell.extra['type'] || 'unknown'}
名称: ${state.currentCell.extra['name'] || '未命名'}
价格: ${state.currentCell.extra['price'] || 'N/A'}
等级: ${state.currentCell.extra['level'] || 0}
所有者: ${(state.currentCell.extra['owners'] as string[] | undefined)?.join(', ') || '无主'}`
      : '无当前格子信息';

    const itemsInfo = state.items.length > 0
      ? state.items.map(i => `- ${i.name || i.id} x${i.quantity}`).join('\n')
      : '无道具';

    const talentsInfo = state.learnedTalents.length > 0
      ? state.learnedTalents.join(', ')
      : '无';

    return `你正在玩大富翁.io 游戏。请根据当前游戏状态，决定下一步行动。

## 你的性格设定
${this.customPersonality}

## 你的策略偏好
${this.customStrategy}

## 当前状态
- 位置: ${state.position}
- 金钱: ${state.money}
- 信用值: ${state.credit}
- 状态: ${state.status}
- 天赋点: ${state.talentPoints}
- 已学天赋: ${talentsInfo}
- 昼夜: ${state.isDay ? '白天' : '夜晚'}
- 掷骰冷却: ${state.cooldownActive ? '冷却中' : '可用'}
- 上次掷骰: ${state.lastDiceResult || '无'} (${state.lastDiceSteps || 0}步)
- 队伍: ${state.team ? state.team.name + ' (' + state.team.memberIds.length + '人)' : '无队伍'}

## 当前格子信息
${cellInfo}

## 道具
${itemsInfo}

## 其他玩家
${otherPlayersInfo || '无其他玩家'}

## 待处理事项
${state.pendingPathChoice ? `- 岔路口选择: 从格子 ${state.pendingPathChoice.fromCellId}，可选方向: ${state.pendingPathChoice.options.map(o => o.cellId + (o.label ? ` (${o.label})` : '')).join(', ')}` : '无'}
${state.pendingTeamInvite ? `- 组队邀请: 来自 ${state.pendingTeamInvite.inviterName} (teamId: ${state.pendingTeamInvite.teamId})` : '无待处理邀请'}

## 可用行动类型
- rollDice: 掷骰子（冷却中不可用）
- choosePath: 选择路径（有岔路口时）
- buyProperty: 购买当前格子的地产
- upgradeProperty: 升级当前格子的地产
- acceptTeamInvite: 接受组队邀请
- rejectTeamInvite: 拒绝组队邀请
- inviteToTeam: 邀请其他玩家组队
- learnTalent: 学习天赋（在起点且有天赋点时）
- repairMonument: 修缮纪念碑
- useItem: 使用道具
- chat: 发送聊天消息
- leaveTeam: 离开队伍
- useTransport: 使用交通枢纽传送

## 输出格式
请以 JSON 格式输出你的决策，只输出 JSON，不要有其他文字：
{
  "action": "行动类型",
  "reason": "简短的决策理由（中文，1-2句话）",
  "params": {
    "cellId": 123,
    "talentId": "credit",
    "content": "聊天内容",
    "targetPlayerId": "player-id",
    "itemId": "item-id"
  }
}

params 中的字段根据 action 类型可选填写。
如果没有特别想做的事，就掷骰子（rollDice）。
请做出最合理的决策！`;
  }

  /**
   * 解析 LLM 响应为决策对象
   */
  private parseResponse(response: string, state: GameStateSnapshot): Decision {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.fallbackEngine.decide(state);
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const action = parsed.action as string;
      const params = parsed.params || {};

      switch (action) {
        case 'rollDice':
          if (!state.cooldownActive) {
            return { type: 'rollDice' };
          }
          break;

        case 'choosePath':
          if (state.pendingPathChoice && params.cellId !== undefined) {
            const validOption = state.pendingPathChoice.options.find(
              o => o.cellId === params.cellId
            );
            if (validOption) {
              return {
                type: 'choosePath',
                fromCellId: state.pendingPathChoice.fromCellId,
                toCellId: params.cellId,
              };
            }
          }
          break;

        case 'buyProperty':
          if (state.currentCell) {
            return { type: 'buyProperty', cellId: state.currentCell.id };
          }
          break;

        case 'upgradeProperty':
          if (state.currentCell) {
            return { type: 'upgradeProperty', cellId: state.currentCell.id };
          }
          break;

        case 'acceptTeamInvite':
          if (state.pendingTeamInvite) {
            return {
              type: 'acceptTeamInvite',
              teamId: state.pendingTeamInvite.teamId,
              inviterId: state.pendingTeamInvite.inviterId,
            };
          }
          break;

        case 'rejectTeamInvite':
          if (state.pendingTeamInvite) {
            return {
              type: 'rejectTeamInvite',
              inviterId: state.pendingTeamInvite.inviterId,
            };
          }
          break;

        case 'inviteToTeam':
          if (params.targetPlayerId && state.otherPlayers.has(params.targetPlayerId)) {
            return { type: 'inviteToTeam', targetPlayerId: params.targetPlayerId };
          }
          break;

        case 'learnTalent':
          if (params.talentId && state.talentPoints > 0 && state.position === 0) {
            return { type: 'learnTalent', talentId: params.talentId };
          }
          break;

        case 'repairMonument':
          if (state.currentCell) {
            return { type: 'repairMonument', monumentId: state.currentCell.id };
          }
          break;

        case 'useItem':
          if (params.itemId) {
            return { type: 'useItem', itemId: params.itemId, targetCellId: params.cellId };
          }
          break;

        case 'chat':
          if (params.content) {
            const channel = params.channel || 'all';
            if (['all', 'region', 'team'].includes(channel)) {
              return { type: 'chat', channel: channel as 'all' | 'region' | 'team', content: params.content };
            }
          }
          break;

        case 'leaveTeam':
          if (state.team) {
            return { type: 'leaveTeam' };
          }
          break;

        case 'useTransport':
          if (state.currentCell && params.targetCellId !== undefined) {
            return {
              type: 'useTransport',
              hubCellId: state.currentCell.id,
              targetCellId: params.targetCellId,
            };
          }
          break;
      }

      return this.fallbackEngine.decide(state);
    } catch {
      return this.fallbackEngine.decide(state);
    }
  }

  /**
   * 更新自定义提示词
   */
  setCustomPersonality(personality: string): void {
    (this as unknown as { customPersonality: string }).customPersonality = personality;
  }

  setCustomStrategy(strategy: string): void {
    (this as unknown as { customStrategy: string }).customStrategy = strategy;
  }

  /**
   * 获取当前使用的 LLM 信息
   */
  getLLMInfo(): { available: boolean; model: string; backend: string } {
    if (!this.llmAdapter) {
      return { available: false, model: 'none', backend: 'rule_engine' };
    }
    return {
      available: this.llmAdapter.isAvailable(),
      model: this.llmAdapter.getModelName(),
      backend: this.llmAdapter.getBackendType(),
    };
  }

  /**
   * 重置连续失败计数
   */
  resetFallbackCount(): void {
    this.consecutiveFallbackCount = 0;
  }
}
