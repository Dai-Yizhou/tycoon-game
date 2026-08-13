# 项目架构

## 目标

大富翁.io 是一款结合经典大富翁玩法与 io 游戏大世界概念的多人在线网页游戏。架构上需要支持：

- **千人级并发**（单棋盘 ~1000 名玩家）
- **数据驱动**（规则由地图数据/天赋动态决定，不硬编码）
- **可扩展**（格子类型、道具、事件、数值字段均插件式扩展）
- **多元数值**（财产、信用值、备选数值多体系并行）

## 技术栈

| 类别 | 选型 | 版本 | 用途 |
| --- | --- | --- | --- |
| 语言 | TypeScript | ^5.4 | 全栈统一类型 |
| 运行时 | Node.js | >=18 | 服务端运行时 |
| 前端构建 | Vite | ^5.2 | 客户端/Admin 构建 |
| 后端运行 | tsx (dev) / tsc (build) | ^4.7 / ^5.4 | 开发与构建 |
| 后端框架 | Express | ^4.19 | HTTP 服务 |
| 实时通信 | Socket.IO | ^4.7 | WebSocket 实时双向 |
| 数据库 | MongoDB | ^6.8 | 玩家数据持久化（可选） |
| 认证 | bcrypt + jsonwebtoken | ^5.1 / ^9.0 | 密码哈希 + JWT |
| 测试 | Jest + ts-jest | ^29 | 单元测试 |
| 代码规范 | ESLint + Prettier | ^8 / ^3 | 静态检查 + 格式化 |
| 包管理 | pnpm workspaces | ^9 | Monorepo 管理 |

## 顶层结构

```
monopoly-io-game/                 # 项目根
├── .trae/specs/                  # 规格文档（只读，不修改）
├── map_editor_v01.01/            # 地图编辑器（只读，参考用）
├── docs/                         # 项目文档
├── packages/
│   ├── shared/   (@game/shared)  # 共享类型/地图解析/调试开关/i18n
│   ├── server/   (@game/server)  # 服务端
│   │   ├── config/               # JSON 配置（talents/achievements/behaviors）
│   │   └── src/
│   ├── client/   (@game/client)  # 客户端
│   │   └── public/config/        # 客户端 JSON 配置副本
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── .eslintrc.cjs
├── .prettierrc
└── .gitignore
```

## 包职责

### @game/shared

- **职责**：前后端共用的类型定义、地图解析工具、调试开关、i18n 语言包。
- **构建产物**：`dist/cjs/`（CommonJS）+ `dist/esm/`（ESM），双格式兼容 Node.js 与 Vite。
- **依赖规则**：不依赖其他 game 包；纯 TS/Node 库。
- **内容**：
  - `src/types/` — 14 个类型文件（cell/player/team/map-meta/transport/event/item/talent/era/chat/socket-events/server-config/auth/achievement）
  - `src/debug/` — 调试开关系统（`isFeatureEnabled`、`withFeature`、通配符匹配）
  - `src/map/` — 地图解析（map-parser/map-index/path-finder/map-loader/map-meta-loader）
  - `src/i18n/` — 多语言（zh-CN.json、en-US.json）

### @game/server

- **职责**：游戏服务端，HTTP API + WebSocket 实时通信 + 游戏世界管理。
- **运行模式**：
  - 开发：`tsx watch src/index.ts`（热重载）
  - 生产：`node dist/index.js`
- **入口**：`src/index.ts` → `src/app.ts`（`createApp` 工厂函数）。
- **目标**：
  - 单棋盘 ~1000 名玩家同时在线
  - 关键计算（随机数、经济、胜负）服务端权威
  - 横向扩展：未来可接 Redis 适配器支持多实例

### @game/client

- **职责**：游戏客户端，Canvas 渲染棋盘与游戏逻辑展示。
- **构建**：Vite 5.x，dev server 5173，生产构建到 `dist/`。
- **架构原则**：渲染层与数据层分离（MVVM）。
- **页面流程**：Start → Login → Loading → Game（由 GameController 状态机管理）。

## 服务端核心架构

### 启动流程

