import { formatUct, type MapData, type Player, type ValueFieldDefinition } from "@game/shared";
import { getLanguage, localizedText } from "../game/i18n.js";

export class InteractiveMapSurface {
  private root = document.createElement("div");
  private map: MapData = [];
  private players: Player[] = [];
  private bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  private followedCellId: number | null = null;
  private movementLocked = false;
  private displayedPlayerPositions = new Map<string, { x: number; y: number }>();
  private valueFieldDefinitions: ValueFieldDefinition[] = [];

  setMovementLocked(locked: boolean): void {
    if (this.movementLocked === locked) return;
    this.movementLocked = locked;
    if (!locked) {
      this.displayedPlayerPositions.clear();
      if (this.map.length) this.render(this.map, this.players, this.valueFieldDefinitions);
    }
  }

  constructor() {
    this.root.className = "interactive-map-surface";
    this.root.dataset.ui = "interactive-map";
  }

  getElement(): HTMLElement {
    return this.root;
  }

  render(
    map: MapData,
    players: Player[] = this.players,
    valueFieldDefinitions: ValueFieldDefinition[] = this.valueFieldDefinitions,
  ): void {
    this.map = map;
    this.players = players;
    this.valueFieldDefinitions = valueFieldDefinitions;
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
    const links = document.createElementNS(ns, "g");
    links.classList.add("interactive-map-surface__links");
    const drawn = new Set<string>();
    const followedCell = byId.get(this.followedCellId ?? -1);
    if (followedCell) this.applyViewBox(svg, followedCell.x, followedCell.y);

    cells.forEach(c =>
      (c.destinations || []).forEach(id => {
        const d = byId.get(id);
        if (!d) return;
        const k = [c.id, id].sort().join(":");
        if (drawn.has(k)) return;
        drawn.add(k);
        const l = document.createElementNS(ns, "line");
        l.setAttribute("x1", String(c.x));
        l.setAttribute("y1", String(c.y));
        l.setAttribute("x2", String(d.x));
        l.setAttribute("y2", String(d.y));
        l.classList.add("map-link");
        links.appendChild(l);
      })
    );
    svg.appendChild(links);

    const nodes = document.createElementNS(ns, "g");
    nodes.classList.add("interactive-map-surface__nodes");
    cells.forEach(c => {
      const g = document.createElementNS(ns, "g");
      const type = String(c.type ?? c.extra?.type ?? "property");
      const name = localizedText(c.name ?? c.extra?.name, `格子 ${c.id}`);
      const price = c.price ? formatUct(c.price, this.valueFieldDefinitions, getLanguage()) : "";
      g.classList.add("map-node", `map-node--${type}`);
      g.dataset.cellId = String(c.id);
      g.setAttribute("transform", `translate(${c.x} ${c.y})`);

      const r = document.createElementNS(ns, "rect");
      r.setAttribute("x", "-56");
      r.setAttribute("y", "-38");
      r.setAttribute("width", "112");
      r.setAttribute("height", "76");
      r.setAttribute("rx", type === "property" ? "2" : "12");
      r.classList.add("map-node__shape");

      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", "-45");
      t.setAttribute("y", "-18");
      t.classList.add("map-node__type");
      t.textContent = type.toUpperCase();

      const n = document.createElementNS(ns, "text");
      n.setAttribute("x", "-45");
      n.setAttribute("y", "9");
      n.classList.add("map-node__name");
      n.textContent = name;

      const pr = document.createElementNS(ns, "text");
      pr.setAttribute("x", "-45");
      pr.setAttribute("y", "29");
      pr.classList.add("map-node__price");
      pr.textContent = price || "—";

      g.append(r, t, n, pr);

      g.addEventListener("mouseenter", () => {
        const b = g.getBoundingClientRect();
        this.root.dispatchEvent(
          new CustomEvent("map:hover", {
            detail: { cellId: c.id, clientX: b.right, clientY: b.top }
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
        const cell = byId.get(player.position.cellId);
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

        g.append(head, body);
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
  }

  setPlayerDisplayPosition(playerId: string, x: number, y: number): void {
    this.displayedPlayerPositions.set(playerId, { x, y });
    const player = Array.from(this.root.querySelectorAll('[data-player-id]'))
      .find((element) => element.getAttribute('data-player-id') === playerId);
    if (player) player.setAttribute('transform', `translate(${x} ${y})`);
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
