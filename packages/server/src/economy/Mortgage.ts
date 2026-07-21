/**
 * 抵押系统
 *
 * 负责：
 * - 地产抵押（抵押价格从 cell.mortgagePrice 读取）
 * - 抵押后地产进入竞拍状态
 * - 区域竞拍（其他玩家可参与竞拍）
 * - 竞拍结束后转移所有权
 *
 * 设计原则：
 * - 抵押价格由地图编辑器配置（cell.extra.mortgagePrice）
 * - 抵押后玩家获得抵押价格的资金
 * - 抵押的地产进入竞拍池，其他玩家可参与竞拍
 * - 竞拍采用竞价模式，最高者获得地产所有权
 */

import type { Cell, Player } from '@game/shared';
import { CellTypes, getExtra, normalizeCellType, getValueCurrent } from '@game/shared';
import { logger } from '../utils/logger.js';
import type { GameWorld } from '../world/GameWorld.js';
import type { TypedServer, TypedSocket } from '../transport/SocketManager.js';

/**
 * 竞拍记录
 */
export interface AuctionRecord {
  /** 竞拍 ID */
  id: string;
  /** 格子 ID */
  cellId: number;
  /** 原所有者 ID */
  originalOwnerId: string;
  /** 抵押价格 */
  mortgagePrice: number;
  /** 当前最高出价 */
  currentHighestBid: number;
  /** 当前最高出价者 */
  currentHighestBidder: string | null;
  /** 所有出价记录 */
  bids: Array<{ playerId: string; amount: number; timestamp: number }>;
  /** 竞拍开始时间 */
  startTime: number;
  /** 竞拍结束时间 */
  endTime: number;
  /** 竞拍状态 */
  status: 'active' | 'completed' | 'cancelled';
}

/**
 * 抵押配置
 */
export interface MortgageConfig {
  /** 竞拍持续时间（毫秒） */
  auctionDuration: number;
  /** 最小出价增量 */
  minBidIncrement: number;
  /** 竞拍延迟时间（无人出价时延长） */
  auctionExtensionTime: number;
}

/**
 * 默认抵押配置
 */
export const DEFAULT_MORTGAGE_CONFIG: MortgageConfig = {
  auctionDuration: 60000, // 1 分钟
  minBidIncrement: 50, // 每次出价至少增加 50
  auctionExtensionTime: 10000, // 最后出价后延长 10 秒
};

/**
 * 抵押结果
 */
export interface MortgageResult {
  success: boolean;
  mortgagePrice?: number;
  error?: string;
}

/**
 * 竞拍出价结果
 */
export interface BidResult {
  success: boolean;
  currentHighestBid?: number;
  error?: string;
}

/**
 * 抵押系统
 */
export class Mortgage {
  private readonly io: TypedServer;
  private readonly world: GameWorld;
  private readonly config: MortgageConfig;
  private readonly auctions: Map<string, AuctionRecord> = new Map(); // auctionId -> auction
  private readonly cellAuctions: Map<number, string> = new Map(); // cellId -> auctionId
  private readonly auctionTimers: Map<string, NodeJS.Timeout> = new Map(); // auctionId -> timer

  constructor(io: TypedServer, world: GameWorld, config: MortgageConfig = DEFAULT_MORTGAGE_CONFIG) {
    this.io = io;
    this.world = world;
    this.config = config;
  }

