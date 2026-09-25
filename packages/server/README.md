# @game/server

Node.js + Express + Socket.IO 服务端。`src/index.ts:bootstrap()` 调用 `src/app.ts:createApp()`，后者是创建 GameWorld、SocketManager、经济系统、HandlerRegistry、周期管理器、行为引擎、时代管理器和存储的组合根；随后才由 `startHttpServer()` 监听端口。

## 当前目录

| 路径 | 职责 |
|---|---|
| `src/world/` | GameWorld、PlayerManager、昼夜（DayNightCycle / DayNightValueChange）、时区（TimeZoneManager） |
| `src/handlers/` | 掷骰、移动、地产、监狱、投资、交通、纪念碑、组队处理器 |
| `src/economy/` | 计税、破产清算、持股/合租模型与经济操作守卫、EconomyService 数值中枢 |
| `src/events/`、`src/behavior/` | 事件格分发；从地图同级 `behaviors/*.json` 执行格子行为 |
| `src/transport/` | SocketManager 与 HandlerRegistry |
| `src/net/` | `valuePublisher`（数值变更唯一发射点，按域广播绝对值）与 `systemChat` |
| `src/auth/` | 游客/正式账号、JWT、游客转正与鉴权路由 |
| `src/state/` | 世界运行时状态聚合与存储 |
| `src/storage/` | WorldStore / UserStore 及 Mongo / 文件 / 内存实现（玩家状态统一经世界快照持久化） |
| `src/team/`、`src/chat/` | 队伍、聊天模块 |
| `src/achievement/` | 成就配置加载、管理器与存储（Mongo/文件/内存） |
| `src/ranking/` | LeaderboardManager 榜单脏标记与正式刷新广播 |
| `map.json`、`map-meta.json`、`behaviors/` | 棋盘、地图元数据与行为配置 |

Socket 注册点是 `app.ts` 的 `io.on('connection')`：先注册 SocketManager 核心连接处理，再调用 HandlerRegistry 注册业务 handler。协议定义在 `@game/shared`。

## REST 与环境变量

- `GET /`：服务信息；`GET /health`：健康检查；`GET /api/map`：地图、区域和动态字段定义。
- `PORT`、`HOST`、`CORS_ORIGIN`、`MAP_PATH`、`MAP_META_PATH`、`MONGO_URI`、`MAX_PLAYERS`、`DEBUG` 等由 `src/config.ts` 解析；实际默认值以源码为准。
- 账号与局内进度都需要跨进程保持（重启后继续使用）。启动脚本（`scripts/dev-services.mjs`）强制注入 `MONGO_URI`，用户与世界快照均落在 Mongo，文件/内存实现已弃用。

### 存档与跨进程恢复

局内进度（玩家、队伍、格子运行时状态、时代、税收与监狱记录）以世界快照持久化到 Mongo `world_snapshots` 集合，键为 `WORLD_ID` + `WORLD_NAMESPACE`。

```bash
# 指定存档：继续上次进度（同名 WORLD_ID 即可读回）
WORLD_ID=beta pnpm dev

# 不指定：每次启动生成临时存档（temp_*），到期由 TTL 索引清理；适合调试用新档
pnpm dev
```

同一存档再次启动时，`app.ts` 在 `loadMap` 之后调用 `world.restoreSnapshot()` 覆盖玩家与运行时状态。跨进程恢复链路由 `tests/storage/MongoWorldStore.test.ts` 覆盖。

当前运行时不包含 item、talent 两个系统；成就系统已实现（见 `src/achievement/`）。误差残留的"三系统均未实现"表述以服务端实际注册链为准。

## 命令

```bash
pnpm --filter @game/server dev
pnpm --filter @game/server build
pnpm --filter @game/server lint
pnpm --filter @game/server test
```

参见 [架构](../../docs/architecture/ARCHITECTURE.md)、[API](../../docs/architecture/API.md) 和 [文件地图](../../docs/architecture/FILE_MAP.md)。