```
index.ts (bootstrap)
  └── loadConfig()           # 从环境变量加载 ServerConfig
  └── createApp(config)      # 工厂函数创建应用
       ├── Express + Helmet + CORS
       ├── GameWorld          # 游戏世界（加载地图 + 元数据）
       ├── SocketManager      # Socket.IO 管理器（鉴权/限流/广播）
       ├── Economy            # 经济系统（Bank/Mortgage/Taxation/Bankruptcy）
       ├── HandlerRegistry    # 事件处理器注册（掷骰/移动/地产/事件/道具...）
       ├── DayNightCycle      # 昼夜循环
       ├── TimeZoneManager    # 时区管理
       ├── ProsperityManager  # 繁荣度管理
       ├── BehaviorEngine     # 行为引擎
       ├── EraManager         # 时代管理
       └── PlayerStore        # 玩家存储（InMemory 或 MongoDB）
  └── startHttpServer()       # 监听端口
  └── SIGINT/SIGTERM          # 优雅关闭
```

### 核心管理器

| 管理器 | 文件 | 职责 |
| --- | --- | --- |
| **GameWorld** | `world/GameWorld.ts` | 游戏世界容器：管理玩家、地图索引、时代信息，发射事件（playerAdded/Removed/Updated/eraChanged） |
| **PlayerManager** | `world/PlayerManager.ts` | 玩家生命周期：加入/离开/连接/断开/冻结 |
| **DayNightCycle** | `world/DayNightCycle.ts` | 全局昼夜循环（默认 15 分钟周期），触发计税与交通枢纽变更，广播 `server.dayNightProgress`/`dayNightChanged` |
| **TimeZoneManager** | `world/TimeZoneManager.ts` | 从地图元数据加载时区配置，计算各时区本地时间与昼夜状态 |
| **ProsperityManager** | `world/ProsperityManager.ts` | 区域繁荣度管理：夜晚降低（默认 30%）、白天恢复（默认 20%），影响租金乘数与事件概率 |
| **EraManager** | `era/EraManager.ts` | 时代生命周期：创建/定时结算/地图切换/纪念碑铭记，支持 `EraStore` 持久化 |

### 经济系统

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| **Bank** | `economy/Bank.ts` | 贷款/还款/利息计算（利率与信用值挂钩） |
| **Mortgage** | `economy/Mortgage.ts` | 地产抵押、区域竞拍（auctionStarted/bidPlaced/auctionEnded） |
| **Taxation** | `economy/Taxation.ts` | 昼夜计税定时器（财富税/地产税/投资税），与 DayNightCycle 集成 |
| **Bankruptcy** | `economy/Bankruptcy.ts` | 破产判定/复活期限/清算（清除地产、回到起点）/复活机制 |

### 事件处理器（HandlerRegistry）

`transport/handlers.ts` 中的 `HandlerRegistry` 集中注册所有业务事件处理器：

| Handler | 文件 | 处理事件 |
| --- | --- | --- |
| DiceHandler | `handlers/diceHandler.ts` | `client.rollDice`（掷骰、冷却、随机数） |
| MovementHandler | `handlers/movementHandler.ts` | 移动路径计算、多岔路、广播 |
| PropertyHandler | `handlers/propertyHandler.ts` | `client.buyProperty`/`upgradeProperty`（购买/升级/租金/合租） |
| StartHandler | `handlers/startHandler.ts` | 启动资金、补充资金 |
| JailHandler | `handlers/jailHandler.ts` | 监狱状态、惩罚、出狱 |
| EventHandler | `events/EventHandler.ts` | 事件格触发、概率计算（信用值影响） |
| InvestmentHandler | `handlers/investmentHandler.ts` | 投资项目购买/合租/事件触发 |
| TransportHandler | `handlers/transportHandler.ts` | 交通枢纽付费传送、目的地变更 |
| MonumentHandler | `handlers/monumentHandler.ts` | 纪念碑修缮、繁荣度管理 |
| ItemHandler | `handlers/itemHandler.ts` | `client.useItem`/`getItems`/`requestItemDrop` |
| TalentHandler | `handlers/talentHandler.ts` | `client.learnTalent`/`unlearnTalent`/`toggleTalent`/`getTalentInfo` |
| DebugHandler | `handlers/debugHandler.ts` | `client.debugReset`/`debugInject`（仅调试模式） |

### 存储层

