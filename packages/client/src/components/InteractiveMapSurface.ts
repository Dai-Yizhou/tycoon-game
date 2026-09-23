import { type MapData, type Player, type ValueFieldDefinition } from "@game/shared";
import { localizedText } from "../game/i18n.js";

export class InteractiveMapSurface {
  private root = document.createElement("div");
  private map: MapData = [];
  private players: Player[] = [];
  private bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  private followedCellId: number | null = null;
  private movementLocked = false;
  private displayedPlayerPositions = new Map<string, { x: number; y: number }>();
  private valueFieldDefinitions: ValueFieldDefinition[] = [];
  /** 已持股（有股东）的格子 id，用于边框高亮（仅 2 种边框样式：默认 / 已持股） */
  private heldCellIds = new Set<number>();
  // 本玩家最近一次渲染/放置所在的格子，用于识别瞬时传送等非动画位置跳变
  private selfCellId: number | null = null;

  setMovementLocked(locked: boolean): void {
    if (this.movementLocked === locked) return;
    this.movementLocked = locked;
    this.root.classList.toggle("is-moving", locked);
    if (!locked) {
      this.displayedPlayerPositions.clear();
      if (this.map.length) this.render(this.map, this.players, this.valueFieldDefinitions);
    }
  }

  /**
   * 权威设置本玩家当前所在格（用于 hover 时"仅当前格可查看"判定）。
   * 移动动画由 currentPlayerPosition 字段驱动，而 players[0].position 在 serverPath
   * 动画过程中可能滞后不更新，若沿用 position 会导致 selfCellId 停留初始格、hover 全部失效。
   */
  setSelfCell(cellId: number): void {
    if (this.selfCellId === cellId) return;
    this.selfCellId = cellId;
  }

  constructor() {
    this.root.className = "interactive-map-surface";
    this.root.dataset.ui = "interactive-map";
  }

  getElement(): HTMLElement {
    return this.root;
  }

  /** 更新已持股格子集合，并就地切换已有节点的边框高亮（无需整图重绘）。 */
  setHeldCells(held: Set<number>): void {
    this.heldCellIds = held;
    if (!this.root.isConnected) return;
    this.root.querySelectorAll<SVGGElement>(".map-node").forEach(node => {
      const cellId = Number(node.dataset.cellId);
      node.classList.toggle("map-node--held", held.has(cellId));
    });
  }

