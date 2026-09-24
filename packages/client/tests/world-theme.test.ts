import { DesignAdapter } from '../src/design/DesignAdapter';
import midwestTheme from '../../shared/design-tokens/themes/midwest.json';
import northeastTheme from '../../shared/design-tokens/themes/northeast.json';
import southTheme from '../../shared/design-tokens/themes/south.json';
import westTheme from '../../shared/design-tokens/themes/west.json';

describe('世界主题基础设施', () => {
  it('从单一主题令牌文件读取默认昼间表面', () => {
    const adapter = new DesignAdapter(northeastTheme);

    expect(adapter.getColor('color.surface.board')).toBe('#A8ACB0');
  });

  it('导出同一份 Canvas 与 DOM 主题快照', () => {
    const adapter = new DesignAdapter(northeastTheme);
    const snapshot = adapter.createSnapshot();

    expect(snapshot.canvas.accent).toBe(snapshot.dom['--gp-accent']);
    expect(snapshot.canvas.fg).toBe(snapshot.dom['--gp-fg']);
    expect(snapshot.piece.outlineWidth).toBe(3);
    expect(snapshot.line.currentWidth).toBe(3);
  });

  it.each([
    [northeastTheme, '#A8ACB0'],
    [southTheme, '#D0C7B0'],
    [midwestTheme, '#C4AB86'],
    [westTheme, '#C4C8C6'],
  ])('可从单个地域令牌文件加载主题', (tokens, surface) => {
    expect(new DesignAdapter(tokens).createSnapshot().canvas.board.background).toBe(surface);
  });
});
