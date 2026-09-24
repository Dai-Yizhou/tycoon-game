/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/?(*.)+(spec|test).ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'svg'],
  setupFiles: ['<rootDir>/tests/canvas-setup.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  clearMocks: true,
  restoreMocks: true,
  moduleNameMapper: {
    // 主题 loader 含 Vite 的 import.meta.glob 宏，Jest 无法解析；定向到读取真实主题 JSON 的桩
    '(^|.*/)ThemeTokensLoader\\.(js|ts)$': '<rootDir>/tests/ThemeTokensLoader.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Vite 的 `?raw` 导入：去掉查询串后由 svg 转换器（下方 transform）导出文件内容字符串
    '(^|.*/)assets/(.+)\\.svg\\?raw$': '<rootDir>/src/assets/$2',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
    // `.svg` 以字符串模块形式导出，供 `?raw` 导入在测试环境使用
    '^.+\\.svg$': '<rootDir>/tests/svgRawTransform.cjs',
  },
};
