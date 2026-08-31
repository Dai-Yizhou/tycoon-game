# 大富翁.io

> 当前运行时由 `packages/shared`、`packages/server`、`packages/client` 三包组成。服务端持有游戏世界和经济权威，客户端通过单一 Socket.IO 连接发送 `client.*` 请求并消费 `server.*` 状态事件。

## 当前功能

- 数据驱动地图：服务端读取 `map.json`、`map-meta.json`，客户端通过 `/api/map` 投影并渲染。
- 客户端使用原生 TypeScript/DOM、Vite，地图渲染层为 `InteractiveMapSurface` 生成的 SVG（单层，非 Canvas）。
- 页面链为 Start → Login → Loading → Game → Bankruptcy。
- shared 提供前后端共享类型、Socket 事件契约、地图解析、i18n、UCT/经济规则与调试开关。

### 已实现的玩法与系统

前端（`packages/client`）：

- 掷骰与后摇冷却（服务端权威 `cooldownEndsAt`）；基础移动动画由 `requestAnimationFrame` 驱动，移动锁防止动画期间重建 SVG，视野跟随插值坐标避免瞬移。
- 岔路/路径选择（`server.askPath`）与落点结算。
- 地产购买、升级、租金结算；投资购买/合租；交通枢纽传送；纪念碑修缮。
- 破产流程（进入 BankruptcyPage，`bankruptRestart` 重开）。
- 组队：邀请弹窗、接受/拒绝、队伍成员视图、离队。
- 聊天多频道（global/team/region/system + 斜杠指令 `/invite /accept /reject /leave /report`）与频道筛选。
- HUD 四象限：左上玩家名牌与数值条、右上区域状态与实时榜单与昼夜指示、左下聊天气泡、底部行动栏（掷骰 + 上下文动作）。
- 设置面板（仅 Beta 的视效开关）、成就面板（本地化文案 + 打开时实时刷新）、格子悬浮卡（按格子能力显示价格/租金/升级/等级/持有者/时区）。
- i18n（zh-CN / en-US，`localizedText`）、区域主题与昼夜时区显示。

后端（`packages/server`）：

- 账号：游客/正式/登录、JWT、游客转正（不改变用户 ID）、Mongo / 文件用户存储。
- GameWorld 权威状态与持久化（Mongo / 文件，快照恢复）。
- 经济：计税（底税/持股税 + 豁免阈值 + 定时器）、破产清算、所有权/持股管理。
- 昼夜循环（DayNightCycle）、时区（TimeZoneManager）、昼夜驱动的区域 UCT 数值变化（DayNightValueChange）。
- 行为事件引擎（BehaviorEngine，供供给格/事件格落地行为）。
- 区域繁荣度：由 `regionValues` / 数值字段定义动态驱动，无硬编码字段。
- 成就系统（六类触发：visitCells / completeEvents / uctThreshold / ownedCells / purchasedCells / ranking；Mongo / 文件存储；owner 级并发串行化；解锁通知经 Socket 下发）。
- 实时榜单（LeaderboardManager，区域数值与玩家更新标记脏、正式刷新后广播）。
- 反馈 `/report`（清洗、限长、限频、结构化日志）。
- 状态语义：Normal 与 Frozen 参与经济，Jail 与 Bankrupt 不参与；Frozen 仅连接状态，不豁免经济结算。

当前运行时不包含 item、talent 两个系统（未实现）。

## 技术栈与命令

Node.js >=18、TypeScript、Vite、Express、Socket.IO、可选 MongoDB、Jest、pnpm workspace。

```bash
pnpm install
pnpm dev:server
pnpm dev:client
pnpm build:shared
pnpm build:server
pnpm build:client
pnpm lint
pnpm test
```

根 `pnpm dev` 通过 `scripts/dev-services.mjs` 并行启动 server/client。服务端默认 3000，客户端 Vite 默认 5173。

## 目录

```text
packages/shared/  共享类型、地图解析、i18n、debug
packages/server/  Express、Socket.IO、GameWorld、业务管理器与 handlers
packages/client/  页面、Socket 投影、GameStore、ViewModel、HUD、Canvas
docs/architecture/ 当前运行时架构、API、文件地图
docs/guides/      开发与内容编辑指南
docs/player/      玩家操作指南
```

详细内容见 [架构](docs/architecture/ARCHITECTURE.md)、[API](docs/architecture/API.md)、[文件地图](docs/architecture/FILE_MAP.md) 和 [开发者指南](docs/guides/DEVELOPER.md)。规格与历史交接文档保留历史语义，阅读时以架构文档和源码为运行时依据。

离线与经济状态规则：Frozen 仅为连接状态；离线不能主动操作，队伍不解散，地产和投资继续参与收租、计税、投资收益和破产检查。Bankrupt 清算全部经济资产并保留 teamId；只有显式 `bankruptRestart` 才按地图初始值重开。

地图经济参数入口为 `packages/server/map-meta.json` 的 `config.taxConfig`；税率使用小数比例，必须同时填写三个税率、两个免税阈值和 `taxInterval`。编辑器入口及字段约束见 `config_editors/map_editor_v01.01/instruction.txt`。
