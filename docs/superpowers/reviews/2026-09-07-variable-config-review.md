# 变量参与配置：现状只读审查与修复范围规划

> 状态：只读审查记录（未实现）。范围边界待用户确认后生成实施计划。
> 本次审查以「行为引擎变量能力、map.json 数值字段、实际调用链、生效/失效配置」为准。

## 1. 目标

用户目标：

- 全面允许变量参与配置，覆盖 map.json / behaviors 中的**所有数字字段**（UCT 数值、概率值等）。
- 变量**只读访问整个游戏世界状态**。
- 支持查询操作（如寻找最近玩家等聚合/定位查询）。

本文记录当前生效/失效部分、变量能力现状、与目标的差距，并给出分阶段修复范围。

## 2. 行为调用链核实（非死代码校验）

BehaviorEngine 的调用点（全部在服务端）：

| 触发路径 | 字段 | 位置 |
|---|---|---|
| 经过格（起点补给） | `cell.behaviorPass` | `transport/handlers.ts` |
| 事件格落地 | `cell.behaviorLand` | `events/EventHandler.ts.handleEventCell` |
| 地产购买后 | `cell.behaviorLand` | `handlers/propertyHandler.ts` |
| 投资购买后 | `cell.behaviorLand` | `handlers/investmentHandler.ts` |
| 修葺纪念碑后 | `cell.behaviorLand` | `handlers/monumentHandler.ts` |
| 入狱 | `cell.behaviorLand` | `handlers/jailHandler.ts` |
| 访问交通枢纽 | `cell.behaviorLand` | `handlers/transportHandler.ts` |

启动预加载与引用校验：

- `app.ts`：`validateBehaviorReferences` 校验 `behaviorPass` / `behaviorLand` 指向的 JSON 存在，并校验 `investmentTriggers[].on` 属于已知域事件。
- `app.ts`：启动时预加载 map.json 引用的所有行为配置。

投资触发器由 `InvestmentHandler.dispatchDomainEvent(domainEvent)` 驱动，事件落地成功后触发。

## 3. 行为配置生效 / 失效清单

`server/behaviors/*.json` 共 12 个。map.json 实际引用：

- `start-supply`（`behaviorPass`，格子 id=0）：**生效**。纯数字 `money +200`。
- `event-generic`（`behaviorLand`，格子 id=2）：**生效**。纯数字 `money +20`。

**失效（map.json 未引用，仅测试覆盖）**：

- `actor-reference`：`{$ref: "$actor.money"}` 演示。仅测试。
- `ref-cell-region`：`$cell.id`、`2 * $region.pros`。仅测试。
- `ref-credit-weight`：weight 引用。仅测试。
- `ref-target`：`$nearestPlayer` 目标。仅测试。
- `ref-unknown`：未知字段快速失败测试。
- `atomic-failure`：多 op 原子回滚测试。
- `contract-test`：EconomyService 注入测试。
- `ownership-position`：ownership + position 测试。
- `region-value`：`region` 目标测试。
- `target-modes`：`globe` / `exclusive` 权重抽样测试。

**关键结论**：行为引擎的变量求值能力**已实现但当前全部为死配置**——线上没有格子引用带变量的行为，生效的 `start-supply` / `event-generic` 均为纯数字。

## 4. 变量能力现状（BehaviorEngine）

### 4.1 已支持

数值：`{$ref: "<算术表达式>"}`。白名单表达式仅 `+ - * / ()`、`min()`、`max()`，token 仅数字/标识符。

引用根（`$root.path`，`$root` 可省略 `$`）：

| 根 | 含义 |
|---|---|
| `$actor` | 触发玩家（`字段.current` 或 `cellId`） |
| `$target` | 本次 op 作用目标玩家 |
| `$cell` | 触发格（任意对象路径，末值需为有限数字） |
| `$map` | `map-meta` 对象 |
| `$region.<fieldId>` | 当前区域该字段值 |
| `$nearestPlayer` | 沿有向边 BFS 距离最近的其他玩家（可作目标或取值） |
| `$randomShareholder` | `$cell` 的随机股东（可作目标或取值） |

op 目标（`target`）也支持 `{$ref: "$nearestPlayer"}` 等玩家解析。

### 4.2 局限与目标差距

1. **变量支持仅限定在 BehaviorEngine 内部**。map.json 的数值/UCT 字段：
   `price`、`rent[]`、`upgradeCost[]`、`repairCost`、`jailCost`、`teleportDestinations[].cost`、`investmentTriggers[].delta`、`buyInMultiplier`、`maxOwnerCount`、`maxLevel`、`jailCooldown` 均**不支持变量**。
   `map-parser.uct()` 只接受有限数字，遇到 `{$ref}` 会硬校验失败。
