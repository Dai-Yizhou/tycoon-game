import type { AchievementDefinition, AchievementSnapshot, AchievementUnlockedPayload, AchievementView } from '@game/shared';
import type { AchievementOwner, AchievementStore } from './AchievementStore.js';

export type AchievementNotification = (payload: AchievementUnlockedPayload) => void;

export class AchievementManager {
  private readonly definitions: AchievementDefinition[];
  private readonly store: AchievementStore;
  private readonly notify: AchievementNotification;
  private readonly records = new Map<string, Awaited<ReturnType<AchievementStore['load']>>>();
  private readonly ownerQueues = new Map<string, Promise<void>>();

  constructor(definitions: AchievementDefinition[], store: AchievementStore, notify: AchievementNotification = () => undefined) {
    this.definitions = definitions;
    this.store = store;
    this.notify = notify;
  }

  async initialize(owner: AchievementOwner, mapId: string): Promise<AchievementSnapshot> {
    const key = ownerKey(owner);
    const records = await this.store.load(owner);
    this.records.set(key, records);
    return await this.getSnapshot(owner, mapId);
  }

  async getSnapshot(owner: AchievementOwner, mapId: string): Promise<AchievementSnapshot> {
    const key = ownerKey(owner);
    const allRecords = this.records.get(key) ?? await this.store.load(owner);
    this.records.set(ownerKey(owner), allRecords);
    const records = allRecords.filter((record) => record.scope === 'global' || record.mapId === mapId);
    return {
      enabled: true,
      mapId,
      generatedAt: Date.now(),
      achievements: this.definitions.map((definition) => ({
        ...definition,
        record: records.find((record) => record.achievementId === definition.id && record.scope === definition.scope && (definition.scope === 'global' || record.mapId === mapId)) ?? this.newRecord(definition, mapId),
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

  async recordPurchase(owner: AchievementOwner, mapId: string, cellId: number): Promise<void> {
    await this.update(owner, mapId, (definition, record) => {
      if (definition.scope !== 'global' || definition.trigger.type !== 'purchasedCells') return false;
      if (record.seenKeys.includes(String(cellId))) return false;
      record.seenKeys.push(String(cellId));
      record.progress.current = record.seenKeys.length;
      return record.progress.current >= record.progress.target;
    });
  }

  async recordEvent(owner: AchievementOwner, mapId: string, cellId: number, eventId: string): Promise<void> {
    await this.update(owner, mapId, (definition, record) => {
      if (definition.scope !== 'map' || definition.trigger.type !== 'completeEvents') return false;
      const key = `${cellId}:${eventId}`;
      if (!definition.trigger.cellIds.includes(cellId) || !definition.trigger.eventIds.includes(eventId) || record.seenKeys.includes(key)) return false;
      record.seenKeys.push(key);
      record.progress.current = record.seenKeys.length;
      return record.progress.current >= record.progress.target;
    });
  }

  async recordUct(owner: AchievementOwner, mapId: string, player: import('@game/shared').Player): Promise<void> {
    await this.update(owner, mapId, (definition, record) => {
      if (definition.trigger.type !== 'uctThreshold') return false;
      const current = player.values[definition.trigger.fieldId]?.current ?? 0;
      record.progress.current = current;
      return current >= record.progress.target;
    });
  }

  async refreshOwnedCells(owner: AchievementOwner, mapId: string, cellIds: number[]): Promise<void> {
    await this.update(owner, mapId, (definition, record) => {
      if (definition.scope !== 'map' || definition.trigger.type !== 'ownedCells') return false;
      record.progress.current = new Set(cellIds).size;
      return record.progress.current >= record.progress.target;
    });
  }

  async recordRanking(owner: AchievementOwner, rank: number | null): Promise<void> {
    await this.update(owner, undefined, (definition, record) => {
      if (definition.scope !== 'global' || definition.trigger.type !== 'ranking' || rank === null) return false;
      record.progress.current = rank <= record.progress.target ? record.progress.target : 0;
      return rank <= record.progress.target;
    });
  }

  private async update(owner: AchievementOwner, mapId: string | undefined, action: (definition: AchievementDefinition, record: Awaited<ReturnType<AchievementStore['load']>>[number]) => boolean): Promise<void> {
    const key = ownerKey(owner);
    const previous = this.ownerQueues.get(key) ?? Promise.resolve();
    const current = previous.then(() => this.updateUnlocked(key, owner, mapId, action));
    this.ownerQueues.set(key, current);
    try {
      await current;
    } finally {
      if (this.ownerQueues.get(key) === current) this.ownerQueues.delete(key);
    }
  }

  private async updateUnlocked(key: string, owner: AchievementOwner, mapId: string | undefined, action: (definition: AchievementDefinition, record: Awaited<ReturnType<AchievementStore['load']>>[number]) => boolean): Promise<void> {
    const records = this.records.get(key) ?? await this.store.load(owner);
    this.records.set(key, records);
    const unlocked: AchievementView[] = [];
    for (const definition of this.definitions) {
      const record = records.find((item) => item.achievementId === definition.id && item.scope === definition.scope && (definition.scope === 'global' || item.mapId === mapId)) ?? this.newRecord(definition, mapId);
      if (!records.includes(record)) records.push(record);
      if (record.unlocked) continue;
      if (action(definition, record)) {
        record.unlocked = true;
        record.unlockedAt = Date.now();
        unlocked.push({ ...definition, record: { ...record, progress: { ...record.progress }, seenKeys: [...record.seenKeys] } });
      }
    }
    try {
      await this.store.save(owner, records);
    } catch (error) {
      this.records.delete(key);
      throw error;
    }
    for (const achievement of unlocked) this.notify({ playerId: owner.accountId, achievement, unlockedAt: achievement.record.unlockedAt ?? Date.now() });
  }

  private newRecord(definition: AchievementDefinition, mapId?: string) {
    const target = definition.progress?.target ?? defaultTarget(definition);
    return { achievementId: definition.id, scope: definition.scope, ...(definition.scope === 'map' && mapId ? { mapId } : {}), progress: { current: 0, target, visible: definition.progress?.visible ?? true }, unlocked: false, unlockedAt: undefined, seenKeys: [] };
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
  return owner.accountId;
}
