import { GameStore } from '../src/state/GameStore.js';

describe('region value authority', () => {
  it('stores every region field by its UCT field id without a prosperity projection', () => {
    const store = new GameStore();

    store.setRegionValue('r1', 'pros', 72);
    store.setRegionValue('r1', 'environment', 18);

    const snapshot = store.getSnapshot() as Record<string, unknown>;
    expect(snapshot).not.toHaveProperty('prosperity');
    expect(snapshot).not.toHaveProperty('regionProsperityMap');
    expect(store.getSnapshot().regionValues.get('r1')).toEqual({ pros: 72, environment: 18 });
  });

  it('does not overwrite an existing authoritative region value with the static initial when setRegions runs later (async race)', () => {
    const store = new GameStore();
    // 登录权威 server.gameState 先落地区域值（服务端累计值，如 86）
    store.setRegionValue('r1', 'pros', 86);
    // 随后异步 loadMapData 完成，setRegions 用配置初值 85 落地——不得把权威值覆盖回初值
    store.setRegions(
      [{ id: 'r1', name: { 'zh-CN': '东北', 'en-US': 'NE' }, initialValues: { pros: 85 }, cellIds: [0] }],
      [{ id: 'pros', name: { 'zh-CN': '繁荣', 'en-US': 'Pros' }, scope: 'region' }],
    );
    expect(store.getSnapshot().regionValues.get('r1')?.pros).toBe(86);
  });

  it('seeds the static initial value for a region absent from the authoritative snapshot', () => {
    const store = new GameStore();
    // 另一区域已有权威值，但 r2 未在快照中 → setRegions 回填其初值
    store.setRegionValue('r1', 'pros', 86);
    store.setRegions(
      [
        { id: 'r1', name: { 'zh-CN': '东北', 'en-US': 'NE' }, initialValues: { pros: 85 }, cellIds: [0] },
        { id: 'r2', name: { 'zh-CN': '南', 'en-US': 'S' }, initialValues: { pros: 80 }, cellIds: [1] },
      ],
      [{ id: 'pros', name: { 'zh-CN': '繁荣', 'en-US': 'Pros' }, scope: 'region' }],
    );
    expect(store.getSnapshot().regionValues.get('r1')?.pros).toBe(86);
    expect(store.getSnapshot().regionValues.get('r2')?.pros).toBe(80);
  });
});