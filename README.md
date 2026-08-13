# 大富翁.io

> 当前架构基线：`packages/shared`、`packages/server`、`packages/client` 三包 monorepo；项目不包含 admin 包。服务端掌握游戏状态与银行账本，客户端通过单一 Socket 连接发送 `client.*` 请求并消费 `server.*` 状态事件。

> 结合经典大富翁玩法与 io 游戏大世界概念的多人在线网页游戏。
> 财产 / 信用值 / 备选数值三大数值体系并行，数据驱动棋盘，地图由编辑器定义。

详细规格见 [`.trae/specs/monopoly-io-game/spec.md`](.trae/specs/monopoly-io-game/spec.md)，
任务分解见 [`.trae/specs/monopoly-io-game/tasks.md`](.trae/specs/monopoly-io-game/tasks.md)。

---

## 功能概览

### 已实现

- **数据驱动棋盘**：加载地图编辑器导出的 JSON，动态解析格子属性与属性模板
- **掷骰与移动**：服务端权威随机数、冷却管理、多岔路路径选择、移动动画
- **地产系统**：购买、升级、租金、合租持股，数值全部由地图数据驱动
- **起点 / 监狱**：启动资金、补充资金、监狱冷却延长、信用值惩罚
- **事件格系统**：插件式事件注册，信用值影响概率，12 个内置事件模板
- **投资项目**：购买、合租持股、事件触发收益/损失
- **交通枢纽**：付费传送、目的地定期变更（与昼夜周期绑定）
- **纪念碑**：修缮增加信用值与繁荣度、未修缮繁荣度衰减
- **经济系统**：银行贷款/还款、抵押竞拍、昼夜计税、破产清算与复活
- **道具系统**：查封令（禁用格子）、复活令（复活破产玩家），插件式扩展
- **昼夜时区与繁荣度**：全局昼夜循环、时区本地时间、区域繁荣度影响收益
- **天赋系统**：17 个天赋（视野/字段开关/机制开关/进阶），插件式注册
- **成就系统**：8 类 18 个成就，跨棋盘保留，解锁给予天赋值
- **时代结算**：时代生命周期管理、结算、纪念碑铭记、地图切换
- **账号系统**：登录/注册、游客模式、离线冻结、状态恢复、MongoDB 持久化
- **行为引擎**：从 JSON 加载并执行格子行为脚本
- **调试开关**：环境变量驱动的功能开关系统，支持通配符与命名空间
- **多语言**：中文 / 英文语言包，参数占位符
- **新手引导**：分步教程，可跳过/回看，受调试开关控制

### 部分实现

- **组队系统**：TeamManager 模块已实现，尚未接入 socket 事件路由
- **聊天系统**：ChatManager 模块已实现，handlers.ts 中为占位处理器
- **系统通知**：NotificationManager 模块已实现，尚未统一接入各 Handler
- **客户端联机**：GamePage 已添加 socket 监听，但主体仍为单机逻辑

## 技术栈

| 类别 | 选型 | 用途 |
| --- | --- | --- |
| 语言 | TypeScript 5.4 | 全栈统一类型 |
| 运行时 | Node.js ≥ 18（推荐 20+） | 服务端运行时 |
| 前端构建 | Vite 5 | 客户端构建 |
| 后端框架 | Express 4 | HTTP 服务 |
| 实时通信 | Socket.IO 4 | WebSocket 双向通信 |
| 数据库 | MongoDB 6（可选） | 玩家数据持久化 |
| 认证 | bcrypt + JWT | 密码哈希 + 身份令牌 |
| 测试 | Jest + ts-jest | 单元测试 |
| 包管理 | pnpm workspaces 9 | Monorepo 管理 |

## 项目结构

