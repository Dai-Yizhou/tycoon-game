# 格子行为模型统一设计（8 类型模式 + 配置参数）

> 状态：设计稿（未实现）
> 分支：`fix/complete-authority-hardening`
> 日期：2026-08-23
> 性质：**需求与机制定义 + 核查计划 + 实现方式**。本文不写实现代码，仅定无歧义的行为契约与落地步骤。

---

## 0. 目标与范围

- 明确 8 种格子类型（`empty` / `supply` / `monument` / `property` / `investment` / `jail` / `transport` / `event`）的统一行为模型。
- 所有格子的行为由 **「类型模式 + 配置参数」** 推导，配置参数写入 `map.json`（`extra` 或顶层字段）或行为 JSON。
- **数值字段字段ID驱动**：效果不写死为 `money/credit/env`，而是引用 `valueFieldDefinitions` 中声明的字段 ID；`extra` 可含多个数值字段，代码不得硬编码字段名。
- **不依赖假设**：格子连接不保证双向，`destinations` 仅表示**有向边**。
- 工程纪律：**不兼容旧代码**、**不滥用 fallback**（缺必填配置 = 配置错误并快速失败，而非静默回退默认值），以杜绝新技术债。
- 本文档同时列出受影响的**全栈（前后端/UI/共享）改动**，作为整体改造计划的一部分。

---

## 1. 术语与基础机制（无歧义定义）

| 术语 | 定义 |
|---|---|
| **掷骰移动** | 玩家掷骰得到步数 `steps`，服务端沿有向边逐格移动，产出路径 `P = [c1, c2, …, cN]`（`c1` 为起点，`cN` 为最终停靠点，`N≥1`）。 |
| **踩中(land)** | 移动路径的**最终停靠格子** `cN`。 |
| **经过(pass)** | 移动路径中**除最终停靠点外**的途经格子 `c1..c_{N-1}`。注意：**踩中 ⊄ 经过**（两者互斥，踩中的格子不算"经过"）。 |
| **可选(optional)** | 玩家可在决策窗口内接受或拒绝；拒绝 = 无效果，不阻塞。 |
| **持有股份** | 玩家在此格子购买过且未失去股份（property/investment 已有合租体系）。 |
| **未被禁用收款** | 玩家状态非 `jail`（监狱中）且非 `bankrupt`（破产）。已有 `canCollectRent` / `canReceiveInvestmentImpact` 佐证。 |
| **有向边** | `cell.destinations: number[]`——只有这些边的方向可走；`A→B` 存在不保证 `B→A`。 |

### 1.1 触发顺序（一次性，无歧义）

一次掷骰移动结算顺序固定为：

1. **结算经过**：按路径顺序 `c1 → c_{N-1}`，对每个声明了 `behaviorPass` 的格子执行经过行为（一个格子一次移动最多触发一次）。
2. **结算踩中**：对最终停靠格子 `cN` 执行踩中结算（`behaviorLand` 及相关类型原生逻辑）。

> 原则：单个格子在一次移动中**至多触发一次**经过行为（路径算法已用 `visited` 去重，禁止同一次移动回头重复经过）。

### 1.2 数值字段处理原则（不硬编码）

- 玩家级数值字段由 `MapMeta.valueFieldDefinitions`（`scope: 'player'`）声明，初始化进 `player.values[fieldId]`。
- 效果统一用 `{ fieldId, delta }` 引用；运行时查 `valueFieldDefinitions` 校验字段存在，**不写死 `fieldId` 为 `'money'/'credit'/'env'`**。
- 用于事件概率调节的"信用值"字段，由配置指定（`creditFieldId`），同样不硬编码。
- 区域级数值字段（`scope: 'region'`，如环保值、繁荣度）由 `region/prosperity` 管理；效果可通过 `target: 'region'` + 区域字段引用联动。

### 1.3 行为引擎（BehaviorEngine）契约

- **事件目标 `target`**：`single` | `team` | `region` | `globe`
  - `single`：触发玩家
  - `team`：触发玩家所在队伍全部成员
  - `region`：触发者所在区域的**全部玩家**（占用该区域格子者）
  - `globe`：全部玩家
  - `target` 缺省值视类型而定，**不允许默认值掩盖含义**——行为 JSON 必须显式书写。
- **操作对象 `op`**：
  - `value`：`{ fieldId, delta }` 数值增减（字段ID驱动）
  - `ownership`：股份持有权变更（如 `acquireShare` / `loseShare`），可能需要额外数据（目标格子、数量）
  - `position`：位置变更（如 `moveTo` / `teleport`），可能需要额外数据（目标格子）
- **加权随机**：从事件列表中轮盘赌选一；概率受 `creditFieldId` 当前值调节（由 `creditModifier` 指定系数）。可选；供 `event` 类型使用。

---

