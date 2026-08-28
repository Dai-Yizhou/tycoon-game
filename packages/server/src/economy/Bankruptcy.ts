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
  startingValues?: import('@game/shared').Uct;
  error?: string;
}

export class Bankruptcy {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly taxation: Taxation;
  private readonly bankruptcyRecords = new Map<string, BankruptcyRecord>();
  private domainEventDispatcher: ((eventName: string) => void) | null = null;
  private readonly onPlayerUpdated = ({ player }: { player: import('@game/shared').Player }): void => {
    if (isBankruptcyCheckable(player.status) && Object.values(player.values).some((field) => field.current < (field.min ?? Number.NEGATIVE_INFINITY))) {
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
      netWorthAtBankruptcy: Object.values(player.values).reduce((total, field) => total + Math.max(0, field.current), 0),
    };

    this.taxation.clearTaxRecords(playerId);
    this.world.getPlayerManager().updateStatus(playerId, PlayerStatus.Bankrupt);
    this.clearPlayerAssets(playerId);
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
      const runtime = this.world.getRuntimeState();
      const ownerships = runtime.getOwnerships(cell.id);
      if (!ownerships.some((ownership) => ownership.playerId === playerId)) continue;
      runtime.replaceOwnerships(cell.id, ownerships.filter((ownership) => ownership.playerId !== playerId));
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

    const startingValues = { player: Object.fromEntries(Object.entries(player.values).map(([fieldId, field]) => [fieldId, field.current])) };
    this.io.emit('server.playerRestarted', { playerId, restartTime: Date.now(), player: { ...player, values: { ...player.values }, position: { ...player.position } }, startingValues });
    return { success: true, startingValues };
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
