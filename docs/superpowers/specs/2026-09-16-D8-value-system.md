# D8 数值调节系统（value modifier system）规格

- 状态：待审阅（Design 已收敛，未进入实现）
- 日期：2026-09-16
- 关联：`docs/superpowers/reviews/2026-09-09-full-project-review.md`（技术债 D8）、
  `docs/superpowers/specs/2026-09-06-cell-hover-act-bar-information-boundaries.md`（展示边界）

## 1. 目标

让地图**可配置**地实现两类机制，且不过分增加实现复杂度、不引入通用表达式引擎：

1. **不同数值之间相互影响**：一个经济字段（价格/租金/升级费…）随世界/玩家/区域/目标格状态联动。
2. **特殊效果**：某种条件下对某类格子的数值做整体调整（时令/环境类效果）。

边界原则：**只做"数值联动"，特殊效果中依赖随机/查询/距离的部分留给既有行为引擎**；数值字段保持 `number | UCT | 表达式` 同构。

## 2. 声明范围（in/out）

### in scope
- map-meta 提供**全局 valueModifiers 规则表**（不做针对单个格子的声明，机制清晰）。
- `calc` 采用 **JSON AST**，闭合原语（算术 + 小型条件），确定性、可 lint、两端同构。
- 变更类数值在**结算/购买时刻 resolve 一次并固定**；展示类按当前上下文 resolve。
- behavior 与 modifier 各自独立；behavior 仅存在于 `supply/event` 这两类**无 base** 的格子上，两套系统不相交，无生效顺序冲突。

### out of scope（明确排除）
- 通用任意表达式引擎、文本表达式语法。
- 查询函数（nearestPlayer 距离/排行榜）、`random` 随机数（作为字段输入）。
- "地产集合/垄断组"跨格概念（当前地图无此模型，不做）。
- 把随机/偶发效果写进字段表达式（这类归行为引擎）。
- 客户端查看限制（**降级为后续**，见 §10）。

## 3. UCT 模型（关键约束）

代码中 UCT 为复合束（`packages/shared/src/types/cell.ts`）：

```ts
interface Uct { player?: Record<string, number>; region?: Record<string, number>; }
```

**读写分离**是本系统的一条铁律：

- **读取**（引用任意复合 UCT）必须**钻到子字段**：`<composite>.<scope>.<fieldId>` 结果为 `number`。
- **写入（结果 = 覆盖，非增量）**：`calc` 算出的值（UCT 字段为 `uctValue`、number 字段为 `numExpr`）作为该字段的**新值**。UCT 字段按**子字段合并**：`calc` 显式列出的子字段**替换**为 calc 值，**未列出的子字段保持原 base 值（不归零）**。若要增量效果，在表达式内用自指 `base` 显式 `$add`（如 `{ "$op":"add", "args":[ { "$ref":"base" }, 10 ] }`）。
- **子字段名不硬编码**：`money/credit/pros/env/…` 由当前地图的 `valueFieldDefinitions` 声明（数据驱动）。逻辑层只认`复合锚 + scope + 字段名`，lint 按地图声明校验子字段是否存在。

## 4. 变量表（refs 固定锚 + 子字段数据驱动）

**一个符号 `base` 的两种语境（语境互斥，勿混淆）：**
- **`scope.base`（规则级字段名）**：标识"本次调节作用在哪个静态配置字段"（如 `price`/`rent`）。只是一个标识维度，**本身不是取值机制**。
- **表达式内 `base`（保留字 = 自指）**：在 `calc` 里，`base` 指**该目标字段自身的当前值**（写入前从地图读到的静态值）。它是 refs 里的一个变量，与其它 ref 同属一个取值命名空间（见下）。

`refs`（表达式中所有能引用的变量）即下表全部；`calc` 里的任何读取都必须落到 refs（经 `$ref`，或保留字 `base`），除此之外无其它取值来源。

所有 ref 锚固定如下；叶节点字段名来自地图声明。

| ref（固定锚） | 相对谁 | 说明 |
|---|---|---|
| `base`（保留字） | 本规则作用的**目标字段** | 该字段自身的**当前静态值**（写入前）。UCT 字段需钻子字段（见下）；number 字段直接用 |
| `player.uct.<fieldId>` | **结算方/付款方玩家** | 其 UCT 的子字段（player 作用域，如 money/credit） |
| `team.uct.<fieldId>` | 上述玩家所属团队 | 团队 UCT 聚合（实现约定，见下） |
| `team.memberCount` | 同上 | number |
| `region.uct.<fieldId>` | **目标格所在区域** | 区域 UCT 子字段（region 作用域，如 pros/env） |
| `region.time` | 同上 | number：区域环境时刻（昼夜系统时间分量，连续） |
| `curCell.level` | **目标格**（本次求值的格子） | number |
| `curCell.ownerCount` | 同上 | number |

