import type { GameEffectHooks } from "../game/GameEffects.js";
import type { GameViewModel } from "../game/GameViewModel.js";

export interface GameHudShellConfig {
  onRoll?: () => void;
  onChatSend?: (message: string, channel: string) => void;
  onPathChoice?: (cellId: number) => void;
  onCellAction?: (actionId: string) => void;
  onCellHover?: (cell: any, x: number, y: number) => void;
  onCellLeave?: () => void;
}

/**
 * 全屏地图 HUD 覆盖层。
 *
 * 布局参考 game-page-hud-compact-chat.html：
 * - gp-topbar：顶部渐变透明状态栏（玩家信息 + 数值 + 昼夜）
 * - cell-hover-card：当前格悬浮详情卡
 * - hud-chat-dock：左下角可收起聊天/通知
 * - gp-actionbar：底部渐变透明行动栏（掷骰 + 动作）
 * - event-toast：顶部居中事件提示（默认隐藏）
 * - map-overlay：地图角落区域标签
 *
 * 低耦合：仅消费 GameViewModel 和回调，不直接访问 Store / Socket / Canvas。
 * 主题令牌通过页面根节点 CSS 变量（--gp-*）注入，组件不读取主题 JSON。
 */
export class GameHudShell {
  private readonly root = document.createElement("div");
  private readonly input: HTMLInputElement;
  private readonly channel: HTMLSelectElement;
  private readonly unsubscribers: Array<() => void> = [];
  private destroyed = false;

  constructor(
    private readonly vm: GameViewModel,
    private readonly effects: GameEffectHooks,
    private readonly config: GameHudShellConfig = {},
  ) {
    this.root.className = "game-hud-shell";
    this.root.dataset.ui = "game-hud-shell";
    this.root.innerHTML = `
      <div class="gp-layout" data-ui="hud-layout">
        <header class="gp-topbar" data-ui="top-bar">
          <div class="player-badge" data-ui="player-badge">
            <div class="player-badge__avatar"></div>
            <div>
              <div class="player-badge__name" data-ui="player-name">玩家</div>
              <div class="player-badge__team" data-ui="player-team">独行</div>
            </div>
          </div>
          <div class="value-pills" data-ui="resource-strip">
            <div class="value-pill"><span class="value-pill__label">金钱</span><span class="value-pill__num" data-ui="money">0</span></div>
            <div class="value-pill value-pill--accent"><span class="value-pill__label">信用</span><span class="value-pill__num" data-ui="credit">0</span></div>
            <div class="value-pill"><span class="value-pill__label">环保</span><span class="value-pill__num" data-ui="env">0</span></div>
          </div>
          <div class="topbar-spacer"></div>
          <div class="cycle-indicator" data-ui="day-night">
            <div class="cycle-dot" data-ui="cycle-dot"></div>
            <span class="cycle-text" data-ui="day-time">--:--</span>
          </div>
        </header>

        <div class="map-overlay map-overlay--zone" data-ui="zone-tag">--</div>
        <div class="map-overlay map-overlay--prosperity" data-ui="prosperity-tag">--</div>

        <div class="event-toast" data-ui="event-toast" style="display:none">
          <span class="event-toast__title"></span>
        </div>

        <div class="cell-hover-card" data-ui="hover-card">
          <div class="cell-hover-card__type">等待</div>
          <div class="cell-hover-card__title">悬停格子查看信息</div>
          <div class="cell-hover-card__rows"></div>
        </div>

        <div class="hud-chat-dock" data-ui="chat-panel">
          <div class="hud-chat-dock__head">
            <span>聊天 / 通知</span>
            <span class="hud-chat-dock__tabs"><b data-ui="sys-count">系统 0</b> 队伍 区域</span>
          </div>
          <div class="hud-chat-msgs" data-ui="chat-messages"></div>
          <div class="hud-chat-dock__input">
            <select data-ui="chat-channel"><option value="team">队伍</option><option value="region">区域</option></select>
            <input data-ui="chat-input" maxlength="200" placeholder="发送消息…" />
            <button data-action="chat-send">发送</button>
          </div>
        </div>

        <footer class="gp-actionbar" data-ui="action-dock">
          <div class="dice-zone">
            <button class="dice-btn" data-action="roll">掷骰</button>
            <span class="dice-status" data-ui="dice-status">就绪</span>
          </div>
          <div class="action-cluster" data-ui="action-cluster">
          </div>
          <div class="actionbar-spacer"></div>
        </footer>
      </div>`;

    this.input = this.root.querySelector("[data-ui=chat-input]") as HTMLInputElement;
    this.channel = this.root.querySelector("[data-ui=chat-channel]") as HTMLSelectElement;

    // Event wiring
    this.root.querySelector('[data-action="chat-send"]')?.addEventListener("click", () => this.sendChat());
    this.input.addEventListener("keydown", (e) => { if (e.key === "Enter") this.sendChat(); });
    this.root.querySelector('[data-action="roll"]')?.addEventListener("click", () => this.config.onRoll?.());

    // Subscriptions
    this.unsubscribers.push(
      this.vm.subscribe("player", () => this.update()),
      this.vm.subscribe("movement", () => this.update()),
      this.vm.subscribe("team", () => this.update()),
      this.vm.subscribe("dayNight", () => this.update()),
      this.vm.subscribe("chat", () => this.update()),
      this.vm.subscribe("pathChoice", () => this.update()),
      this.vm.subscribe("cellActions", () => this.update()),
    );
    this.update();
  }