  /**
   * 抵押地产
   */
  mortgageProperty(playerId: string, cellId: number, _socket: TypedSocket): MortgageResult {
    const player = this.world.getPlayer(playerId);
    if (!player) {
      return { success: false, error: '玩家不存在' };
    }

    // 1. 获取地图数据
    const mapIndex = this.world.getMapIndex();
    if (!mapIndex) {
      return { success: false, error: '地图未加载' };
    }

    // 2. 获取格子数据
    const cell = mapIndex.getById(cellId);
    if (!cell) {
      return { success: false, error: `格子 ${cellId} 不存在` };
    }

    // 3. 验证格子类型
    const cellType = normalizeCellType(cell);
    if (cellType !== CellTypes.Property) {
      return { success: false, error: '该格子不可抵押' };
    }

    // 4. 验证所有权
    const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
    if (!owners.includes(playerId)) {
      return { success: false, error: '你不是该地产的所有者' };
    }

    // 5. 检查是否已抵押
    const isMortgaged = getExtra<boolean | number>(cell, 'isMortgaged', false);
    if (isMortgaged) {
      return { success: false, error: '该地产已抵押' };
    }

    // 6. 获取抵押价格
    const mortgagePrice = getExtra<number>(cell, 'mortgagePrice', 0) ?? 0;
    if (mortgagePrice <= 0) {
      return { success: false, error: '该地产无抵押价格' };
    }

    // 7. 执行抵押
    cell.extra.isMortgaged = true;
    cell.extra.mortgagePrice = mortgagePrice;

    // 8. 增加玩家财产
    this.addPlayerMoney(player, mortgagePrice);
    this.world.updatePlayer(player);

    // 9. 更新格子数据
    this.updateCell(cell);

    // 10. 启动竞拍
    const auction = this.startAuction(cellId, playerId, mortgagePrice);

    // 11. 广播抵押事件
    this.io.emit('server.propertyMortgaged', {
      cellId,
      playerId,
      mortgagePrice,
      auctionId: auction.id,
    });

    logger.debug(`玩家 ${playerId} 抵押了格子 ${cellId}，获得 ${mortgagePrice}`);

    return { success: true, mortgagePrice };
  }

  /**
   * 启动竞拍
   */
  private startAuction(cellId: number, originalOwnerId: string, mortgagePrice: number): AuctionRecord {
    const auctionId = `auction_${cellId}_${Date.now()}`;
    const startTime = Date.now();
    const endTime = startTime + this.config.auctionDuration;

    const auction: AuctionRecord = {
      id: auctionId,
      cellId,
      originalOwnerId,
      mortgagePrice,
      currentHighestBid: mortgagePrice, // 起拍价为抵押价格
      currentHighestBidder: null,
      bids: [],
      startTime,
      endTime,
      status: 'active',
    };

    this.auctions.set(auctionId, auction);
    this.cellAuctions.set(cellId, auctionId);

    // 设置竞拍结束定时器
    const timer = setTimeout(() => {
      this.endAuction(auctionId);
    }, this.config.auctionDuration);
    this.auctionTimers.set(auctionId, timer);

    // 广播竞拍开始
    this.io.emit('server.auctionStarted', {
      auctionId,
      cellId,
      mortgagePrice,
      startTime,
      endTime,
      originalOwnerId,
    });

    logger.debug(`竞拍 ${auctionId} 已启动，格子 ${cellId}，起拍价 ${mortgagePrice}`);

    return auction;
  }

  /**
   * 参与竞拍出价
   */
  placeBid(playerId: string, auctionId: string, amount: number, _socket: TypedSocket): BidResult {
    const player = this.world.getPlayer(playerId);
    if (!player) {
      return { success: false, error: '玩家不存在' };
    }

    // 1. 获取竞拍记录
    const auction = this.auctions.get(auctionId);
    if (!auction) {
      return { success: false, error: '竞拍不存在' };
    }

    // 2. 检查竞拍状态
    if (auction.status !== 'active') {
      return { success: false, error: '竞拍已结束' };
    }

    // 3. 检查是否为原所有者
    if (auction.originalOwnerId === playerId) {
      return { success: false, error: '原所有者不能参与竞拍' };
    }

    // 4. 检查出价金额
    if (amount <= auction.currentHighestBid) {
      return { success: false, error: `出价必须高于当前最高价 ${auction.currentHighestBid}` };
    }

    if (amount < auction.currentHighestBid + this.config.minBidIncrement) {
      return { success: false, error: `出价增量至少为 ${this.config.minBidIncrement}` };
    }

    // 5. 检查玩家财产
    const playerMoney = this.getPlayerMoney(player);
    if (playerMoney < amount) {
      return { success: false, error: `财产不足，需要 ${amount}` };
    }

    // 6. 记录出价
    auction.bids.push({
      playerId,
      amount,
      timestamp: Date.now(),
    });

    auction.currentHighestBid = amount;
    auction.currentHighestBidder = playerId;

    // 7. 延长竞拍时间（如果有新出价）
    const now = Date.now();
    if (auction.endTime - now < this.config.auctionExtensionTime) {
      auction.endTime = now + this.config.auctionExtensionTime;

      // 重置定时器
      const timer = this.auctionTimers.get(auctionId);
      if (timer) {
        clearTimeout(timer);
      }
      const newTimer = setTimeout(() => {
        this.endAuction(auctionId);
      }, this.config.auctionExtensionTime);
      this.auctionTimers.set(auctionId, newTimer);
    }

    // 8. 广播出价事件
    this.io.emit('server.bidPlaced', {
      auctionId,
      playerId,
      amount,
      currentHighestBid: amount,
      endTime: auction.endTime,
    });

    logger.debug(`玩家 ${playerId} 在竞拍 ${auctionId} 出价 ${amount}`);

    return { success: true, currentHighestBid: amount };
  }

