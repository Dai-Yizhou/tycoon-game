/**
 * 纪念碑处理器
 *
 * 负责：
 * - 修缮功能：玩家可修缮纪念碑
 * - 消耗财产（修缮费用从 cell.repairCost 读取）
 * - 增加玩家信用值
 * - 增加区域繁荣度（通过 ProsperityManager）
 * - 纪念碑状态视觉显示
 *
 * 设计原则：
 * - 修缮费用从地图数据读取
 * - 繁荣度由 ProsperityManager 统一管理（昼夜衰减、纪念碑修缮增益）
 * - 服务端权威校验所有修缮操作
 */

import type { AckResult, Cell, Player } from '@game/shared';
import { getExtra, normalizeCellType, CellTypes, t } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';
import type { GameWorld } from '../world/GameWorld.js';
import type { ProsperityManager } from '../world/ProsperityManager.js';
import { ErrorCodes, emitError } from '../transport/handlers.js';
import type { BehaviorEngine } from '../behavior/BehaviorEngine.js';
import { EconomyService } from '../economy/EconomyService.js';

/**
 * 修缮结果
 */
export interface RepairResult {
  /** 玩家 ID */
  playerId: string;
  /** 纪念碑格子 ID */
  monumentId: number;
  /** 修缮费用 */
  cost: number;
  /** 信用值增加 */
  creditIncrease: number;
  /** 繁荣度增加 */
  prosperityIncrease: number;
  /** 纪念碑格子数据 */
  cell: Cell;
}

/**
 * 纪念碑内部状态（不含繁荣度，繁荣度由 ProsperityManager 管理）
 */
interface MonumentInternalState {
  /** 纪念碑 ID */
  monumentId: number;
  /** 上次修缮时间 */
  lastRepairTime: number;
  /** 繁荣度衰减率（每小时） */
  decayRate: number;
  /** 最大繁荣度 */
  maxProsperity: number;
}

/**
 * 纪念碑状态（API 返回，包含从 ProsperityManager 读取的繁荣度快照）
 */
export interface MonumentState extends MonumentInternalState {
  /** 区域繁荣度（从 ProsperityManager 读取的快照） */
  regionProsperity: number;
}

/**
 * 纪念碑处理器
 */
export class MonumentHandler {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly economy: EconomyService;
  /** 繁荣度管理器（可选，由 app.ts 注入） */
  private prosperityManager: ProsperityManager | null = null;
  /** 行为执行引擎（可选，由 app.ts 注入） */
  private behaviorEngine: BehaviorEngine | null = null;
  /** 纪念碑状态映射 */
  private readonly monumentStates: Map<number, MonumentInternalState> = new Map();
  /** 最大繁荣度 */
  private readonly maxProsperity = 100;

  constructor(io: TypedServer, world: GameWorld, prosperityManager?: ProsperityManager, economy: EconomyService = new EconomyService(world)) {
    this.io = io;
    this.world = world;
    this.economy = economy;
    if (prosperityManager) {
      this.prosperityManager = prosperityManager;
    }
    this.initializeMonuments();
  }

  /**
   * 注入繁荣度管理器（用于 app.ts 中延迟注入）
   */
  setProsperityManager(prosperityManager: ProsperityManager): void {
    this.prosperityManager = prosperityManager;
    logger.debug('ProsperityManager 已注入 MonumentHandler');
  }

  /**
   * 设置行为执行引擎（在 app.ts 中调用）
   *
   * @param engine 行为执行引擎实例
   */
  setBehaviorEngine(engine: BehaviorEngine): void {
    this.behaviorEngine = engine;
    logger.info('BehaviorEngine 已注入 MonumentHandler');
  }

  /**
   * 获取行为执行引擎
   */
  getBehaviorEngine(): BehaviorEngine | null {
    return this.behaviorEngine;
  }

