export type TokenTree = Record<string, unknown>;
export type DayPhase = 'day' | 'dusk' | 'night';

export interface ThemeSnapshot {
  canvas: {
    board: { background: string };
    cell: Record<'property' | 'event' | 'transport', { fill: string }>;
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

    return {
      canvas: { board: { background: board }, cell: { property: { fill: property }, event: { fill: event }, transport: { fill: transport } } },
      dom: {
        '--tycoon-board-background': board,
        '--tycoon-cell-property-fill': property,
        '--tycoon-cell-event-fill': event,
        '--tycoon-cell-transport-fill': transport,
        '--tycoon-piece-head': color('color.piece.head'),
        '--tycoon-piece-body': color('color.piece.body'),
        '--tycoon-piece-outline': color('color.piece.outline'),
        '--tycoon-line-map': color('color.line.map'),
        '--tycoon-line-current': color('color.line.current'),
        '--tycoon-line-key': color('color.line.key'),
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
