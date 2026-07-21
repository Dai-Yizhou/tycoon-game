/**
 * 时代存储接口
 *
 * 用于持久化时代（Era）信息，便于崩溃恢复与跨实例同步。
 */

import type { EraInfo } from '@game/shared';

/**
 * 时代存储接口
 */
export interface EraStore {
  /** 保存或更新时代 */
  saveEra(era: EraInfo): Promise<void>;
  /** 加载当前活跃时代（已结算的不算「当前」），未找到返回 null */
  loadCurrentEra(): Promise<EraInfo | null>;
  /** 加载指定 ID 的时代（可选） */
  loadEraById?(id: string): Promise<EraInfo | null>;
  /** 列出全部时代（可选） */
  listEras?(): Promise<EraInfo[]>;
}
