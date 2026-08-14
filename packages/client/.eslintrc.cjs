/**
 * client 包独立 ESLint 配置
 *
 * client 的 tsconfig.json 为通过构建类型检查而排除了 components/hud/hooks，
 * 但 ESLint 类型化 lint 需要能看到全部源码。这里用 tsconfig.eslint.json
 * （include 全部 src）覆盖 parserOptions.project，让 lint 可解析全部文件。
 */
module.exports = {
  root: false,
  extends: ['../../.eslintrc.cjs'],
  parserOptions: {
    project: ['./tsconfig.eslint.json'],
  },
};
