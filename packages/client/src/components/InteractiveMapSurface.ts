import { type MapData, type Player, type ValueFieldDefinition, parseChatCommand } from "@game/shared";
import { localizedText, t } from "../game/i18n.js";
import { readCssVarNumber } from "../design/DesignAdapter.js";
// 图形资源（矢量）：以 Vite ?raw 内联，颜色由应用样式表按类名/CSS 变量驱动
import pieceSelfSvgRaw from "../assets/piece-self.svg?raw";
import pieceTeammateSvgRaw from "../assets/piece-teammate.svg?raw";
import pieceOtherSvgRaw from "../assets/piece-other.svg?raw";
import emptyCellSvgRaw from "../assets/cells/empty.svg?raw";
import eventCellSvgRaw from "../assets/cells/event.svg?raw";
import supplyCellSvgRaw from "../assets/cells/supply.svg?raw";
import propertyCellSvgRaw from "../assets/cells/property.svg?raw";
import transportCellSvgRaw from "../assets/cells/transport.svg?raw";
import investmentCellSvgRaw from "../assets/cells/investment.svg?raw";
import jailCellSvgRaw from "../assets/cells/jail.svg?raw";
import monumentCellSvgRaw from "../assets/cells/monument.svg?raw";

const SVG_NS = "http://www.w3.org/2000/svg";

/** 棋子角色语义：由交互层按玩家关系判定，决定棋子图像源 */
type PlayerRole = "self" | "teammate" | "other";

/** 同格多玩家的错位图案：在格内水平铺开，满 3 人后换上一排继续错位（不再竖直堆叠），索引超出后循环 */
const PLAYER_SLOT_OFFSETS: ReadonlyArray<{ x: number; y: number }> = [
  { x: -34, y:  10 },
  { x:  30, y: -14 },
  { x:   6, y:  30 },
  { x: -24, y: -30 },
  { x:  46, y:  18 },
];

/** 同格内第 index 个玩家的落点偏移（index 0 = 本玩家，不偏移） */
function playerSlotOffset(index: number): { x: number; y: number } {
  if (index <= 0) return { x: 0, y: 0 };
  return PLAYER_SLOT_OFFSETS[(index - 1) % PLAYER_SLOT_OFFSETS.length];
}

/** 格子矩形几何（矩形相对格子中心对称，故用半宽/半高）：名称变长只横向扩展，不截断 */
const BASE_RECT_HALF_W = 68;
const RECT_HALF_H = 46;
/** 玩家发言悬浮框的停留时长（临时提示，到期自动消失） */
const PLAYER_CHAT_BUBBLE_MS = 6000;
/** 发言悬浮框底边距棋子锚点的留白：盖住棋子图形上缘(16px)+待机跳动上浮(9px)，贴住整枚棋子 */
const PIECE_TOP_CLEARANCE = 26;
/** 名称/类型文字距矩形左右边缘的内边距 */
const RECT_TEXT_PAD_X = 10;
/** 名称字号（与 .map-node__name 的 font-size 对应，用于估算所需宽度） */
const NODE_NAME_FONT_SIZE = 16;
/** 右侧图标预留宽度（该类型有图标资源时才计入矩形宽度） */
const RECT_ICON_RESERVE = 32;
/** 图标中心距矩形右边缘的距离（矩形变宽时图标随之右移） */
const RECT_ICON_INSET = 16;

/**
 * 按字号估算文本宽度：全角按字号、半角按 0.55 字号（保守估算，仅用于给矩形定宽）。
 * 格子名称过长时不再截断，而是据此把矩形拉长；估算需贴紧真实字宽，
 * 否则矩形会明显宽于文字（此前按整字宽估算 + 大内边距导致矩形过宽）。
 * 用 charCodeAt 判全角而非 /[^\x00-\xff]/，避免控制字符正则触发 no-control-regex。
 */
function estimateTextWidth(text: string, fontSize: number): number {
  const halfWidth = fontSize * 0.55;
  let total = 0;
  for (const ch of text) total += ch.charCodeAt(0) > 0xff ? fontSize : halfWidth;
  return total * 0.45;
}

