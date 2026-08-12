/**
 * 配置加载器
 *
 * 管理天赋配置、成就配置、行为配置和玩家进度的加载/保存。
 */

import type { BehaviorConfig } from '../../state/GameStore.js';
import {
  activeTalents, availableTP, talentsLocked,
  achievements, totalMoneyEarned,
  setActiveTalents, setAvailableTP, setTalentsLocked,
  setTotalMoneyEarned,
} from '../../state/GameStore.js';
import type { TalentDef, AchievementDef } from '../../state/GameStore.js';

export function getAccountKey(): string {
  return `monopoly_player_${currentPlayerName}`;
}

// Reference to currentPlayerName from GameStore - needs to be imported
import { currentPlayerName } from '../../state/GameStore.js';

export function savePlayerProgress(): void {
  const key = getAccountKey();
  const data = {
    activeTalents: Array.from(activeTalents),
    availableTP,
    talentsLocked,
    achievements: achievements.map(a => ({ id: a.id, current: a.current, completed: a.completed })),
    totalMoneyEarned,
    version: 1,
  };
  localStorage.setItem(`${key}_progress`, JSON.stringify(data));
}

export function loadPlayerProgress(): void {
  const key = getAccountKey();
  const raw = localStorage.getItem(`${key}_progress`);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (data.activeTalents) setActiveTalents(new Set(data.activeTalents));
    if (typeof data.availableTP === 'number') setAvailableTP(data.availableTP);
    if (typeof data.talentsLocked === 'boolean') setTalentsLocked(data.talentsLocked);
    if (typeof data.totalMoneyEarned === 'number') setTotalMoneyEarned(data.totalMoneyEarned);
    if (Array.isArray(data.achievements)) {
      for (const saved of data.achievements) {
        const ach = achievements.find(a => a.id === saved.id);
        if (ach) {
          ach.current = saved.current ?? 0;
          ach.completed = saved.completed ?? false;
        }
      }
    }
  } catch {
    console.warn('[GamePage] 玩家进度数据解析失败');
  }
}

export async function loadTalentConfig(): Promise<TalentDef[]> {
  try {
    const res = await fetch('/config/talents.json');
    if (res.ok) return await res.json();
  } catch { /* fallback */ }
  return [
    { id: 'credit', name: '信用系统', description: '启用信用值数值，影响贷款额度和事件概率', rarity: 'common', cost: 1, branchId: 'economy', prerequisites: [], icon: '💳', category: 'economy', conflicts: [] },
    { id: 'bank', name: '银行系统', description: '启用银行贷款功能，可借款和还款', rarity: 'uncommon', cost: 2, prerequisites: ['credit'], branchId: 'economy', icon: '🏦', category: 'economy', conflicts: [] },
    { id: 'investment_boost', name: '投资加成', description: '投资项目收益+20%', rarity: 'rare', cost: 3, prerequisites: ['bank'], branchId: 'economy', icon: '📈', category: 'economy', conflicts: [] },
    { id: 'monument_master', name: '纪念碑大师', description: '修缮纪念碑信用值+15（原+10）', rarity: 'rare', cost: 3, prerequisites: ['credit'], branchId: 'economy', icon: '🗿', category: 'economy', conflicts: [] },
    { id: 'team_boost', name: '组队加成', description: '组队时信用值加成翻倍', rarity: 'common', cost: 1, branchId: 'social', prerequisites: [], icon: '👥', category: 'social', conflicts: [] },
    { id: 'item_luck', name: '道具幸运', description: '触发事件获取道具概率+30%', rarity: 'uncommon', cost: 2, prerequisites: ['team_boost'], branchId: 'social', icon: '🍀', category: 'social', conflicts: [] },
    { id: 'seal_master', name: '查封大师', description: '查封令效果持续时间+50%', rarity: 'rare', cost: 3, prerequisites: ['item_luck'], branchId: 'social', icon: '🔒', category: 'social', conflicts: [] },
    { id: 'env', name: '环保系统', description: '启用环保值数值，受地产和事件影响', rarity: 'common', cost: 1, branchId: 'exploration', prerequisites: [], icon: '🌱', category: 'exploration', conflicts: [] },
    { id: 'transport_discount', name: '交通折扣', description: '传送费用-30%', rarity: 'uncommon', cost: 2, prerequisites: ['env'], branchId: 'exploration', icon: '🚇', category: 'exploration', conflicts: [] },
    { id: 'vision', name: '鹰眼视野', description: '相机跟随时显示更多棋盘区域', rarity: 'rare', cost: 3, prerequisites: ['transport_discount'], branchId: 'exploration', icon: '👁️', category: 'exploration', conflicts: [] },
  ] as TalentDef[];
}