  /**
   * 初始化纪念碑状态
   */
  private initializeMonuments(): void {
    const mapData = this.world.getMapData();
    if (!mapData) return;

    for (const cell of mapData) {
      const cellType = normalizeCellType(cell);
      if (cellType === CellTypes.Monument) {
        this.monumentStates.set(cell.id, {
          monumentId: cell.id,
          lastRepairTime: Date.now(),
          decayRate: getExtra<number>(cell, 'decayRate', 0.1) ?? 0.1, // 默认每小时衰减 10%
          maxProsperity: getExtra<number>(cell, 'maxProsperity', this.maxProsperity) ?? this.maxProsperity,
        });
      }
    }

    logger.debug(`纪念碑初始化完成：${this.monumentStates.size} 个纪念碑`);
  }

  /**
   * 注册纪念碑事件处理器
   */
  register(socket: TypedSocket): void {
    socket.on('client.repairMonument', (payload, ack) => {
      this.handleRepairMonument(socket, payload, ack);
    });

    socket.on('client.getMonumentStatus', (payload, ack) => {
      this.handleGetMonumentStatus(socket, payload, ack);
    });
  }

  /**
   * 处理修缮纪念碑请求
   */
  private handleRepairMonument(
    socket: TypedSocket,
    payload: { monumentId: number },
    ack?: (result: AckResult<RepairResult>) => void,
  ): void {
    try {
      // 1. 验证玩家身份
      const playerId = socket.data.playerId;
      if (!playerId) {
        emitError(socket, ErrorCodes.NotAuthenticated, '请先登录');
        ack?.({ ok: false, error: 'not_authenticated' });
        return;
      }

      // 2. 获取玩家数据
      const player = this.world.getPlayer(playerId);
      if (!player) {
        emitError(socket, ErrorCodes.PlayerNotFound, '玩家不存在');
        ack?.({ ok: false, error: 'player_not_found' });
        return;
      }

      // 3. 获取地图数据
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        emitError(socket, ErrorCodes.InternalError, '地图未加载');
        ack?.({ ok: false, error: 'map_not_loaded' });
        return;
      }

      // 4. 获取纪念碑格子
      const monumentCell = mapIndex.getById(payload.monumentId);
      if (!monumentCell) {
        emitError(socket, ErrorCodes.InvalidPayload, `纪念碑 ${payload.monumentId} 不存在`);
        ack?.({ ok: false, error: 'monument_not_found' });
        return;
      }

      // 5. 验证格子类型
      const cellType = normalizeCellType(monumentCell);
      if (cellType !== CellTypes.Monument) {
        emitError(socket, ErrorCodes.InvalidPayload, '该格子不是纪念碑');
        ack?.({ ok: false, error: 'not_monument' });
        return;
      }

      // 6. 获取修缮费用
      const cost = getExtra<number>(monumentCell, 'repairCost', 100) ?? 100;

      // 7. 检查玩家财产是否足够
      const money = this.getPlayerMoney(player);
      if (money < cost) {
        emitError(socket, ErrorCodes.InvalidPayload, `财产不足，需要 ${cost}，当前 ${money}`);
        ack?.({ ok: false, error: 'insufficient_money' });
        return;
      }

      // 8. 执行修缮
      const result = this.executeRepair(player, monumentCell, cost);
      if (!result) {
        emitError(socket, ErrorCodes.InternalError, '修缮失败');
        ack?.({ ok: false, error: 'repair_failed' });
        return;
      }

      // 9. 检查是否有 behavior 字段（作为额外效果）
      const behaviorId = monumentCell.behavior ?? '';
      if (behaviorId && this.behaviorEngine) {
        const behaviorResult = this.behaviorEngine.executeBehavior(behaviorId, player, {
          cellType: CellTypes.Monument,
          cell: monumentCell,
          action: 'repair',
        });
        if (behaviorResult) {
          logger.info(
            `玩家 ${playerId} 修缮纪念碑后触发 behavior ${behaviorId}: ${behaviorResult.event.msg}`,
          );
        }
      }

      // 10. 广播修缮事件
      this.broadcastRepair(result);

      // 11. 返回成功结果
      ack?.({ ok: true, data: result });
      logger.debug(`玩家 ${playerId} 修缮了纪念碑 ${payload.monumentId}，费用 ${cost}，信用值增加 ${result.creditIncrease}`);
    } catch (err) {
      logger.error('修缮纪念碑处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 处理获取纪念碑状态请求
   */
  private handleGetMonumentStatus(
    socket: TypedSocket,
    payload: { monumentId: number },
    ack?: (result: AckResult<{ state: MonumentState }>) => void,
  ): void {
    try {
      const mapIndex = this.world.getMapIndex();
      if (!mapIndex) {
        emitError(socket, ErrorCodes.InternalError, '地图未加载');
        ack?.({ ok: false, error: 'map_not_loaded' });
        return;
      }

      const monumentCell = mapIndex.getById(payload.monumentId);
      if (!monumentCell) {
        emitError(socket, ErrorCodes.InvalidPayload, `纪念碑 ${payload.monumentId} 不存在`);
        ack?.({ ok: false, error: 'monument_not_found' });
        return;
      }

      const cellType = normalizeCellType(monumentCell);
      if (cellType !== CellTypes.Monument) {
        emitError(socket, ErrorCodes.InvalidPayload, '该格子不是纪念碑');
        ack?.({ ok: false, error: 'not_monument' });
        return;
      }

      const state = this.monumentStates.get(payload.monumentId);
      if (!state) {
        emitError(socket, ErrorCodes.InternalError, '纪念碑状态未初始化');
        ack?.({ ok: false, error: 'state_not_found' });
        return;
      }

      // 构造 API 返回状态（包含从 ProsperityManager 读取的繁荣度快照）
      const apiState: MonumentState = {
        ...state,
        regionProsperity: this.getMonumentProsperity(payload.monumentId),
      };

      ack?.({ ok: true, data: { state: apiState } });
    } catch (err) {
      logger.error('获取纪念碑状态处理错误', err);
      emitError(socket, ErrorCodes.InternalError, err instanceof Error ? err.message : String(err));
      ack?.({ ok: false, error: 'internal_error' });
    }
  }

  /**
   * 执行修缮操作
   */
  private executeRepair(
    player: Player,
    monumentCell: Cell,
    cost: number,
  ): RepairResult | null {
    try {
      // 1. 扣除玩家财产
      const moneyChange = this.economy.changeValue(player.id, 'money', -cost, 'monument_repair');
      if (!moneyChange.ok) return null;

      // 2. 增加玩家信用值
      const creditIncrease = getExtra<number>(monumentCell, 'creditIncrease', 10) ?? 10;
      const creditChange = this.economy.changeValue(player.id, 'credit', creditIncrease, 'monument_repair');
      if (!creditChange.ok) {
        this.economy.changeValue(player.id, 'money', cost, 'monument_repair_rollback');
        return null;
      }

      // 3. 增加区域繁荣度（通过 ProsperityManager）
      const prosperityIncrease = getExtra<number>(monumentCell, 'prosperityIncrease', 20) ?? 20;
      const monumentState = this.monumentStates.get(monumentCell.id);
      if (monumentState) {
        monumentState.lastRepairTime = Date.now();
      }
      if (this.prosperityManager) {
        // 通过 ProsperityManager 查找纪念碑所属区域并增加繁荣度
        const regionId = this.prosperityManager.findRegionByCellId(monumentCell.id);
        if (regionId) {
          this.prosperityManager.increaseProsperity(regionId, prosperityIncrease, 'monument_repair');
        }
      }

      // 4. 更新纪念碑使用记录（可选，用于统计）
      const repairCount = getExtra<number>(monumentCell, 'repairCount', 0) ?? 0;
      monumentCell.extra.repairCount = repairCount + 1;
      monumentCell.extra.lastRepairBy = player.id;
      monumentCell.extra.lastRepairTime = Date.now();

      // 5. 更新玩家数据
      return {
        playerId: player.id,
        monumentId: monumentCell.id,
        cost,
        creditIncrease,
        prosperityIncrease,
        cell: monumentCell,
      };
    } catch (err) {
      logger.error('修缮执行错误', err);
      return null;
    }
  }

  /**
   * 广播修缮事件
   */
  private broadcastRepair(result: RepairResult): void {
    // 1. 广播修缮通知
    this.io.emit('server.notification', {
      id: `repair_${result.playerId}_${Date.now()}`,
      type: 'success',
      title: t('server.monumentRepairSuccess'),
      content: t('server.monumentRepairContent', { player: result.playerId.slice(0, 8), id: result.monumentId, credit: result.creditIncrease }),
      durationMs: 3000,
    });

    // 2. 广播数值变化（财产）
    const player = this.world.getPlayer(result.playerId);
    if (player) {
      this.io.emit('server.valueChanged', {
        playerId: result.playerId,
        fieldId: 'money',
        current: this.getPlayerMoney(player),
        delta: -result.cost,
      });

      // 3. 广播数值变化（信用值）
      this.io.emit('server.valueChanged', {
        playerId: result.playerId,
        fieldId: 'credit',
        current: this.getPlayerCredit(player),
        delta: result.creditIncrease,
      });
    }

    // 4. 繁荣度变化由 ProsperityManager 负责广播（server.prosperityChanged）
  }

  /**
   * 处理纪念碑格子事件（玩家到达时调用）
   *
   * 由 MovementHandler 或 HandlerRegistry 调用
   */
  handleMonumentCell(playerId: string, monumentId: number, socket: TypedSocket): void {
    const mapIndex = this.world.getMapIndex();
    if (!mapIndex) return;

    const monumentCell = mapIndex.getById(monumentId);
    if (!monumentCell) return;

    const monumentState = this.monumentStates.get(monumentId);
    if (!monumentState) {
      // 初始化纪念碑状态
      this.monumentStates.set(monumentId, {
        monumentId,
        lastRepairTime: Date.now(),
        decayRate: getExtra<number>(monumentCell, 'decayRate', 0.1) ?? 0.1,
        maxProsperity: getExtra<number>(monumentCell, 'maxProsperity', this.maxProsperity) ?? this.maxProsperity,
      });
    }

    // 发送通知给玩家，显示修缮选项
    const cost = getExtra<number>(monumentCell, 'repairCost', 100) ?? 100;
    const currentProsperity = this.getMonumentProsperity(monumentId);

    socket.emit('server.notification', {
      id: `monument_${monumentId}`,
      type: 'info',
      title: t('server.monumentTitle'),
      content: t('server.monumentPrompt', { cost, prosperity: currentProsperity }),
      actions: [
        { label: '修缮纪念碑', action: 'repairMonument', payload: { monumentId } },
        { label: '取消', action: 'dismiss' },
      ],
      durationMs: 0, // 需用户手动关闭
    });

    logger.debug(`玩家 ${playerId} 到达纪念碑 ${monumentId}`);
  }

  /**
   * 获取玩家财产
   */
  private getPlayerMoney(player: Player): number {
    const moneyField = player.values['money'];
    return moneyField?.current ?? 0;
  }

  /**
   * 设置玩家财产
   */
  /**
   * 获取玩家信用值
   */
  private getPlayerCredit(player: Player): number {
    const creditField = player.values['credit'];
    return creditField?.current ?? 0;
  }

  /**
   * 设置玩家信用值
   */
  /**
   * 获取纪念碑所属区域的繁荣度
   *
   * 优先从 ProsperityManager 读取；若 ProsperityManager 未注入，返回默认最大繁荣度。
   */
  private getMonumentProsperity(monumentId: number): number {
    if (this.prosperityManager) {
      return this.prosperityManager.getCellProsperity(monumentId);
    }
    return this.maxProsperity;
  }

  /**
   * 获取纪念碑状态（用于调试）
   */
  getMonumentState(monumentId: number): MonumentState | undefined {
    const internal = this.monumentStates.get(monumentId);
    if (!internal) return undefined;
    return {
      ...internal,
      regionProsperity: this.getMonumentProsperity(monumentId),
    };
  }

  /**
   * 获取所有纪念碑状态（用于调试）
   */
  getAllMonumentStates(): MonumentState[] {
    return Array.from(this.monumentStates.entries()).map(([id, internal]) => ({
      ...internal,
      regionProsperity: this.getMonumentProsperity(id),
    }));
  }
}

/**
 * 快速注册纪念碑处理器
 */
export function registerMonumentHandler(io: TypedServer, world: GameWorld, prosperityManager?: ProsperityManager): MonumentHandler {
  const handler = new MonumentHandler(io, world, prosperityManager);
  // 注册将在 HandlerRegistry.registerForSocket 中调用
  return handler;
}
