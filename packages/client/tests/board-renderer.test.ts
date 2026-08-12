import { BoardRenderer } from '../src/board/board-renderer';
import type { ThemeSnapshot } from '../src/design/DesignAdapter';

/**
 * Mock Canvas 2D context for jsdom
 */
function createMockContext(): CanvasRenderingContext2D {
  const noop = jest.fn();
  const mockGradient = { addColorStop: noop } as unknown as CanvasGradient;
  return {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    fillText: noop,
    strokeText: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    setLineDash: noop,
    setTransform: noop,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    createLinearGradient: jest.fn(() => mockGradient),
    createRadialGradient: jest.fn(() => mockGradient),
  } as unknown as CanvasRenderingContext2D;
}

describe('BoardRenderer', () => {
  let canvas: HTMLCanvasElement;
  let getContextSpy: jest.SpyInstance;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    document.body.appendChild(canvas);
    getContextSpy = jest
      .spyOn(canvas, 'getContext')
      .mockImplementation(() => createMockContext());
  });

  afterEach(() => {
    getContextSpy.mockRestore();
    document.body.removeChild(canvas);
  });

  it('creates renderer with viewport', () => {
    const renderer = new BoardRenderer(canvas);
    const viewport = renderer.getViewport();
    expect(viewport.width).toBe(800);
    expect(viewport.height).toBe(600);
    expect(viewport.zoom).toBe(0.8);
  });

  it('throws on invalid context', () => {
    getContextSpy.mockImplementation(() => null);
    expect(() => new BoardRenderer(canvas)).toThrow('Failed to acquire 2D context');
  });

  it('clear does not throw', () => {
    const renderer = new BoardRenderer(canvas);
    expect(() => renderer.clear()).not.toThrow();
  });

  it('drawPlaceholder does not throw', () => {
    const renderer = new BoardRenderer(canvas);
    expect(() => renderer.drawPlaceholder('test')).not.toThrow();
  });

  it('renders board, cell, and connection colors from the theme snapshot', () => {
    const context = createMockContext();
    getContextSpy.mockImplementation(() => context);
    const theme: ThemeSnapshot = {
      canvas: { board: { background: '#101820' }, cell: { property: { fill: '#aa0001' }, event: { fill: '#aa0002' }, transport: { fill: '#aa0003' } } },
      dom: { '--tycoon-line-map': '#556677' }, piece: { outlineWidth: 3 }, line: { currentWidth: 3 },
    };
    const renderer = new BoardRenderer(canvas, { theme });
    renderer.loadMap([
      { id: 0, x: 100, y: 100, destinations: [1], extra: { type: 'property' } },
      { id: 1, x: 200, y: 100, destinations: [2], extra: { type: 'event' } },
      { id: 2, x: 300, y: 100, destinations: [], extra: { type: 'transport' } },
    ]);
    renderer.render();
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, canvas.width, canvas.height);
    expect(context.fillStyle).toBe('#aa0003');
  });
});