export async function loadAchievementConfig(): Promise<AchievementDef[]> {
  try {
    const res = await fetch('/config/achievements.json');
    if (res.ok) {
      const defs: Omit<AchievementDef, 'current' | 'completed'>[] = await res.json();
      return defs.map(d => ({ ...d, current: 0, completed: false }));
    }
  } catch { /* fallback */ }
  return [
    { id: 'first_move', name: '初次移动', description: '第一次掷骰移动', rarity: 'common', goal: 1, current: 0, completed: false, tpReward: 1, icon: '🎯', category: 'move', target: 1, secret: false, progress: 0 },
    { id: 'money_1000', name: '小有积蓄', description: '累计赚取1000元', rarity: 'common', goal: 1000, current: 0, completed: false, tpReward: 1, icon: '💰', category: 'money', target: 1000, secret: false, progress: 0 },
    { id: 'money_5000', name: '财富初现', description: '累计赚取5000元', rarity: 'uncommon', goal: 5000, current: 0, completed: false, tpReward: 1, icon: '💰', category: 'money', target: 5000, secret: false, progress: 0 },
    { id: 'money_10000', name: '富甲一方', description: '累计赚取10000元', rarity: 'rare', goal: 10000, current: 0, completed: false, tpReward: 2, icon: '💰', category: 'money', target: 10000, secret: false, progress: 0 },
    { id: 'property_3', name: '地产新手', description: '购买3处地产', rarity: 'common', goal: 3, current: 0, completed: false, tpReward: 1, icon: '🏠', category: 'property', target: 3, secret: false, progress: 0 },
    { id: 'property_8', name: '地产大亨', description: '购买8处地产', rarity: 'rare', goal: 8, current: 0, completed: false, tpReward: 2, icon: '🏠', category: 'property', target: 8, secret: false, progress: 0 },
    { id: 'invest_3', name: '投资入门', description: '进行3次投资', rarity: 'uncommon', goal: 3, current: 0, completed: false, tpReward: 1, icon: '📊', category: 'invest', target: 3, secret: false, progress: 0 },
    { id: 'invest_10', name: '投资专家', description: '进行10次投资', rarity: 'epic', goal: 10, current: 0, completed: false, tpReward: 2, icon: '📊', category: 'invest', target: 10, secret: false, progress: 0 },
    { id: 'monument_1', name: '修缮者', description: '修缮1座纪念碑', rarity: 'uncommon', goal: 1, current: 0, completed: false, tpReward: 1, icon: '🗿', category: 'monument', target: 1, secret: false, progress: 0 },
    { id: 'monument_5', name: '纪念碑守护者', description: '修缮5座纪念碑', rarity: 'legendary', goal: 5, current: 0, completed: false, tpReward: 3, icon: '🗿', category: 'monument', target: 5, secret: false, progress: 0 },
    { id: 'transport_5', name: '旅行者', description: '使用传送5次', rarity: 'uncommon', goal: 5, current: 0, completed: false, tpReward: 1, icon: '🚇', category: 'transport', target: 5, secret: false, progress: 0 },
    { id: 'bankrupt_1', name: '从头再来', description: '经历1次破产', rarity: 'common', goal: 1, current: 0, completed: false, tpReward: 1, icon: '💔', category: 'bankrupt', target: 1, secret: false, progress: 0 },
    { id: 'bankrupt_3', name: '不屈不挠', description: '经历3次破产并重开', rarity: 'epic', goal: 3, current: 0, completed: false, tpReward: 2, icon: '💔', category: 'bankrupt', target: 3, secret: false, progress: 0 },
    { id: 'moves_50', name: '步步为营', description: '完成50次移动', rarity: 'uncommon', goal: 50, current: 0, completed: false, tpReward: 1, icon: '👣', category: 'move', target: 50, secret: false, progress: 0 },
    { id: 'moves_200', name: '环游世界', description: '完成200次移动', rarity: 'legendary', goal: 200, current: 0, completed: false, tpReward: 3, icon: '🌍', category: 'move', target: 200, secret: false, progress: 0 },
  ] as AchievementDef[];
}

export async function loadBehaviorConfig(id: string): Promise<BehaviorConfig | null> {
  try {
    const res = await fetch(`/config/behaviors/${id}.json`);
    if (res.ok) return await res.json();
  } catch { /* fallback */ }
  return null;
}
