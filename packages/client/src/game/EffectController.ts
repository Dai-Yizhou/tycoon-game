import type { GameEffectHooks } from './GameEffects.js';

export class EffectController implements GameEffectHooks {
  private enabled = true;
  private readonly hooks: Partial<GameEffectHooks>;

  constructor(hooks: Partial<GameEffectHooks> = {}) {
    this.hooks = hooks;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  onDiceRollStart(): void { this.invoke('onDiceRollStart'); }
  onDiceSettled(value: number): void { this.invoke('onDiceSettled', value); }
  onCooldownStart(durationMs: number): void { this.invoke('onCooldownStart', durationMs); }
  onCooldownEnd(): void { this.invoke('onCooldownEnd'); }
  onStepStart(fromCellId: number, toCellId: number): void { this.invoke('onStepStart', fromCellId, toCellId); }
  onStepArrive(cellId: number): void { this.invoke('onStepArrive', cellId); }
  onMoveComplete(cellId: number): void { this.invoke('onMoveComplete', cellId); }
  onIntersectionPrompt(options: number[]): void { this.invoke('onIntersectionPrompt', options); }
  onIntersectionResolved(chosenCellId: number): void { this.invoke('onIntersectionResolved', chosenCellId); }
  onMoneyChange(delta: number, newValue: number): void { this.invoke('onMoneyChange', delta, newValue); }
  onCreditChange(delta: number, newValue: number): void { this.invoke('onCreditChange', delta, newValue); }
  onEnvChange(delta: number, newValue: number): void { this.invoke('onEnvChange', delta, newValue); }
  onProsperityChange(delta: number, newValue: number): void { this.invoke('onProsperityChange', delta, newValue); }
  onPropertyPurchased(cellId: number): void { this.invoke('onPropertyPurchased', cellId); }
  onPropertyUpgraded(cellId: number, newLevel: number): void { this.invoke('onPropertyUpgraded', cellId, newLevel); }
  onInvestmentPurchased(cellId: number): void { this.invoke('onInvestmentPurchased', cellId); }
  onMonumentRestored(cellId: number): void { this.invoke('onMonumentRestored', cellId); }
  onTransport(fromCellId: number, toCellId: number): void { this.invoke('onTransport', fromCellId, toCellId); }
  onEventTriggered(eventMsg: string): void { this.invoke('onEventTriggered', eventMsg); }
  onBankrupt(): void { this.invoke('onBankrupt'); }
  onJailEnter(): void { this.invoke('onJailEnter'); }
  onJailExit(): void { this.invoke('onJailExit'); }
  onDayNightToggle(isDay: boolean): void { this.invoke('onDayNightToggle', isDay); }
  onNotifyShow(message: string, level: 'info' | 'warn' | 'error' | 'success'): void { this.invoke('onNotifyShow', message, level); }
  onNotifyDismiss(message: string): void { this.invoke('onNotifyDismiss', message); }

  private invoke<K extends keyof GameEffectHooks>(name: K, ...args: Parameters<GameEffectHooks[K]>): void {
    if (!this.enabled) return;
    const hook = this.hooks[name] as ((...values: Parameters<GameEffectHooks[K]>) => void) | undefined;
    hook?.(...args);
  }
}