关于自指 `base`（目标字段自身当前值）的类型，取决于目标字段：
- 目标字段为 **number**（如 `jailCooldown`）：`base` 本身是 number，可整体参与算术。
- 目标字段为 **UCT**（如 `price`/`rent[level]`）：`base` 是该字段的 UCT 束；要得到 number 必须钻子字段 `base.player.money`、`base.region.pros` 等（读写分离铁律，见 §3）。`base` 整体（不带子字段）只能用于期待 UCT 的位置（如顶层写入）。
- 目标字段为**数组元素**（如 `rent[level]`、`teleportDestinations[i].cost`、`investmentTriggers[j].delta`）：`base` 取**当前被消费的那个元素**。

约定：
- `player.*`/`team.*` 代指"触发该值结算的**付款方玩家**"：购买=买家、付租=付款租客、保释金=进监者、修复=所有者（统一规则，不按消费点各查）。
- `region.*`/`curCell.*` 代指**目标格**及其所在区域（scope 命中的那批格子各处各自读数）。
- `team.uct.<fieldId>` 为**实现约定（当前代码无 team UCT 专用引擎，见 §11）**：对团队全部成员，取各自 UCT 中该字段的值——`fieldId` 为 **player 作用域字段**时取成员自己的 player 值，为 **region 作用域字段**时取该成员**自己所在区域**的 region 值，作用域由该 `fieldId` 在 `valueFieldDefinitions` 中的声明决定——再对全体成员求**算术平均**。`memberCount == 0`（无成员）或该字段地图未声明时，lint 拒绝引用。`team.memberCount` 即团队成员数。

## 5. 允许的 base（按 cellType，字段名对应地图结构）

| cellType | base 字段 | 类型 |
|---|---|---|
| `empty` / `event` / `supply` | （无，使用 behavior） | — |
| `property` | `price`、`rent[]`、`upgradeCost[]` | UCT |
| `transport` | `teleportDestinations[].cost` | UCT |
| `investment` | `price`、`investmentTriggers[].delta` | UCT |
| `jail` | `jailCooldown`、`jailCost` | number、UCT |
| `monument` | `repairCost` | UCT |

数组元素语义：calc 作用在**具体被消费的那个元素**上（`rent[level]`、`teleportDestinations[i].cost`、`investmentTriggers[j].delta`），自指 `base` 取当前元素。

## 6. AST 语法（JSON 表达式树）

### 6.1 数值表达式 `numExpr`（统一 node 形式）

每个节点为以下三种之一，**所有运算符共用同一形状**（前缀式，操作数一律收进定长 `args` 列表，无散落的具名字段）：

```
node := number                                 // 字面量
      | { "$ref": "<refs 路径>" }               // 变量引用（§4），含保留字 base
      | { "$op": "<op>", "args": [ node, ... ] } // 运算符
```

运算符（闭合集合）与**元数**：
- 算术：`add`(≥2) `sub`(≥2) `mul`(≥2) `div`(2) `neg`(1) `abs`(1) `min`(≥2) `max`(≥2) `round`(1) `clamp`(3)
- 条件：`gte`(2) `lte`(2) `eq`(2) `and`(≥2) `if`(3，`args=[cond, then, else]`)

> 采用 `{"$op":"…","args":[…]}` 统一前缀格式：定长 `args`、无 `cond/then/else` 具名字段、无变参展开，确定性高、易 lint、两端同构，与通用 JSON s-expression 一致。

**自指**：目标字段自身当前值用保留字 `base` 引用（即 §4 的 `base`），如 `base.player.money`。其余读取一律 `$ref` 指向 §4 refs 表。`scope.base`（字段名）与表达式内 `base`（自指值）是两个互斥语境。

示例（结果均为**覆盖**，见 §3）：
```jsonc
// price.player.money := price.player.money + pros×50
{
  "price": { "player": { "money":
    { "$op": "add", "args": [
        { "$ref": "base.player.money" },        // 目标字段 price 自身 player.money（写入前）
        { "$op": "mul", "args": [ { "$ref": "region.uct.pros" }, 50 ] }   // 目标格区域 pros（live）
    ] }
  } }
}

// rent[level].player.money := 自身 × (夜晚?1.2:1)
{
  "rent": { "player": { "money":
    { "$op": "mul", "args": [
        { "$ref": "base.player.money" },
        { "$op": "if", "args": [
            { "$op": "eq", "args": [ { "$ref": "region.time" }, 0 ] },
            1.2,
            1
        ] }
    ] }
  } }
}
```

### 6.2 UCT 值（写入目标字段时，顶层按 UCT 语法）
```
uctValue := { player?: { <fieldId>: numExpr }, region?: { <fieldId>: numExpr } }
```
- 目标字段为 number 时：`calc` 是单一 `numExpr`，结果是该 number 字段的**新值（覆盖）**。
- 目标字段为 UCT 时：`calc` 是 `uctValue`；**结果 = 覆盖**——`calc` 显式列出的子字段替换为对应值，**未列出的子字段保持原 base 值（不归零）**。

### 6.3 类型规则
- 引用到 UCT（`$ref`，或自指 `base`，如 `player.uct`、`region.uct`、`base`）→ 必须带子字段才得 `number`；不带子字段只能作为 UCT 值整体（顶层写入或传给期待 UCT 的位置）。
- 结果类型 = 目标字段类型（number→number，UCT→uctValue）。跨币/换算不在 AST 层做（UCT 换算由既有 valueFieldDefinitions 机制承担；v1 不预期混合币种输入）。

