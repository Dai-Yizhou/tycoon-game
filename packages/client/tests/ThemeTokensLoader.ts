import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Jest 下替代 src/design/ThemeTokensLoader.ts 的桩。
 *
 * 生产该文件用 Vite 的 import.meta.glob 宏在构建期内联主题 JSON；Jest（CommonJS
 * 运行时）无法解析该宏，故通过 jest.config 的 moduleNameMapper 将 import 定向到此，
 * 用 fs 读取同一批主题 JSON，保证测试看到的令牌与生产一致。
 */
// ts-jest 以 CommonJS 运行，__dirname 可用；避免 import.meta（Vite 宏）避免重蹈覆辙
const themesDir = path.resolve(__dirname, '../../shared/design-tokens/themes');

const THEME_IDS = ['northeast', 'south', 'west', 'midwest'];

export const themeTokens: Record<string, Record<string, unknown>> = Object.fromEntries(
  THEME_IDS.map((id) => [
    id,
    JSON.parse(readFileSync(path.join(themesDir, `${id}.json`), 'utf8')) as Record<string, unknown>,
  ]),
);