| 接口/实现 | 文件 | 说明 |
| --- | --- | --- |
| `PlayerStore` | `storage/PlayerStore.ts` | 玩家存储接口（save/load/loadByUsername/delete） |
| `InMemoryPlayerStore` | `storage/InMemoryPlayerStore.ts` | 内存版（开发用，支持持久化+恢复+冻结） |
| `MongoPlayerStore` | `storage/MongoPlayerStore.ts` | MongoDB 版（连接池、序列化/反序列化、索引优化） |
| `EraStore` | `storage/EraStore.ts` | 时代存储接口 |
| `InMemoryEraStore` | `storage/InMemoryEraStore.ts` | 内存版时代存储 |

### 其他服务端模块

- **BehaviorEngine**（`behavior/BehaviorEngine.ts`）：从 JSON 加载格子行为脚本并执行，注入 ProsperityManager 与 ItemEffectsHandler。
- **AuthService**（`auth/AuthService.ts`）：用户注册/登录/游客创建/游客迁移，bcrypt 密码哈希。
- **JWTService**（`auth/JWTService.ts`）：JWT 生成/验证（默认 7 天有效期）。
- **AchievementManager**（`achievements/AchievementManager.ts`）：成就注册/检测/进度/回调，8 类 18 个内置成就。
- **TalentRegistry**（`talents/TalentRegistry.ts`）：天赋注册/学习/取消/启用/禁用，前置与互斥关系。
- **TeamManager**（`team/TeamManager.ts`）：队伍创建/合并/分离（**已实现，待接入 socket 路由**）。
- **ChatManager**（`chat/ChatManager.ts`）：频道管理与消息分发（**已实现，handler 为占位**）。
- **NotificationManager**（`notifications/NotificationManager.ts`）：通知创建/优先级/历史（**已实现，待接入**）。

## 数据流

### 主数据流

```
客户端 (Canvas)
  │  socket.emit('client.rollDice', ...)
  ▼
SocketManager (鉴权/限流/路由)
  │
  ▼
HandlerRegistry → DiceHandler
  │  生成随机数、校验冷却
  ▼
MovementHandler
  │  PathFinder 计算路径、GameWorld 更新位置
  ▼
PropertyHandler / EventHandler / ... (按格子类型触发)
  │  经济计算、事件效果
  ▼
SocketManager.broadcast / broadcastToMap / emitToPlayer
  │  server.playerMoved / valueChanged / notification ...
  ▼
客户端 (渲染更新)
```

### 登录与时间同步数据流

```
客户端 LoginPage
  │  socket.emit('client.login', { username, guest })
  ▼
SocketManager.registerCoreHandlers
  │  创建/恢复玩家 → GameWorld.addPlayer
  │  获取 DayNightCycle 周期信息
  ▼
ack({ player, serverTime, cycleStartTime, cycleMinutes })
  │
  ▼
客户端 GameController
  │  保存 player 状态、同步昼夜时间
  │  监听 server.dayNightProgress (每秒) → DayNightRenderer
  │  监听 server.prosperityChanged → 繁荣度 UI
```

### 账号持久化流程

```
登录时:
  client.login → SocketManager
    → PlayerStore.loadPlayerByUsername(username)
    → 恢复玩家状态（frozen → normal）
    → GameWorld.addPlayer

断开时:
  socket.disconnect → SocketManager.onDisconnect
    → PlayerStore.savePlayer(player)  [非游客]
    → PlayerManager.disconnectPlayer → 玩家状态设为 frozen

存储选择:
  config.mongoUri 存在 → MongoPlayerStore
  否则 → InMemoryPlayerStore
```

## 昼夜循环与区域繁荣度系统

```
DayNightCycle (全局时间)
  │  每 15 分钟一个周期（可配置）
  │  每秒广播 server.dayNightProgress
  │  昼夜切换时广播 server.dayNightChanged
  │
  ├──→ TimeZoneManager
  │      从 MapMeta 加载时区配置
  │      各时区本地时间 = 全局时间 + 时区偏移
  │      判定时区昼夜状态
  │
  ├──→ ProsperityManager
  │      夜晚：区域繁荣度降低（默认 30%）
  │      白天：区域繁荣度恢复（默认 20%）
  │      繁荣度 → 租金乘数、事件概率修正
  │      广播 server.prosperityChanged
  │
  ├──→ Taxation
  │      昼夜切换时触发计税（财富税/地产税/投资税）
  │
  └──→ TransportHandler
         昼夜切换时变更交通枢纽目的地
```

## 配置系统

### JSON 配置（数据驱动）