## 7. 规则表 schema（map-meta）

```jsonc
"valueModifiers": [
  {
    "id": "regionA-price-pros",          // 可选，便于引用
    "scope": { "cellType": "property", "base": "price" },   // scope.base=字段名称，标识作用于 price
    "calc": { "player": { "money":
      { "$op": "add", "args": [
        { "$ref": "base.player.money" },                 // price 自身 player.money（写入前，覆盖语义）
        { "$op": "mul", "args": [ { "$ref": "region.uct.pros" }, 50 ] }   // 目标格区域 pros（live）
      ] }
    } }
  }
]
```
- `scope`：仅 `cellType` + `base`（全局均匀/按目标格读数，**不做 per-cell/其他维度的 scope**）。
- 同 `base` 多条不合法 → lint 拒绝（避免重叠歧义）；不同 `base` 可各一条。

## 8. 求值 & 生命周期

```
resolveField(cell, field, level, actorCtx) -> number | Uct
  value = cell[field]                       // 静态基值（数组按 level/下标取元素）
  mod = rules[field]                        // 该 base（字段名）绑定的唯一 calc（加载期索引）
  if (!mod)        return value             // 无 calc → 原样返回（number 或 UCT）
  return evalExpr(mod.calc, { base: value, actor: actorCtx })   // base 供自指保留字读取字段当前值
```
- **纯函数进 `@game/shared`**，两端同构；`actorCtx` 由 GameWorld 提供 ref 读数（settlement 付款方）。
- **变更类**（购买实付、租金、升级费、传送费、保释金、修复费、投资 delta）：在结算/购买时刻 resolve **一次并固定**，随 ack 返回实付额。
- **展示类**：按当前上下文 resolve。
- **与 behavior 的关系（不相交）**：behavior 仅存在于 `supply/event` 两类格子（见 [cell.ts](file:///Users/a123/Desktop/tycoon-game/shared-repo/packages/shared/src/types/cell.ts#L41-L42) 的 `behaviorPass/behaviorLand`），而这两类在 §5 中 **base 为空**；valueModifiers 只作用于有 base 的格子。两套系统**不共享字段、不叠加**，无生效顺序冲突。behavior 作为既有黑盒机制在其独立入口（Pass/Land）执行，本系统不改动它。

## 9. 校验（加载期 lint，复用 map-parser）

对每条 calc：
- `$ref` 锚合法，且数据驱动校验：UCT 子字段在当前地图 `valueFieldDefinitions` 中存在、作用域匹配；自指 `base` 的 UCT 子字段与该字段声明一致。
- 比较/条件操作数类型一致（number）；UCT 位置必须为 `uctValue` 形状。
- 数组字段按 level/下标能解析；`base` 对数组字段取当前元素。
- 单调性：对 `region.uct.*`/`curCell.*`/`player.*` 做**线性符号提示**（警告而非强校验）；文档要求设计者尽量单调增/减。
- 同 `base` 规则冲突检查。

## 10. 客户端展示

- 悬浮显示**服务端权威 final**；`base → final` 仅作摘要提示，不暴露计算式（减轻认知负担）。
- 客户端查看限制"仅允许查看当前格子"：**本阶段不实现，仅本条记录在案，后续再做**（届时用宽松不加防护的实现消除观看方/结算方归属歧义；当前展示以结算方上下文为准）。
- 客户端可与服务端同构求值做乐观显示，服务端在结算 ack 校正。

## 11. 打开问题 / 后续（记录，不阻塞本阶段）
- `region.time` 的精确时钟语义（连续时刻 vs 相位）待 IP 与 `DayNightCycle` 对齐后定死。
- `team.uct.<fieldId>` 已按**实现约定（成员 UCT 字段算术均值，含各成员所在区域字段）**暂定，见 §4；若后续引入团队自有价值引擎可替换。
- 是否以及如何对"同 base 多条规则叠加"保留（当前 lint 拒绝，简单优先）。

## 12. 实现步骤概要（供后续 writing-plans 拆解）
1. shared：AST 类型（统一 `{"$op","args"}` node）+ 解释器 `evalExpr` + `resolveField`（含**覆盖合并**：UCT 未列出子字段保持 base）+ ref 读取器（数据驱动子字段、自指 `base`）+ 变量表常量。
2. map-meta：`valueModifiers` 类型 + parser/lint（含数据驱动 UCT 子字段校验、同 base 冲突、单调性提示）。
3. server：各 handler 消费点（购买/租金/升级/传送/保释金/修复/投资 delta）替换为 `resolveField`，并保留变更类"结算时刻固定+ack 实付"。
4. behavior：既有黑盒通道，独立于 modifier（behavior 仅无 base 的 supply/event，相交为空，见 §8）。
5. 客户端：同构解析器接入；`base→final` 摘要（当前格范围）。
6. 测试：表达式解释器单测、lint 用例、各消费点端到端一致性（含"确认→执行"固定实付）。