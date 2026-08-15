# @game/server

Node.js + Express + Socket.IO 服务端。`src/index.ts:bootstrap()` 调用 `src/app.ts:createApp()`，后者是创建 GameWorld、SocketManager、经济系统、HandlerRegistry、周期管理器、行为引擎、时代管理器和存储的组合根；随后才由 `startHttpServer()` 监听端口。

## 当前目录

| 路径 | 职责 |
|---|---|
| `src/world/` | GameWorld、PlayerManager、昼夜、时区、繁荣度 |
| `src/handlers/` | 掷骰、移动、地产、起点、监狱、投资、交通、纪念碑、组队和调试处理器 |
| `src/events/` | 事件注册、模板与效果 |
| `src/behavior/` | 从 `config/behaviors/*.json` 执行格子行为 |
| `src/transport/` | SocketManager 与 HandlerRegistry |
| `src/storage/` | PlayerStore、EraStore 及内存/Mongo 实现 |
| `src/team/`、`src/chat/`、`src/notifications/` | 队伍、聊天、通知模块 |
| `map.json`、`map-meta.json` | 棋盘和地图元数据 |

Socket 注册点是 `app.ts` 的 `io.on('connection')`：先注册 SocketManager 核心连接处理，再调用 HandlerRegistry 注册业务 handler。协议定义在 `@game/shared`。

## REST 与环境变量

- `GET /`：服务信息；`GET /health`：健康检查；`GET /api/map`：地图、区域和动态字段定义。
- `PORT`、`HOST`、`CORS_ORIGIN`、`MAP_PATH`、`MAP_META_PATH`、`MONGO_URI`、`MAX_PLAYERS`、`DEBUG` 等由 `src/config.ts` 解析；实际默认值以源码为准。

当前运行时不包含 item、talent、achievement 三个系统。残余同名 JSON、类型或历史文档不表示对应 handler/manager 已注册。

## 命令

```bash
pnpm --filter @game/server dev
pnpm --filter @game/server build
pnpm --filter @game/server lint
pnpm --filter @game/server test
```

参见 [架构](../../docs/architecture/ARCHITECTURE.md)、[API](../../docs/architecture/API.md) 和 [文件地图](../../docs/architecture/FILE_MAP.md)。
