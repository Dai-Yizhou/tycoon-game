import type { GameEffectHooks } from "../game/GameEffects.js";
import type { GameViewModel } from "../game/GameViewModel.js";

export interface GameHudShellConfig {
  onRoll?: () => void;
  onBank?: () => void;
  onChatSend?: (message: string, channel: string) => void;
}

export class GameHudShell {
  private readonly root: HTMLElement;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly input: HTMLInputElement;
  private readonly channel: HTMLSelectElement;
  private destroyed = false;

  constructor(private readonly vm: GameViewModel, private readonly effects: GameEffectHooks, private readonly config: GameHudShellConfig = {}) {
    this.root = document.createElement("div");
    this.root.className = "game-hud-shell";
    this.root.dataset.ui = "game-hud-shell";
    this.root.append(this.buildTopBar(), this.buildTeamPanel(), this.buildChatPanel(), this.buildItemsPanel(), this.buildActionPanel(), this.buildHoverCard());
    this.input = this.root.querySelector('[data-ui="chat-input"]') as HTMLInputElement;
    this.channel = this.root.querySelector('[data-ui="chat-channel"]') as HTMLSelectElement;
    this.root.querySelector('[data-action="chat-send"]')?.addEventListener("click", () => this.sendChat());
    this.input.addEventListener("keydown", (event) => { if (event.key === "Enter") this.sendChat(); });
    this.unsubscribers.push(this.vm.subscribe("player", () => this.update()), this.vm.subscribe("movement", () => this.update()), this.vm.subscribe("team", () => this.update()), this.vm.subscribe("items", () => this.update()), this.vm.subscribe("chat", () => this.update()));
    this.update();
  }

  getElement(): HTMLElement { return this.root; }

  update(): void {
    if (this.destroyed) return;
    const player = this.vm.getPlayer();
    const movement = this.vm.getMovement();
    const team = this.vm.getTeam();
    const top = this.root.querySelector('[data-ui="top-bar"]');
    if (top) top.querySelector('[data-ui="player-name"]')!.textContent = player.currentPlayerName || "玩家";
    for (const [key, value] of [["money", player.currentMoney], ["credit", player.currentCredit], ["env", player.currentEnv]] as const) {
      const el = this.root.querySelector(`[data-ui="${key}"]`); if (el) el.textContent = String(Math.round(value));
    }
    const teamList = this.root.querySelector('[data-ui="team-list"]');
    if (teamList) teamList.textContent = team.members.length ? team.members.map(member => member.username).join("、") : "暂无队员";
    const roll = this.root.querySelector('[data-action="roll"]') as HTMLButtonElement | null;
    if (roll) roll.disabled = !movement.canRoll || movement.isMoving || player.isBankrupt;
    const items = this.root.querySelector('[data-ui="items-list"]');
    if (items) items.textContent = this.vm.getItems().items.length ? this.vm.getItems().items.map(item => `${item.name} ×${item.count}`).join("、") : "暂无道具";
  }

  destroy(): void { this.destroyed = true; this.unsubscribers.forEach(unsubscribe => unsubscribe()); this.effects.onNotifyDismiss("game-hud-shell"); this.root.remove(); }

  private sendChat(): void { const message = this.input.value.trim(); if (!message) return; this.config.onChatSend?.(message, this.channel.value); this.input.value = ""; }
  private section(ui: string, className: string): HTMLElement { const el = document.createElement("section"); el.dataset.ui = ui; el.className = className; return el; }
  private button(action: string, label: string, onClick?: () => void): HTMLButtonElement { const btn = document.createElement("button"); btn.type = "button"; btn.dataset.action = action; btn.textContent = label; onClick && btn.addEventListener("click", onClick); return btn; }
  private buildTopBar(): HTMLElement { const el = this.section("top-bar", "hud-top-bar"); el.innerHTML = '<span class="hud-brand">城市经营</span><strong data-ui="player-name">玩家</strong><span>金钱 <b data-ui="money">0</b></span><span>信用 <b data-ui="credit">0</b></span><span>环保 <b data-ui="env">0</b></span>'; return el; }
  private buildTeamPanel(): HTMLElement { const el = this.section("team-panel", "hud-team-panel"); el.innerHTML = '<header>队伍</header><div data-ui="team-list">暂无队员</div><div class="hud-row"></div>'; const row = el.querySelector(".hud-row")!; row.append(this.button("team-invite", "邀请", () => window.showTeamInvite?.()), this.button("team-manage", "管理", () => window.showTeamManagement?.())); return el; }
  private buildChatPanel(): HTMLElement { const el = this.section("chat-panel", "hud-chat-panel"); el.innerHTML = '<header>聊天</header><div data-ui="chat-messages" class="hud-chat-messages"></div><div class="hud-chat-compose"><select data-ui="chat-channel"><option value="team">队伍</option><option value="region">区域</option></select><input data-ui="chat-input" maxlength="200" placeholder="输入消息"><button data-action="chat-send" type="button">发送</button></div>'; return el; }
  private buildItemsPanel(): HTMLElement { const el = this.section("items-panel", "hud-items-panel"); el.innerHTML = '<header>道具</header><div data-ui="items-list">暂无道具</div>'; return el; }
  private buildActionPanel(): HTMLElement { const el = this.section("action-panel", "hud-action-panel"); el.append(this.button("roll", "掷骰移动", this.config.onRoll), this.button("bank", "银行", this.config.onBank)); return el; }
  private buildHoverCard(): HTMLElement { const el = this.section("hover-card", "hud-hover-card"); el.textContent = "悬停格子查看信息"; return el; }
}
