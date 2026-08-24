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

export type BankruptcyConfig = Record<string, never>;
export const DEFAULT_BANKRUPTCY_CONFIG: BankruptcyConfig = {};

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
  private readonly taxation: Taxation;
  private readonly bankruptcyRecords = new Map<string, BankruptcyRecord>();
  private domainEventDispatcher: ((eventName: string) => void) | null = null;
  private readonly onPlayerUpdated = ({ player }: { player: import('@game/shared').Player }): void => {
    if (isBankruptcyCheckable(player.status) && player.values.money && player.values.money.current <= 0) {
      this.triggerBankruptcy(player.id, 'negative_net_worth');
    }
  };

  constructor(io: TypedServer, world: GameWorld, taxation: Taxation, _config: BankruptcyConfig = DEFAULT_BANKRUPTCY_CONFIG) {
    this.io = io;
    this.world = world;
    this.taxation = taxation;
    this.world.on('playerUpdated', this.onPlayerUpdated);
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

    this.taxation.clearTaxRecords(playerId);
    this.world.getPlayerManager().updateStatus(playerId, PlayerStatus.Bankrupt);
    this.clearPlayerAssets(playerId);
    const mutablePlayer = player as import('@game/shared').Player & { extra?: Record<string, unknown> };
    if (mutablePlayer.extra) {
      delete mutablePlayer.extra.jail;
      delete mutablePlayer.extra.economy;
      delete mutablePlayer.extra.projectOwner;
      delete mutablePlayer.extra.projectState;
      delete mutablePlayer.extra.assets;
    }
    this.world.updatePlayer(player);
    this.world.saveSnapshot(this.taxation.getAllTaxRecords(), {});
    this.bankruptcyRecords.set(playerId, record);

    this.io.emit('server.playerBankrupt', { playerId, bankruptcyId, bankruptcyTime, reason, netWorthAtBankruptcy: record.netWorthAtBankruptcy });
    this.domainEventDispatcher?.('shareholder-bankrupt');
    return { success: true, bankruptcyId };
  }

  setDomainEventDispatcher(dispatcher: (eventName: string) => void): void {
    this.domainEventDispatcher = dispatcher;
  }

  private clearPlayerAssets(playerId: string): void {
    for (const cell of this.world.getMapData() ?? []) {
      const ownerships = Array.isArray(cell.extra.ownerships) ? cell.extra.ownerships as Array<{ playerId: string }> : [];
      const owners = Array.isArray(cell.extra.owners) ? cell.extra.owners as string[] : [];
      const ownsProject = cell.extra.projectOwner === playerId || cell.extra.projectOwnerId === playerId;
      if (!ownerships.some((ownership) => ownership.playerId === playerId) && !owners.includes(playerId) && !ownsProject) continue;
      const remaining = ownerships.filter((ownership) => ownership.playerId !== playerId);
      cell.extra.ownerships = remaining;
      cell.extra.owners = owners.filter((ownerId) => ownerId !== playerId);
      if (ownsProject) {
        delete cell.extra.projectOwner;
        delete cell.extra.projectOwnerId;
        delete cell.extra.projectState;
      }
      if (remaining.length === 0) {
        cell.extra.level = 0;
        cell.extra.accumulatedValue = 0;
      }
      if (Array.isArray(cell.extra.investments)) {
        cell.extra.investments = (cell.extra.investments as Array<{ playerId?: string }>).filter((investment) => investment.playerId !== playerId);
      }
    }
  }

  restartBankruptPlayer(playerId: string, _socket: TypedSocket): BankruptcyRestartResult {
    const player = this.world.getPlayer(playerId);
    if (!player) return { success: false, error: '玩家不存在' };
    if (player.status !== PlayerStatus.Bankrupt) return { success: false, error: '玩家未破产' };

    const initialValues = this.world.buildInitialPlayerValues();
    const teamId = player.teamId;
    player.values = initialValues;
    player.teamId = teamId;
    const startCellId = this.world.getMapMeta()?.startCellId ?? this.findStartCellId();
    player.position = { cellId: startCellId };
    player.status = PlayerStatus.Normal;
    this.world.updatePlayer(player);
    this.bankruptcyRecords.delete(playerId);

    const startingMoney = player.values.money?.current;
    const startingCredit = player.values.credit?.current;
    this.io.emit('server.playerRestarted', { playerId, restartTime: Date.now(), player: { ...player, values: { ...player.values }, position: { ...player.position } }, startingMoney, startingCredit });
    return { success: true, startingMoney, startingCredit };
  }

  private findStartCellId(): number {
    return this.world.getMapMeta()?.startCellId ?? 0;
  }

  getBankruptcyRecord(playerId: string): BankruptcyRecord | undefined { return this.bankruptcyRecords.get(playerId); }
  isPlayerBankrupt(playerId: string): boolean { return this.world.getPlayer(playerId)?.status === PlayerStatus.Bankrupt; }
  getConfig(): BankruptcyConfig { return DEFAULT_BANKRUPTCY_CONFIG; }
  manualBankruptcy(playerId: string): BankruptcyResult { return this.triggerBankruptcy(playerId, 'manual'); }

  cleanup(): void {
    this.world.off('playerUpdated', this.onPlayerUpdated);
    this.bankruptcyRecords.clear();
    this.domainEventDispatcher = null;
  }
}


export function createBankruptcy(io: TypedServer, world: GameWorld, taxation: Taxation, config?: BankruptcyConfig): Bankruptcy {
  return new Bankruptcy(io, world, taxation, config);
}