| 配置 | 服务端路径 | 客户端路径 | 说明 |
| --- | --- | --- | --- |
| 天赋 | `packages/server/config/talents.json` | `packages/client/public/config/talents.json` | 天赋定义（id/名称/效果/消耗/前置/互斥） |
| 成就 | `packages/server/config/achievements.json` | `packages/client/public/config/achievements.json` | 成就定义（条件/奖励/分类） |
| 行为 | `packages/server/config/behaviors/*.json` | `packages/client/public/config/behaviors/*.json` | 格子行为脚本（BehaviorEngine 加载） |

### TS 硬编码配置

- 事件模板：`packages/server/src/events/eventTemplates.ts`（12 个内置事件）
- 道具模板：`packages/server/src/items/itemTemplates.ts`（查封令/复活令）
- 昼夜默认值：`packages/server/src/world/DayNightCycle.ts`（`DEFAULT_DAY_NIGHT_CONFIG`）
- 繁荣度默认值：`packages/server/src/world/ProsperityManager.ts`（`DEFAULT_PROSPERITY_CONFIG`）
- 服务端配置：`packages/server/src/config.ts` + `packages/shared/src/types/server-config.ts`（`DEFAULT_SERVER_CONFIG`）

## Socket.IO 通信

### 房间命名约定

| 房间 | 格式 | 用途 |
| --- | --- | --- |
| 全局 | `all`（默认） | 全体广播 |
| 棋盘 | `map:<mapId>` | 同一棋盘的玩家 |
| 区域 | `region:<mapId>:<regionId>` | 棋盘内某区域 |
| 队伍 | `team:<teamId>` | 队伍成员 |
| 玩家 | `player:<playerId>` | 单玩家私推 |

### 广播分层

SocketManager 提供 5 层广播：`broadcast`（全局）、`broadcastToMap`、`broadcastToRegion`、`broadcastToTeam`、`emitToPlayer`。

详细 Socket 事件列表见 [API.md](./API.md)。

## 客户端架构

### 页面流程

```
StartPage (标题 + 剪影动画)
  └── LoginPage (用户名输入 / 游客模式)
       └── LoadingPage (连接进度)
            └── GamePage (棋盘 + HUD + 弹窗)
```

`GameController` 管理状态机（start → login → loading → game）与 socket 引用。

### 渲染层

| 渲染器 | 文件 | 职责 |
| --- | --- | --- |
| BoardRenderer | `renderer/BoardRenderer.ts` | 棋盘总渲染器（协调各子渲染器） |
| CellRenderer | `renderer/CellRenderer.ts` | 格子渲染（类型颜色、等级徽章、所有者标识） |
| ConnectionRenderer | `renderer/ConnectionRenderer.ts` | 连线渲染（虚线） |
| PlayerRenderer | `renderer/PlayerRenderer.ts` | 玩家棋子渲染 |
| VisionMaskRenderer | `renderer/VisionMaskRenderer.ts` | 视野遮罩（视野外格子雾化） |
| DayNightRenderer | `renderer/DayNightRenderer.ts` | 昼夜视觉效果（夜晚变暗、色调变化） |
| Camera | `renderer/Camera.ts` | 缩放/平移交互 |

### 前端组件

- **弹窗**：PropertyModal、UpgradeButton、EventModal、InvestmentModal、TransportModal、MonumentModal、SealOrderModal、ReviveOrderModal
- **HUD**：HUD、ValueDisplay、PlayerList、StatusIndicator
- **面板**：TalentPanel、TeamPanel、ChatPanel、NotificationCenter、ItemBag、JailIndicator
- **Hooks**：useSocket、useDice、useMovement、usePlayerState
- **教程**：TutorialManager（分步引导，受调试开关控制）

## 性能与可扩展性

- 服务端：单进程基线 ~1000 并发；接 Redis 适配器后可水平扩展。
- 客户端：Canvas 渲染按需重绘；视野系统减少视觉负载。
- 通信：Socket.IO 房间机制 + 区域/队伍分层广播，避免无差别广播导致的消息风暴。
- 限流：每连接 100 事件/10s（可配置），超限发送 `server.error`。
- 数据：动态字段使用 `Record<string, ValueField>`，避免重复定义新字段时改引擎核心。

## 动态数值字段系统

