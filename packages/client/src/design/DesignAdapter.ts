export type TokenTree = Record<string, unknown>;
export type DayPhase = 'day' | 'dusk' | 'night';

export interface ThemeSnapshot {
  canvas: {
    board: { background: string };
    cell: Record<'property' | 'event' | 'transport', { fill: string }> & { text: string };
    connection: string;
    accent: string;
    muted: string;
    fg: string;
  };
  dom: Record<string, string>;
  piece: { outlineWidth: number };
  line: { currentWidth: number };
}

/** 令牌读取源描述：种类决定如何从令牌树取值并格式化 */
type DomTokenSource =
  | { kind: 'color'; path: string }
  | { kind: 'string'; path: string }
  | { kind: 'px'; path: string }
  | { kind: 'ms'; path: string };

/** DOM 令牌映射：令牌路径 → CSS 变量名。单一数据源，由 createSnapshot 统一消费。 */
const DOM_TOKEN_MAP: ReadonlyArray<readonly [cssVar: string, source: DomTokenSource]> = [
  ['--tycoon-board-background', { kind: 'color', path: 'color.surface.board' }],
  ['--tycoon-cell-property-fill', { kind: 'color', path: 'color.cell.property.fill' }],
  ['--tycoon-cell-event-fill', { kind: 'color', path: 'color.cell.event.fill' }],
  ['--tycoon-cell-transport-fill', { kind: 'color', path: 'color.cell.transport.fill' }],
  ['--tycoon-piece-head', { kind: 'color', path: 'color.piece.head' }],
  ['--tycoon-piece-outline', { kind: 'color', path: 'color.piece.outline' }],
  ['--gp-player-self', { kind: 'color', path: 'color.player.self' }],
  ['--gp-player-teammate', { kind: 'color', path: 'color.player.teammate' }],
  ['--gp-player-other', { kind: 'color', path: 'color.player.other' }],
  ['--tycoon-accent', { kind: 'color', path: 'color.palette.accent' }],
  ['--tycoon-muted', { kind: 'color', path: 'color.hud.muted' }],
  // HUD 覆盖层令牌：由主题 JSON 的 color.hud 区段注入，组件只消费 CSS 变量
  ['--gp-bar-bg', { kind: 'color', path: 'color.hud.barBg' }],
  ['--gp-sidebar-bg', { kind: 'color', path: 'color.hud.sidebarBg' }],
  ['--gp-map-bg', { kind: 'color', path: 'color.hud.mapBg' }],
  ['--gp-card', { kind: 'color', path: 'color.hud.card' }],
  ['--gp-fg', { kind: 'color', path: 'color.hud.fg' }],
  ['--gp-border', { kind: 'color', path: 'color.hud.cellBorder' }],
  ['--gp-muted', { kind: 'color', path: 'color.hud.muted' }],
  ['--gp-accent', { kind: 'color', path: 'color.palette.accent' }],
  ['--gp-cell-bg', { kind: 'color', path: 'color.hud.cellBg' }],
  // 字体（功能/数字 + 通用正文/标题）
  ['--font-body', { kind: 'color', path: 'font.body' }],
  ['--font-title', { kind: 'color', path: 'font.title' }],
  ['--font-func', { kind: 'color', path: 'font.func' }],
  ['--font-num', { kind: 'color', path: 'font.number' }],
  // 棋子几何
  ['--piece-outline-width', { kind: 'px', path: 'dimension.piece.outline' }],
  // 地域语法（棋盘与 SVG 地图语义令牌）
  ['--region-board-bg', { kind: 'color', path: 'color.region.board' }],
  ['--region-fg', { kind: 'color', path: 'color.region.fg' }],
  ['--region-border', { kind: 'color', path: 'color.region.border' }],
  ['--region-border-w', { kind: 'px', path: 'color.region.borderWidth' }],
  ['--region-radius', { kind: 'px', path: 'color.region.radius' }],
  ['--region-chip-radius', { kind: 'px', path: 'color.region.chipRadius' }],
  ['--region-accent', { kind: 'color', path: 'color.region.accent' }],
  ['--region-accent-hover', { kind: 'color', path: 'color.region.accentHover' }],
  ['--region-label-fg', { kind: 'color', path: 'color.region.labelFg' }],
  ['--region-motion-fg', { kind: 'color', path: 'color.region.motionFg' }],
  ['--region-rule', { kind: 'color', path: 'color.region.ruleColor' }],
  ['--region-cell-bg', { kind: 'color', path: 'color.region.cellBg' }],
  ['--region-cell-border', { kind: 'color', path: 'color.region.cellBorder' }],
  ['--region-box-bg', { kind: 'color', path: 'color.region.boxBg' }],
  ['--region-tab-bg', { kind: 'color', path: 'color.region.tabBg' }],
  ['--region-frag-bg', { kind: 'color', path: 'color.region.fragBg' }],
  ['--region-btn-fg', { kind: 'color', path: 'color.region.btnFg' }],
  ['--region-focus', { kind: 'color', path: 'color.region.focus' }],
  ['--region-focus-w', { kind: 'px', path: 'color.region.focusWidth' }],
  ['--region-cycle-day', { kind: 'color', path: 'color.region.cycleDay' }],
  ['--region-cycle-night', { kind: 'color', path: 'color.region.cycleNight' }],
  ['--region-error', { kind: 'color', path: 'color.region.error' }],
  ['--region-texture', { kind: 'color', path: 'texture.region.background' }],
  // 登录/加载/欢迎：语义令牌映射到同一套地域变量（standalone 时由 :root 兜底）
  ['--auth-bg', { kind: 'color', path: 'color.region.board' }],
  ['--auth-fg', { kind: 'color', path: 'color.region.fg' }],
  ['--auth-card', { kind: 'color', path: 'color.region.boxBg' }],
  ['--auth-surface', { kind: 'color', path: 'color.region.cellBg' }],
  ['--auth-muted', { kind: 'color', path: 'color.region.labelFg' }],
  ['--auth-accent', { kind: 'color', path: 'color.region.accent' }],
  ['--auth-accent-hover', { kind: 'color', path: 'color.region.accentHover' }],
  ['--auth-border', { kind: 'color', path: 'color.region.border' }],
  ['--auth-border-soft', { kind: 'color', path: 'color.region.cellBorder' }],
  ['--auth-error', { kind: 'color', path: 'color.region.error' }],
  ['--auth-track', { kind: 'color', path: 'color.region.board' }],
  ['--auth-paper', { kind: 'color', path: 'color.region.btnFg' }],
  ['--auth-radius', { kind: 'px', path: 'color.region.radius' }],
  // HUD 额外令牌
  ['--gp-paper', { kind: 'color', path: 'color.region.btnFg' }],
  ['--gp-cycle-day', { kind: 'color', path: 'color.region.cycleDay' }],
  ['--gp-cycle-night', { kind: 'color', path: 'color.region.cycleNight' }],
  // 动效时序令牌：串型时长直接作为 CSS 动画时长；数值型转换为毫秒供 JS 动画读取
  ['--motion-fast', { kind: 'string', path: 'motion.fast' }],
  ['--motion-normal', { kind: 'string', path: 'motion.normal' }],
  ['--motion-step', { kind: 'ms', path: 'motion.step' }],
  ['--motion-step-arrive', { kind: 'ms', path: 'motion.stepArrive' }],
  ['--motion-move-complete', { kind: 'ms', path: 'motion.moveComplete' }],
  ['--motion-dice-settled', { kind: 'ms', path: 'motion.diceSettled' }],
  ['--motion-property-bought', { kind: 'ms', path: 'motion.propertyBought' }],
  ['--motion-bankrupt', { kind: 'ms', path: 'motion.bankrupt' }],
  ['--motion-slideup-title', { kind: 'string', path: 'motion.slideUpTitle' }],
  ['--motion-slideup', { kind: 'string', path: 'motion.slideUp' }],
  ['--motion-spin', { kind: 'string', path: 'motion.spin' }],
];

