import { PlayerStatus, isBankruptcyCheckable } from '@game/shared';
import type { GameWorld } from '../world/GameWorld.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { Taxation } from './Taxation.js';

export interface BankruptcyRecord {
  id: string;
  playerId: string;
  bankruptcyTime: number;
  reason: 'negative_net_worth' | 'debt_overdue' | 'manual';
  netWorthAtBankruptcy: number;
}

export interface BankruptcyConfig {
  bankruptcyThresholdTime: number;
  bankruptcyCheckInterval: number;
}

export const DEFAULT_BANKRUPTCY_CONFIG: BankruptcyConfig = {
  bankruptcyThresholdTime: 300000,
  bankruptcyCheckInterval: 60000,
};

interface BankruptcyCheckState {
  playerId: string;
  firstNegativeTime: number | null;
}

export interface BankruptcyResult {
  success: boolean;
  bankruptcyId?: string;
  error?: string;
}

export interface BankruptcyRestartResult {
  success: boolean;
  startingMoney?: number;
  startingCredit?: number;
  error?: string;
}

export class Bankruptcy {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly config: BankruptcyConfig;
  private readonly bankruptcyRecords = new Map<string, BankruptcyRecord>();
  private readonly checkStates = new Map<string, BankruptcyCheckState>();
  private bankruptcyCheckTimer: NodeJS.Timeout | null = null;

  constructor(io: TypedServer, world: GameWorld, taxation: Taxation, config: BankruptcyConfig = DEFAULT_BANKRUPTCY_CONFIG) {
    this.io = io;
    this.world = world;
    void taxation;
    this.config = config;
  }

  startBankruptcyCheck(): void {
    if (this.bankruptcyCheckTimer) return;
    this.bankruptcyCheckTimer = setInterval(() => this.executeBankruptcyCheck(), this.config.bankruptcyCheckInterval);
    this.bankruptcyCheckTimer.unref();
  }

  stopBankruptcyCheck(): void {
    if (!this.bankruptcyCheckTimer) return;
    clearInterval(this.bankruptcyCheckTimer);
    this.bankruptcyCheckTimer = null;
  }

  private executeBankruptcyCheck(): void {
    for (const player of this.world.getAllPlayers()) {
      if (!isBankruptcyCheckable(player.status)) continue;
      const netWorth = player.values.money?.current ?? 0;
      if (netWorth <= 0) {
        const state = this.checkStates.get(player.id);
        if (!state || !state.firstNegativeTime) {
          this.checkStates.set(player.id, { playerId: player.id, firstNegativeTime: Date.now() });
        } else if (Date.now() - state.firstNegativeTime >= this.config.bankruptcyThresholdTime) {
          this.triggerBankruptcy(player.id, 'negative_net_worth');
        }
      } else {
        this.checkStates.delete(player.id);
      }
    }
  }

  triggerBankruptcy(playerId: string, reason: 'negative_net_worth' | 'debt_overdue' | 'manual'): BankruptcyResult {
    const player = this.world.getPlayer(playerId);
    if (!player) return { success: false, error: '玩家不存在' };
    if (player.status === PlayerStatus.Bankrupt) return { success: false, error: '玩家已破产' };

    const bankruptcyId = `bankruptcy_${playerId}_${Date.now()}`;
    const bankruptcyTime = Date.now();
    const record: BankruptcyRecord = {
      id: bankruptcyId,
      playerId,
      bankruptcyTime,
      reason,
      netWorthAtBankruptcy: player.values.money?.current ?? 0,
    };

    this.world.getPlayerManager().updateStatus(playerId, PlayerStatus.Bankrupt);
    this.bankruptcyRecords.set(playerId, record);
    this.checkStates.delete(playerId);

    this.io.emit('server.playerBankrupt', { playerId, bankruptcyId, bankruptcyTime, reason, netWorthAtBankruptcy: record.netWorthAtBankruptcy });
    return { success: true, bankruptcyId };
  }

  restartBankruptPlayer(playerId: string, _socket: TypedSocket): BankruptcyRestartResult {
    const player = this.world.getPlayer(playerId);
    if (!player) return { success: false, error: '玩家不存在' };
    if (player.status !== PlayerStatus.Bankrupt) return { success: false, error: '玩家未破产' };

    const initialValues = this.world.buildInitialPlayerValues();
    const teamId = player.teamId;
    player.values = initialValues;
    player.teamId = teamId;
    player.status = PlayerStatus.Normal;
    const startCellId = this.world.getMapMeta()?.startCellId ?? this.findStartCellId();
    player.position = { cellId: startCellId };
    this.world.updatePlayer(player);
    this.bankruptcyRecords.delete(playerId);

    const startingMoney = player.values.money?.current;
    const startingCredit = player.values.credit?.current;
    this.io.emit('server.playerRestarted', { playerId, restartTime: Date.now(), startingMoney, startingCredit });
    return { success: true, startingMoney, startingCredit };
  }

  private findStartCellId(): number {
    return this.world.getMapData()?.find((cell) => getExtra<string>(cell, 'type', '') === 'start')?.id ?? 0;
  }

  getBankruptcyRecord(playerId: string): BankruptcyRecord | undefined { return this.bankruptcyRecords.get(playerId); }
  isPlayerBankrupt(playerId: string): boolean { return this.world.getPlayer(playerId)?.status === PlayerStatus.Bankrupt; }
  getConfig(): BankruptcyConfig { return this.config; }
  manualBankruptcy(playerId: string): BankruptcyResult { return this.triggerBankruptcy(playerId, 'manual'); }

  cleanup(): void {
    this.stopBankruptcyCheck();
    this.bankruptcyRecords.clear();
    this.checkStates.clear();
  }
}

export function createBankruptcy(io: TypedServer, world: GameWorld, taxation: Taxation, config?: BankruptcyConfig): Bankruptcy {
  return new Bankruptcy(io, world, taxation, config);
}

function getExtra<T>(cell: { extra: Record<string, unknown> }, key: string, defaultValue?: T): T {
  const value = cell.extra[key];
  return ((value as T) ?? defaultValue) as T;
}