## 2. 8 种格子行为模型

以下每种给出：**触发时机 / 触发条件 / 行为动作 / 配置参数 / 边界与歧义澄清**。

统一说明：每个格子可选声明 `behaviorPass`、`behaviorLand`（行为 JSON 的 id）。未声明的类型不触发对应钩子，**属性缺失即不触发（合法），但已声明却指向不存在的 JSON 为配置错误 → 快速失败**（见 §4 校验）。

### 2.1 `empty`

- **触发**：无。
- **行为**：无任何动作，可有 `description`（展示用）。
- **配置**：无必填项。
- **澄清**：经过/踩中均零效果；不广播、不弹窗、不报错。

### 2.2 `supply`（原 `start`，类型 token 改为 `supply`）

- **经过**：触发 **行为 A**（`behaviorPass`）。
- **踩中**：先触发 **行为 A**（`behaviorPass`），**在其之后**再触发 **行为 B**（`behaviorLand`）。
- **配置**：`behaviorPass`、`behaviorLand`（**均必填**，缺一为配置错误）。
- **澄清**：
  - 行为 A 与 B 是两份独立行为 JSON（已确认方案）。
  - 经过时只触发 A；踩中时 A → B 按序。
  - A/B 内部可用任意 `target` 与 `op`（可设为 `region`/`globe` 影响他人）。

### 2.3 `monument`

- **触发**：踩中（可选一次修缮）。
- **行为**：玩家可选修缮一次 → 支付 `repairCost`；增加玩家 `creditFieldId` 字段 + `repairCreditGain`；增加所在区域繁荣度 `repairProsperityGain`。
- **配置**：`extra.repairCost`、`extra.repairCreditGain`、`extra.repairProsperityGain`；`creditFieldId` 取自元数据配置。
- **澄清**：每次踩中最多修缮一次；拒绝则无效果；区域由 `ProsperityManager.findRegionByCellId` 解析。

### 2.4 `property`

- **触发（踩中）**，按序判定：
  1. **可购**：未持有股份 且 股东数 < `maxOwnerCount` → 可选购买（价 `price`，合租算法）。
  2. **可升级**：持有股份 且 `level < maxLevel` → 可选升级（耗 `upgradeCost[level]`）。
  3. **踩中玩家向持股者分发收益**：**任意不持有该格股份的玩家**踩中 → 该踩中玩家按 `rent[level]`（可乘繁荣度乘数）**支付**，按持股比例分给所有"未被禁用收款"的股东。
- **配置**：`extra.price`、`extra.rent[]`、`extra.upgradeCost[]`、`extra.maxLevel`、`extra.maxOwnerCount`。
- **澄清**：
  - 收益来源 = **踩中玩家支付**（已确认）。金额 = 当前等级租金（×繁荣度乘数）。踩中者足额支付；不足则**支付其全部余款**（≥0），不足未付部分不产生负债、股东分得相应减少；无可支付（为 0）则股东分得 0。
  - **踩中玩家自身持有股份 ⇒ 不触发分发**（视为"往返"无租金）。
  - 股东中被「禁用收款」（监狱/破产）者跳过，其份额**不补发**给他人（无 fallback）。
  - 分账按股比 `floor(amount × share)`，与现有合租分配一致。

### 2.5 `investment`

- **触发（踩中）**：
  1. **可购**：未持有股份 且 股东数 < `maxOwnerCount` → 可选购买（价 `price`，合投算法）。
- **条件触发**：持有股份的玩家，当满足指定触发条件时生效，**无论其是否在该格上**。示例形态：任意玩家踩中 `event` 格 → 向所有持有该投资格股份且未被禁用收款的玩家分发收益。
- **配置（暂定/待定）**：`extra.price`、`extra.maxOwnerCount`；`eventImpacts` / `defaultEventImpact`（金额来源）、以及"触发条件"的具体形态——**均由后续"投资项目通用行为模式"定稿后补充**。本文保留机制接口（见 §5 `InvestmentHandler.triggerInvestmentEvent`）。
- **澄清**：投资的具体触发源（谁在何种条件触发）与金额模型**不在本文定稿**，仅确立"条件触发、不限位置、按持股分配、排除禁用收款、金额来自配置"的骨架。

### 2.6 `jail`

- **触发（踩中）**：进入监狱。
- **行为**：延长冷却（`cooldownMs`）、扣除 `creditFieldId`（`creditPenalty`）、冷却期间禁用收款。**已实现，仅校验**。
- **配置**：`cooldownMs`、`creditPenalty`（来自 MapMeta.config / `extra`，字段ID驱动 credit）。
- **澄清**：与 §1「未被禁用收款」定义一致；冷却到期自动释放。

### 2.7 `transport`

