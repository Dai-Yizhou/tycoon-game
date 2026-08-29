import type { AchievementRecord } from '@game/shared';

export interface AchievementOwner {
  accountId: string;
  guest: boolean;
}

export interface AchievementStore {
  load(owner: AchievementOwner): Promise<AchievementRecord[]>;
  save(owner: AchievementOwner, records: AchievementRecord[]): Promise<void>;
  merge(from: AchievementOwner, to: AchievementOwner): Promise<AchievementRecord[]>;
  close?(): Promise<void>;
}
