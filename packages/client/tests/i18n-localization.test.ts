import { localizedText } from '../src/game/i18n.js';

describe('localizedText 多语言字段解析', () => {
  it('普通字符串原样返回', () => {
    expect(localizedText('北方')).toBe('北方');
  });

  it('多语言对象按当前语言取文本', () => {
    expect(localizedText({ 'zh-CN': '东方', 'en-US': 'East' })).toBe('东方');
  });

  it('数组项 join 结果不含 [object Object]', () => {
    const options = [
      { cellId: 1, label: { 'zh-CN': '北方', 'en-US': 'North' } },
      { cellId: 2, label: { 'zh-CN': '南方', 'en-US': 'South' } },
    ];
    const joined = options.map(o => localizedText(o.label, `格子 ${o.cellId}`)).join(' / ');
    expect(joined).not.toContain('[object Object]');
    expect(joined).toBe('北方 / 南方');
  });

  it('空对象回退到 fallback', () => {
    expect(localizedText({}, '回退')).toBe('回退');
    expect(localizedText(undefined, '回退')).toBe('回退');
  });
});