/**
 * 调试开关系统
 *
 * 通过环境变量 `DEBUG_FLAGS` 启用调试功能，多个标志以逗号分隔。
 *
 * 用法：
 * ```bash
 * DEBUG_FLAGS=tutorial,onboarding,cheat-economy pnpm dev
 * ```
 *
 * 也支持通配符 `*` 启用所有调试功能。
 */

/**
 * 缓存已解析的调试标志集合
 */
let cachedFlags: ReadonlySet<string> | null = null;

/**
 * 缓存来源（用于测试时强制刷新）
 */
let cachedSource: string | undefined | null = null;

/**
 * 通配符，表示启用所有调试功能
 */
export const ALL_FEATURES_FLAG = '*';

/**
 * 默认调试标志集合（未设置环境变量时）
 */
export const DEFAULT_FLAGS: readonly string[] = [];

/**
 * 读取环境变量并解析为 Set 集合
 *
 * 规则：
 * - 多个标志以逗号分隔
 * - 空白字符会被忽略
 * - 空字符串或未设置时使用默认空集合
 * - '*' 表示启用所有功能
 */
export function getDebugFlags(): ReadonlySet<string> {
  const source =
    typeof process !== 'undefined' && process.env ? process.env.DEBUG_FLAGS : undefined;

  if (cachedFlags !== null && cachedSource === source) {
    return cachedFlags;
  }

  cachedSource = source;

  if (!source || source.trim() === '') {
    cachedFlags = new Set(DEFAULT_FLAGS);
    return cachedFlags;
  }

  const flags = source
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);

  cachedFlags = new Set(flags);
  return cachedFlags;
}

/**
 * 重置内部缓存（仅用于测试）
 */
export function resetDebugFlagsCache(): void {
  cachedFlags = null;
  cachedSource = null;
}

/**
 * 检查某个调试功能是否启用
 *
 * @param featureName 调试功能名称
 * @returns 是否启用
 */
export function isFeatureEnabled(featureName: string): boolean {
  if (!featureName) {
    return false;
  }

  const flags = getDebugFlags();

  // 通配符
  if (flags.has(ALL_FEATURES_FLAG)) {
    return true;
  }

  // 精确匹配
  if (flags.has(featureName)) {
    return true;
  }

  // 命名空间匹配（foo.bar 匹配 foo）
  const segments = featureName.split('.');
  for (let i = segments.length - 1; i > 0; i--) {
    const prefix = segments.slice(0, i).join('.');
    if (flags.has(prefix)) {
      return true;
    }
  }

  return false;
}

/**
 * 高阶函数：当功能启用时执行 fn，否则不执行
 *
 * @param name 调试功能名称
 * @param fn 待执行函数
 * @returns fn 的返回值（如果功能未启用，返回 undefined）
 */
export function withFeature<T>(name: string, fn: () => T): T | undefined {
  if (!isFeatureEnabled(name)) {
    return undefined;
  }
  return fn();
}

/**
 * 列出当前所有已启用的调试标志
 */
export function listEnabledFeatures(): string[] {
  return Array.from(getDebugFlags());
}

/**
 * 常用调试功能名称（用作类型提示与拼写检查参考）
 */
export const DebugFeatures = {
  /** 禁用新手引导 */
  Tutorial: 'tutorial',
  /** 禁用引导教程 */
  Onboarding: 'onboarding',
  /** 启用经济系统作弊（可任意调整财产、信用值等） */
  CheatEconomy: 'cheat-economy',
  /** 启用账号快速重置 */
  QuickReset: 'quick-reset',
  /** 启用测试数据注入 */
  InjectTestData: 'inject-test-data',
  /** 跳过昼夜动画 */
  SkipDayNightAnim: 'skip-day-night-anim',
  /** 显示调试信息（如 FPS、坐标等） */
  ShowDebugInfo: 'show-debug-info',
  /** 启用骰子概率可视化 */
  DiceProbabilities: 'dice-probabilities',
  /** 启用视野全开 */
  FullVision: 'full-vision',
} as const;

export type DebugFeatureName = (typeof DebugFeatures)[keyof typeof DebugFeatures];
