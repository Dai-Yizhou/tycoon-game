# @game/server

大富翁.io 游戏服务端（Node.js + Express + Socket.IO）。

## 架构

```
src/
├── index.ts              # 入口：bootstrap()，加载配置、创建应用、注册信号
├── app.ts                # createApp() 工厂函数：Express + Socket.IO + 全部管理器
├── config.ts             # loadConfig()：从环境变量加载 ServerConfig
├── world/                # 游戏世界
│   ├── GameWorld.ts      #   游戏世界容器（玩家/地图/时代，发射事件）
│   ├── PlayerManager.ts  #   玩家生命周期（加入/离开/冻结）
│   ├── DayNightCycle.ts  #   昼夜循环（定时器 + 广播）
│   ├── TimeZoneManager.ts#   时区管理（本地时间计算）
│   └── ProsperityManager.ts # 区域繁荣度（夜晚降低/白天恢复）
├── economy/              # 经济系统
│   ├── Bank.ts           #   贷款/还款/利息
│   ├── Mortgage.ts       #   抵押/竞拍
│   ├── Taxation.ts       #   昼夜计税
│   └── Bankruptcy.ts     #   破产/清算/复活
├── handlers/             # 事件处理器
│   ├── diceHandler.ts    #   掷骰
│   ├── movementHandler.ts#   移动
│   ├── propertyHandler.ts#   地产（购买/升级/租金/合租）
│   ├── startHandler.ts   #   起点
│   ├── jailHandler.ts    #   监狱
│   ├── investmentHandler.ts # 投资项目
│   ├── transportHandler.ts  # 交通枢纽
│   ├── monumentHandler.ts   # 纪念碑
│   ├── itemHandler.ts    #   道具
│   ├── talentHandler.ts  #   天赋
│   ├── debugHandler.ts   #   调试（仅调试模式）
│   └── index.ts
├── events/               # 事件系统
│   ├── EventRegistry.ts  #   事件注册表（插件式）
│   ├── EventEffects.ts   #   效果处理器（player/all/region）
│   ├── EventHandler.ts   #   事件触发器
│   └── eventTemplates.ts #   12 个内置事件模板
├── items/                # 道具系统
│   ├── ItemRegistry.ts   #   道具注册表
│   ├── ItemEffects.ts    #   道具效果处理器
│   └── itemTemplates.ts  #   查封令/复活令
├── talents/              # 天赋系统
│   ├── TalentRegistry.ts #   天赋注册表
│   ├── TalentEffects.ts  #   天赋效果处理器
│   └── talentTemplates.ts#   17 个内置天赋
├── achievements/         # 成就系统
│   ├── AchievementManager.ts
│   └── achievementTemplates.ts # 18 个内置成就
├── behavior/             # 行为引擎
│   └── BehaviorEngine.ts #   从 JSON 加载并执行格子行为
├── era/                  # 时代管理
│   └── EraManager.ts     #   时代创建/结算/切换/纪念碑铭记
├── auth/                 # 认证
│   ├── AuthService.ts    #   注册/登录/游客/迁移
│   └── JWTService.ts     #   JWT 生成/验证
├── storage/              # 存储层
│   ├── PlayerStore.ts    #   玩家存储接口
│   ├── InMemoryPlayerStore.ts
│   ├── MongoPlayerStore.ts
│   ├── EraStore.ts       #   时代存储接口
│   └── InMemoryEraStore.ts
├── transport/            # 通信层
│   ├── SocketManager.ts  #   Socket.IO 管理（鉴权/限流/5层广播/登录处理）
│   └── handlers.ts       #   HandlerRegistry（集中注册事件处理器）
├── team/                 # 组队（已实现，待接入 socket 路由）
├── chat/                 # 聊天（已实现，handler 为占位）
├── notifications/        # 通知（已实现，待接入）
├── utils/
│   └── logger.ts
└── config/               # JSON 配置（非 src，位于包根）
    ├── talents.json
    ├── achievements.json
    └── behaviors/
```

## 启动流程

```bash
# 开发模式（热重载）
pnpm dev:server
# 或
pnpm --filter @game/server dev

# 生产模式
pnpm --filter @game/server build
node dist/index.js
```

入口 `src/index.ts` 的 `bootstrap()` 执行：
1. `loadConfig()` 从环境变量加载配置
2. `createApp(config)` 创建应用（Express + Socket.IO + 全部管理器）
3. `startHttpServer()` 监听端口
4. 注册 SIGINT/SIGTERM 优雅关闭

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `CORS_ORIGIN` | `*` | CORS 允许来源 |
| `DAY_NIGHT_CYCLE_MINUTES` | `15` | 昼夜周期（分钟） |
| `ERA_LENGTH_DAYS` | `90` | 时代长度（天） |
| `MAP_PATH` | `./map.json` | 地图文件路径 |
| `MAP_META_PATH` | `./map-meta.json` | 地图元数据路径 |
| `MONGO_URI` | （空） | MongoDB 连接字符串；不设则用内存存储 |
| `REDIS_URL` | （空） | Redis 连接（多实例水平扩展） |
| `MAX_PLAYERS` | `1000` | 最大玩家数 |
| `DEBUG` | `false` | 启用调试日志 |
| `SERVE_CLIENT` | （空） | 设为 `1` 时挂载 client/dist 静态资源 |
| `DEBUG_FLAGS` | （空） | 调试功能开关（逗号分隔，支持通配符） |

## REST API 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 服务信息（名称、版本、地图状态、调试标志） |
| GET | `/health` | 健康检查（状态、运行时间、玩家数、时代 ID） |
| GET | `/api/map` | 获取地图数据（从 `map.json` 加载） |

## Socket.IO

- 传输：`websocket`、`polling`
- 心跳：pingTimeout 30s、pingInterval 25s
- 限流：每连接 100 事件/10s
- 房间：`map:<mapId>`、`region:<mapId>:<regionId>`、`team:<teamId>`、`player:<playerId>`

详细 Socket 事件列表见 [docs/API.md](../../docs/API.md)。

## JSON 配置

服务端从 `config/` 目录加载：
- `talents.json` — 天赋定义
- `achievements.json` — 成就定义
- `behaviors/*.json` — 格子行为脚本

## 测试

```bash
pnpm --filter @game/server test
```

测试覆盖：掷骰、移动、地产、监狱、事件、投资、交通、纪念碑、天赋、成就、时代、认证、JWT、i18n 等。
