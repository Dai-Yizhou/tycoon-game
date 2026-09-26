# 内容创作者指南

> 本文只描述当前运行时真正加载的内容与加载方式。修改前请先确认路径存在于[文件地图](../architecture/FILE_MAP.md)。运行时可观察到的玩家行为见[玩家手册](../player/PLAYER.md)。

## 一页概览

可编辑内容分四类：棋盘 `map.json`、地图元数据 `map-meta.json`、行为脚本 `behaviors/*.json`、成就定义 `achievements.json`。全部为 JSON，改动后需重启服务端并跑 lint/test 校验。地图编辑器与客户端 behaviors 静态副本**已不存在**于当前仓库。

## 生效链

```text
map.json / map-meta.json / achievements.json / behaviors/*.json
  -> server/app.ts 启动解析（parseMapData / validateMapMeta / value modifier lint / 成就校验）
  -> GameWorld / BehaviorEngine / AchievementManager
  -> server.* 事件 -> client SocketEventHandler -> GameStore / HUD / InteractiveMapSurface
```

服务端是唯一权威；客户端按 `/api/map` 返回的 `valueFieldDefinitions` 投影，不要假设固定字段集合。行为与数值调节由服务端结算，客户端只展示结果。

## 可编辑文件

| 文件 | 作用 |
|---|---|
| `packages/server/map.json` | 棋盘格子与有向边、按类型的数值字段、行为引用、区域/时区归属 |
| `packages/server/map-meta.json` | 数值字段定义、UCT 声明、初始值、区域、昼夜、骰子、榜单、税收、可选 valueModifiers |
| `packages/server/behaviors/*.json` | 行为引擎脚本；由格子 `behaviorPass` / `behaviorLand` 与 `investmentTriggers` 引用 |
| `packages/server/achievements.json` | 成就定义 |

注意：当前**没有**客户端 behaviors 静态副本，也**没有** `config_editors/` 编辑器目录；旧文档中的这些路径已失效。

## map.json

顶层是数组，每项一个格子。通用字段：

| 字段 | 说明 |
|---|---|
| `id` | 格子 ID（整数、唯一） |
| `x` / `y` | 画布坐标 |
| `type` | `empty` / `supply` / `event` / `property` / `investment` / `jail` / `transport` / `monument` |
| `name` / `description` | 双语 `{ "zh-CN": ..., "en-US": ... }` |
| `destinations` | 有向边目标格子 ID 数组（决定移动路径与岔路） |
| `regionId` | 所属区域 ID（须在 `map-meta.regions` 中声明） |
| `theme` | 客户端视觉主题标识 |
| `timezone` | 该格时区偏移（分钟；如 480 = UTC+8，0 = UTC，-480 = UTC-8） |
| `behaviorPass` | 经过该格时执行的行为 id（可选） |
| `behaviorLand` | 落在该格时执行的行为 id（可选） |

按类型的数值字段（均为 UCT 束）：

| 类型 | 字段 |
|---|---|
| property | `price`、`rent[]`、`upgradeCost[]`、`maxLevel`、`maxOwnerCount` |
| investment | `price`、`maxOwnerCount`、`investmentTriggers[]`（`{ id, on, delta }`） |
| transport | `teleportDestinations[]`（`{ cellid, cost }`） |
| jail | `jailCooldown`（number，毫秒）、`jailCost`、`jailDurationTurns` |
| monument | `repairCost` |

`rent[]`/`upgradeCost[]` 按 level 索引；`price`/`rent`/`cost`/`delta`/`repairCost` 等为 UCT 束，负值表示扣减。`investmentTriggers[].on` 为域事件名（默认地图用 `any-player-lands-event`、`shareholder-bankrupt`）。

## map-meta.json

| 字段 | 说明 |
|---|---|
| `id` / `version` / `name` | 地图标识与双语名 |
| `valueFieldDefinitions[]` | 数值字段：`{ id, name, scope: player|region, min?, max? }` |
| `uct` | 声明哪些字段为 UCT：`{ player: [字段…], region: [字段…] }` |
| `playerInitial` | 玩家初始值：`{ player: { 字段: 值 } }` |
| `startCellId` | 起点格 ID |
| `regions[]` | 区域：`{ id, name, initial: { region: { 字段: 值 } } }` |
| `dayNightCycle` / `dayNightRatio` | 昼夜周期（小时）与白昼占比 |
| `dayNight` | 昼夜区域数值变化：`{ day: { region: {...} }, night: { region: {...} } }` |
| `dice` | `{ cooldownMs, min, max }` |
| `ranking` | `{ enabled, topN, refreshMs, score: { constant, player: {字段:权重}, region: {字段:权重} } }` |
| `tax` | 计税配置，见下 |
| `valueModifiers[]` | 可选；数值调节规则，见下 |

### 税收（`tax`）

- `baseTax.rates.player`：`{ 字段: 0–1 小数税率 }`，对每个已列字段计 `floor(当前值 × 税率)`；未列字段不征。
- `baseTax.exemptBelow.player`：`{ 字段: 阈值 }`，当前值低于阈值免征。
- `baseTax.taxInterval`：正数毫秒，固定墙钟周期（与昼夜循环无关）。
- `shareTax.rates.player`：`{ 字段: 每股税额 }`，税基为玩家在全部 property/investment 格的累计持股比例，`floor(总持股 × 每股税额)`。
- `shareTax.exemptBelow`：总持股低于该值免征股份税。
- `shareTax.taxInterval`：正数毫秒（同一周期内与基础税一并结算）。
- 字段缺失或非法会阻止服务端启动。

