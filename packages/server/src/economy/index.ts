/**
 * 经济系统模块导出
 *
 * 包括：
 * - Mortgage: 抵押系统（地产抵押、竞拍、赎回）
 * - Taxation: 计税系统（昼夜计税、财产税、地产税）
 * - Bankruptcy: 破产机制（破产判定、复活、清算）
 */

export {
  Mortgage,
  createMortgage,
  DEFAULT_MORTGAGE_CONFIG,
  type MortgageConfig,
  type AuctionRecord,
  type MortgageResult,
  type BidResult,
} from './Mortgage.js';

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
