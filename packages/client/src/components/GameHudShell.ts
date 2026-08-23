import type { GameEffectHooks } from "../game/GameEffects.js";
import type { GameViewModel } from "../game/GameViewModel.js";
import { t, localizedText } from "../game/i18n.js";

export interface GameHudShellConfig {
  onRoll?: () => void;
  onChatSend?: (message: string, channel: string) => void;
  onPathChoice?: (cellId: number) => void;
  onCellAction?: (actionId: string) => void;
  onCellHover?: (cellId: number, x: number, y: number) => void;
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
  private readonly activeFilters = new Set(["region", "system", "team"]);
  private isExpanded = false;
  private destroyed = false;
  private hoveredCell: { id: number; x: number; y: number } | null = null;

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
              <div class="player-badge__name" data-ui="player-name"></div>
              <div class="player-badge__team" data-ui="player-team"></div>
            </div>
          </div>
          <div class="value-pills" data-ui="resource-strip">
            <div class="value-pill"><span class="value-pill__label" data-ui="pill-money"></span><span class="value-pill__num" data-ui="money">0</span></div>
            <div class="value-pill value-pill--accent"><span class="value-pill__label" data-ui="pill-credit"></span><span class="value-pill__num" data-ui="credit">0</span></div>
            <div class="value-pill"><span class="value-pill__label" data-ui="pill-env"></span><span class="value-pill__num" data-ui="env">0</span></div>
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
          <div class="cell-hover-card__type"></div>
          <div class="cell-hover-card__title"></div>
          <div class="cell-hover-card__rows"></div>
        </div>

        <div class="hud-chat-dock" data-ui="chat-panel">
          <div class="hud-chat-dock__ticker" data-ui="chat-toggle" role="button" tabindex="0">
            <span class="hud-chat-dock__ticker-icon">&gt;</span>
            <span class="hud-chat-dock__ticker-text" data-ui="chat-ticker"></span>
          </div>
          <div class="hud-chat-dock__expanded">
            <div class="hud-chat-dock__filters" data-ui="chat-filters"></div>
            <div class="hud-chat-msgs" data-ui="chat-messages"></div>
            <div class="hud-chat-dock__input">
              <select data-ui="chat-channel"></select>
              <input data-ui="chat-input" maxlength="200" />
              <button data-action="chat-send"></button>
            </div>
          </div>
        </div>

