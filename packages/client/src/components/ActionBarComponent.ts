import type { GameEffectHooks } from '../game/GameEffects.js';
import type { GameViewModel } from '../game/GameViewModel.js';
import { showBankModal } from '../game/systems/BankSystem.js';

export interface ActionBarConfig {
  onRoll?: () => void;
}

export class ActionBarComponent {
  private readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(private readonly vm: GameViewModel, private readonly effects: GameEffectHooks, private readonly config: ActionBarConfig = {}) {
    this.root = document.createElement('section');
    this.root.className = 'new-action-bar';
    this.root.dataset.ui = 'action-bar';
    this.status = document.createElement('div');
    this.status.className = 'new-action-bar__status';
    this.actions = document.createElement('div');
    this.actions.className = 'new-action-bar__actions';
    this.root.append(this.status, this.actions);
    this.unsubscribers.push(this.vm.subscribe('movement', () => this.update()));
    this.unsubscribers.push(this.vm.subscribe('jail', () => this.update()));
    this.unsubscribers.push(this.vm.subscribe('player', () => this.update()));
    this.update();
  }

  getElement(): HTMLElement {
    return this.root;
  }

  update(): void {
    const movement = this.vm.getMovement();
    const jail = this.vm.getJail();
    const player = this.vm.getPlayer();
    this.actions.replaceChildren();
    const dice = document.createElement('span');
    dice.className = 'new-action-bar__dice';
    dice.dataset.ui = 'dice-display';
    dice.textContent = '骰子';
    this.actions.appendChild(dice);
    this.root.dataset.state = movement.isMoving ? 'moving' : jail.isInJail ? 'jail' : 'ready';
    if (movement.isMoving) {
      this.status.dataset.state = 'moving';
      this.status.textContent = '移动中';
      return;
    }
    if (jail.isInJail) {
      this.status.dataset.state = 'jail';
      this.status.textContent = '监狱状态';
      return;
    }
    this.status.dataset.state = 'ready';
    this.status.textContent = player.isBankrupt ? '已破产' : '等待行动';
    if (!player.isBankrupt && movement.canRoll) {
      const roll = document.createElement('button');
      roll.type = 'button';
      roll.dataset.action = 'roll';
      roll.className = 'new-action-bar__button';
      roll.textContent = '掷骰移动';
      roll.addEventListener('click', () => this.config.onRoll?.());
      this.actions.appendChild(roll);
    }
    const bank = document.createElement('button');
    bank.type = 'button';
    bank.dataset.action = 'bank';
    bank.className = 'new-action-bar__button new-action-bar__button--secondary';
    bank.textContent = '银行';
    bank.addEventListener('click', showBankModal);
    this.actions.appendChild(bank);
  }

  destroy(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.effects.onNotifyDismiss('action-bar');
    this.root.remove();
  }
}
