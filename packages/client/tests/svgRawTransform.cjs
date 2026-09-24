/**
 * Jest 转换器：将 `.svg` 文件作为「导出文件内容字符串」的模块。
 *
 * 用于支撑组件里的 Vite `?raw` 导入（如 `../assets/piece.svg?raw`）在测试环境可用。
 * jest.config.cjs 的 moduleNameMapper 会先去掉 `?raw` 查询串，再交给本转换器。
 */
module.exports = {
  process(src) {
    return { code: `module.exports = ${JSON.stringify(src)};` };
  },
};