/**
 * 解析独立 SVG 资源并"解包"为 <g>：只取其图形子节点，不保留外层 <svg> 视口。
 * 嵌套 <svg> 视口在祖先翻转变换（缩放/滤镜）下会被反复重栅格化，导致棋子频闪；
 * 解包后与直接写在文档里的图形一致，且模板共用（克隆后使用）。
 * 解析失败返回 null（该图形不渲染），不抛错。
 */
function parseSvgGroup(raw: string, className?: string): SVGElement | null {
  // 空资源（占位期留空的 svg 文件）直接视为"无图形"，不进入解析
  if (!raw.trim()) return null;
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(raw, "image/svg+xml");
  const root = doc.documentElement as unknown as SVGElement;
  if (!root || root.nodeName.toLowerCase() === "parsererror") return null;
  const g = document.createElementNS(SVG_NS, "g");
  if (className) g.classList.add(className);
  for (const child of Array.from(root.childNodes)) g.appendChild(document.importNode(child, true));
  return g;
}

/**
 * 棋子图形模板：按角色语义（本玩家 / 队友 / 其他玩家）取不同图像源，解析一次后克隆复用。
 * 颜色规则不变（仍由 --gp-player-color 驱动身体填充），这里只区分轮廓。
 */
const PIECE_RAW: Record<PlayerRole, string> = {
  self: pieceSelfSvgRaw,
  teammate: pieceTeammateSvgRaw,
  other: pieceOtherSvgRaw,
};
const pieceTemplates = new Map<PlayerRole, SVGElement>();
function getPieceTemplate(role: PlayerRole): SVGElement | null {
  const cached = pieceTemplates.get(role);
  if (cached) return cached;
  const g = parseSvgGroup(PIECE_RAW[role], "map-player__icon");
  if (!g) return null;
  pieceTemplates.set(role, g);
  return g;
}

/** 8 种格子类型图标（独立 SVG 资源）：按类型缓存解包后的模板 */
const CELL_ICON_RAW: Record<string, string> = {
  empty: emptyCellSvgRaw,
  event: eventCellSvgRaw,
  supply: supplyCellSvgRaw,
  property: propertyCellSvgRaw,
  transport: transportCellSvgRaw,
  investment: investmentCellSvgRaw,
  jail: jailCellSvgRaw,
  monument: monumentCellSvgRaw,
};
const cellIconTemplates = new Map<string, SVGElement>();
function getCellIconTemplate(type: string): SVGElement | null {
  const cached = cellIconTemplates.get(type);
  if (cached) return cached;
  const raw = CELL_ICON_RAW[type];
  if (!raw) return null;
  const g = parseSvgGroup(raw);
  if (!g) return null;
  cellIconTemplates.set(type, g);
  return g;
}

/** 玩家发言输入气泡的对外回调（发送由 GamePage 注入） */
export interface MapChatComposerConfig {
  onSend: (message: string, channel: string, onResult?: (ok: boolean) => void) => void;
  /** 指令显式指定频道时回调（如 /t，用于提示队伍频道可见性） */
  onChannelChange?: (channel: string) => void;
}

