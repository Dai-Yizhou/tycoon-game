import { InteractiveMapSurface } from '../src/components/InteractiveMapSurface.js';

describe('InteractiveMapSurface 格子渲染', () => {
  it('多语言名称渲染为字符串而非 [object Object]', () => {
    const surface = new InteractiveMapSurface();
    const root = surface.getElement();
    surface.render([
      { id: 1, x: 10, y: 20, destinations: [], extra: { type: 'property', name: { 'zh-CN': '地产', 'en-US': 'Property' } } },
    ]);
    const nameEl = root.querySelector('text.map-node__name');
    expect(nameEl).not.toBeNull();
    expect(nameEl!.textContent).not.toBe('[object Object]');
    expect(nameEl!.textContent!.trim().length).toBeGreaterThan(0);
  });

  it('纯字符串名称原样渲染', () => {
    const surface = new InteractiveMapSurface();
    const root = surface.getElement();
    surface.render([
      { id: 1, x: 10, y: 20, destinations: [], extra: { type: 'property', name: '起点' } },
    ]);
    expect(root.querySelector('text.map-node__name')!.textContent).toBe('起点');
  });
});