/**
 * 从根元素读取带 `--` 前缀的 CSS 数值变量并解析为毫秒，供 JS 动画时序使用。
 * 解析失败或数值非正时回退 fallback，避免动画时序因缺失变量而失效。
 */
export function readCssVarNumber(root: HTMLElement, property: string, fallback: number): number {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return fallback;
  const raw = window.getComputedStyle(root).getPropertyValue(property);
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isToken(value: unknown): value is { $value: unknown } {
  return typeof value === 'object' && value !== null && '$value' in value;
}

function mergeTrees(base: TokenTree, override: TokenTree): TokenTree {
  const result: TokenTree = { ...base };
  Object.entries(override).forEach(([key, value]) => {
    const current = result[key];
    result[key] =
      typeof current === 'object' && current !== null && !isToken(current) &&
      typeof value === 'object' && value !== null && !isToken(value)
        ? mergeTrees(current as TokenTree, value as TokenTree)
        : value;
  });
  return result;
}

/** 令牌读取、引用解析和 Canvas/DOM 投影；不存放主题样式值或游戏逻辑。 */
export class DesignAdapter {
  constructor(private readonly baseTokens: TokenTree) {}

  getColor(path: string, tokens: TokenTree = this.baseTokens): string {
    const token = path.split('.').reduce<unknown>((node, key) => {
      return typeof node === 'object' && node !== null ? (node as TokenTree)[key] : undefined;
    }, tokens);
    if (!isToken(token) || typeof token.$value !== 'string') {
      throw new Error(`Unknown color token: ${path}`);
    }
    return this.resolveValue(token.$value, tokens);
  }

  getString(path: string, tokens: TokenTree = this.baseTokens): string {
    const token = path.split('.').reduce<unknown>((node, key) => {
      return typeof node === 'object' && node !== null ? (node as TokenTree)[key] : undefined;
    }, tokens);
    if (!isToken(token) || typeof token.$value !== 'string') {
      throw new Error(`Unknown string token: ${path}`);
    }
    return token.$value;
  }

  /** 数值令牌基础读取，供 number 投影与 DOM 映射共用 */
  private readNumber(path: string, tokens: TokenTree): number {
    const token = path.split('.').reduce<unknown>((node, key) => {
      return typeof node === 'object' && node !== null ? (node as TokenTree)[key] : undefined;
    }, tokens);
    if (!isToken(token) || typeof token.$value !== 'number') throw new Error(`Unknown number token: ${path}`);
    return token.$value;
  }

  /** 依据 DOM 令牌映射与阶段合并后的令牌树，将各条目渲染为 CSS 变量值 */
  private readDomToken([cssVar, source]: readonly [string, DomTokenSource], tokens: TokenTree): [string, string] {
    switch (source.kind) {
      case 'color': return [cssVar, this.getColor(source.path, tokens)];
      case 'string': return [cssVar, this.getString(source.path, tokens)];
      case 'px': return [cssVar, `${this.readNumber(source.path, tokens)}px`];
      case 'ms': return [cssVar, `${this.readNumber(source.path, tokens)}ms`];
    }
  }

  createSnapshot(phase: DayPhase = 'day'): ThemeSnapshot {
    const tokens = phase === 'day'
      ? this.baseTokens
      : mergeTrees(this.baseTokens, ((this.baseTokens.modes as TokenTree | undefined)?.[phase] as TokenTree | undefined) ?? {});

    const property = this.getColor('color.cell.property.fill', tokens);
    const event = this.getColor('color.cell.event.fill', tokens);
    const transport = this.getColor('color.cell.transport.fill', tokens);
    const board = this.getColor('color.surface.board', tokens);
    const ink = this.getColor('color.piece.outline', tokens);
    const connection = this.getColor('color.line.map', tokens);
    const accent = this.getColor('color.palette.accent', tokens);
    const muted = this.getColor('color.hud.muted', tokens);

    const dom: Record<string, string> = {};
    for (const entry of DOM_TOKEN_MAP) {
      const [cssVar, value] = this.readDomToken(entry, tokens);
      dom[cssVar] = value;
    }

    return {
      canvas: {
        board: { background: board },
        cell: { property: { fill: property }, event: { fill: event }, transport: { fill: transport }, text: ink },
        connection,
        accent,
        muted,
        fg: this.getColor('color.hud.fg', tokens),
      },
      dom,
      piece: { outlineWidth: this.readNumber('dimension.piece.outline', tokens) },
      line: { currentWidth: this.readNumber('dimension.line.current', tokens) },
    };
  }

  private resolveValue(value: string, tokens: TokenTree): string {
    const match = /^\{(.+)}$/.exec(value);
    return match ? this.getColor(match[1], tokens) : value;
  }
}