  getElement(): HTMLElement { return this.root; }

  showCellHover(cell: any, x: number, y: number): void {
    const card = this.root.querySelector("[data-ui=hover-card]") as HTMLElement;
    card.innerHTML = `<div class="cell-hover-card__type">${String(cell.type).toUpperCase()} · 当前格</div><div class="cell-hover-card__title">${this.escapeHtml(String(cell.name))}</div><div class="cell-hover-card__rows"><span>价格</span><b>${cell.price ? `$${cell.price}` : "—"}</b><span>等级</span><b>Lv.${cell.level ?? 0}</b><span>归属</span><b>${cell.owners?.length ? "已归属" : "无主"}</b></div>`;
    card.style.display="block"; card.style.left=`${Math.min(x+18,window.innerWidth-240)}px`; card.style.top=`${Math.max(76,y-12)}px`;
  }
  hideCellHover(): void { (this.root.querySelector("[data-ui=hover-card]") as HTMLElement).style.display="none"; }

  update(): void {
    if (this.destroyed) return;
    const player = this.vm.getPlayer();
    const movement = this.vm.getMovement();
    const team = this.vm.getTeam();
    const chat = this.vm.getChat();
    const pathChoice = this.vm.getPathChoice();
    const cellActions = this.vm.getCellActions();

    // Player badge
    const nameEl = this.root.querySelector("[data-ui=player-name]")!;
    nameEl.textContent = player.currentPlayerName || "玩家";
    const teamEl = this.root.querySelector("[data-ui=player-team]")!;
    teamEl.textContent = team.members.length > 1 ? `队伍 ${team.members.length}人` : "独行";

    // Value pills
    for (const [key, value] of [["money", player.currentMoney], ["credit", player.currentCredit], ["env", player.currentEnv]] as const) {
      this.root.querySelector(`[data-ui=${key}]`)!.textContent = String(Math.round(value));
    }

    // Day/Night cycle
    const day = this.vm.getLocalDayNight(this.vm.getPlayerTimezone());
    const timeEl = this.root.querySelector("[data-ui=day-time]")!;
    timeEl.textContent = `${day.isDay ? "昼" : "夜"} ${day.timeStr}`;
    const dotEl = this.root.querySelector("[data-ui=cycle-dot]")!;
    dotEl.className = `cycle-dot ${day.isDay ? "cycle-dot--day" : "cycle-dot--night"}`;

    // Dice button
    const rollBtn = this.root.querySelector('[data-action="roll"]') as HTMLButtonElement;
    const canRoll = movement.canRoll && !movement.isMoving && !player.isBankrupt;
    rollBtn.disabled = !canRoll;
    const statusEl = this.root.querySelector("[data-ui=dice-status]")!;
    statusEl.textContent = movement.isMoving ? "移动中" : canRoll ? "就绪" : "冷却中";

    const actionCluster = this.root.querySelector('[data-ui="action-cluster"]')!;
    const actionButtons = pathChoice.active ? pathChoice.options.map((option, index) => {
      const button = document.createElement('button');
      button.className = 'act-btn act-btn--accent';
      button.dataset.action = 'path-choice';
      button.dataset.cellId = String(option.cellId);
      button.textContent = `选择路径 ${String.fromCharCode(65 + index)}`;
      const detail = document.createElement('span');
      detail.className = 'act-btn__price';
      detail.textContent = `→ ${option.label}`;
      button.appendChild(detail);
      button.addEventListener('click', () => this.config.onPathChoice?.(option.cellId));
      return button;
    }) : cellActions.map(action => {
      const button = document.createElement('button');
      button.className = `act-btn${action.enabled ? ' act-btn--accent' : ''}`;
      button.dataset.action = action.id;
      button.disabled = !action.enabled;
      button.textContent = action.label;
      if (action.detail) {
        const detail = document.createElement('span');
        detail.className = 'act-btn__price';
        detail.textContent = action.detail;
        button.appendChild(detail);
      }
      button.addEventListener('click', () => this.config.onCellAction?.(action.id));
      return button;
    });
    actionCluster.replaceChildren(...actionButtons);

    // Chat messages (last 10)
    const msgsEl = this.root.querySelector("[data-ui=chat-messages]")!;
    const recent = chat.history.slice(-10);
    if (recent.length > 0) {
      msgsEl.innerHTML = recent.map(m => {
        const chanLabel = m.channel === "system" ? "系统" : m.channel === "team" ? "队伍" : "区域";
        return `<div class="hud-chat-msg"><b>${chanLabel}</b><span>${this.escapeHtml(m.text)}</span></div>`;
      }).join("");
    } else {
      msgsEl.innerHTML = `<div class="hud-chat-msg"><span>暂无消息</span></div>`;
    }

    // System unread count
    const sysCount = chat.history.filter(m => m.channel === "system").length;
    this.root.querySelector("[data-ui=sys-count]")!.textContent = `系统 ${sysCount}`;
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribers.forEach(fn => fn());
    this.effects.onNotifyDismiss("game-hud-shell");
    this.root.remove();
  }

  private sendChat(): void {
    const message = this.input.value.trim();
    if (!message) return;
    this.config.onChatSend?.(message, this.channel.value);
    this.input.value = "";
  }

  private escapeHtml(s: string): string {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }
}