```
monopoly-io-game/
├── .trae/specs/                  # 规格文档（只读）
│   └── monopoly-io-game/
│       ├── spec.md               # 产品需求（FR-1 ~ FR-23）
│       ├── tasks.md              # 任务分解与状态
│       └── checklist.md          # 验证清单
├── map_editor_v01.01/            # 地图编辑器（只读，参考用）
├── docs/                         # 项目文档
│   ├── ARCHITECTURE.md           # 架构说明
│   ├── API.md                    # Socket 事件与 REST API
│   ├── DEPLOYMENT.md             # 部署指南
│   ├── CODING_STYLE.md           # 编码规范
│   ├── DEVELOPER.md              # 开发者指南
│   ├── CONTENT_CREATOR.md        # 内容创作指南
│   └── PLAYER.md                 # 玩家指南
├── packages/
│   ├── shared/   (@game/shared)  # 共享类型、调试开关、地图解析、i18n
│   ├── server/   (@game/server)  # Node.js + Express + Socket.IO 后端
│   │   └── config/               # JSON 配置（talents/achievements/behaviors）
│   ├── client/   (@game/client)  # Vite + TypeScript + Canvas 前端
│   │   └── public/config/        # 客户端 JSON 配置副本
├── ai-bot/                       # AI 玩家程序（独立项目，开发测试工具）
├── ai_bot_try/                   # AI 训练框架（独立工具，不属于三包运行时）
├── pnpm-workspace.yaml
├── package.json                  # 根
├── tsconfig.base.json
├── .eslintrc.cjs
├── .prettierrc
└── README.md
```

## 快速开始

### 环境要求

- **Node.js** ≥ 18（推荐 20+）
- **pnpm** ≥ 8（推荐 9.x）

> 项目已锁定 `packageManager` 字段，未安装 pnpm 可通过 `corepack enable && corepack prepare pnpm@9.15.0 --activate` 激活。

### 安装依赖

```bash
pnpm install
```

### 启动开发模式

```bash
# 终端 1：启动服务端（端口 3000）
pnpm dev:server

# 终端 2：启动客户端（端口 5173）
> ⚠️ 客户端已禁用浏览器页面缩放，确保游戏棋盘正确显示。pnpm dev:client

```

打开浏览器访问 `http://localhost:5173` 即可进入游戏。

> 服务端启动时会在当前目录寻找 `map.json` 和 `map-meta.json`；若不存在则跳过地图加载（繁荣度/时区系统不可用，其余功能正常）。

### 构建生产产物

```bash
pnpm -r build
```

构建产物位于各包的 `dist/` 目录：
- `packages/shared/dist/` - 共享库（CJS + ESM 双格式）
- `packages/server/dist/` - Node.js 服务端
- `packages/client/dist/` - 静态前端（可用任意静态服务器托管）

### 运行测试

```bash
# 运行所有包的测试
pnpm -r test

# 单包测试
pnpm --filter @game/shared test
pnpm --filter @game/server test
pnpm --filter @game/client test
```

### 代码检查

```bash
pnpm -r lint          # ESLint
npx prettier --write . # Prettier 格式化
```

## 配置系统

运行时配置直接编辑仓库中的 JSON 文件，不通过 admin 页面或隐藏管理 API 生成：

### JSON 配置（数据驱动，可热替换）

| 配置文件 | 位置 | 说明 |
| --- | --- | --- |
| `talents.json` | `packages/server/config/`、`packages/client/public/config/` | 天赋定义（id、名称、效果、消耗、前置/互斥） |
| `achievements.json` | 同上 | 成就定义（条件、奖励、分类） |
| `behaviors/*.json` | 同上 `behaviors/` 子目录 | 格子行为脚本（事件触发逻辑） |

服务端从 `packages/server/config/` 加载；客户端从 `packages/client/public/config/` 加载（Vite 静态服务）。直接编辑后重新启动服务端或重新构建客户端；需要同步的同名配置文件应同时更新。

### TS 硬编码配置

- 事件模板：`packages/server/src/events/eventTemplates.ts`
- 道具模板：`packages/server/src/items/itemTemplates.ts`
- 昼夜/繁荣度默认值：`packages/server/src/world/DayNightCycle.ts`、`ProsperityManager.ts`
- 服务端环境配置：`packages/server/src/config.ts`（环境变量解析）

详细部署与环境变量说明见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 调试开关系统

通过环境变量 `DEBUG_FLAGS` 启用调试功能，多个标志以**逗号分隔**。

