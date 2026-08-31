# 当前文件地图

> 基于 2026-08-14 工作目录实际文件。路径均相对仓库根目录；只列运行时三包和相关文档。历史/规格文档中的文件名和功能描述不代表当前运行时。

## 顶层

| 路径 | 职责 | 关系 |
|---|---|---|
| `package.json` | 根 dev/build/lint/test/clean 脚本 | 调度三包 |
| `scripts/dev-services.mjs` | 并行启动 server 与 client dev 进程 | 被根 `dev` 调用 |
| `pnpm-workspace.yaml` | workspace 声明 | 管理 `packages/*` |
| `tsconfig.base.json` | 三包共享 TypeScript 基础配置 | 被各包 tsconfig 继承 |
| `docs/architecture/ARCHITECTURE.md` | 运行时架构、边界与技术债 | 本文配套 |
| `docs/architecture/API.md` | 当前 REST/Socket 协议 | 本文配套 |

## shared

| 路径 | 职责 | 关系 |
|---|---|---|
| `packages/shared/src/index.ts` | 统一导出 types、map、debug、i18n | server/client 入口 |
| `packages/shared/src/types/index.ts` | 汇总共享类型 | 被根入口导出 |
| `packages/shared/src/types/player.ts` | Player、ValueField、玩家状态 | world、handler、client store |
| `packages/shared/src/types/cell.ts` | Cell、格子扩展字段及辅助访问 | 地图解析与两端玩法 |
| `packages/shared/src/types/map-meta.ts` | MapMeta、区域、时区、字段定义 | app、地图加载、HUD |
| `packages/shared/src/types/socket-events.ts` | ClientToServerEvents、ServerToClientEvents、SocketData、AckResult | 两端 typed Socket 契约 |
| `packages/shared/src/types/team.ts` / `chat.ts` / `transport.ts` / `event.ts` / `era.ts` / `auth.ts` / `server-config.ts` | 队伍、聊天、交通、事件、时代、认证、服务端配置契约 | 对应 server/client 模块 |
| `packages/shared/src/map/map-parser.ts` | 校验并标准化地图 JSON | app 与客户端地图链 |
| `packages/shared/src/map/map-index.ts` | 按 cell id 建索引 | MovementHandler、客户端地图加载 |
| `packages/shared/src/map/path-finder.ts` | 沿 destinations 查路径/邻居 | 服务端移动 |
| `packages/shared/src/map/map-loader.ts` / `map-meta-loader.ts` | 地图与元数据加载/解析 | parser 外层 |
| `packages/shared/src/debug/index.ts` | DEBUG_FLAGS 和功能开关 | server/client 调试门控 |
| `packages/shared/src/i18n/index.ts`、`zh-CN.json`、`en-US.json` | 翻译与语言资源 | 客户端界面 |
| `packages/shared/package.json` | CJS/ESM 构建出口与 build/lint/test scripts | 独立构建包 |

当前 `packages/shared/src/types`、运行时配置和 Socket 契约均不包含 item/talent/achievement 的现行能力；历史/规格文档中的同名描述不属于当前文件地图。

## server

### 入口与组合根

| 路径 | 职责 | 关系 |
|---|---|---|
| `packages/server/src/index.ts` | `bootstrap()`、配置、启动 HTTP、信号关闭 | 调用 app |
| `packages/server/src/app.ts` | `createApp()` 组合根；Express、地图、Socket.IO、所有 manager/handler 的创建与注入 | 依赖整个服务端 |
| `packages/server/src/config.ts` | 环境变量解析为 ServerConfig | 被 bootstrap/app |
| `packages/server/src/utils/logger.ts` | 分级日志 | 全服务端 |
| `packages/server/src/transport/SocketManager.ts` | Socket 类型、连接、login/ping、限流、玩家绑定、房间广播和世界事件转发 | app 创建；持有 world/io |
| `packages/server/src/transport/handlers.ts` | HandlerRegistry，按 socket 注册业务 handlers、统一错误处理 | app 创建；连接时调用 |

### 世界、周期与存储

| 路径 | 职责 |
|---|---|
| `src/world/GameWorld.ts` | 地图、时代和玩家世界容器，发出世界事件 |
| `src/world/PlayerManager.ts` | 玩家增删改查、连接绑定、冻结/恢复 |
| `src/world/DayNightCycle.ts` | 昼夜计时、广播、税收和交通周期联动 |
| `src/world/TimeZoneManager.ts` | 地图时区、本地时间与昼夜判定 |
| `src/world/ProsperityManager.ts` | 区域繁荣度更新与广播 |
| `src/storage/PlayerStore.ts`、`InMemoryPlayerStore.ts`、`MongoPlayerStore.ts` | 玩家持久化接口及内存/Mongo 实现 |
| `src/storage/EraStore.ts`、`InMemoryEraStore.ts` | 时代存储接口及内存实现 |
| `src/era/EraManager.ts` | 时代初始化、结算、切换、纪念碑铭记 |