  /**
   * 结束竞拍
   */
  private endAuction(auctionId: string): void {
    const auction = this.auctions.get(auctionId);
    if (!auction || auction.status !== 'active') {
      return;
    }

    auction.status = 'completed';
    this.auctionTimers.delete(auctionId);

    // 1. 获取地图数据
    const mapIndex = this.world.getMapIndex();
    if (!mapIndex) {
      logger.warn(`竞拍 ${auctionId} 结束时地图未加载`);
      return;
    }

    // 2. 获取格子数据
    const cell = mapIndex.getById(auction.cellId);
    if (!cell) {
      logger.warn(`竞拍 ${auctionId} 结束时格子 ${auction.cellId} 不存在`);
      return;
    }

    // 3. 处理竞拍结果
    if (auction.currentHighestBidder) {
      // 有竞拍者，转移所有权
      const winner = this.world.getPlayer(auction.currentHighestBidder);
      if (winner) {
        // 扣除竞拍者财产
        this.subtractPlayerMoney(winner, auction.currentHighestBid);
        this.world.updatePlayer(winner);

        // 更新格子所有权
        const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
        // 移除原所有者
        const originalOwnerIndex = owners.indexOf(auction.originalOwnerId);
        if (originalOwnerIndex >= 0) {
          owners.splice(originalOwnerIndex, 1);
        }
        // 添加新所有者
        owners.push(auction.currentHighestBidder);
        cell.extra.owners = owners;
        cell.extra.isMortgaged = false;

        this.updateCell(cell);

        // 广播竞拍结果
        this.io.emit('server.auctionEnded', {
          auctionId,
          cellId: auction.cellId,
          winnerId: auction.currentHighestBidder,
          winningBid: auction.currentHighestBid,
          originalOwnerId: auction.originalOwnerId,
        });

        logger.debug(
          `竞拍 ${auctionId} 结束，${auction.currentHighestBidder} 以 ${auction.currentHighestBid} 获得格子 ${auction.cellId}`,
        );
      }
    } else {
      // 无竞拍者，地产归还原所有者（但保持抵押状态）
      // 原所有者可以赎回地产
      this.io.emit('server.auctionEnded', {
        auctionId,
        cellId: auction.cellId,
        winnerId: null,
        winningBid: null,
        originalOwnerId: auction.originalOwnerId,
      });

      logger.debug(`竞拍 ${auctionId} 结束，无人出价，格子 ${auction.cellId} 保持抵押状态`);
    }

    // 清理竞拍记录
    this.cellAuctions.delete(auction.cellId);
    // 保留竞拍记录一段时间供查询
    setTimeout(() => {
      this.auctions.delete(auctionId);
    }, 60000);
  }

