/**
 * Jest 全局 Canvas 2D mock
 *
 * jsdom 不实现 CanvasRenderingContext2D，这里在测试环境启动时
 * 为 HTMLCanvasElement.prototype.getContext 提供一套完整的 2D 上下文 mock，
 * 让 DiceAnimation / BoardRenderer 等组件在测试中可正常渲染而不抛错。
 */

const noop = (): undefined => undefined;

function createMockContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: noop } as unknown as CanvasGradient;
  const ctx: Record<string, unknown> = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    shadowBlur: 0,
    shadowColor: 'rgba(0,0,0,0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save: noop,
    restore: noop,
    setTransform: noop,
    transform: noop,
    resetTransform: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    bezierCurveTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    arcTo: noop,
    ellipse: noop,
    rect: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    drawImage: noop,
    fillText: noop,
    strokeText: noop,
    putImageData: noop,
    setLineDash: noop,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    createImageData: () => ({ data: [], width: 0, height: 0 }),
    getImageData: () => ({ data: [], width: 0, height: 0 }),
    getLineDash: () => [],
    measureText: (text: string) => ({
      width: String(text).length * 8,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: String(text).length * 8,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 0,
    }),
    isPointInPath: () => false,
    isPointInStroke: () => false,
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function getContext(
    this: HTMLCanvasElement,
  ): CanvasRenderingContext2D | null {
    const ctx = createMockContext();
    Object.defineProperty(ctx, 'canvas', { value: this });
    return ctx;
  } as typeof HTMLCanvasElement.prototype.getContext;
}
