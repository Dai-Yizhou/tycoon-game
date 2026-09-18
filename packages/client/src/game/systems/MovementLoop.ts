/**
 * 服务端权威移动的插值步进循环
 *
 * 移出 GamePage 的内联 RAF 代码，使"移动步进循环"的语义可被单测验证，并彻底消除
 * 一类"掷骰后卡在移动态、棋子不再移动"的卡死：
 *
 * 不变量：isMoving 为真 ⇔ 存在且仅存在一个活跃的 tick 链。
 * - tick 任一步（updateMovement / 展示回调 / 落格回调）抛错都被捕获为单帧故障，循环
 *   继续推进而非静默死亡——否则残留的 frameId 会让订阅侧 `frameId === null` 门禁永远
 *   拦截后续移动，isMoving 卡真、棋子永不在移动。
 * - 续排仅在 finally 进行：isMoving 仍真 → 重排下一帧；否则 → 停表并落格归位。
 * - 宿主抽象（raf/cancelRaf）便于测试注入手动驱动。
 */

import type { MapIndex } from '@game/shared';
import type { GameStore } from '../../state/GameStore.js';
import { updateMovement, updateOtherPlayerMoveSteps, projectOtherPlayerDisplays } from './MovementSystem.js';
import type { MovementEffectHooks } from '../GameEffects.js';

export interface MovementLoopHost {
  raf(callback: (timestamp: number) => void): number;
  cancelRaf(id: number): void;
}

/** 浏览器默认宿主：requestAnimationFrame / cancelAnimationFrame */
export function browserLoopHost(): MovementLoopHost {
  return {
    raf: (callback) => requestAnimationFrame(callback),
    cancelRaf: (id) => cancelAnimationFrame(id),
  };
}

export interface MovementLoopOptions {
  onArrived: () => void;
  effects?: MovementEffectHooks;
  /** 地图索引的惰性读取器：地图异步加载完成前可能为 undefined */
  getMapIndex: () => MapIndex | undefined;
  /** 每帧位置投影；故障作为单帧异常被吞掉并继续循环 */
  onDisplay: (playerId: string, x: number, y: number) => void;
  /** 移动结束后的落格投影；故障同样只跳过该帧 */
  onSettled: (playerId: string, x: number, y: number) => void;
}

export interface MovementLoop {
  /** 未在运行且当前处于移动态时，启动步进循环（幂等，不会并发多链） */
  ensureRunning(): void;
  /** 停止循环并取消待执行的帧 */
  stop(): void;
}

export function createMovementLoop(store: GameStore, host: MovementLoopHost, options: MovementLoopOptions): MovementLoop {
  let frameId: number | null = null;
  let disposed = false;

  const tick = (): void => {
    if (disposed) {
      frameId = null;
      return;
    }
    try {
      const current = store.getSnapshot();
      const hasAnim = current?.isMoving || (current?.otherPlayerMoves?.size ?? 0) > 0;
      if (!hasAnim) return;
      const mapIndex = options.getMapIndex();
      if (!mapIndex) return; // 地图尚未就绪：停在循环内待命，由 finally 续排，不推进
      try {
        updateMovement(store, mapIndex, options.onArrived, options.effects);
      } catch (err) {
        // 单帧步进故障：跳过该帧、不中断循环（下帧继续推进），
        // 避免循环死亡导致 isMoving 卡真、棋子永在不移动。
        console.error('[movementLoop] 移动步进异常，已跳过本帧', err);
      }
      try {
        // 其他玩家的权威带路径移动步进（角色 self 由 updateMovement 处理）
        updateOtherPlayerMoveSteps(store, mapIndex);
      } catch (err) {
        console.error('[movementLoop] 其他玩家动画步进异常，已跳过本帧', err);
      }
      const next = store.getSnapshot();
      if (next?.currentPlayer) {
        options.onDisplay(next.currentPlayer.id, next.playerDisplayX, next.playerDisplayY);
      }
      try {
        projectOtherPlayerDisplays(next, options.onDisplay);
      } catch (err) {
        console.error('[movementLoop] 其他玩家动画投影异常，已跳过本帧', err);
      }
    } catch (err) {
      console.error('[movementLoop] 移动帧异常，已跳过本帧', err);
    } finally {
      const snap = store.getSnapshot();
      if (snap?.isMoving || (snap?.otherPlayerMoves?.size ?? 0) > 0) {
        frameId = host.raf(tick);
      } else {
        frameId = null;
        try {
          if (snap?.currentPlayer) {
            const mapIndex = options.getMapIndex();
            const cell = mapIndex?.getById(snap.currentPlayerPosition);
            if (cell) options.onSettled(snap.currentPlayer.id, cell.x, cell.y);
          }
        } catch (err) {
          console.error('[movementLoop] 落格展示异常', err);
        }
      }
    }
  };

  return {
    ensureRunning(): void {
      if (disposed) return;
      if (frameId !== null) return; // 已有活跃循环，幂等
      const snap = store.getSnapshot();
      if (!(snap?.isMoving || (snap?.otherPlayerMoves?.size ?? 0) > 0)) return;
      frameId = host.raf(tick);
    },
    stop(): void {
      disposed = true;
      if (frameId !== null) {
        host.cancelRaf(frameId);
        frameId = null;
      }
    },
  };
}