```bash
# 启用特定功能
DEBUG_FLAGS=tutorial,cheat-economy pnpm dev:client

# 启用全部
DEBUG_FLAGS=* pnpm dev:client
```

### 支持的调试标志

| 标志 | 说明 |
| --- | --- |
| `tutorial` | 禁用新手引导 |
| `onboarding` | 禁用引导教程 |
| `cheat-economy` | 启用经济系统作弊（任意调整数值） |
| `quick-reset` | 启用账号快速重置 |
| `inject-test-data` | 启用测试数据注入 |
| `skip-day-night-anim` | 跳过昼夜动画 |
| `show-debug-info` | 显示调试信息（FPS、坐标等） |
| `dice-probabilities` | 启用骰子概率可视化 |
| `full-vision` | 启用视野全开（无视天赋限制） |

### 在代码中使用

```typescript
import { isFeatureEnabled, withFeature } from '@game/shared';

if (isFeatureEnabled('tutorial')) {
  // 调试逻辑
}

withFeature('cheat-economy', () => {
  console.log('cheat mode enabled');
});
```

命名空间匹配：`DEBUG_FLAGS=cheat` 会同时启用 `cheat.economy`、`cheat.spawn` 等子功能。

实现位于 `packages/shared/src/debug/index.ts`。

## 各包命令速查

| 命令 | 说明 |
| --- | --- |
| `pnpm -r build` | 构建所有包 |
| `pnpm -r lint` | 所有包 ESLint 检查 |
| `pnpm -r test` | 运行所有包单元测试 |
| `pnpm -r clean` | 清理所有包构建产物 |
| `pnpm dev:server` | 服务端开发（热重载） |
| `pnpm dev:client` | 客户端开发（Vite HMR） |

## 端口约定

| 服务 | 端口 |
| --- | --- |
| @game/server | 3000 |
| @game/client (Vite dev) | 5173 |
| @game/client (Vite preview) | 4173 |
| ai-bot 控制面板 | 4040 |

可通过环境变量覆盖：`PORT`、`HOST`、`VITE_API_TARGET`。

## 文档

| 文档 | 受众 | 内容 |
|---|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 开发者 | 三包架构、依赖图、权威边界与核心流程 |
| [docs/API.md](docs/API.md) | 开发者 | Socket 事件列表、REST API、核心类型 |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | 运维 | 环境变量、部署流程、MongoDB 配置、排查 |
| [docs/CODING_STYLE.md](docs/CODING_STYLE.md) | 开发者 | 编码规范 |
| [docs/DEVELOPER.md](docs/DEVELOPER.md) | 协作开发者 | 三包开发、直接编辑配置、Socket 与验证 |
| [docs/CONTENT_CREATOR.md](docs/CONTENT_CREATOR.md) | 内容创作者 | 地图数据与 JSON 配置直接编辑 |
| [docs/PLAYER.md](docs/PLAYER.md) | 玩家 | 操作说明、界面介绍、天赋系统 |
| [.trae/specs/monopoly-io-game/spec.md](.trae/specs/monopoly-io-game/spec.md) | 全部 | 产品需求规格 |
| [map_editor_v01.01/instruction.txt](map_editor_v01.01/instruction.txt) | 内容创作者 | 地图编辑器说明 |

## 当前进展

| 阶段 | 任务 | 状态 |
| --- | --- | --- |
| 一 基础架构 | Task 1-4 | ✅ 完成 |
| 二 核心玩法（MVP） | Task 5-10 | ✅ 完成 |
| 三 扩展玩法 | Task 11-17 | ✅ 完成（含经济/道具/天赋/昼夜/成就） |
| 四 社交与多人 | Task 18-20 | ⏳ 部分实现（组队/聊天/通知模块已建，待接线） |
| 五 辅助与优化 | Task 21-26 | ✅ 完成（账号/成就/i18n/时代/文档/测试） |

详细任务状态见 [`.trae/specs/monopoly-io-game/tasks.md`](.trae/specs/monopoly-io-game/tasks.md)。

## 许可

UNLICENSED - 内部项目。
