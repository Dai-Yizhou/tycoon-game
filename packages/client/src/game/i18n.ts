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