- **边分类**（已确认方案：独立字段）：
  - `destinations`：**普通行走有向边**，掷骰移动可沿其前进，岔路时可选（走现有 fork 机制）。
  - `teleportDestinations`：**传送目的地**，仅当**掷骰移动最终踩停**在该 transport 格上时可选。
- **普通邻接**：移动过程中遇到岔路可正常选择任一普通边（无需额外条件）。
- **传送（踩停才可选，付费、不掷骰）**：踩停后，可选项性支付 `extra.transportCost` 传送至任一 `teleportDestinations`；也可以不选（停在该格）。若选：扣除费用、移动到目标格，目标视为新踩中格并结算其 `behaviorLand`/原生逻辑；需防传送环。
- **配置**：`destinations`（行走边）、`teleportDestinations`（传送边）、`extra.transportCost`。
- **澄清**：**经过不触发传送**；踩停才可选。传送后目标格的踩中结算可能递归。

### 2.8 `event`

- **触发（踩中）**：从 `behaviorLand` 行为 JSON 的事件列表中**加权随机**选中一个事件并执行。
- **目标**：`single` / `team` / `region` / `globe`（§1.3）。
- **操作**：数值字段（`value`）/ 股份持有权（`ownership`）/ 位置（`position`），可能需要额外数据。
- **配置**：`behaviorLand`（事件行为 JSON）。金额/字段/数量等均在事件条目的效果内以字段ID+extra 数据引用。
- **澄清**：已实现但需按新契约核对（target 四态、op 三类、字段ID驱动、无静默回退）。

---

## 3. 配置模型（Schema 级定义）

### 3.1 格子（map.json per cell）

```jsonc
{
  "id": 0, "x": 0, "y": 0,
  "destinations": [/* 普通行走有向边：仅向前 */],
  "teleportDestinations": [/* 仅 transport：踩停才可选、付费、不掷骰 */],
  "behaviorPass": "supply_pass",      // 经过钩子（仅 supply 等需要经过行为的类型）
  "behaviorLand": "event_generic",    // 踩中钩子（event / supply-B 等）
  "type": "supply|empty|monument|property|investment|jail|transport|event",
  "extra": {
    "price": 0, "rent": [], "upgradeCost": [],
    "level": 0, "maxLevel": 0, "maxOwnerCount": 0,
    "repairCost": 0, "repairCreditGain": 0, "repairProsperityGain": 0,
    "transportCost": 0,
    /* 其他任意数值字段，字段名不硬化进代码 */
  }
}
```

> 迁移说明：现有 `map.json` 事件格使用顶层 `behavior` 字段；新模型统一改为 `behaviorLand`（`behavior` 废弃移除，不做兼容）。`CellTypes.start` 改名为 `supply`。

### 3.2 行为 JSON（behaviorLand / behaviorPass）

```jsonc
{
  "id": "event_generic",
  "name": "随机事件",
  "events": [
    {
      "msg": "…",
      "target": "single",            // single|team|region|globe（必填，无默认掩盖）
      "weight": 4,
      "good": true,
      "creditModifier": 0.3,         // 可选：用 creditFieldId 调概率
      "effects": [
        { "op": "value", "fieldId": "env", "delta": 5 },
        { "op": "ownership", "action": "acquireShare", "cellId": 5, "share": 0.1 }, // 需额外数据
        { "op": "position", "action": "moveTo", "cellId": 9 }
      ]
    }
  ]
}
```

---

## 4. 配置校验与防滥用 fallback

- 为 `map.json` 与行为 JSON 建立**显式 Schema 校验**（如 zod / JSON Schema），在加载时一次性校验。
- **必填缺失 = 配置错误**：例如 `supply` 缺 `behaviorPass/behaviorLand`、`jail` 缺冷却、`transport` 引用不存在的 `teleportDestinations`、`behavior*` 指向不存在的 JSON、`op:'value'` 的 `fieldId` 不在 `valueFieldDefinitions`——均**快速失败并报错**，绝不静默回退默认值。
- 明确界定合法"缺省"（不触发钩子）与"配置错误"（声明了但缺失/失效）之间的边界，写入文档与测试。

---

## 5. 实现方式（架构与模块）

> 只给方案，不给代码。

- **共享层（`@game/shared`）**：
  - `cell.ts`：`Cell` 增顶层 `teleportDestinations`、`behaviorPass`、`behaviorLand`；`destinations` 注释改为"有向边"，删除"双向"表述。`CellTypes`：新增/改名 `supply`，与「8 类型」对齐。
  - `map-parser.ts`：`BUILTIN_FIELDS` 增 `teleportDestinations`、`behaviorPass`、`behaviorLand`，作为顶层字段提取（不入 `extra`）。
  - 校验工具：map/behavior 的 Schema 校验器。