        <footer class="gp-actionbar" data-ui="action-dock">
          <div class="dice-zone">
            <button class="dice-btn" data-action="roll"></button>
            <span class="dice-status" data-ui="dice-status"></span>
          </div>
          <div class="action-cluster" data-ui="action-cluster">
          </div>
          <div class="actionbar-spacer"></div>
        </footer>
      </div>`;

    this.input = this.root.querySelector("[data-ui=chat-input]") as HTMLInputElement;
    this.channel = this.root.querySelector("[data-ui=chat-channel]") as HTMLSelectElement;

    // 静态文本国际化（语言在会话启动时固定；如需运行中切换语言，需在切换时重调本方法）
    this.bindStaticLabels();

    // Event wiring
    this.root.querySelector('[data-action="chat-send"]')?.addEventListener("click", () => this.sendChat());
    this.input.addEventListener("keydown", (e) => { if (e.key === "Enter") this.sendChat(); });
    this.root.querySelector('[data-action="roll"]')?.addEventListener("click", () => this.config.onRoll?.());
    const toggle = this.root.querySelector('[data-ui="chat-toggle"]');
    const setExpanded = (expanded: boolean): void => {
      this.isExpanded = expanded;
      this.root.querySelector('[data-ui="chat-panel"]')?.classList.toggle("is-expanded", expanded);
    };
    toggle?.addEventListener("click", () => setExpanded(!this.isExpanded));
    toggle?.addEventListener("keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
        event.preventDefault();
        setExpanded(!this.isExpanded);
      }
    });
    this.input.addEventListener("focus", () => setExpanded(true));
    this.input.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (!this.root.contains(document.activeElement)) setExpanded(false);
      }, 150);
    });

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

  /** 写入不进 innerHTML、只在语言切换时变化的静态文案。 */
  private bindStaticLabels(): void {
    const set = (selector: string, key: string): void => {
      const el = this.root.querySelector(selector);
      if (el) el.textContent = t(key);
    };
    set("[data-ui=pill-money]", "hud.money");
    set("[data-ui=pill-credit]", "hud.credit");
    set("[data-ui=pill-env]", "hud.env");
    set('[data-action="roll"]', "dice.roll");
    set('[data-action="chat-send"]', "chat.send");

    // 下拉频道选项与输入框占位符
    this.channel.replaceChildren(
      ...["team", "region"].map((value) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = t(`chat.channel.${value}`);
        return opt;
      }),
    );
    this.input.placeholder = t("chat.inputPlaceholder");
  }

  showCellHover(cellId: number, x: number, y: number): void {
    this.hoveredCell = { id: cellId, x, y };
    this.renderCellHover();
  }

  private renderCellHover(): void {
    if (!this.hoveredCell) return;
    const { id: cellId, x, y } = this.hoveredCell;
    const cell = this.vm.getCell(cellId);
    const card = this.root.querySelector("[data-ui=hover-card]") as HTMLElement;
    if (!cell) {
      card.innerHTML = `<div class="cell-hover-card__type">${this.escapeHtml(t("hud.hoverSyncing"))}</div><div class="cell-hover-card__title">${this.escapeHtml(t("hud.hoverFetching"))}</div>`;
      card.style.display = "block";
      return;
    }
    const extra = cell.extra as Record<string, unknown>;
    const ownerships = Array.isArray(extra.ownerships) ? extra.ownerships as Array<{ playerId: string; share: number }> : [];
    const type = String(extra.type ?? 'empty');
    
    const name = localizedText(extra.name, t("cell." + type));
    const description = localizedText(extra.description, '');
    const price = Number(extra.price ?? 0);
    const level = Number(extra.level ?? 0);
    const typeLabel = this.escapeHtml(String(extra.typeLabel ?? t("cell." + type)));
    const holderText = ownerships.length > 0
      ? t("hud.holderCount", { count: ownerships.length })
      : t("hud.noOwners");
    card.innerHTML = `<div class="cell-hover-card__type">${typeLabel}</div><div class="cell-hover-card__title">${this.escapeHtml(name)}</div>${description ? `<div class="cell-hover-card__description">${this.escapeHtml(description)}</div>` : ""}<div class="cell-hover-card__rows"><span>${t("hud.price")}</span><b>${price ? `$${price}` : "—"}</b><span>${t("hud.level")}</span><b>Lv.${level}</b><span>${t("hud.holder")}</span><b>${holderText}</b></div>`;
    card.style.display="block"; card.style.left=`${Math.min(x+18,window.innerWidth-240)}px`; card.style.top=`${Math.max(76,y-12)}px`;
  }

  hideCellHover(): void {
    this.hoveredCell = null;
    (this.root.querySelector("[data-ui=hover-card]") as HTMLElement).style.display="none";
  }

  update(): void {
    if (this.destroyed) return;
    this.updatePlayerBadge();
    this.updateValuePills();
    this.updateDayNight();
    this.updateDiceButton();
    this.updateActionCluster();
    this.updateChat();
    this.renderCellHover();
  }

  /** 玩家名牌 + 队伍状态 */
  private updatePlayerBadge(): void {
    const player = this.vm.getPlayer();
    const team = this.vm.getTeam();
    const nameEl = this.root.querySelector("[data-ui=player-name]")!;
    nameEl.textContent = player.currentPlayerName || t("game.defaultPlayerName");
    const teamEl = this.root.querySelector("[data-ui=player-team]")!;
    teamEl.textContent = team.members.length > 1 ? t("hud.teamCount", { count: team.members.length }) : t("hud.lone");
  }

  /** 顶部数值条（金钱/信用/环保） */
  private updateValuePills(): void {
    const player = this.vm.getPlayer();
    for (const [key, value] of [["money", player.currentMoney], ["credit", player.currentCredit], ["env", player.currentEnv]] as const) {
      this.root.querySelector(`[data-ui=${key}]`)!.textContent = String(Math.round(value));
    }
  }

  /** 昼夜指示器 */
  private updateDayNight(): void {
    const day = this.vm.getLocalDayNight(this.vm.getPlayerTimezoneOffset());
    const timeEl = this.root.querySelector("[data-ui=day-time]")!;
    timeEl.textContent = `${day.isDay ? t("hud.dayShort") : t("hud.nightShort")} ${day.timeStr}`;
    const dotEl = this.root.querySelector("[data-ui=cycle-dot]")!;
    dotEl.className = `cycle-dot ${day.isDay ? "cycle-dot--day" : "cycle-dot--night"}`;
  }

  /** 掷骰按钮状态与文案 */
  private updateDiceButton(): void {
    const player = this.vm.getPlayer();
    const movement = this.vm.getMovement();
    const dice = this.vm.getDice();
    const cooldown = this.vm.getCooldown();
    const jail = this.vm.getJail();
    const rollBtn = this.root.querySelector('[data-action="roll"]') as HTMLButtonElement;
    const cooldownActive = cooldown.rollCooldownEnd > Date.now();
    const jailCooldownActive = jail.isInJail && jail.jailEndTime > Date.now();
    const canRoll = movement.canRoll && !movement.isMoving && !dice.diceAnimating && !player.isBankrupt && !cooldownActive && !jailCooldownActive;
    rollBtn.disabled = !canRoll;
    const statusEl = this.root.querySelector("[data-ui=dice-status]")!;
    statusEl.textContent = movement.isMoving
      ? t("hud.moving")
      : canRoll ? t("hud.ready") : t("hud.cooldown");
  }

  /** 动作/岔路按钮簇 */
  private updateActionCluster(): void {
    const pathChoice = this.vm.getPathChoice();
    const cellActions = this.vm.getCellActions();
    const actionCluster = this.root.querySelector('[data-ui="action-cluster"]')!;
    const actionButtons = pathChoice.active ? pathChoice.options.map((option, index) => {
      const button = document.createElement('button');
      button.className = 'act-btn act-btn--accent';
      button.dataset.action = 'path-choice';
      button.dataset.cellId = String(option.cellId);
      button.textContent = `${t("hud.choosePath")} ${String.fromCharCode(65 + index)}`;
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
  }

  /** 聊天消息、ticker 与频道筛选 */
  private updateChat(): void {
    const chat = this.vm.getChat();
    const msgsEl = this.root.querySelector("[data-ui=chat-messages]")!;
    const channelId = (channel: string): string => channel === "system" ? "system" : channel === "team" ? "team" : "region";
    const recent = chat.history.filter(message => this.activeFilters.has(channelId(message.channel))).slice(-10);
    if (recent.length > 0) {
      msgsEl.innerHTML = recent.map(m => {
        const chanKey = channelId(m.channel);
        return `<div class="hud-chat-msg"><b>${this.escapeHtml(t(`chat.channel.${chanKey}`))}</b><span>${this.escapeHtml(m.text)}</span></div>`;
      }).join("");
    } else {
      msgsEl.innerHTML = `<div class="hud-chat-msg"><span>${this.escapeHtml(t("hud.noMessage"))}</span></div>`;
    }
    const lastMessage = chat.history[chat.history.length - 1];
    const ticker = this.root.querySelector("[data-ui=chat-ticker]")!;
    if (lastMessage) {
      const key = channelId(lastMessage.channel);
      ticker.innerHTML = `<span class="ch">${this.escapeHtml(t(`chat.channel.${key}`))}</span>${this.escapeHtml(lastMessage.text)}`;
    } else {
      ticker.textContent = t("hud.noMessage");
    }
    this.renderFilters();
  }

  private renderFilters(): void {
    const filters = this.root.querySelector("[data-ui=chat-filters]")!;
    const channels = [
      { id: "region", labelKey: "chat.channel.region" },
      { id: "system", labelKey: "chat.channel.system" },
      { id: "team", labelKey: "chat.channel.team" },
    ];
    filters.innerHTML = channels.map(channel => {
      const checked = this.activeFilters.has(channel.id);
      return `<label class="hud-chat-dock__filter${checked ? " hud-chat-dock__filter--checked" : ""}" data-channel="${channel.id}"><input type="checkbox" data-ui="filter-${channel.id}"${checked ? " checked" : ""}>${this.escapeHtml(t(channel.labelKey))}</label>`;
    }).join("");
    channels.forEach(channel => {
      const checkbox = this.root.querySelector(`[data-ui="filter-${channel.id}"]`) as HTMLInputElement | null;
      checkbox?.addEventListener("change", () => {
        if (checkbox.checked) this.activeFilters.add(channel.id);
        else this.activeFilters.delete(channel.id);
        this.updateChat();
      });
    });
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
