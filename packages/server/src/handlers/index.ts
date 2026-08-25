/**
 * Handlers 模块导出
 */

export { DiceHandler, registerDiceHandler, DEFAULT_COOLDOWN_CONFIG, type CooldownConfig, type DiceResult } from './diceHandler.js';
export { MovementHandler, registerMovementHandler, type MovementResult } from './movementHandler.js';
export { PropertyHandler, registerPropertyHandler, type PropertyOwnership, type PropertyResult, type BuyResult, type UpgradeResult, type RentResult } from './propertyHandler.js';
export { JailHandler, registerJailHandler, DEFAULT_JAIL_CONFIG, type JailConfig, type JailStateData } from './jailHandler.js';
export { InvestmentHandler, registerInvestmentHandler, type InvestmentResult, type EventTriggerResult } from './investmentHandler.js';
export { TransportHandler, registerTransportHandler, type TransportResult, type TransportNetworkState } from './transportHandler.js';
export { MonumentHandler, registerMonumentHandler, type RepairResult, type MonumentState } from './monumentHandler.js';
export { TeamHandler } from './teamHandler.js';
