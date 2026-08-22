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

  createSnapshot(phase: DayPhase = 'day'): ThemeSnapshot {
    const tokens = phase === 'day'
      ? this.baseTokens
      : mergeTrees(this.baseTokens, ((this.baseTokens.modes as TokenTree | undefined)?.[phase] as TokenTree | undefined) ?? {});
    const color = (path: string) => this.getColor(path, tokens);
    const number = (path: string): number => {
      const token = path.split('.').reduce<unknown>((node, key) => {
        return typeof node === 'object' && node !== null ? (node as TokenTree)[key] : undefined;
      }, tokens);
      if (!isToken(token) || typeof token.$value !== 'number') throw new Error(`Unknown number token: ${path}`);
      return token.$value;
    };

    const property = color('color.cell.property.fill');
    const event = color('color.cell.event.fill');
    const transport = color('color.cell.transport.fill');
    const board = color('color.surface.board');
    const ink = color('color.piece.outline');
    const connection = color('color.line.map');
    const accent = color('color.palette.accent');
    const muted = color('color.hud.muted');
    const px = (path: string): string => `${number(path)}px`;

    return {
      canvas: {
        board: { background: board },
        cell: { property: { fill: property }, event: { fill: event }, transport: { fill: transport }, text: ink },
        connection,
        accent,
        muted,
        fg: color("color.hud.fg"),
      },
      dom: {
        '--tycoon-board-background': board,
        '--tycoon-cell-property-fill': property,
        '--tycoon-cell-event-fill': event,
        '--tycoon-cell-transport-fill': transport,
        '--tycoon-cell-border': color('color.hud.cellBorder'),
        '--tycoon-piece-head': color('color.piece.head'),
        '--tycoon-piece-body': color('color.piece.body'),
        '--tycoon-piece-outline': color('color.piece.outline'),
        '--tycoon-line-map': color('color.line.map'),
        '--tycoon-line-current': color('color.line.current'),
        '--tycoon-line-key': color('color.line.key'),
        '--tycoon-accent': accent,
        '--tycoon-muted': muted,
        // HUD 覆盖层令牌：由主题 JSON 的 color.hud 区段注入，组件只消费 CSS 变量
        '--gp-bar-bg': color('color.hud.barBg'),
        '--gp-sidebar-bg': color('color.hud.sidebarBg'),
        '--gp-map-bg': color('color.hud.mapBg'),
        '--gp-card': color('color.hud.card'),
        '--gp-fg': color('color.hud.fg'),
        '--gp-border': color('color.hud.cellBorder'),
        '--gp-muted': color('color.hud.muted'),
        '--gp-accent': accent,
        '--gp-cell-bg': color('color.hud.cellBg'),
        '--gp-cell-border': color('color.hud.cellBorder'),
        '--gp-link': color('color.hud.link'),
        // 主题标识 + 玩家色
        '--theme-id': color('theme.id'),
        '--player-red': color('color.player.red'),
        '--player-blue': color('color.player.blue'),
        '--player-green': color('color.player.green'),
        // 字体（地域标题/功能/数字 + 通用正文/标题）
        '--font-heading': color('font.heading'),
        '--font-body': color('font.body'),
        '--font-title': color('font.title'),
        '--font-func': color('font.func'),
        '--font-num': color('font.number'),
        // 棋子几何
        '--piece-width': px('dimension.piece.width'),
        '--piece-head-diameter': px('dimension.piece.headDiameter'),
        '--piece-torso-top': px('dimension.piece.torsoTop'),
        '--piece-torso-bottom': px('dimension.piece.torsoBottom'),
        '--piece-torso-height': px('dimension.piece.torsoHeight'),
        '--piece-outline-width': px('dimension.piece.outline'),
        // 1900 地域语法（棋盘与 SVG 地图语义令牌）
        '--region-board-bg': color('color.region.board'),
        '--region-fg': color('color.region.fg'),
        '--region-border': color('color.region.border'),
        '--region-border-w': px('color.region.borderWidth'),
        '--region-radius': px('color.region.radius'),
        '--region-chip-radius': px('color.region.chipRadius'),
        '--region-accent': color('color.region.accent'),
        '--region-accent-hover': color('color.region.accentHover'),
        '--region-label-fg': color('color.region.labelFg'),
        '--region-motion-fg': color('color.region.motionFg'),
        '--region-rule': color('color.region.ruleColor'),
        '--region-cell-bg': color('color.region.cellBg'),
        '--region-cell-border': color('color.region.cellBorder'),
        '--region-box-bg': color('color.region.boxBg'),
        '--region-tab-bg': color('color.region.tabBg'),
        '--region-frag-bg': color('color.region.fragBg'),
        '--region-btn-fg': color('color.region.btnFg'),
        '--region-focus': color('color.region.focus'),
        '--region-focus-w': px('color.region.focusWidth'),
        '--region-cycle-day': color('color.region.cycleDay'),
        '--region-cycle-night': color('color.region.cycleNight'),
        '--region-error': color('color.region.error'),
        '--region-texture': color('texture.region.background'),
        // 登录/加载/欢迎：语义令牌映射到同一套地域变量（standalone 时由 :root 兜底）
        '--auth-bg': color('color.region.board'),
        '--auth-fg': color('color.region.fg'),
        '--auth-card': color('color.region.boxBg'),
        '--auth-surface': color('color.region.cellBg'),
        '--auth-muted': color('color.region.labelFg'),
        '--auth-accent': color('color.region.accent'),
        '--auth-accent-hover': color('color.region.accentHover'),
        '--auth-border': color('color.region.border'),
        '--auth-border-soft': color('color.region.cellBorder'),
        '--auth-error': color('color.region.error'),
        '--auth-track': color('color.region.board'),
        '--auth-paper': color('color.region.btnFg'),
        '--auth-radius': px('color.region.radius'),
        // HUD 额外令牌
        '--gp-paper': color('color.region.btnFg'),
        '--gp-cycle-day': color('color.region.cycleDay'),
        '--gp-cycle-night': color('color.region.cycleNight'),
      },
      piece: { outlineWidth: number('dimension.piece.outline') },
      line: { currentWidth: number('dimension.line.current') },
    };
  }

  private resolveValue(value: string, tokens: TokenTree): string {
    const match = /^\{(.+)}$/.exec(value);
    return match ? this.getColor(match[1], tokens) : value;
  }
}