2. **`map-parser.ts` 明确拒绝 `buyInMultiplier`**（第 51 行）。与近期「只用格子级 `buyInMultiplier`」的方案冲突：当前服务端仅使用全局 `ownershipConfig.buyInMultiplier`。需记录：格子级倍数未接线、解析器已禁用该字段。
3. **查询能力薄弱**：
   - 不能按 `cellId` 访问任意格子和其字段（只能 `$cell` 触发格、`$map` 元数据）。
   - 不能按 `playerId` 访问指定玩家。
   - 无聚合/条件查询：最富玩家、某区域玩家数、某格股东数、榜单名次、团队状态等。
   - 最近玩家语义固定为「有向边 BFS 距离」，不可配置。
4. **只读**：当前求值逻辑不写世界，具备只读性质；但实现内嵌在引擎私有方法中，未抽象为可复用的「世界只读查询上下文」。
5. **概率值**：目前唯一概率机制是 behavior `effect.weight`，且语义为：
   - 非 `exclusive`：`weight >= 1` 恒触发（阈值，非概率）。
   - `exclusive`：按 `weight` 加权随机抽样。
   投资触发器 `investmentTriggers` 现在完全确定性（事件驱动），无概率。若要「概率参与配置」，需为触发器类字段引入 weight 解析。

## 5. 运行时数值解析的影响面

若让变量覆盖全部数字字段，数值需延迟到运行期解析，并将值类型由 `number` 扩展为 `number | { $ref: string }`。以下消费点都要接入统一解析：

- property：`price`（购买）、`rent[level]`（收租）、`upgradeCost[level]`（升级）。
- investment：`price`（购买）、`investmentTriggers[].delta`（分红/损失，按股缩放）。
- monument：`repairCost`。
- jail：`jailCost`、`jailCooldown`。
- transport：`teleportDestinations[].cost`。
- behavior：`weight`、`delta`、`share`、`cellId`（已支持）。

若纳入 map-meta（严格说属地图元数据，非 map.json/cell），则 `dayNight.day/night`、`tax.*.rates`、`ranking.score` 亦可变量化；需用户确认是否包含。

## 6. 建议修复范围（分阶段）

依赖关系决定顺序；每阶段保持只读审查 → 计划 → 实现闭环。

- **阶段 0：抽出「世界只读查询与表达式求值」**。
  新建服务端共享解析模块（如 `ValueResolver` + `WorldQueryContext`），封装：
  - 白名单表达式求值（从 BehaviorEngine 搬出，保持现有 12 行为 + 测试通过）。
  - 世界只读查询 API（当前 `$actor/$target/$cell/$map/$region/$nearestPlayer/$randomShareholder`）。
  里程碑：行为能力无回归，测试全绿。

- **阶段 1：map.json 数字字段变量化**。
  扩展 UCT/数值值类型与解析器为 `number | { $ref }`；`map-parser` 允许 `{$ref}`；handler 侧统一经解析入口取运行期数字。覆盖 price/rent/upgradeCost/repairCost/jailCost/teleportCost/investmentTrigger.delta 及 maxLevel/jailCooldown 等纯数字。
  同时按已定边界处理 `buyInMultiplier` 归属（见决策点）。

- **阶段 2：查询与概率增强**。
  - 查询根扩展：按 cellId 访问任意格、按 playerId 访问指定玩家、最富玩家、某格股东数、某区域玩家列表、榜单名次、团队查询。
  - 概率：投资触发器 weight（或其他触发器类字段）接入权重抽样；行为 weight 语义保持。
  - 为每项查询固化为纯函数并配单测。

## 7. 待确认决策点

1. **`buyInMultiplier` 归属**：当前解析器禁用格子级字段、服务端用全局配置；是否按先前方案改为支持格子级 `cell.buyInMultiplier`（需一并放开 `map-parser`），还是维持全局配置？
2. **map-meta 是否纳入变量化**：`map-meta.json` 的 `dayNight`、`tax`、`ranking.score` 是否也在本轮支持变量，还是仅 map.json / behaviors？
3. **阶段边界**：一次性交付阶段 1+2，还是先只做阶段 0+1（变量进格子配置）再单独做查询/概率增强？
4. **变量求值模块归属**：放 `@game/server`（依赖 GameWorld）还是 `@game/shared`（只读世界接口需入参注入，避免 client 引入服务端依赖）。