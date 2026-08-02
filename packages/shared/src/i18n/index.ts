/**
 * i18n 多语言支持模块
 *
 * 提供语言包加载、语言切换等功能。
 * 语言包定义在 zh-CN.json 和 en-US.json 中，此处为编译时的内联后备。
 */

import zhCNRaw from './zh-CN.json';
import enUSRaw from './en-US.json';

export type LocaleCode = 'zh-CN' | 'en-US';

const zhCN = zhCNRaw as Record<string, unknown>;
const enUS = enUSRaw as Record<string, unknown>;

const locales: Record<LocaleCode, Record<string, unknown>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

let currentLocale: LocaleCode = 'zh-CN';

export function setLocale(locale: LocaleCode): void {
  if (locales[locale]) {
    currentLocale = locale;
  }
}

export function getLocale(): LocaleCode {
  return currentLocale;
}

export function getCurrentLocaleData(): Record<string, unknown> {
  return locales[currentLocale];
}

/**
 * 获取国际化文本
 * @param key 点号分隔的 key，如 'common.loading'
 * @param params 可选参数，用于替换 {{key}} 占位符
 * @returns 翻译后的文本，如果 key 不存在则返回 key 本身
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const parts = key.split('.');
  let value: unknown = locales[currentLocale];

  for (const part of parts) {
    if (typeof value === 'object' && value !== null && part in value) {
      value = (value as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }

  if (typeof value !== 'string') {
    return key;
  }

  if (params) {
    let result = value;
    for (const [paramKey, paramValue] of Object.entries(params)) {
      result = result.replace(new RegExp(`{{${paramKey}}}`, 'g'), String(paramValue));
    }
    return result;
  }

  return value;
}

export function getSupportedLocales(): LocaleCode[] {
  return Object.keys(locales) as LocaleCode[];
}