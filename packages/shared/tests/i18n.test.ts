/**
 * i18n 模块测试
 */

import { t, setLocale, getLocale, getSupportedLocales, getCurrentLocaleData } from '../src/i18n/index';

describe('i18n', () => {
  beforeEach(() => {
    // 重置为中文
    setLocale('zh-CN');
  });

  describe('setLocale and getLocale', () => {
    it('should set locale correctly', () => {
      setLocale('en-US');
      expect(getLocale()).toBe('en-US');

      setLocale('zh-CN');
      expect(getLocale()).toBe('zh-CN');
    });

    it('should ignore invalid locale', () => {
      setLocale('invalid-locale');
      expect(getLocale()).toBe('zh-CN'); // should remain unchanged
    });
  });

  describe('t function', () => {
    it('should translate key correctly', () => {
      expect(t('common.loading')).toBe('加载中...');
      expect(t('game.title')).toBe('rentfree.io');
    });

    it('should translate key with params', () => {
      setLocale('zh-CN');
      expect(t('dice.moveSteps', { count: 5 })).toBe('移动 5 步');
      expect(t('property.rentPaid', { amount: 100 })).toBe('支付租金 100 元');
    });

    it('should return key for non-existent translation', () => {
      expect(t('non.existent.key')).toBe('non.existent.key');
    });

    it('should translate nested keys', () => {
      expect(t('property.levelFormat', { level: 2 })).toBe('等级 2/4');
      expect(t('transport.costValue', { cost: 100 })).toBe('100 元');
    });

    it('should work with English locale', () => {
      setLocale('en-US');
      expect(t('common.loading')).toBe('Loading...');
      expect(t('game.title')).toBe('rentfree.io');
    });
  });

  describe('getSupportedLocales', () => {
    it('should return all supported locales', () => {
      const locales = getSupportedLocales();

      expect(locales).toContain('zh-CN');
      expect(locales).toContain('en-US');
      expect(locales.length).toBe(2);
    });
  });

  describe('getCurrentLocaleData', () => {
    it('should return current locale data', () => {
      setLocale('zh-CN');
      const data = getCurrentLocaleData();

      expect(data).toBeDefined();
      expect((data as any).common.loading).toBe('加载中...');
    });
  });
});
