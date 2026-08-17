/**
 * 内存时代存储（InMemoryEraStore）
 *
 * EraStore 接口的内存实现，用于开发/测试与单实例部署。
 * 与 InMemoryPlayerStore 对称：不依赖外部数据库，进程结束后数据丢失。
 */

import type { EraInfo } from '@game/shared';
import type { EraStore } from './EraStore.js';

/**
 * 内存时代存储
 *
 * 按时代 ID 索引；`loadCurrentEra` 返回首个未结算的时代。
 */
export class InMemoryEraStore implements EraStore {
  private readonly eras: Map<string, EraInfo> = new Map();

  constructor(initialEra?: EraInfo | null) {
    if (initialEra) this.eras.set(initialEra.id, { ...initialEra, monumentRecords: [...initialEra.monumentRecords] });
  }

  async saveEra(era: EraInfo): Promise<void> {
    this.eras.set(era.id, { ...era, monumentRecords: [...era.monumentRecords] });
  }

  async loadCurrentEra(): Promise<EraInfo | null> {
    for (const era of this.eras.values()) {
      if (!era.settled) {
        return { ...era, monumentRecords: [...era.monumentRecords] };
      }
    }
    return null;
  }

  async loadEraById(id: string): Promise<EraInfo | null> {
    const era = this.eras.get(id);
    if (!era) return null;
    return { ...era, monumentRecords: [...era.monumentRecords] };
  }

  async listEras(): Promise<EraInfo[]> {
    return Array.from(this.eras.values()).map((era) => ({
      ...era,
      monumentRecords: [...era.monumentRecords],
    }));
  }
}