### 业务模块

| 路径 | 职责 |
|---|---|
| `src/handlers/diceHandler.ts` | 服务端掷骰与冷却 |
| `src/handlers/movementHandler.ts` | 权威路径、岔路选择、最终落点结算 |
| `src/handlers/jailHandler.ts` | 监狱规则 |
| `src/handlers/investmentHandler.ts` | 投资购买、持股与事件收益 |
| `src/handlers/transportHandler.ts` | 交通目的地与传送 |
| `src/handlers/monumentHandler.ts` | 纪念碑状态与修缮 |
| `src/events/EventHandler.ts`、`EventRegistry.ts`、`EventEffects.ts`、`eventTemplates.ts` | 事件注册、模板和效果 |
| `src/behavior/BehaviorEngine.ts` | 加载 `config/behaviors/*.json` 并权威执行行为 |
| `src/team/TeamManager.ts`、`src/handlers/teamHandler.ts` | 队伍纯数据与 Socket 协议 |
| `src/chat/ChatManager.ts` | 聊天消息与频道状态 |
| `src/notifications/NotificationManager.ts` | 通知管理能力；接线以具体 handler 为准 |
| `src/handlers/debugHandler.ts` | debug flags 开启时的调试请求 |

### 数据文件

| 路径 | 职责 |
|---|---|
| `packages/server/map.json` | 服务端启动读取的棋盘数据 |
| `packages/server/map-meta.json` | 区域、时区、动态数值字段和地图配置 |
| `packages/server/config/behaviors/*.json` | 行为引擎脚本 |

## client

### 页面与连接

| 路径 | 职责 |
|---|---|
| `packages/client/src/main.ts` | bootstrap、语言设置、GameController、页面切换 |
| `src/game/GameController.ts` | start/login/loading/game 状态机和 socket 引用 |
| `src/pages/LoadingPage.ts` | 创建唯一 Socket、连接、login、把结果交给 controller |
| `src/pages/GamePage.ts` | 游戏页组合根；初始化地图、Store、HUD、渲染器和事件订阅 |
| `src/pages/StartPage.ts`、`LoginPage.ts`、`LoadingPage.ts`、`GamePage.ts` | 页面工厂与清理 |
| `src/hooks/useSocket.ts` | typed socket 创建、连接等待和心跳 |

### 状态、事件与渲染

| 路径 | 职责 |
|---|---|
| `src/game/systems/SocketEventHandler.ts` | 唯一 server.* 订阅入口，写 GameStore 并触发 UI/动画刷新 |
| `src/state/GameStore.ts` | 模块级玩家、移动、区域、队伍、昼夜和 UI 状态 |
| `src/game/GameViewModel.ts` | GameHudShell 的状态切片与订阅通知 |
| `src/game/ClientHudBridge.ts` | 统一 HUD 刷新回调 |
| `src/components/GameHudShell.ts` | HUD 组合入口，消费 ViewModel |
| `src/components/InteractiveMapSurface.ts` | 实际可见的 SVG 地图层；负责地图节点渲染、棋子 transform、移动锁与视野 viewBox 跟随 |
| `src/game/systems/MapLoader.ts` | 请求 `/api/map`、标准化地图、计算本地昼夜 |
| `src/game/systems/MovementSystem.ts` | 服务端移动路径/单步插值，供 GamePage 的 RAF 循环驱动棋子移动动画与岔路选择界面 |
| `src/game/systems/ChatSystem.ts`、`TeamSystem.ts`、`TutorialSystem.ts`、`GameLogic.ts` | 对应请求/投影/引导逻辑 |

`packages/client/public/config/behaviors/` 是客户端可读行为副本。旧 HUD、部分 hooks 和历史文档引用的文件若不在上述当前树中，不得补写为现行文件。`ai-bot` 与 `ai_bot_try` 不在本次运行时文件地图和清理边界内。

## 验证入口

根脚本实际提供 `npm run lint` 与 `npm run test`，以及三包 build；包级脚本见各包 `package.json`。架构变更应优先验证 shared，再验证 server/client 构建与 lint/test。
