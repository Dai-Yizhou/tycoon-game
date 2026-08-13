# 开发者文档

> 开发边界：只维护 `packages/shared`、`packages/server`、`packages/client` 三包；没有 admin 包。客户端只有一个 Socket 连接和一个服务端事件入口，银行与其他关键数值由服务端权威计算。

## 快速上手

### 环境要求

- Node.js 18+
- pnpm 9+

### 克隆并安装

```bash
git clone <repo-url>
cd monopoly-io-game
pnpm install
```

### 启动开发服务器

```bash
# 启动游戏服务端（默认 http://localhost:3000）
pnpm dev:server

# 启动游戏客户端（默认 http://localhost:5173）
pnpm dev:client
```

### 运行 AI 玩家进行测试

```bash
cd ai-bot
npm install
npm run build

# 启动 3 个 AI 玩家 + 控制面板
npm start -- --count 3 --dashboard \
  --log-dir /Volumes/T7_APFS/monopoly-io-game/ai-bot/logs
```

控制面板地址：`http://localhost:4040`

### T7_APFS 关键目录

| 路径 | 说明 |
|---|---|
| `/Volumes/T7_APFS/monopoly-io-game/` | 项目根目录 |
| `/Volumes/T7_APFS/monopoly-io-game/ai-bot/logs` | AI Bot 日志默认目录 |
| `/Volumes/T7_APFS/monopoly-io-game/ai-bot/screenshots` | 浏览器 AI 玩家截图目录 |

面向协作开发者的技术参考。

## 技术栈

| 类别 | 选型 | 版本 |
|---|---|---|
| 语言 | TypeScript | ^5.4 |
| 运行时 | Node.js | >=18 |
| 前端构建 | Vite | ^5.2 |
| 后端框架 | Express + Socket.IO | ^4.19 / ^4.7 |
| 包管理 | pnpm workspaces | ^9 |
| 测试 | Jest + ts-jest | ^29 |

## 包结构

```
packages/
├── shared/   (@game/shared)  共享类型、调试开关、地图解析
├── server/   (@game/server)  Express + Socket.IO 服务端
├── client/   (@game/client)  Vite + Canvas 渲染客户端
```

### @game/shared

- 不依赖其他 game 包
- 导出类型定义：`Cell`, `MapData`, `TalentDefinition`, `AchievementDefinition`, `ServerConfig`
- 导出工具函数：`getExtra()`, `parseMapData()`, `isFeatureEnabled()`
- 调试开关系统：`DEBUG_FLAGS` 环境变量控制

### @game/server

- 入口：`src/index.ts` -> `src/app.ts`
- 提供 HTTP API (`/api/map`) 和 WebSocket 实时通信
- 地图数据：`server/map.json`（棋盘格子数据）、`server/map-meta.json`（地图元数据）
- 配置目录：`server/config/`（天赋/成就/格子行为脚本）
- 配置通过 `packages/server/src/config.ts` 的 `loadConfig()` 加载

### @game/client

- 入口：`src/main.ts` -> `src/router.ts` -> `src/pages/GamePage.ts`
- Canvas 渲染：`src/renderer/BoardRenderer.ts`（主渲染器）
- 子渲染器：`CellRenderer.ts`, `ConnectionRenderer.ts`, `PlayerRenderer.ts`
- 加载配置：`/config/talents.json`, `/config/achievements.json`（从 `public/config/` serve）
- 单一连接：`hooks/useSocket.ts` 创建，`GamePage` 持有，`SocketEventHandler` 集中监听并在销毁时注销
- 新 HUD：`components/GameHudShell.ts` 消费 `GameViewModel`，展示玩家数值、昼夜、聊天、行动栏和道具

## 关键文件

