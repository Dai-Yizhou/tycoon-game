import type { AchievementDefinition, AchievementSnapshot, AchievementUnlockedPayload, AchievementView } from '@game/shared';
import type { AchievementOwner, AchievementStore } from './AchievementStore.js';

export type AchievementNotification = (payload: AchievementUnlockedPayload) => void;

export class AchievementManager {
  private readonly definitions: AchievementDefinition[];
  private readonly store: AchievementStore;
  private readonly notify: AchievementNotification;
  private readonly records = new Map<string, Awaited<ReturnType<AchievementStore['load']>>>();

  constructor(definitions: AchievementDefinition[], store: AchievementStore, notify: AchievementNotification = () => undefined) {
    this.definitions = definitions;
    this.store = store;
    this.notify = notify;
  }

  async initialize(owner: AchievementOwner, mapId: string): Promise<AchievementSnapshot> {
    const records = await this.store.load(owner);
    this.records.set(ownerKey(owner), records);
    return this.getSnapshot(owner, mapId);
  }

  async getSnapshot(owner: AchievementOwner, mapId: string): Promise<AchievementSnapshot> {
    const records = this.records.get(ownerKey(owner)) ?? await this.store.load(owner);
    this.records.set(ownerKey(owner), records);
    return {
      enabled: true,
      mapId,
      generatedAt: Date.now(),
      achievements: this.definitions.map((definition) => ({
        ...definition,
        record: records.find((record) => record.achievementId === definition.id) ?? this.newRecord(definition),
      })),
    };
  }

  async recordCellVisit(owner: AchievementOwner, mapId: string, cellId: number): Promise<void> {
    await this.update(owner, mapId, (definition, record) => {
      if (definition.scope !== 'map' || definition.trigger.type !== 'visitCells') return false;
      if (!definition.trigger.cellIds.includes(cellId) || record.seenKeys.includes(String(cellId))) return false;
      record.seenKeys.push(String(cellId));
      record.progress.current = record.seenKeys.length;
      return record.progress.current >= record.progress.target;
    });
  }

  async recordPurchase(owner: AchievementOwner, cellId: number): Promise<void> {
    await this.update(owner, '', (definition, record) => {
      if (definition.scope !== 'global' || definition.trigger.type !== 'purchasedCells') return false;
      if (record.seenKeys.includes(String(cellId))) return false;
      record.seenKeys.push(String(cellId));
      record.progress.current = record.seenKeys.length;
      return record.progress.current >= record.progress.target;
    });
  }

  private async update(owner: AchievementOwner, mapId: string, action: (definition: AchievementDefinition, record: Awaited<ReturnType<AchievementStore['load']>>[number]) => boolean): Promise<void> {
    const key = ownerKey(owner);
    const records = this.records.get(key) ?? await this.store.load(owner);
    this.records.set(key, records);
    const unlocked: AchievementView[] = [];
    for (const definition of this.definitions) {
      const record = records.find((item) => item.achievementId === definition.id) ?? this.newRecord(definition, mapId);
      if (!records.includes(record)) records.push(record);
      if (record.unlocked) continue;
      if (action(definition, record)) {
        record.unlocked = true;
        record.unlockedAt = Date.now();
        unlocked.push({ ...definition, record: { ...record, progress: { ...record.progress }, seenKeys: [...record.seenKeys] } });
      }
    }
    await this.store.save(owner, records);
    for (const achievement of unlocked) this.notify({ achievement, unlockedAt: achievement.record.unlockedAt ?? Date.now() });
  }

  private newRecord(definition: AchievementDefinition, mapId?: string) {
    const target = definition.progress?.target ?? defaultTarget(definition);
    return { achievementId: definition.id, scope: definition.scope, ...(definition.scope === 'map' && mapId ? { mapId } : {}), progress: { current: 0, target, visible: definition.progress?.visible ?? true }, unlocked: false, seenKeys: [] };
  }
}

function defaultTarget(definition: AchievementDefinition): number {
  const trigger = definition.trigger;
  if (trigger.type === 'visitCells' || trigger.type === 'completeEvents') return trigger.cellIds.length;
  if (trigger.type === 'ownedCells' || trigger.type === 'purchasedCells') return trigger.target;
  if (trigger.type === 'ranking') return trigger.targetRank;
  return 1;
}

function ownerKey(owner: AchievementOwner): string {
  return `${owner.guest ? 'guest' : 'account'}:${owner.accountId}`;
}