## 数值调节（`valueModifiers`，可选）

每条规则：`{ id?, scope: { cellType, base }, calc }`。

- `scope.cellType`：`empty`/`supply`/`event`/`property`/`investment`/`jail`/`transport`/`monument`。
- `scope.base`：可改写的 base 字段；`empty`/`supply`/`event` 无 base（改用行为）：
  - property：`price`、`rent`、`upgradeCost`
  - investment：`price`、`investmentTriggers.delta`
  - transport：`teleportDestinations.cost`
  - jail：`jailCooldown`、`jailCost`
  - monument：`repairCost`
- `calc`：
  - number 字段（如 `jailCooldown`）→ 单个表达式节点
  - UCT 字段 → `{ player?: { 字段: 节点 }, region?: { 字段: 节点 } }`，按子字段**覆盖合并**（未列子字段保留 base 原值，不置零）

### 表达式（AST）

统一前缀式节点：

- 常量：数字字面量
- 引用：`{ "$ref": "<path>" }`
- 运算：`{ "$op": "<op>", "args": [节点…] }`

运算符与元数：

| 运算 | 元数 |
|---|---|
| `$add` / `$sub` / `$mul` / `$min` / `$max` | ≥2 |
| `$div` | =2 |
| `$neg` / `$abs` / `$round` | =1 |
| `$clamp` | =3 |
| `$eq` / `$lt` / `$lte` / `$gt` / `$gte` | =2 |
| `$and` / `$or` | ≥2 |
| `$not` | =1 |
| `$if` | =3 |

### refs

| 路径 | 含义 |
|---|---|
| `base` / `base.<scope>.<字段>` | 目标字段自身的当前静态值（UCT 时须带 `player`/`region` 子字段） |
| `player.uct.<字段>` | 付款方玩家该字段值 |
| `team.uct.<字段>` | 团队该字段的算术均值 |
| `team.memberCount` | 团队成员数 |
| `region.uct.<字段>` | 目标格所在区域该字段值 |
| `region.time` | 目标格时区下的区域时刻（白昼 0 / 夜晚 1） |
| `curCell.level` | 目标格等级 |
| `curCell.ownerCount` | 目标格持股人数 |

### 约束

- 加载期 lint 校验：节点类型、`$ref` 是否存在于 stateSchema、类型对齐、数组字段按 level 可解析、`$op` 元数。
- 团队字段均值：`memberCount == 0` 或字段未声明一律 lint 拒绝。
- 求值顺序为 `base → modifier → behavior`；modifier 结果是对 base 的**覆盖**，behavior 为黑盒。
- 求值在结算时刻解析一次并固定；两端同构（`@game/shared` 的 `resolveField`）。数值单调性仅作提示、不强制校验。

## behaviors/*.json

结构：`{ id, effects: [{ weight, exclusive?, msg, ops: [...] }] }`。

- `weight`：数字或 `{ "$ref" }` 算术表达式。非 `exclusive` 且权重 ≥1 的效果全部执行；`exclusive` 的按权重随机择一。
- `msg`：双语 `{ zh-CN, en-US }`，发到受影响玩家聊天区。
- op 三类：
  - `value`：`{ type, target, delta: { player: {...}, region: {...} } }`
  - `ownership`：`{ type, target, action: acquireShare|loseShare, cells?: [{ cellId }], scope?: all|all-property|all-investment, share? }`
  - `position`：`{ type, target, action: moveTo|teleport, cellId }`
- `target` 四态 `single`/`team`/`region`/`globe`，或 `{ "$ref": "$actor"|"$target"|"$nearestPlayer"|"$randomShareholder" }`。
- 字段值可用受限算术表达式 `{ "$ref": "..." }`，白名单标识：`$actor.*`、`$target.*`、`$cell.*`、`$map.*`、`$region.<字段>`、`$nearestPlayer.*`、`$randomShareholder.*`；支持 `+ - * /`、括号、`min()`、`max()`。除数为 0、引用未知标识或路径均视为配置错误（快速失败）。
- 行为执行失败会回滚数值与运行时快照。

## achievements.json

顶层是数组，每项：

- `id`、双语 `name`/`description`、`scope`（`map`/`global`）、`category`（movement/economy/social/event/ranking）
- `progress`（可选）：`{ visible, target }`（`target` 为正整数）
- `trigger`：见下表

| `trigger.type` | 参数 | scope 限制 |
|---|---|---|
| `visitCells` | `cellIds[]` | 必须 `map` |
| `completeEvents` | `cellIds[]`、`eventIds[]` | 必须 `map` |
| `uctThreshold` | `fieldId`、`target` | 任意 |
| `ownedCells` | `target` | 必须 `map` |
| `purchasedCells` | `target` | 任意 |
| `ranking` | `targetRank` | 任意 |

加载期校验：ID 非空且唯一、双语文案齐全、scope/category 合法、cellIds/target 合法。

## 删除边界

`item`、`talent` 不是当前内容系统；残留的同名配置、历史/规格文档不得继续编辑为运行时功能，也不要为其新增字段、加载器或 UI。银行（`Bank`）已删除。

## 检查

修改 JSON 后至少运行：

```bash
pnpm build:shared
pnpm build:server
pnpm build:client
pnpm lint
pnpm test
```

当前文件职责与真实加载位置见[文件地图](../architecture/FILE_MAP.md)。