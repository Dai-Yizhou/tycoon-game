import { DomainEvents, PlayerStatus, getLocale, isBankruptcyCheckable, t, type BankruptFieldTrigger, type DomainEvent } from '@game/shared';
import type { GameWorld } from '../world/GameWorld.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import { broadcastSystemMessage } from '../net/systemChat.js';
import type { Taxation } from './Taxation.js';

/** 破产原因：负数越线 / 债务逾期 / 手动触发 / 长期离线清理 */
export type BankruptcyReason = 'negative_net_worth' | 'debt_overdue' | 'manual' | 'inactivity';

export interface BankruptcyRecord {
  id: string;
  playerId: string;
  bankruptcyTime: number;
  reason: BankruptcyReason;
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
  /** 待判定的玩家（在一次操作完整结算后统一判定，避免结算中途提前清产） */
  private readonly pendingChecks = new Set<string>();
  private flushScheduled = false;
  /** 上一次「结算边界」后的字段值快照，用于给出触发前的 previous 值 */
  private readonly lastSettledValues = new Map<string, Record<string, number>>();
  private domainEventDispatcher: ((eventName: DomainEvent) => void) | null = null;
  private ownershipChanged?: (playerId: string, guest: boolean) => void;
  private readonly onPlayerAdded = ({ player }: { player: import('@game/shared').Player }): void => {
    this.lastSettledValues.set(player.id, this.snapshotValues(player));
  };
  private snapshotValues(player: import('@game/shared').Player): Record<string, number> {
    return Object.fromEntries(Object.values(player.values).map((field) => [field.id, field.current]));
  }

  /**
   * 负债式破产：任一字段低于其 `min`（破产阈值）即触发。
   *
   * 判定推迟到当前同步操作完整结算之后（微任务），以保证「先结算操作、再破产」：
   * 例如购买/投资会先扣款、再登记股权，若在扣款瞬间就清算，会把清算后才登记的
   * 股权留在已破产玩家名下。推迟后清算发生在操作收尾，清产覆盖本次操作的全部资产变动。
   * 被动路径（税收/事件/租金）同走此入口，可在无二次确认的情况下直接致破产。
   */
  private readonly onPlayerUpdated = ({ player }: { player: import('@game/shared').Player }): void => {
    this.pendingChecks.add(player.id);
    this.scheduleFlush();
  };

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.flushPendingBankruptcies();
    });
  }

  /**
   * 处理所有待判定玩家：逐字段比对破产阈值，命中即清算。
   *
   * 公开供测试与需要在结算后立即判定的调用方使用（微任务之外可手动触发）。
   */
  flushPendingBankruptcies(): void {
    const playerIds = [...this.pendingChecks];
    this.pendingChecks.clear();
    for (const playerId of playerIds) {
      const player = this.world.getPlayer(playerId);
      if (!player) continue;
      const settled = this.snapshotValues(player);
      const previous = this.lastSettledValues.get(playerId) ?? settled;
      const triggers: BankruptFieldTrigger[] = [];
      for (const field of Object.values(player.values)) {
        const minimum = field.min ?? Number.NEGATIVE_INFINITY;
        // 只看结果：低于阈值即破产。不再依赖「从 > min 掉到 <= min」，
        // 因为负债口径下允许一步跨入负值。
        if (field.current < minimum) {
          triggers.push({ fieldId: field.id, fieldName: this.resolveFieldName(player, field.id), previous: previous[field.id] ?? field.current, current: field.current, min: minimum });
        }
      }
      this.lastSettledValues.set(playerId, settled);
      if (isBankruptcyCheckable(player.status) && triggers.length > 0) {
        this.triggerBankruptcy(playerId, 'negative_net_worth', triggers);
      }
    }
  }

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

  triggerBankruptcy(playerId: string, reason: BankruptcyReason, triggeredFields: BankruptFieldTrigger[] = []): BankruptcyResult {
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
   * 破产可观测性：向聊天框广播系统消息，说明触发原因与越线字段
   *
   * 负债口径下允许数值扣成负数，任一字段低于其 min（破产阈值）即触发；
   * 把具体字段与前后值播出来，用户实测时可直接从聊天框读出是哪一步操作把人打到破产。
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
    this.pendingChecks.clear();
    this.lastSettledValues.clear();
    this.flushScheduled = false;
    this.domainEventDispatcher = null;
  }
}


export function createBankruptcy(io: TypedServer, world: GameWorld, taxation: Taxation, config?: BankruptcyConfig): Bankruptcy {
  return new Bankruptcy(io, world, taxation, config);
}