- **服务端**：
  - `BehaviorEngine`：目标扩为 4 态；操作扩为 `value/ownership/position`；效果字段ID驱动；`creditFieldId` 配置化。
  - `MovementHandler`：新增**经过钩子**沿路径按序触发 `behaviorPass`；再结算踩中。路径算法已去重。
  - `settleLanding` 分发器：按 `normalizeCellType` 路由到各 handler（property/investment/jail/transport/monument/event/supply/empty）。
  - `propertyHandler`：实现"不持股者踩中 → 支付租金 → 成分给股东，排除禁用收款"。
  - `monumentHandler`：实现可选修缮 → credit 字段 + 区域繁荣度。
  - `transportHandler`：`teleportDestinations`（踩停、付费、不掷骰）；普通边走既有 fork 机制；防传送环。
  - `startHandler → supplyHandler`：经过 A / 踩中 A+B。
  - `EventHandler`：改读 `behaviorLand`，支持 4 态目标与三类操作。
  - `InvestmentHandler.triggerInvestmentEvent`：**保留为机制接口**（已存在），供后续投资项目通用行为模式接入；本文不对其改效果模型。
- **前端/客户端（明确受影响）**：
  - 格子类型图标/文案：新增 `supply`，去除 `start`；`BehaviorConfig` 解析与 `BehaviorEvent` 客户端类型对齐（target 4 态、effects 结构、字段ID）。
  - HUD：数值字段按 `valueFieldDefinitions` 渲染，**不写死 env/money/credit**（现状若硬编码需通用化）。
  - 移动/岔路：`client.choosePath` 仅普通行走边，不变；transport 踩停后 `client.useTransport` 呈现 `teleportDestinations` + 费用。
  - 交互 UI：property 购买/升级提示、monument 修缮提示、踩中分发收益的结算通知、投资购买（未来收益/亏损 UI）。

---

## 6. 核查计划（Checklist → 期望的确定性结果）

### 6.1 通用核查
- [ ] map.json 与行为 JSON 通过 Schema 校验；**缺失必填项即加载报错**（无静默默认）。
- [ ] `behavior*` 指向不存在的 JSON → 报错，不执行、不广播。
- [ ] `op:'value'` 引用的 `fieldId` 不在 `valueFieldDefinitions` → 报错。
- [ ] `destinations` 作为有向边：`A→B` 存在而 `B→A` 不存在等单边情形，移动只按出边走。

### 6.2 逐类型核查（场景 → 期望）
| 类型 | 场景 | 期望结果 |
|---|---|---|
| empty | 踩中/经过 | 零效果，无广播/弹窗/报错 |
| supply | 经过 | 仅触发 A |
| supply | 踩中 | A → B 按序 |
| supply | 同一次移动两次经过同一格（回头） | 仅触发一次 A |
| monument | 踩中→修缮 | 支付→credit+、区域繁荣+；拒绝→无效果；每次踩中至多一次 |
| property | 不持股者踩中 | 支付 `rent[level]`（×繁荣度）→ 股东按股比分，排除禁用收款者 |
| property | 持股者踩中自身 | 不触发分发；可升级（未满级） |
| property | 未满 `maxOwnerCount` | 可选购买；满员则不可购 |
| property | 踩中者资金不足 | 支付其全部余款（可 0），股东分得相应减少，无负债产生 |
| investment | 未满员踩中 | 可选购买；条件触发时对股东发收益（保留接口） |
| jail | 踩中 | 进入监狱：cooldown+、credit−、禁用收款；到期释放 |
| transport | 移动路过 | 仅普通边，无传送选项 |
| transport | 踩停 | 可选付费传送至 `teleportDestinations`（不掷骰）；拒绝则停在该格 |
| transport | 传送 | 扣费→移动到目标→目标踩中结算；防环 |
| event | 踩中 | 加权随机选中一事件，作用于解析后的目标（single/team/region/globe），无静默回退 |

---

## 7. 待后续确认项

- **投资项目通用行为模式**（`investment` 的触发条件来源、金额模型、与 event 的耦合方式）——由你后续交代后，再补充到 §2.5 与配置 schema，并相应扩展行为引擎与投资 UI。
- `team` 目标解析的精确范围（同队成员的定义；TeamManager 现有语义）与 `region` 目标在"玩家跨区域占用"时的归属口径，实现前对齐。

---

## 8. 落地顺序建议（非耗时估计，仅依赖序）

1. 共享层：`Cell` 字段、`map-parser`、`CellTypes(supply)`、Schema 校验。
2. 服务端 `BehaviorEngine`：4 态目标 + 三类操作 + 字段ID驱动。
3. `MovementHandler` 经过钩子 + `settleLanding` 分发器。
4. 各 handler 迁移（property / monument / transport / supply / event）。
5. 前端/UI：类型与行为配置对齐、HUD 字段通用化、交互 UI。
6. 核查清单落地为自动化测试。