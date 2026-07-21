# 编码规范

本项目遵循统一的 TypeScript 编码规范，所有贡献者请阅读并遵守。

## 通用原则

1. **可读性优先**：代码首先是写给人看的，其次才是给机器执行的。
2. **显式优于隐式**：避免依赖隐式行为；显式声明类型、显式返回、显式错误处理。
3. **数据驱动**：游戏规则与具体数值分离。数值由地图数据/配置提供，不要硬编码到代码中。
4. **单一职责**：一个文件/类/函数只做一件事。
5. **避免过早抽象**：仅在确有第二个用例出现时才抽象通用逻辑。

## TypeScript

### 严格模式

- 项目使用 `tsconfig.base.json` 中定义的 strict 全家桶。
- 不要使用 `any`（必要时用 `unknown` 加类型守卫）。
- 不要使用 `@ts-ignore` / `@ts-expect-error`（如确需使用，需在 PR 中说明原因）。
- 严格区分 `interface`（描述对象结构）和 `type`（描述联合/工具类型）。

### 类型定义

- 公共类型（前后端共用）放在 `packages/shared/src/` 下。
- 优先使用接口（`interface`）声明对象结构，使用类型别名（`type`）声明联合/工具类型。
- 动态属性用 `Record<string, unknown>` + 类型守卫，不要硬编码字段名。
- 类型命名采用 PascalCase；接口不加 `I` 前缀。

### 导出

- 模块顶部集中导出，使用 `export *` 仅在入口文件中。
- 公开 API 必须有 JSDoc 注释（至少一行说明用途）。
- 默认导出仅在确实需要时使用；优先命名导出。

## 命名约定

| 类别 | 约定 | 示例 |
| --- | --- | --- |
| 文件名 | kebab-case | `board-renderer.ts` |
| 类 | PascalCase | `BoardRenderer` |
| 接口/类型 | PascalCase | `CellExtra` |
| 函数/方法 | camelCase | `isFeatureEnabled` |
| 变量 | camelCase | `currentPlayer` |
| 常量 | UPPER_SNAKE | `MAX_PLAYERS` |
| 枚举 | PascalCase，键 PascalCase | `CellType.Property` |
| 私有字段 | 加下划线前缀仅在必要时 | `_cache` |
| 测试文件 | `*.test.ts` / `*.spec.ts` | `debug.test.ts` |

## 注释

- 关键业务逻辑加 JSDoc 注释。
- 复杂算法说明思路，避免冗余逐行解释。
- TODO 注释格式：`// TODO(username): description`。

## 测试

- 单元测试与源代码放在不同目录（`tests/`）以避免污染构建产物。
- 测试文件命名 `*.test.ts`。
- 关键算法必须有单元测试覆盖。
- 调试一次修复 bug：先写一个失败的测试，再修复。

## Git 提交

- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)：
  - `feat:` 新功能
  - `fix:` 修复 bug
  - `docs:` 文档变更
  - `style:` 代码格式（不影响功能）
  - `refactor:` 重构
  - `test:` 测试相关
  - `chore:` 构建/工具链变更
- 提交粒度：一个提交完成一件事。
- 不要在提交中夹带无关变更。

## 代码风格（自动）

- 缩进：2 空格
- 引号：单引号
- 分号：保留
- 行宽：100 字符
- 尾逗号：多行时保留
- 箭头函数：始终带括号 `(x) => x`
- 配置见 `.prettierrc` 与 `.eslintrc.cjs`

## 文件组织

- 每个包目录结构：
  ```
  src/                # 源代码
  tests/              # 单元测试
  dist/               # 构建产物（自动生成，不入版本控制）
  coverage/           # 测试覆盖率（自动生成）
  ```
- 一个文件 ≤ 300 行；超过请考虑拆分。
- 单一职责：拆分前思考"这是不是同一件事"。

## 安全

- 禁止硬编码密钥、Token、密码。
- 用户输入必须校验。
- 服务端是权威：所有关键计算（随机数、经济、胜负）必须在服务端。
- 任何日志/响应不暴露敏感数据。

## 调试开关

- 用户体验流程（新手引导、动画等）必须可被调试开关禁用。
- 新增调试功能时在 `packages/shared/src/debug/index.ts` 的 `DebugFeatures` 常量中注册名称。
- 默认关闭，仅通过 `DEBUG_FLAGS=foo,bar` 启用。
