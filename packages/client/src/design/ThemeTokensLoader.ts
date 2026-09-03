/**
 * 主题令牌源的 bundler 专用加载器。
 *
 * 使用 import.meta.glob 动态加载 shared/design-tokens/themes 下的全部 JSON，
 * 以文件名（不含扩展名）作为主题 id。新增主题只需在 themes 目录添加 JSON 文件。
 *
 * 该宏仅能被 Vite/打包器在构建期静态内联，普通 Node/Jest（CommonJS 运行时）
 * 无法解析 import.meta。因此在 Jest 下通过 jest 配置的 moduleNameMapper
 * 将其定向到 tests/ThemeTokensLoader.ts 桩（同样读取真实主题 JSON），
 * 生产代码路径保持不变。
 */
const themeModules = import.meta.glob("../../../shared/design-tokens/themes/*.json", {
  eager: true,
  import: "default",
});

function themeIdFromPath(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.json$/, "");
}

/** 主题 id 与令牌映射，键由令牌文件名派生 */
export const themeTokens: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(themeModules).map(([path, tokens]) => [
    themeIdFromPath(path),
    tokens as Record<string, unknown>,
  ]),
);