| 文件 | 职责 |
|---|---|
| `packages/client/src/pages/GamePage.ts` | 游戏主页面逻辑（3600+行，含UI构建、游戏状态、天赋/成就、聊天、相机、行为事件） |
| `packages/client/src/renderer/BoardRenderer.ts` | Canvas 渲染入口，管理 Camera 和子渲染器 |
| `packages/client/src/renderer/CellRenderer.ts` | 单个格子渲染（填充色、边框、图标、时区标签） |
| `packages/shared/src/types/cell.ts` | Cell 类型定义和 `getExtra()` 辅助函数 |
| `packages/shared/src/types/map-meta.ts` | MapMeta / TimeZone / Region / ValueField 类型定义及 `buildPlayerValues()` |
| `packages/shared/src/map/map-parser.ts` | 地图数据解析（`parseMapData()` / `buildCell()`） |
| `packages/server/src/config.ts` | 服务端配置加载（环境变量驱动） |
| `packages/server/src/behavior/BehaviorEngine.ts` | 格子行为执行引擎（加载 behaviors/*.json、按权重选事件、应用效果） |
| `packages/server/map.json` | 棋盘格子数据（40格示例地图） |
| `packages/server/map-meta.json` | 地图元数据（时区/区域/数值字段定义/自定义配置） |
| `packages/server/config/behaviors/*.json` | 格子行为脚本（10个文件，每个含 events 数组） |

## 单一 Socket 入口与新 HUD

`LoadingPage` 创建 Socket 并完成登录，`GamePage` 复用该连接，不在页面或子系统创建第二条连接。所有服务端推送在 `SocketEventHandler` 注册，重复注册会被忽略；离开游戏页必须调用注销函数。`GameHudShell` 不直接依赖 Socket 或 Store，只消费 ViewModel，通过 `ClientHudBridge` 接收状态刷新。

客户端操作必须遵循：按钮或系统发出 `client.*` → 服务端校验和执行业务 → `server.*`/ack 返回 → GameStore 与 ViewModel 更新 → HUD 刷新。不得在客户端请求成功前修改金钱、信用、位置或破产状态。

## 配置直接编辑

配置文件是运行时事实来源，不需要 admin 工具：

| 内容 | 直接编辑路径 | 生效方式 |
|---|---|---|
| 地图 | `packages/server/map.json`、`packages/server/map-meta.json` | 重启服务端 |
| 天赋/成就/行为 | `packages/server/config/` | 重启服务端 |
| 客户端配置副本 | `packages/client/public/config/` | 重新启动或构建客户端 |

修改服务端与客户端同名配置时保持内容同步，先验证 JSON，再运行三包 build。`src/config.ts` 只负责环境变量和路径解析；不要新增运行时管理页面来替代文件编辑。

## 数据流

```
map.json (格子数据)        map-meta.json (元数据)
    │                          │
    ├─> parseMapData()         └─> parseMapMeta()
    │     (格子数组)                 (regions / valueFieldDefinitions / timezones)
    │                          │
    └──────────┬───────────────┘
               │
        HTTP /api/map  ->  { mapData, regions, valueFieldDefinitions }
               │
    客户端 loadMapData() <──┘
              │
              └──> normalizeClientMapData()
                        │
                        └──> MapIndex + BoardRenderer
                        └──> 根据 valueFieldDefinitions 动态渲染 HUD/详情面板
```

`/api/map` 返回 `{ mapData, regions, valueFieldDefinitions }` 三段数据：`mapData` 为格子数组，`regions` 为区域配置，`valueFieldDefinitions` 为数值字段定义。客户端 `normalizeClientMapData()` 将所有非内置字段（id/x/y/destinations 除外）收拢到 `cell.extra` 对象中，因此 `getExtra(cell, 'name')` 实际读取的是 `cell.extra['name']`。

## 时区系统

- 时区由 `map-meta.json` 的 `timezones` 数组配置，支持任意数量时区
- 每个时区含 `offsetMinutes`（相对 UTC 的分钟级偏移，可为负）和 `cellIds`（所属格子列表）
- 支持父子层级结构：子时区通过 `parentId` 指向父时区，可继承父时区偏移但有更细的边界定义
- 当前示例地图配置了 10 个时区（中央/东部/西部/南部，并含若干子时区）
- 玩家所在时区的本地昼夜由 `getLocalDayNight(timezone)` 计算
- 晕影效果在 `drawTimezoneVignette()` 中绘制，使用玩家本地昼夜

## 配置系统

### 棋盘格子数据 (`packages/server/map.json`)

格子数组，每个格子含内置字段（`id`/`x`/`y`/`destinations`）和模板驱动的扩展字段（统一存入 `cell.extra`）：

- `name`: 显示名称
- `type`: 格子类型（`property`/`event`/`transport`/`monument`/`start`/`jail`/`investment`/`empty`）
- `price`: 购买价格
- `rent`: 租金（多级数组）
- `description`: 描述（字符串或字符串数组）
- `extra`: 扩展数据
- `behavior`: 关联的行为文件名（对应 `behaviors/*.json`，见格子行为系统）
- `icon`: 图标文件名
- `level`: 等级
- `upgradeCost`: 升级费用数组
- `owners`: 持有者 ID 列表
- `isMortgaged`: 是否抵押
- `mortgagePrice`: 抵押价格

### 地图元数据 (`packages/server/map-meta.json`)

地图的配置信息，与格子位置/连接信息分离。包含：

- `timezones`: 时区数组（见时区系统）
- `regions`: 区域数组（`id`/`name`/`cellIds`/`prosperity`/`environmentValue`/`color`）
- `valueFieldDefinitions`: 数值字段定义（见动态数值字段系统）
- `config`: 自定义配置块，承载地图特有扩展配置：
  - `era`: 初始时代（如 `古典时代`）
  - `startBonus`: 起点奖励金额
  - `passBonus`: 经过起点奖励
  - `taxRate`: 税率配置（`property`/`money`/`investment`）
  - `diceCooldownSeconds`: 掷骰冷却秒数
  - `jailCooldownSeconds`: 监狱冷却秒数
  - `jailDurationTurns`: 监狱关押回合数

### 动态数值字段系统

`valueFieldDefinitions` 定义地图可用的数值字段，每个字段为 `ValueField` 结构：

- `id`: 字段唯一标识（如 `money`/`credit`/`environmental`）
- `name`: 显示名
- `current`: 初始值
- `min` / `max`: 可选边界
- `scope`: 字段作用域，`'player'` 或 `'region'`
  - `scope: 'player'` 的字段写入 `player.values`，由 `buildPlayerValues(meta)` 初始化（仅 player scope 字段被写入）
  - `scope: 'region'` 的字段绑定到区域（如环保值、繁荣度），由 Region / ProsperityManager 管理，不写入玩家 values

客户端根据 `valueFieldDefinitions` 动态渲染 HUD 和详情面板，**不硬编码字段列表**。不同时代/棋盘可定义不同数目、不同 scope 的数值字段，引擎与客户端均按定义动态适配。

### 天赋配置 (`packages/server/config/talents.json`)

共 10 个天赋，分 3 个分支（`economy` / `social` / `exploration`）：

```json
[
  {
    "id": "credit",
    "name": "信用系统",
    "description": "启用信用值数值",
    "rarity": "common",
    "cost": 1,
    "requires": "bank",
    "branch": "economy"
  }
]
```

字段说明：
- `id`: 唯一标识
- `name`: 显示名称
- `description`: 悬停说明
- `rarity`: `common` / `uncommon` / `rare` / `epic` / `legendary`
- `cost`: 天赋点消耗
- `requires`: 前置天赋 id（可选）
- `branch`: `economy` / `social` / `exploration`

### 成就配置 (`packages/server/config/achievements.json`)

共 15 个成就，分 6 个分类（`wealth` / `property` / `investment` / `monument` / `special` / `survival`）：

```json
[
  {
    "id": "first_move",
    "name": "初次移动",
    "description": "第一次掷骰移动",
    "rarity": "common",
    "goal": 1,
    "tpReward": 1,
    "category": "special"
  }
]
```

字段说明：
- `id`, `name`, `description`, `rarity`: 同天赋
- `goal`: 目标值
- `tpReward`: 完成奖励的天赋点
- `category`: `wealth` / `property` / `investment` / `monument` / `special` / `survival`

### 格子行为系统 (`packages/server/config/behaviors/*.json`)

格子的 `behavior` 字段关联 `behaviors/` 目录下的 JSON 文件（如 `behavior: "event_city_center"` 对应 `behaviors/event_city_center.json`），共 10 个行为脚本。每个文件含 `events` 数组，事件支持以下字段：

- `msg`: 事件消息（展示给玩家）
- `money` / `credit` / `env`: 对应数值变化
- `item`: 获得道具 ID（如 `seal`、`revive`）
- `weight`: 权重（默认 1，值越大被选中概率越高）
- `good`: 是否为好事件（影响信用值加成）
- `creditModifier`: 信用值对概率的影响系数（正值：信用越高概率越高；负值：越低）
- `target`: 效果目标，`'player'`（默认，仅影响触发玩家）或 `'region'`（影响所在区域所有玩家）

`BehaviorEngine` 懒加载并缓存行为配置，玩家踩中格子时按权重随机选择事件，服务端权威执行效果后通过 socket 广播 `server.valueChanged`。

### 环境变量配置

服务端通过 `loadConfig()` 从环境变量加载配置（`packages/server/src/config.ts`）：

| 变量 | 说明 |
|---|---|
| `PORT` | 服务端口 |
| `HOST` | 监听地址 |
| `CORS_ORIGIN` | CORS 允许来源 |
| `DAY_NIGHT_CYCLE_MINUTES` | 昼夜周期（分钟） |
| `ERA_LENGTH_DAYS` | 时代长度（天） |
| `MAP_PATH` | 格子数据路径（`map.json`） |
| `MAP_META_PATH` | 地图元数据路径（`map-meta.json`） |
| `MONGO_URI` | MongoDB 连接 URI（可选） |
| `MAX_PLAYERS` | 最大玩家数 |

客户端通过 `loadTalentConfig()` 和 `loadAchievementConfig()` 异步加载天赋/成就配置，加载失败时回退到内置数据。

## 玩家数据持久化

- 使用 `localStorage`，key 格式：`monopoly_player_{玩家名}_progress`
- 保存内容：激活天赋、可用天赋点、天赋锁定状态、成就进度、累计赚取金钱
- 保存时机：天赋激活、成就完成、赚取金钱时自动保存
- 加载时机：游戏初始化时（在配置加载完成后）

## 调试

```bash
# 启用全部调试功能
DEBUG_FLAGS=* pnpm dev:client

# 仅启用经济和教程调试
DEBUG_FLAGS=cheat-economy,tutorial pnpm dev:client
```

支持的标志见 `README.md`。

## AI 玩家 (ai-bot) 开发指南

### 快速启动

```bash
cd ai-bot
npm install
npm run build

# 启动 3 个 AI 玩家 + 控制面板
npm start -- --count 3 --dashboard --log-dir /Volumes/T7_APFS/monopoly-io-game/ai-bot/logs
```

控制面板默认地址：`http://localhost:4040`

### 启用 LLM 决策

```bash
# 使用 Ollama 本地模型
npm start -- --count 1 --dashboard --llm --llm-type ollama --llm-model qwen2.5:0.5b

# 使用 Groq 等 OpenAI 兼容 API
npm start -- --count 1 --dashboard --llm --llm-type openai-compatible \
  --llm-url https://api.groq.com/openai/v1 \
  --llm-apikey YOUR_API_KEY \
  --llm-model llama-3.1-8b-instant
```

### 常用 CLI 参数

| 参数 | 说明 | 默认值 |
|---|---|---|
| `--server <url>` | 游戏服务端地址 | `http://localhost:3000` |
| `--count <n>` | AI 玩家数量 | `1` |
| `--prefix <name>` | 用户名前缀 | `AI_Bot` |
| `--interval <ms>` | 决策间隔 | `2000` |
| `--log-dir <path>` | 日志目录 | `./logs` |
| `--dashboard` | 启用控制面板 | - |
| `--dashboard-port <n>` | 控制面板端口 | `4040` |
| `--llm` | 启用 LLM 决策 | - |
| `--evaluate` | 启用评价引擎 | - |
| `--screenshot` | 启用截图服务 | - |

### 自定义 AI 性格与策略

在控制面板的"LLM 决策配置"区域，可设置：

- **性格设定**：如"谨慎保守，优先保证资金安全"、"激进冒险，积极购买地产"
- **策略偏好**：如"优先升级地产"、"喜欢组队合作"、"偏好投资项目"

也可通过代码自定义，见 `ai-bot/src/LLMDecisionEngine.ts`。

### Bug 检测

AI Bot 内置 BugDetector，自动检测以下异常：

- 掷骰请求超时/无响应
- 操作发送后无确认
- 玩家资金变为负数
- 满级地产仍尝试升级
- 重复加入同一队伍
- 状态不一致（服务端与本地状态不匹配）

Bug 日志标记为 `bug` 级别，在控制面板中以红色高亮显示。

### 评价引擎

启用 `--evaluate` 后，AI Bot 会定时生成多维度评价报告：

- **游戏性 (gameplay)**：操作流畅度、交互响应
- **经济性 (economy)**：经济系统平衡、收支曲线
- **视觉 (visuals)**：界面美观度、信息展示
- **Bug 情况 (bugs)**：bug 数量与严重程度
- **平衡性 (balance)**：玩家间差距、成长曲线
- **UI (ui)**：界面易用性、信息层级

支持 LLM 增强评价，生成更详细的文字分析。

### 日志导出

在控制面板点击"导出 JSON"或"导出文本"按钮，可导出过滤后的日志。

日志文件也会自动保存到 `--log-dir` 指定目录，每个 Bot 一个文件。

## 编译检查

```bash
pnpm build:shared
pnpm build:server
pnpm build:client
pnpm --filter @game/shared test
pnpm --filter @game/server test
pnpm --filter @game/client test
pnpm lint
```