/** 未写频道指令时的默认发言频道 */
const DEFAULT_CHAT_CHANNEL = "region";

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
  /** 玩家发言悬浮框层：HTML 覆盖在 SVG 之上，锚定到发言者棋子，随镜头移动 */
  private readonly chatLayer = document.createElement("div");
  /** playerId → 当前悬浮框元素及其自动隐藏/移除定时器（同一玩家只保留最新一条） */
  private readonly chatBubbles = new Map<string, { el: HTMLElement; hideTimer: number; removeTimer: number }>();
  /** 玩家发言输入气泡：与发言悬浮框同层，锚定在本玩家棋子正上方 */
  private readonly chatComposer = document.createElement("div");
  private readonly chatComposerInput = document.createElement("input");
  private chatComposerConfig: MapChatComposerConfig | null = null;
  private chatComposerOpen = false;

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
    this.chatLayer.className = "map-chat-layer";
    this.root.appendChild(this.chatLayer);
    this.buildChatComposer();
  }

  /** 构建玩家发言输入气泡：仅输入框（频道由 /r /t /g 指令指定），默认收起 */
  private buildChatComposer(): void {
    this.chatComposer.className = "map-chat-composer";
    this.chatComposer.dataset.ui = "map-chat-composer";
    this.chatComposerInput.className = "map-chat-composer__input";
    this.chatComposerInput.maxLength = 200;
    this.chatComposerInput.placeholder = t("chat.inputPlaceholder");
    this.chatComposerInput.setAttribute("aria-label", t("chat.inputPlaceholder"));
    this.chatComposer.appendChild(this.chatComposerInput);
    this.chatLayer.appendChild(this.chatComposer);

    this.chatComposerInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeChatComposer();
        return;
      }
      if (event.key !== "Enter") return;
      // 普通 Enter 不发送，避免误触；Ctrl/Cmd+Enter 才提交
      event.preventDefault();
      if (!(event.ctrlKey || event.metaKey)) return;
      this.sendChatComposer();
    });
    // 焦点离开气泡（如点击棋盘）时收起
    this.chatComposerInput.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (this.chatComposerOpen && !this.chatComposer.contains(document.activeElement)) this.closeChatComposer();
      }, 150);
    });
  }

  /** 注入发送/频道切换回调（GamePage 持有 socket 与 store） */
  setChatComposerConfig(config: MapChatComposerConfig): void {
    this.chatComposerConfig = config;
  }

  /** 唤起玩家头顶的发言输入气泡并聚焦 */
  openChatComposer(): void {
    if (!this.map.length) return;
    this.chatComposerOpen = true;
    this.chatComposer.classList.add("is-open");
    // 展开后测量一次尺寸并缓存，后续相机每帧重定位只读缓存、不触发重排
    this.chatComposer.dataset.w = String(this.chatComposer.offsetWidth);
    this.chatComposer.dataset.h = String(this.chatComposer.offsetHeight);
    this.repositionChatOverlays();
    this.chatComposerInput.focus();
  }

  private closeChatComposer(): void {
    this.chatComposerOpen = false;
    this.chatComposer.classList.remove("is-open");
  }

  /** 提交发言：支持 /r /t /g 频道前缀，未指定时发往默认频道；成功后保持输入框聚焦以便连续发送 */
  private sendChatComposer(): void {
    const message = this.chatComposerInput.value.trim();
    if (!message) return;
    const command = parseChatCommand(message);
    const channel = command.kind === "channel" ? command.channel : DEFAULT_CHAT_CHANNEL;
    if (command.kind === "channel") this.chatComposerConfig?.onChannelChange?.(command.channel);
    this.chatComposerInput.value = "";
    this.chatComposerConfig?.onSend(message, channel);
    this.chatComposerInput.focus();
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
    const ns = SVG_NS;
    const cells = [...map];
    if (!cells.length) return;

    // 每格排版：类型 / 名称 / 矩形半宽 / 图标模板，供连线端点与节点绘制共用。
    // 名称过长时不截断文字，而是把矩形横向拉长（右侧有图标资源时再预留图标位）。
    const layout = new Map<number, { type: string; name: string; halfW: number; icon: SVGElement | null }>();
    cells.forEach((c) => {
      const type = String(c.type ?? c.extra?.type ?? "property");
      const icon = getCellIconTemplate(type);
      const name = localizedText(c.name ?? c.extra?.name, `格子 ${c.id}`);
      const halfW = Math.max(
        BASE_RECT_HALF_W,
        RECT_TEXT_PAD_X * 2 + estimateTextWidth(name, NODE_NAME_FONT_SIZE) + (icon ? RECT_ICON_RESERVE : 0),
      );
      layout.set(c.id, { type, name, halfW, icon });
    });
    // 视口留白需覆盖最宽格子的半个矩形，否则边缘格子的矩形会紧贴/越出可视范围
    const maxHalfW = Math.max(BASE_RECT_HALF_W, ...cells.map((c) => layout.get(c.id)!.halfW));

    const xs = cells.map(c => c.x),
      ys = cells.map(c => c.y);
    const padX = Math.max(90, maxHalfW + 24);
    const minX = Math.min(...xs) - padX,
      minY = Math.min(...ys) - 90,
      maxX = Math.max(...xs) + padX,
      maxY = Math.max(...ys) + 90;
    this.bounds = { minX, minY, maxX, maxY };

    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.classList.add("interactive-map-surface__svg");

    const byId = new Map(cells.map(c => [c.id, c]));
    const destSet = new Map(cells.map(c => [c.id, new Set(c.destinations || [])]));

    // 连线几何令牌（布局常量）：线宽由 CSS --map-link-width 控制；箭头尺寸与端点留白在此读取
    const arrowSize = readCssVarNumber(this.root, "--map-arrow-size", 22);
    const linkGap = readCssVarNumber(this.root, "--map-link-gap", 4);

    // 方向箭头 marker：双向边两端各挂一个（auto-start-reverse 使起点箭头朝外），单向边仅目标端挂一个
    const defs = document.createElementNS(ns, "defs");
    const arrowMarker = document.createElementNS(ns, "marker");
    arrowMarker.setAttribute("id", "map-link-arrow");
    // viewBox 16 单位映射到 --map-arrow-size 个 user-space 单位；refX 取箭头尖端(15)使尖端恰好落在端点
    arrowMarker.setAttribute("viewBox", "0 0 16 16");
    arrowMarker.setAttribute("refX", "15");
    arrowMarker.setAttribute("refY", "8");
    arrowMarker.setAttribute("markerWidth", String(arrowSize));
    arrowMarker.setAttribute("markerHeight", String(arrowSize));
    arrowMarker.setAttribute("markerUnits", "userSpaceOnUse");
    arrowMarker.setAttribute("orient", "auto-start-reverse");
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

    /** 从格子中心沿单位方向 u 到矩形边界的距离（射线-矩形求交）：
     *  取两个轴的约束距离中较小的一个；固定距离会让斜向连线的端点落进矩形内（被格子盖住），
     *  或离矩形太远，故必须按方向与各自的矩形尺寸实时求交。零分量轴视为无约束。 */
    const edgeDistance = (ux: number, uy: number, halfW: number): number => {
      const tx = ux === 0 ? Infinity : halfW / Math.abs(ux);
      const ty = uy === 0 ? Infinity : RECT_HALF_H / Math.abs(uy);
      return Math.min(tx, ty);
    };

    /**
     * 绘制一条连线。两端按各自格子矩形边界计算并各留出 linkGap，使线/箭头与格子衔接自然。
     * @param both 双向边：两端各挂一个箭头，且只画一条线（避免两条反向线重叠发脏）
     */
    const drawLink = (
      from: { x: number; y: number; id: number },
      to: { x: number; y: number; id: number },
      both: boolean,
    ) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy);
      // 自环 / 极短边：不绘制，避免除零与坐标 NaN
      if (!Number.isFinite(len) || len < 1) return;
      const ux = dx / len;
      const uy = dy / len;
      // 矩形宽度随名称长度变化，故两端分别按自身半宽求交
      const insetFrom = edgeDistance(ux, uy, layout.get(from.id)!.halfW) + linkGap;
      const insetTo = edgeDistance(ux, uy, layout.get(to.id)!.halfW) + linkGap;
      // 两格过近时留白会互相越过：退化为不画线
      if (len <= insetFrom + insetTo) return;
      const l = document.createElementNS(ns, "line");
      l.setAttribute("x1", String(from.x + ux * insetFrom));
      l.setAttribute("y1", String(from.y + uy * insetFrom));
      l.setAttribute("x2", String(to.x - ux * insetTo));
      l.setAttribute("y2", String(to.y - uy * insetTo));
      l.classList.add("map-link");
      if (both) l.setAttribute("marker-start", "url(#map-link-arrow)");
      l.setAttribute("marker-end", "url(#map-link-arrow)");
      links.appendChild(l);
    };

    cells.forEach(c =>
      (c.destinations || []).forEach(id => {
        const d = byId.get(id);
        if (!d) return;
        const a = c.id;
        const b = id;
        if (a === b) return; // 自环：不绘制
        const k = [a, b].sort().join(":");
        if (drawn.has(k)) return;
        drawn.add(k);
        const ab = destSet.get(a)?.has(b) ?? false;
        const ba = destSet.get(b)?.has(a) ?? false;
        if (ab && ba) {
          // 双向：单条线 + 两端箭头
          drawLink(c, d, true);
        } else if (ab) {
          drawLink(c, d, false);
        } else if (ba) {
          drawLink(d, c, false);
        }
        // 均无方向关系（异常数据）：不画线，保持一致
      })
    );
    svg.appendChild(links);

    const nodes = document.createElementNS(ns, "g");
    nodes.classList.add("interactive-map-surface__nodes");
    cells.forEach(c => {
      const g = document.createElementNS(ns, "g");
      const { type, name, halfW, icon: iconTemplate } = layout.get(c.id)!;
      g.classList.add("map-node", `map-node--${type}`);
      if (this.heldCellIds.has(c.id)) g.classList.add("map-node--held");
      g.dataset.cellId = String(c.id);
      g.setAttribute("transform", `translate(${c.x} ${c.y})`);

      // 矩形宽度由名称长度决定（长名称拉长矩形而非截断文字），仍以格子中心对称
      const r = document.createElementNS(ns, "rect");
      r.setAttribute("x", String(-halfW));
      r.setAttribute("y", String(-RECT_HALF_H));
      r.setAttribute("width", String(halfW * 2));
      r.setAttribute("height", String(RECT_HALF_H * 2));
      r.setAttribute("rx", type === "property" ? "2" : "12");
      r.classList.add("map-node__shape");

      // 文字左对齐（矩形内按阅读起点排布）；矩形已按名称宽度扩展，故不再截断
      const textLeft = -halfW + RECT_TEXT_PAD_X;
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", String(textLeft));
      t.setAttribute("y", "-12");
      t.classList.add("map-node__type");
      t.textContent = type.toUpperCase();

      const n = document.createElementNS(ns, "text");
      n.setAttribute("x", String(textLeft));
      n.setAttribute("y", "24");
      n.classList.add("map-node__name");
      n.textContent = name;

      g.append(r);

      // 8 种格子类型图标：独立 SVG 资源解包为 <g> 后克隆，贴矩形右缘（左侧留给左对齐文字）
      if (iconTemplate) {
        const icon = iconTemplate.cloneNode(true) as SVGElement;
        icon.classList.add("map-node__icon");
        icon.setAttribute("transform", `translate(${halfW - RECT_ICON_INSET} 0)`);
        g.appendChild(icon);
      }

      g.append(t, n);

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
        const slot = playerSlotOffset(i);
        const defaultX = cell.x + slot.x;
        const defaultY = cell.y + slot.y;
        const displayed = this.displayedPlayerPositions.get(player.id);
        const x = displayed?.x ?? defaultX;
        const y = displayed?.y ?? defaultY;
        g.setAttribute("transform", `translate(${x} ${y})`);
        g.dataset.playerId = player.id;
        g.dataset.cellId = String(restId);
        
        /* 角色语义：本玩家 / 队友 / 其他玩家。决定棋子图像源（各自独立 SVG）与颜色令牌，
           颜色规则不再变化（--gp-player-self|teammate|other，棋子 SVG 内 body 取 --gp-player-color） */
        const role: PlayerRole = player.id === selfId
          ? "self"
          : player.teamId !== null && player.teamId === selfTeamId
            ? "teammate"
            : "other";
        g.dataset.playerRole = role;
        const color = getComputedStyle(this.root).getPropertyValue(`--gp-player-${role}`).trim();
        if (color) g.style.setProperty("--gp-player-color", color);

        // 待机跳动包裹层：对外层 g 的 translate 定位无干扰，动画仅作用于内层 transform。
        // 同格多玩家随机错开动画相位，避免整格棋子同频同起同落。
        const bounce = document.createElementNS(ns, "g");
        bounce.classList.add("map-player__bounce");
        if (i > 0) bounce.style.animationDelay = `${-((i % PLAYER_SLOT_OFFSETS.length) * 0.16 + Math.random() * 0.04).toFixed(2)}s`;
        const icon = getPieceTemplate(role);
        if (icon) bounce.appendChild(icon.cloneNode(true));
        g.append(bounce);
        /* 悬停显示玩家名：名字挂在外层 g 上（不随 bounce 上下浮动），默认隐藏、hover 由 CSS 显形；
           不依赖图标即可辨认棋子属于谁 */
        const nameLabel = document.createElementNS(ns, "text");
        nameLabel.classList.add("map-player__name");
        nameLabel.setAttribute("x", "0");
        nameLabel.setAttribute("y", "52");
        nameLabel.textContent = player.username;
        g.appendChild(nameLabel);
        /* 棋子会遮挡其所在格子的命中面，悬停棋子时补发一次该格 hover；
           仅当前格（本玩家所在格）需要悬浮卡，其余格不补发以维持"只显示当前格"的口径 */
        if (restId === this.selfCellId) {
          g.addEventListener("mouseenter", () => this.emitCellHoverAt(restId));
          g.addEventListener("mouseleave", () => this.root.dispatchEvent(new Event("map:leave")));
        }
        pieces.appendChild(g);
      });
    svg.appendChild(pieces);

    this.root.replaceChildren(svg, this.chatLayer);
    this.repositionChatOverlays();
  }

  /** 以当前格节点的真实矩形补发 grid hover（棋子遮挡场景下替代节点的 mouseenter） */
  private emitCellHoverAt(cellId: number): void {
    if (cellId !== this.selfCellId) return;
    const node = this.root.querySelector<SVGGElement>(`.map-node[data-cell-id="${cellId}"]`);
    const b = node?.getBoundingClientRect();
    if (!b || b.width === 0 || b.height === 0) return;
    this.root.dispatchEvent(
      new CustomEvent("map:hover", {
        detail: { cellId, clientX: b.right, clientY: b.top, rect: { left: b.left, right: b.right, top: b.top, width: b.width, height: b.height } }
      })
    );
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
        const slot = playerSlotOffset(index + 1);
        element.setAttribute('transform', `translate(${cell.x + slot.x} ${cell.y + slot.y})`);
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
    // 其他玩家可能仅位置变化而未触发整体重绘，这里同步重定位其发言悬浮框
    this.repositionChatOverlays();
  }

  setPlayerDisplayPosition(playerId: string, x: number, y: number): void {
    this.displayedPlayerPositions.set(playerId, { x, y });
    // 其他玩家带同格错位偏移（与 render/updatePlayers 的默认落点一致），self 精确落格，
    // 使插值轨迹与静止时的错位位置一致，避免动画起始/结束的微小跳动。
    const idx = this.players.findIndex((player) => player?.id === playerId);
    const slot = playerSlotOffset(idx);
    const tx = x + slot.x;
    const ty = y + slot.y;
    const player = Array.from(this.root.querySelectorAll('[data-player-id]'))
      .find((element) => element.getAttribute('data-player-id') === playerId);
    if (player) player.setAttribute('transform', `translate(${tx} ${ty})`);
    this.repositionChatOverlays();
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
    // 先按地图边界夹紧（视图不越出地图），再把跟随目标拉回上下 HUD 栏的渐变覆盖带之内。
    // 单靠边界夹紧时，位于地图上下边缘的玩家会被夹到画面边缘，连同所在格一起没入栏的渐变里。
    let centerY = Math.min(
      this.bounds.maxY - height / 2,
      Math.max(this.bounds.minY + height / 2, y)
    );
    const devY = this.safeVerticalDeviation(width, height);
    centerY = Math.min(y + devY, Math.max(y - devY, centerY));
    svg.setAttribute(
      "viewBox",
      `${centerX - width / 2} ${centerY - height / 2} ${width} ${height}`
    );
    this.repositionChatOverlays();
  }

  /** 展示某玩家的一条发言悬浮框：名称 + 正文两行；同一玩家复用同一框，限时自动渐隐 */
  showPlayerChat(playerId: string, senderName: string, text: string, durationMs = PLAYER_CHAT_BUBBLE_MS): void {
    if (!this.map.length) return;
    let entry = this.chatBubbles.get(playerId);
    if (!entry) {
      const el = document.createElement("div");
      el.className = "map-chat-bubble";
      el.dataset.playerId = playerId;
      this.chatLayer.appendChild(el);
      entry = { el, hideTimer: 0, removeTimer: 0 };
      this.chatBubbles.set(playerId, entry);
    }
    // 若正处于上一轮的渐隐过程，取消失效的移除定时器直接恢复显形
    window.clearTimeout(entry.removeTimer);
    entry.removeTimer = 0;
    // 之前因发言者不在棋盘上被隐藏的话，这里恢复布局后再测量
    entry.el.style.display = "";
    const nameEl = document.createElement("div");
    nameEl.className = "map-chat-bubble__name";
    nameEl.textContent = senderName;
    const textEl = document.createElement("div");
    textEl.className = "map-chat-bubble__text";
    textEl.textContent = text;
    entry.el.replaceChildren(nameEl, textEl);
    // 先测量再定位：尺寸缓存到 dataset，之后每帧重定位只读缓存、不触发强制重排
    entry.el.dataset.w = String(entry.el.offsetWidth);
    entry.el.dataset.h = String(entry.el.offsetHeight);
    this.repositionChatOverlays();
    if (!entry.el.classList.contains("is-visible")) {
      // 读一次布局让初始 opacity:0 生效，过渡才会真正播放；否则直接跳到终态、没有渐显
      void entry.el.offsetWidth;
      entry.el.classList.add("is-visible");
    }
    window.clearTimeout(entry.hideTimer);
    entry.hideTimer = window.setTimeout(() => this.hidePlayerChat(playerId), durationMs);
  }

  private hidePlayerChat(playerId: string): void {
    const entry = this.chatBubbles.get(playerId);
    if (!entry) return;
    window.clearTimeout(entry.hideTimer);
    // 先退掉显形态播放渐隐，过渡结束后再移除节点
    entry.el.classList.remove("is-visible");
    const fadeMs = readCssVarNumber(this.root, "--motion-chat-bubble", 250);
    window.clearTimeout(entry.removeTimer);
    entry.removeTimer = window.setTimeout(() => {
      entry.el.remove();
      this.chatBubbles.delete(playerId);
    }, fadeMs);
  }

  /** 把各悬浮框与输入气泡重新锚定到对应棋子上方；发言者出视野时夹到对应边缘 */
  private repositionChatOverlays(): void {
    if (this.chatBubbles.size === 0 && !this.chatComposerOpen) return;
    const svg = this.root.querySelector<SVGSVGElement>("svg.interactive-map-surface__svg");
    if (!svg) return;
    // 用属性解析 viewBox（jsdom 不实现 SVGAnimatedRect，baseVal 会缺失）
    const viewBoxAttr = svg.getAttribute("viewBox");
    if (!viewBoxAttr) return;
    const [vbX, vbY, vbW, vbH] = viewBoxAttr.trim().split(/[\s,]+/).map(Number);
    if (![vbX, vbY, vbW, vbH].every(Number.isFinite) || vbW <= 0 || vbH <= 0) return;
    const rect = this.root.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // preserveAspectRatio=xMidYMid meet：等比缩放后居中，故需把留边计入坐标换算
    const scale = Math.min(rect.width / vbW, rect.height / vbH);
    const padX = (rect.width - vbW * scale) / 2;
    const padY = (rect.height - vbH * scale) / 2;
    const topInset = readCssVarNumber(this.root, "--gp-topbar-h", 0);
    const bottomInset = readCssVarNumber(this.root, "--gp-actionbar-h", 0);
    const margin = 8;
    const selfId = this.players[0]?.id;
    // 本玩家自己的发言气泡顶边：输入气泡出现时叠在它上方，避免两者重叠
    let selfBubbleTop: number | null = null;
    this.chatBubbles.forEach((entry, playerId) => {
      const world = this.playerWorldPosition(playerId);
      if (!world) {
        entry.el.style.display = "none";
        return;
      }
      entry.el.style.display = "";
      const anchorX = padX + (world.x - vbX) * scale;
      const anchorY = padY + (world.y - vbY) * scale;
      const w = Number(entry.el.dataset.w) || entry.el.offsetWidth;
      const h = Number(entry.el.dataset.h) || entry.el.offsetHeight;
      // 锚点取棋子原点：图形上缘在该点上方约 16px，待机跳动再上浮约 9px，
      // 故气泡底边留 26px 才能稳定地贴在整个棋子之上（留白不足会压住头部，看着像"位置偏了"）
      const left = anchorX - w / 2;
      const top = anchorY - PIECE_TOP_CLEARANCE - h;
      const clampedLeft = Math.max(margin, Math.min(left, rect.width - w - margin));
      const clampedTop = Math.max(topInset + margin, Math.min(top, rect.height - bottomInset - margin - h));
      // 发生夹紧即说明发言者不在视野内，标记出来供样式区分
      entry.el.classList.toggle("map-chat-bubble--edge", clampedLeft !== left || clampedTop !== top);
      entry.el.style.left = `${clampedLeft}px`;
      entry.el.style.top = `${clampedTop}px`;
      if (playerId === selfId) selfBubbleTop = clampedTop;
    });

    if (!this.chatComposerOpen) return;
    const selfWorld = selfId ? this.playerWorldPosition(selfId) : null;
    if (!selfWorld) {
      this.chatComposer.style.display = "none";
      return;
    }
    this.chatComposer.style.display = "";
    const anchorX = padX + (selfWorld.x - vbX) * scale;
    const anchorY = padY + (selfWorld.y - vbY) * scale;
    const w = Number(this.chatComposer.dataset.w) || this.chatComposer.offsetWidth;
    const h = Number(this.chatComposer.dataset.h) || this.chatComposer.offsetHeight;
    const left = anchorX - w / 2;
    let top = anchorY - PIECE_TOP_CLEARANCE - h;
    if (selfBubbleTop !== null) top = Math.min(top, selfBubbleTop - h - 4);
    const clampedLeft = Math.max(margin, Math.min(left, rect.width - w - margin));
    const clampedTop = Math.max(topInset + margin, Math.min(top, rect.height - bottomInset - margin - h));
    this.chatComposer.style.left = `${clampedLeft}px`;
    this.chatComposer.style.top = `${clampedTop}px`;
  }

  /** 发言者棋子的世界坐标：优先取移动中的插值位置，回退到其所在格的错位落点 */
  private playerWorldPosition(playerId: string): { x: number; y: number } | null {
    const index = this.players.findIndex((player) => player?.id === playerId);
    if (index < 0) return null;
    const displayed = this.displayedPlayerPositions.get(playerId);
    if (displayed) return displayed;
    const player = this.players[index];
    const cellId = index === 0 ? (this.selfCellId ?? player.position.cellId) : player.position.cellId;
    const cell = this.map.find((item) => item.id === cellId);
    if (!cell) return null;
    const slot = playerSlotOffset(index);
    return { x: cell.x + slot.x, y: cell.y + slot.y };
  }

  /**
   * 跟随目标允许偏离画面中心的纵向距离（viewBox 单位）。
   *
   * 顶栏/底栏是压在地图上的渐变带（高度取 CSS 令牌 --gp-topbar-h / --gp-actionbar-h），
   * 目标贴到画面边缘时其所在格会落进渐变里，故把可用区域收掉两条栏的高度、
   * 再扣除格子自身半高。容器未布局（jsdom / 隐藏）时无法换算像素，退回半屏，等同旧行为。
   */
  private safeVerticalDeviation(width: number, height: number): number {
    const rect = this.root.getBoundingClientRect();
    const scale = rect.width > 0 && rect.height > 0
      ? Math.min(rect.width / width, rect.height / height)
      : 0;
    if (!(scale > 0)) return height / 2;
    const topInset = readCssVarNumber(this.root, "--gp-topbar-h", 0);
    const bottomInset = readCssVarNumber(this.root, "--gp-actionbar-h", 0);
    const usableHalf = Math.min(rect.height / 2 - topInset, rect.height / 2 - bottomInset);
    return Math.max(0, usableHalf / scale - RECT_HALF_H);
  }
}