不同棋盘（时代）可定义不同的数值字段，引擎和客户端根据定义动态渲染，不硬编码字段列表。

### ValueField 的 scope 字段

`ValueField` 接口含可选 `scope` 字段：

| scope | 说明 | 初始化 | 渲染位置 |
| --- | --- | --- | --- |
| `player`（默认） | 玩家持有数值（如财产、信用值） | `buildPlayerValues()` 写入 `player.values` | 顶栏 + 详情面板"其他"标签 |
| `region` | 区域级数值（如环保值） | `Region` 对象的属性 | 详情面板"区域"标签 |

### 配置方式

在 `map-meta.json` 的 `valueFieldDefinitions` 数组中定义：

```json
[
  { "id": "money", "name": "财产", "current": 2000, "min": 0, "scope": "player" },
  { "id": "credit", "name": "信用值", "current": 0, "min": 0, "scope": "player" },
  { "id": "environmental", "name": "环保值", "current": 50, "min": 0, "max": 100, "scope": "region" }
]
```

不同时代/棋盘可定义不同数目、不同 scope 的字段，客户端通过 `/api/map` 获取 `valueFieldDefinitions` 后动态生成 UI 元素。

## AI 玩家系统 (ai-bot)

独立于主项目的 AI 玩家程序，用于自动化测试、游戏平衡性评估和开发调试。

### 定位

- **开发工具**：非游戏功能，供开发者和内容创作者使用
- **独立运行**：不依赖 `@game/shared` 等包，独立 `package.json` 和类型定义
- **黑盒测试**：通过 Socket.IO 连接游戏服务端，模拟真实玩家行为

### 目录结构

```
ai-bot/
├── src/
│   ├── types.ts              # 本地类型定义
│   ├── Logger.ts             # 自然语言日志生成器（6级日志）
│   ├── BugDetector.ts        # Bug 检测器（异常检测）
│   ├── DecisionEngine.ts     # 规则驱动决策引擎
│   ├── LLMDecisionEngine.ts  # LLM 驱动决策引擎（支持自定义提示词）
│   ├── AIBot.ts              # AI 玩家核心类
│   ├── BotManager.ts         # Bot 管理器（动态创建/停止/删除）
│   ├── EvaluationEngine.ts   # 多维度评价引擎（6维度评分）
│   ├── LLMAdapter.ts         # 多后端 LLM 适配器
│   ├── ScreenshotService.ts  # 游戏页面截图服务
│   ├── main.ts               # CLI 入口
│   └── dashboard/
│       └── server.ts         # 控制面板 Web 服务（Express + WebSocket）
├── logs/                     # 日志文件目录
├── screenshots/              # 截图目录（可选）
├── docs/LLM_GUIDE.md         # LLM 集成指南
├── package.json
└── README.md
```

### 核心模块

| 模块 | 职责 |
| --- | --- |
| **AIBot** | AI 玩家核心，管理 Socket.IO 连接、游戏状态、决策循环 |
| **DecisionEngine** | 规则驱动决策：岔路选择 > 组队响应 > 掷骰 > 格子操作 > 天赋 > 组队邀请 > 聊天 |
| **LLMDecisionEngine** | LLM 驱动决策：支持用户自定义性格/策略提示词，失败自动回退规则引擎 |
| **BugDetector** | 检测异常：掷骰无响应、操作超时、负数资金、状态不一致、满级仍升级等 |
| **Logger** | 6级日志（info/action/event/warning/error/bug），文件+控制台+WebSocket 三渠道输出 |
| **EvaluationEngine** | 6维度评分（gameplay/economy/visuals/bugs/balance/ui），支持 LLM 增强评价 |
| **BotManager** | 运行时动态创建/停止/删除 AI 玩家 |
| **LLMAdapter** | 多后端适配：Ollama / Groq / OpenRouter / Together AI / llamafile / 规则引擎 |
| **Dashboard** | Web 控制面板：实时日志查看、AI 状态监控、LLM 配置、日志导出 |

### 决策引擎优先级

规则引擎决策优先级（从高到低）：

1. **岔路选择**：遇到岔路时选择方向
2. **组队响应**：收到组队邀请时接受/拒绝
3. **掷骰**：冷却结束后掷骰前进
4. **格子操作**：购买地产、升级、投资、修缮纪念碑、交通传送
5. **天赋学习**：优先学习高性价比天赋
6. **组队邀请**：主动邀请附近玩家组队
7. **聊天**：随机发送聊天消息