  /**
   * 赎回抵押地产
   *
   * 原所有者可以支付抵押价格赎回地产
   */
  redeemMortgage(playerId: string, cellId: number, _socket: TypedSocket): MortgageResult {
    const player = this.world.getPlayer(playerId);
    if (!player) {
      return { success: false, error: '玩家不存在' };
    }

    // 1. 获取地图数据
    const mapIndex = this.world.getMapIndex();
    if (!mapIndex) {
      return { success: false, error: '地图未加载' };
    }

    // 2. 获取格子数据
    const cell = mapIndex.getById(cellId);
    if (!cell) {
      return { success: false, error: `格子 ${cellId} 不存在` };
    }

    // 3. 检查是否已抵押
    const isMortgaged = getExtra<boolean | number>(cell, 'isMortgaged', false);
    if (!isMortgaged) {
      return { success: false, error: '该地产未抵押' };
    }

    // 4. 检查是否为原所有者
    const owners = getExtra<string[]>(cell, 'owners', []) ?? [];
    if (!owners.includes(playerId)) {
      return { success: false, error: '你不是该地产的原所有者' };
    }

    // 5. 检查是否有进行中的竞拍
    const auctionId = this.cellAuctions.get(cellId);
    if (auctionId) {
      const auction = this.auctions.get(auctionId);
      if (auction && auction.status === 'active') {
        return { success: false, error: '该地产正在进行竞拍，无法赎回' };
      }
    }

    // 6. 获取赎回价格
    const mortgagePrice = getExtra<number>(cell, 'mortgagePrice', 0) ?? 0;
    if (mortgagePrice <= 0) {
      return { success: false, error: '该地产无抵押价格' };
    }

    // 7. 检查玩家财产
    const playerMoney = this.getPlayerMoney(player);
    if (playerMoney < mortgagePrice) {
      return { success: false, error: `财产不足，需要 ${mortgagePrice}` };
    }

    // 8. 执行赎回
    this.subtractPlayerMoney(player, mortgagePrice);
    this.world.updatePlayer(player);

    // 9. 更新格子状态
    cell.extra.isMortgaged = false;

    this.updateCell(cell);

    // 10. 广播赎回事件
    this.io.emit('server.mortgageRedeemed', {
      cellId,
      playerId,
      mortgagePrice,
    });

    logger.debug(`玩家 ${playerId} 赎回了格子 ${cellId}，支付 ${mortgagePrice}`);

    return { success: true, mortgagePrice };
  }

  /**
   * 获取当前进行中的竞拍
   */
  getActiveAuctions(): AuctionRecord[] {
    return Array.from(this.auctions.values()).filter(a => a.status === 'active');
  }

  /**
   * 获取指定格子的竞拍
   */
  getCellAuction(cellId: number): AuctionRecord | undefined {
    const auctionId = this.cellAuctions.get(cellId);
    if (!auctionId) return undefined;
    return this.auctions.get(auctionId);
  }

  /**
   * 检查格子是否在竞拍中
   */
  isCellInAuction(cellId: number): boolean {
    const auctionId = this.cellAuctions.get(cellId);
    if (!auctionId) return false;
    const auction = this.auctions.get(auctionId);
    return auction?.status === 'active';
  }

  /**
   * 更新格子到地图数据
   */
  private updateCell(cell: Cell): void {
    const mapData = this.world.getMapData();
    if (!mapData) return;

    const index = mapData.findIndex(c => c.id === cell.id);
    if (index >= 0) {
      mapData[index] = cell;
    }
  }

  /**
   * 获取玩家财产
   */
  private getPlayerMoney(player: Player): number {
    return getValueCurrent(player, 'money', 0);
  }

  /**
   * 增加玩家财产
   */
  private addPlayerMoney(player: Player, amount: number): void {
    if (player.values['money']) {
      player.values['money'].current += amount;
    } else {
      player.values['money'] = {
        id: 'money',
        name: '财产',
        current: amount,
        min: 0,
      };
    }
  }

  /**
   * 扣除玩家财产
   */
  private subtractPlayerMoney(player: Player, amount: number): void {
    if (player.values['money']) {
      player.values['money'].current = Math.max(0, player.values['money'].current - amount);
    }
  }

  /**
   * 获取抵押配置
   */
  getConfig(): MortgageConfig {
    return this.config;
  }

  /**
   * 清理所有竞拍（破产时使用）
   */
  clearAllAuctions(): void {
    for (const timer of this.auctionTimers.values()) {
      clearTimeout(timer);
    }
    this.auctionTimers.clear();
    this.auctions.clear();
    this.cellAuctions.clear();
    logger.debug('已清理所有竞拍');
  }
}

/**
 * 快速创建抵押实例
 */
export function createMortgage(io: TypedServer, world: GameWorld, config?: MortgageConfig): Mortgage {
  return new Mortgage(io, world, config);
}