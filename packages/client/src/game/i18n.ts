/**
 * 客户端 i18n 包装模块
 *
 * 从 @game/shared 导出 i18n 功能，并提供语言切换的本地持久化。
 */

import { t as sharedT, setLocale, getLocale, getSupportedLocales, type LocaleCode } from '@game/shared';

export type { LocaleCode };

const STORAGE_KEY = 'game-language';

/**
 * 获取国际化文本
 */
export function t(key: string, params?: Record<string, string | number>): string {
  return sharedT(key, params);
}

/**
 * 切换语言并持久化到 localStorage
 */
export function changeLanguage(locale: LocaleCode): void {
  setLocale(locale);
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // localStorage 可能不可用（隐私模式等），静默忽略
  }
}

/**
 * 获取当前语言
 */
export function getLanguage(): LocaleCode {
  return getLocale();
}

/**
 * 解析多语言字段为当前语言的文本
 * - 传入普通字符串则原样返回
 * - 传入多语言对象（服务端返回的 name/label/description 等）则按
 *   「当前语言 → zh-CN → en-US → 任意非空键」顺序回退取文本
 * - 均未命中时返回 fallback
 */
export function localizedText(value: unknown, fallback: string = ''): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const translations = value as Record<string, unknown>;
    const locales = [getLanguage(), 'zh-CN', 'en-US', ...Object.keys(translations)];
    for (const locale of locales) {
      const v = translations[locale];
      if (typeof v === 'string' && v.trim().length > 0) return v;
    }
  }
  return fallback;
}

/**
 * 获取支持的语言列表
 */
export function getSupportedLanguages(): LocaleCode[] {
  return getSupportedLocales();
}

/**
 * 从 localStorage 恢复上次选择的语言
 */
export function restoreLanguage(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh-CN' || saved === 'en-US') {
      setLocale(saved);
    }
  } catch {
    // localStorage 不可用，使用默认语言
  }
}

// 模块加载时自动恢复语言偏好
restoreLanguage();