  render(
    map: MapData,
    players: Player[] = this.players,
    valueFieldDefinitions: ValueFieldDefinition[] = this.valueFieldDefinitions,
  ): void {
    this.map = map;
    this.players = players;
    this.valueFieldDefinitions = valueFieldDefinitions;
    // selfCellId 由 setSelfCell 以 currentPlayerPosition（权威移动字段）维护；
    // 这里仅在尚未初始化时回填一次，避免 render 用滞后的 position.cellId 覆盖权威值
    if (this.selfCellId === null) this.selfCellId = players[0]?.position.cellId ?? null;
    const ns = "http://www.w3.org/2000/svg";
    const cells = [...map];
    if (!cells.length) return;

    const xs = cells.map(c => c.x),
      ys = cells.map(c => c.y);
    const minX = Math.min(...xs) - 90,
      minY = Math.min(...ys) - 90,
      maxX = Math.max(...xs) + 90,
      maxY = Math.max(...ys) + 90;
    this.bounds = { minX, minY, maxX, maxY };

    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.classList.add("interactive-map-surface__svg");

    const byId = new Map(cells.map(c => [c.id, c]));
    const destSet = new Map(cells.map(c => [c.id, new Set(c.destinations || [])]));

    // 方向箭头 marker：双向边两端各挂一个，单向边仅目标端挂一个
    const defs = document.createElementNS(ns, "defs");
    const arrowMarker = document.createElementNS(ns, "marker");
    arrowMarker.setAttribute("id", "map-link-arrow");
    // 更大的箭头（16 单位 viewBox 铺到 32 user-space 单位），相对 10px 线径足够醒目
    arrowMarker.setAttribute("viewBox", "0 0 16 16");
    arrowMarker.setAttribute("refX", "14");
    arrowMarker.setAttribute("refY", "8");
    arrowMarker.setAttribute("markerWidth", "32");
    arrowMarker.setAttribute("markerHeight", "32");
    arrowMarker.setAttribute("markerUnits", "userSpaceOnUse");
    arrowMarker.setAttribute("orient", "auto");
    const arrowPath = document.createElementNS(ns, "path");
    arrowPath.setAttribute("d", "M1,1 L15,8 L1,15 Z");
    arrowPath.classList.add("map-link__arrow");
    arrowMarker.appendChild(arrowPath);
    defs.appendChild(arrowMarker);
    svg.appendChild(defs);

    const links = document.createElementNS(ns, "g");
    links.classList.add("interactive-map-surface__links");
    const drawn = new Set<string>();
    const followedCell = byId.get(this.followedCellId ?? -1);
    if (followedCell) this.applyViewBox(svg, followedCell.x, followedCell.y);

    // 箭头端点内收半径：格子半宽 68 + 箭头后段约 26，使放大后的箭头整体落在格子边缘外可见
    const ARROW_INSET = 94;
    const drawDirectedLine = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy);
      const inset = Math.min(ARROW_INSET, len / 2);
      const ux = dx / len;
      const uy = dy / len;
      const ex = to.x - ux * inset;
      const ey = to.y - uy * inset;
      const l = document.createElementNS(ns, "line");
      l.setAttribute("x1", String(from.x));
      l.setAttribute("y1", String(from.y));
      l.setAttribute("x2", String(ex));
      l.setAttribute("y2", String(ey));
      l.classList.add("map-link");
      l.setAttribute("marker-end", "url(#map-link-arrow)");
      links.appendChild(l);
    };

    cells.forEach(c =>
      (c.destinations || []).forEach(id => {
        const d = byId.get(id);
        if (!d) return;
        const a = c.id;
        const b = id;
        const k = a === b ? `loop:${a}` : [a, b].sort().join(":");
        if (drawn.has(k)) return;
        drawn.add(k);
        const ab = destSet.get(a)?.has(b) ?? false;
        const ba = destSet.get(b)?.has(a) ?? false;
        if (ab && ba) {
          drawDirectedLine(c, d);
          drawDirectedLine(d, c);
        } else if (ab) {
          drawDirectedLine(c, d);
        } else if (ba) {
          drawDirectedLine(d, c);
        }
        // 均无方向关系（异常数据）：不画线，保持一致
      })
    );
    svg.appendChild(links);

    const nodes = document.createElementNS(ns, "g");
    nodes.classList.add("interactive-map-surface__nodes");
    cells.forEach(c => {
      const g = document.createElementNS(ns, "g");
      const type = String(c.type ?? c.extra?.type ?? "property");
      const name = localizedText(c.name ?? c.extra?.name, `格子 ${c.id}`);
      g.classList.add("map-node", `map-node--${type}`);
      if (this.heldCellIds.has(c.id)) g.classList.add("map-node--held");
      g.dataset.cellId = String(c.id);
      g.setAttribute("transform", `translate(${c.x} ${c.y})`);

      const r = document.createElementNS(ns, "rect");
      r.setAttribute("x", "-68");
      r.setAttribute("y", "-46");
      r.setAttribute("width", "136");
      r.setAttribute("height", "92");
      r.setAttribute("rx", type === "property" ? "2" : "12");
      r.classList.add("map-node__shape");

      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", "0");
      t.setAttribute("y", "-12");
      t.setAttribute("text-anchor", "middle");
      t.classList.add("map-node__type");
      t.textContent = type.toUpperCase();

      const n = document.createElementNS(ns, "text");
      n.setAttribute("x", "0");
      n.setAttribute("y", "24");
      n.setAttribute("text-anchor", "middle");
      n.classList.add("map-node__name");
      n.textContent = name;

      g.append(r, t, n);

      // 客户端宽松防护：仅当悬停格是本玩家当前所在格时才上报 hover，其余格子不显示
      g.addEventListener("mouseenter", () => {
        if (c.id !== this.selfCellId) return;
        const b = g.getBoundingClientRect();
        this.root.dispatchEvent(
          new CustomEvent("map:hover", {
            detail: { cellId: c.id, clientX: b.right, clientY: b.top, rect: { left: b.left, right: b.right, top: b.top, width: b.width, height: b.height } }
          })
        );
      });
      g.addEventListener("mouseleave", () =>
        this.root.dispatchEvent(new CustomEvent("map:leave"))
      );

      nodes.appendChild(g);
    });
    svg.appendChild(nodes);

    const pieces = document.createElementNS(ns, "g");
    pieces.classList.add("interactive-map-surface__players");
    const selfId = this.players[0]?.id;
    const selfTeamId = this.players[0]?.teamId ?? null;
    this.players
      .filter((player): player is Player => Boolean(player))
      .forEach((player, i) => {
        // 本玩家落点以权威 selfCellId 为准（serverPath 动画期间 position.cellId 可能滞后）
        const restId = i === 0 ? (this.selfCellId ?? player.position.cellId) : player.position.cellId;
        const cell = byId.get(restId);
        if (!cell) return;
        const g = document.createElementNS(ns, "g");
        g.classList.add("map-player");
        const defaultX = i === 0 ? cell.x : cell.x + (i % 3 - 1) * 18;
        const defaultY = i === 0 ? cell.y : cell.y - 42 - Math.floor(i / 3) * 8;
        const displayed = this.displayedPlayerPositions.get(player.id);
        const x = displayed?.x ?? defaultX;
        const y = displayed?.y ?? defaultY;
        g.setAttribute("transform", `translate(${x} ${y})`);
        g.dataset.playerId = player.id;
        
        const body = document.createElementNS(ns, "path");
        body.setAttribute("d", "M-18 34 L-11 2 L11 2 L18 34 Z");
        body.classList.add("map-player__body");
        
        const head = document.createElementNS(ns, "circle");
        head.setAttribute("r", "12");
        head.setAttribute("cy", "-4");
        head.classList.add("map-player__head");
        
        /* 玩家色：按关系区分（本玩家/队友/其他玩家），颜色由主题令牌注入 */
        const roleVar = player.id === selfId
          ? "--gp-player-self"
          : player.teamId !== null && player.teamId === selfTeamId
            ? "--gp-player-teammate"
            : "--gp-player-other";
        const color = getComputedStyle(this.root).getPropertyValue(roleVar).trim();
        if (color) g.style.setProperty("--gp-player-color", color);

        // 待机跳动包裹层：对外层 g 的 translate 定位无干扰，动画仅作用于内层 transform
        const bounce = document.createElementNS(ns, "g");
        bounce.classList.add("map-player__bounce");
        bounce.append(head, body);
        g.append(bounce);
        pieces.appendChild(g);
      });
    svg.appendChild(pieces);

    this.root.replaceChildren(svg);
  }

  updatePlayers(players: Player[]): void {
    const changed = players.length !== this.players.length || players.some((player, index) => {
      const previous = this.players[index];
      return !previous || previous.id !== player.id || previous.status !== player.status;
    });
    this.players = players;
    if (this.movementLocked) return;
    if (changed && this.map.length) {
      this.render(this.map, players, this.valueFieldDefinitions);
      return;
    }
    players.slice(1).forEach((player, index) => {
      const cell = this.map.find((item) => item.id === player.position.cellId);
      const element = this.root.querySelector(`[data-player-id="${player.id}"]`);
      if (cell && element) {
        element.setAttribute('transform', `translate(${cell.x + ((index + 1) % 3 - 1) * 18} ${cell.y - 42 - Math.floor((index + 1) / 3) * 8})`);
      }
    });
    // 本玩家：无论 position.cellId 是否滞后，都回落到权威 selfCellId 对应格。
    // 行走动画由 setMovementLocked/RAF 驱动，此处锁定态提前返回、不触碰其节点；
    // selfCellId 由 setSelfCell(currentPlayerPosition) 权威维护，绝不以滞后的 position.cellId 覆写。
    const self = players[0];
    if (self) {
      if (this.selfCellId === null) this.selfCellId = self.position.cellId;
      const cell = this.map.find((item) => item.id === this.selfCellId);
      if (cell) this.setPlayerDisplayPosition(self.id, cell.x, cell.y);
    }
  }

  setPlayerDisplayPosition(playerId: string, x: number, y: number): void {
    this.displayedPlayerPositions.set(playerId, { x, y });
    // 其他玩家带错位偏移（与 render/updatePlayers 的默认落格一致），self 精确落格，
    // 使插值轨迹与静止时的错位位置一致，避免动画起始/结束的微小跳动。
    const idx = this.players.findIndex((player) => player?.id === playerId);
    const tx = idx > 0 ? x + ((idx % 3) - 1) * 18 : x;
    const ty = idx > 0 ? y - 42 - Math.floor(idx / 3) * 8 : y;
    const player = Array.from(this.root.querySelectorAll('[data-player-id]'))
      .find((element) => element.getAttribute('data-player-id') === playerId);
    if (player) player.setAttribute('transform', `translate(${tx} ${ty})`);
  }

  setDisplayPosition(x: number, y: number): void {
    const playerId = this.players[0]?.id;
    if (playerId) this.setPlayerDisplayPosition(playerId, x, y);
  }

  followPlayer(cellId: number): void {
    if (this.movementLocked) return;
    this.followedCellId = cellId;
    if (!this.map.length) return;
    const svg = this.root.querySelector('svg');
    const cell = this.map.find((item) => item.id === cellId);
    if (svg && cell) this.applyViewBox(svg, cell.x, cell.y);
  }

  followDisplayPosition(x: number, y: number): void {
    if (!this.map.length) return;
    const svg = this.root.querySelector('svg');
    if (svg) this.applyViewBox(svg, x, y);
  }

  private applyViewBox(svg: SVGSVGElement, x: number, y: number): void {
    if (!this.bounds) return;
    const width = Math.max(720, (this.bounds.maxX - this.bounds.minX) * 0.68);
    const height = width * 0.625;
    const centerX = Math.min(
      this.bounds.maxX - width / 2,
      Math.max(this.bounds.minX + width / 2, x)
    );
    const centerY = Math.min(
      this.bounds.maxY - height / 2,
      Math.max(this.bounds.minY + height / 2, y)
    );
    svg.setAttribute(
      "viewBox",
      `${centerX - width / 2} ${centerY - height / 2} ${width} ${height}`
    );
  }
}
