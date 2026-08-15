/**
 * 经济系统模块导出
 *
 * 包括：
 * - Taxation: 计税系统（昼夜计税、财产税、地产税）
 * - Bankruptcy: 破产机制（破产判定、复活、清算）
 */

export {
  Taxation,
  createTaxation,
  type TaxConfig,
  type TaxRecord,
  type TaxResult,
} from './Taxation.js';

export {
  Bankruptcy,
  createBankruptcy,
  DEFAULT_BANKRUPTCY_CONFIG,
  type BankruptcyConfig,
  type BankruptcyRecord,
  type BankruptcyResult,
  type RevivalResult,
} from './Bankruptcy.js';

export {
  DEFAULT_OWNERSHIP_CONFIG,
  getAccumulatedValue,
  getBuyInPrice,
  getOwnerships,
  getOwners,
  addOwnership,
  distributeByShare,
  releaseOwnership,
  syncOwnerships,
  type Ownership,
  type OwnershipConfig,
} from './Ownership.js';
