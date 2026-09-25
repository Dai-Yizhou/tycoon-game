import { DomainEvents, PlayerStatus, getLocale, isBankruptcyCheckable, t, type BankruptFieldTrigger, type DomainEvent } from '@game/shared';
import type { GameWorld } from '../world/GameWorld.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import { broadcastSystemMessage } from '../net/systemChat.js';
import type { Taxation } from './Taxation.js';

export interface BankruptcyRecord {
  id: string;
  playerId: string;
  bankruptcyTime: number;
  reason: 'negative_net_worth' | 'debt_overdue' | 'manual';
  netWorthAtBankruptcy: number;
  /** 触发破产的数值字段明细，便于事后追溯 */
  triggeredFields: BankruptFieldTrigger[];
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
  private readonly previousValues = new Map<string, Record<string, number>>();
  private domainEventDispatcher: ((eventName: DomainEvent) => void) | null = null;
  private ownershipChanged?: (playerId: string, guest: boolean) => void;
  private readonly onPlayerAdded = ({ player }: { player: import('@game/shared').Player }): void => {
    this.previousValues.set(player.id, this.snapshotValues(player));
  };
  private snapshotValues(player: import('@game/shared').Player): Record<string, number> {
    return Object.fromEntries(Object.values(player.values).map((field) => [field.id, field.current]));
  }

  private readonly onPlayerUpdated = ({ player }: { player: import('@game/shared').Player }): void => {
    const previous = this.previousValues.get(player.id) ?? this.snapshotValues(player);
    const triggers: BankruptFieldTrigger[] = [];
    for (const field of Object.values(player.values)) {
      const minimum = field.min ?? Number.NEGATIVE_INFINITY;
      const before = previous[field.id] ?? field.current;
      // 内测口径：经济操作一律把数值钳在 min 之上，玩家无法负债，
      // 因此「跨过 min 触底」即破产。起始值本就等于 min 时不触发（before > min 不成立）。
      if (before > minimum && field.current <= minimum) {
        triggers.push({ fieldId: field.id, fieldName: this.resolveFieldName(player, field.id), previous: before, current: field.current, min: minimum });
      }
    }
    this.previousValues.set(player.id, Object.fromEntries(Object.values(player.values).map((field) => [field.id, field.current])));
    if (isBankruptcyCheckable(player.status) && triggers.length > 0) {
      this.triggerBankruptcy(player.id, 'negative_net_worth', triggers);
    }
  };

  /** 字段显示名：优先取地图数值字段定义，其次取玩家身上已有的名称，最后回退字段 ID */
  private resolveFieldName(player: import('@game/shared').Player, fieldId: string): string {
    const locale = getLocale();
    const definition = this.world.getMapMeta()?.valueFieldDefinitions.find((item) => item.id === fieldId);
    const localized = definition?.name as Record<string, string> | undefined;
    if (localized) {
      return localized[locale] ?? localized['zh-CN'] ?? localized['en-US'] ?? fieldId;
    }
    const own = player.values[fieldId]?.name;
    return typeof own === 'string' && own.length > 0 ? own : fieldId;
  }

  constructor(io: TypedServer, world: GameWorld, taxation: Taxation, _config: BankruptcyConfig = DEFAULT_BANKRUPTCY_CONFIG) {
    this.io = io;
    this.world = world;
    this.taxation = taxation;
    this.world.on('playerAdded', this.onPlayerAdded);
    this.world.on('playerUpdated', this.onPlayerUpdated);
    for (const player of this.world.getAllPlayers()) this.onPlayerAdded({ player });
  }

  triggerBankruptcy(playerId: string, reason: 'negative_net_worth' | 'debt_overdue' | 'manual', triggeredFields: BankruptFieldTrigger[] = []): BankruptcyResult {
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
      triggeredFields,
    };

    this.taxation.clearTaxRecords(playerId);
    this.world.getPlayerManager().updateStatus(playerId, PlayerStatus.Bankrupt);
    this.clearPlayerAssets(playerId);
    this.ownershipChanged?.(playerId, player.username.startsWith('guest_'));
    this.world.updatePlayer(player);
    this.world.saveSnapshot(this.taxation.getAllTaxRecords(), {});
    this.bankruptcyRecords.set(playerId, record);

    this.io.emit('server.playerBankrupt', { playerId, bankruptcyId, bankruptcyTime, reason, netWorthAtBankruptcy: record.netWorthAtBankruptcy, triggeredFields });
    this.broadcastBankruptcyMessage(player.username, reason, triggeredFields);
    this.domainEventDispatcher?.(DomainEvents.ShareholderBankrupt);
    return { success: true, bankruptcyId };
  }

  /**
   * 破产可观测性：向聊天框广播系统消息，说明触发原因与触底字段
   *
   * 内测口径下经济操作无法把数值扣到 min 以下，玩家负债不可能发生，
   * 因此破产只由「数值触底」引起；把具体字段与前后值播出来，用户实测时
   * 可直接从聊天框读出是哪一步操作把人打到破产。
   */
  private broadcastBankruptcyMessage(username: string, reason: BankruptcyRecord['reason'], triggeredFields: BankruptFieldTrigger[]): void {
    const reasonLabel = t(`server.bankruptReason.${reason}`);
    const separator = t('server.amountSeparator');
    const detail = triggeredFields
      .map((field) => t('server.bankruptFieldDetail', { field: field.fieldName, previous: field.previous, current: field.current, min: field.min }))
      .join(separator);
    broadcastSystemMessage(
      this.io,
      detail
        ? t('server.bankruptTriggeredDetail', { player: username, reason: reasonLabel, detail })
        : t('server.bankruptTriggered', { player: username, reason: reasonLabel }),
    );
  }

  setOwnershipChangedHandler(handler: (playerId: string, guest: boolean) => void): void {
    this.ownershipChanged = handler;
  }

  setDomainEventDispatcher(dispatcher: (eventName: DomainEvent) => void): void {
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
    this.world.off('playerAdded', this.onPlayerAdded);
    this.world.off('playerUpdated', this.onPlayerUpdated);
    this.bankruptcyRecords.clear();
    this.previousValues.clear();
    this.domainEventDispatcher = null;
  }
}


export function createBankruptcy(io: TypedServer, world: GameWorld, taxation: Taxation, config?: BankruptcyConfig): Bankruptcy {
  return new Bankruptcy(io, world, taxation, config);
}