LLM 决策引擎可完全接管决策，或在规则引擎基础上进行策略调整。

### LLM 集成

- **支持后端**：Ollama（本地）、OpenAI 兼容 API（Groq/OpenRouter/Together AI）、llamafile（llama-server）
- **自定义提示词**：用户可设置性格设定（如"谨慎保守型"、"激进冒险型"）和策略偏好
- **回退机制**：LLM 超时或不可用时自动回退到规则引擎
- **视觉支持**：可配合截图服务，将游戏画面描述注入提示词（实验性）

### 控制面板功能

- **实时日志**：WebSocket 推送，支持按 Bot/级别/关键词过滤
- **AI 管理**：查看状态、动态添加/删除 Bot、调整决策间隔
- **LLM 配置**：后端切换、模型选择、API Key 设置、性格/策略自定义
- **日志导出**：支持 JSON/TXT 格式导出，便于分析和存档
- **评价报告**：定时生成多维度评价报告

### 使用方式

```bash
# 启动 3 个 AI 玩家 + 控制面板
cd ai-bot
npm run dev -- --count 3 --dashboard --log-dir /Volumes/T7_APFS/monopoly-io-game/ai-bot/logs

# 启用 LLM 决策
npm run dev -- --count 1 --dashboard --llm --llm-type ollama --llm-model qwen2.5:0.5b
```

## 安全

- 服务端权威：随机数、经济、胜负、位置变更均服务端计算。
- 输入校验：所有 API 入口校验输入。
- 防作弊：关键操作服务端校验；玩家之间不可直接交易地产。
- 隐私：密码 bcrypt 哈希（10 轮 salt）；JWT 身份认证；敏感数据不写入日志。
- 地图数据：服务端校验格式（防恶意大文件、结构炸弹）。
- HTTP：Helmet 安全头 + CORS 白名单 + 1MB 请求体限制。

## 服务端权威关键设计模式

### 移动最终落点事务（settleLanding）

```
MovementHandler.continueMovement (路径计算 + 位置更新)
  │
  └──→ settleLanding (回调，由 HandlerRegistry 注入)
         │
         └──→ HandlerRegistry.handleCellEvent
                │
                ├──→ StartHandler (起点资金)
                ├──→ JailHandler (入狱判定)
                ├──→ EventHandler (事件格)
                ├──→ PropertyHandler (地产租金/购买)
                ├──→ InvestmentHandler (投资结算)
                └──→ MonumentHandler (纪念碑修缮)
```

**关键规则**：
- 中间经过的格子**不触发任何业务逻辑**，仅用于动画路径
- 只有最终停留格触发一次 `settleLanding` 回调
- `client.move` 的普通调用被拒绝，必须由服务端 `rollDice` 流程发起

### 地产与租金权威

- 租金计算时过滤 `PlayerStatus.Jail` 的所有者，被监禁所有者不参与租金分配
- 若所有所有者均被监禁，该地产不收取租金
- 合租（`ownerships`）场景同样过滤被监禁者

### 组件状态同步

- 组队状态以 `TeamManager` 为权威源，`Player.teamId` 同步更新
- 退出队伍、被踢出、队伍解散时，所有受影响成员均收到状态清理事件

### 客户端事件处理

- 所有 `client.*` 请求仅发送到服务端，不修改本地业务状态
- 服务端通过 `server.valueChanged`、`server.playerStatusChanged` 等事件驱动客户端状态更新
- `SocketEventHandler` 集中管理所有事件监听，使用 `WeakSet` 防止重复注册，提供 `unregisterSocketHandlers` 清理
- 客户端 `GameLogic.ts` 和 `ModalSystem.ts` 中的业务操作只发送请求，不调用 `setCurrentMoney`、`setCurrentPlayerPosition` 等本地状态修改函数

### 破产重开流程

- 客户端 `handleBankruptRestart()` 发送 `client.bankruptRestart` 请求
- 服务端 `HandlerRegistry.handleBankruptRestart` 调用 `Bankruptcy.revivePlayer()` 处理
- 重置玩家状态为 `Normal`，重置金钱和信用值，回到起点
- 广播 `server.playerRevived` 事件通知所有客户端
- 服务端权威：所有数值变更由服务端事件驱动，客户端不直接修改本地状态
