---
name: map-author
description: 协作者侧地图制作 Skill。在本仓库触发词：协作者说"我要一个格子/地图"/"怎么描述格子"/"帮我生成"/"校验"/"提交"/"改一下格X"等。职责覆盖地图制作整条工作流——理解需求→确认→按 UCT 制图规范生成→校验→入库/导出，同时维护每张图与配置说明的同步文档。自解释；本文件即完整使用说明，加载后无需另翻文档即可驱动工作流。
---

# Map Author — 地图制作 Skill

驱动地图仓库 `tycoon-maps` 的协作者协作全流程。协作方只说话，Agent 负责生成、按规范校验、入库/导出，并维持配置注释文档的同步。

## 入口（如何进入本工作流）

- 协作者任意一个制作/修改请求都会命中本 Skill，例如：
  - "我要一个 property 格子…"
  - "怎么描述一个格子？"
  - "校验一下这张图"
  - "提交"
  - "把格 5 改成 investment"
- 一旦进入，按下方五步工作流执行；过程中无须协作者理解 JSON 或 UCT。

## 仓库结构与"一图一目录"约定

每张地图的**所有相关文件**放在同一个目录下，以便维护多份地图：

```text
maps/
├── example/                          ← 一张图一个目录
│   ├── example.map.json              ← 格子表
│   ├── example.map-meta.json         ← 全局元数据（字段全集/区域/计费）
│   ├── NOTES.md                      ← 配置注释文档（见"注释文档约束"）
│   └── behaviors/                    ← 本图行为 JSON（被 behaviorPass/Land 按 id 引用）
└── <另张图>/  …                      ← 新增图仿此布局
```

> 约束：一张图的 `map` / `map-meta` / `behaviors` / `NOTES.md` 必须同目录；新增地图就新建一个目录，不跨目录引用别的图的行为。

## 制图规范（自解释，含 UCT）

### UCT 通用费用类型
- UCT 形状：`{ "player": { field: num }, "region": { field: num } }`。
- 字段全集来自本图 `map-meta.json` 的 `uct`；**只能引用已声明字段**，未声明 = 报错。
- 与格子无关的键可省略（=0）。
- **方向**：代码统一 `+=`，正负号写在数据里。玩家**支付/被扣=负**，**获得=正**；`region.pros` 同样。
- **混合符号允许**（如一次修缮：money 负、credit 正、region pros 正），是预期用法，schema 不拒绝。
- 股份分配：UCT 参与分红时，每个 `player` 字段按同一股比 `floor(delta × share)` 分配（保留符号）；`region` 字段不按股比拆分。

### 公共字段（每个格子必填）
`id, x, y, type, name({zh-CN,en-US}), description({zh-CN,en-US}), destinations(有向边), regionId, timezone`。
`regionId` 必须存在于本图 `map-meta.regions`。

### 8 类格子速记（详细见 docs/CELLS.md）
| 类型 | 触发 | 专属字段 |
|---|---|---|
| `empty` | 无 | — |
| `supply` | 经过 A、踩中 A+B | `behaviorPass`、`behaviorLand`（均必填） |
| `monument` | 踩中可选修缮一次 | `repairCost` |
| `property` | 踩中可购/升；他人踩中分红 | `maxOwnerCount`、`buyInMultiplier`、`price`、`maxLevel`、`rent[]`、`upgradeCost[]` |
| `investment` | 条件触发（非踩中） | `maxOwnerCount`、`buyInMultiplier`、`price`、`investmentTriggers[]` |
| `jail` | 踩中 | `jailCooldown`、`jailCost` |
| `transport` | 停靠可选传送 | `teleportDestinations[]` |
| `event` | 踩中 | `behaviorLand` |

要点：
- **没有 `start` 类型**；起点由 `map-meta.startCellId` 指定（本示例格 0 是 `supply`）。
- `destinations` 是有向边，**不保证双向**。
- `investment` 用 `investmentTriggers` 订阅全局期事件（如 `any-player-lands-event`、`shareholder-bankrupt`），作用于全部持股且未被禁用收款的股东，按股比分。
- 行为 JSON 内 `ops.type` ∈ `value`（UCT 增减）| `ownership`（acquireShare/loseShare）| `position`（moveTo/teleport）；`target` ∈ `single|team|region|globe` 或 `{$ref}`；`exclusive:true`=互斥（组内归一选一）、`false`=独立。

### 注释文档约束（新增，必须遵守）
- 每张图目录**必须**有 `NOTES.md`：用自然语言说明本图 `map-meta` / `map` / `behaviors` 里每一项配置的含义。
- **改动同步**：任何修改地图文件（`*.map.json` / `*.map-meta.json` / `behaviors/*.behavior.json`）时，必须同步更新该图 `NOTES.md` 中对应说明，保持"配置 ↔ 说明"一致。
- 缺失未建 `NOTES.md` 的图 = 不合规，入库前补齐。

## 工作流约束（五步 + 纪律）

### 1. 理解需求
- 把协作者的话转成「类型 + 触发时机 + 动作 + 参与字段 + 方向」；能用一句自然语言复述时才继续。
- 缺必填信息必追问（最高等级、升级费用、分红触发条件、UCT 作用域、正负方向）。

### 2. 确认
- 生成前给一档确认清单，让协作者确认"完整、无歧义"；引用 `docs/CELLS.md` 核对字段齐全。

### 3. 生成（遵循规范）
- 参照 `maps/<图>/` 的示例结构与 `docs/`。字段、UCT、方向、i18n 全部符合上节规范。

### 4. 校验（硬门禁）
- 复用主仓库 `shared/map-parser` + UCT 行为 schema（本仓库运行就地在主仓库上下文校验；合并进主仓库时开发者侧再审）。
- 检查点：公共字段完整 / id 唯一 / destinations 指向存在 / regionId 存在 / UCT 字段在全集内且为 number / 专属字段按类型齐全 / behaviorPass|Land 指向存在行为且合法 / `NOTES.md` 存在。
- 失败 → **报错 → 定位 → 修正**，绝不静默回退。

### 5. 入库 / 导出
- 写入对应图的目录（含同步更新 `NOTES.md`），git 提交并返回 commit hash。
- 回退：无法 git 操作时把完整 JSON 文本交给协作者，告知"可贴给开发者（如微信）人工入库"。
- 提交信息约定语义，如 `feat(map-example): add property id 1`。

### 纪律（源自项目工作规则，本仓库场景化）
- **对称与一致**：同类格子同类配置写法一致；字段命名统一不混样。
- **最小改动**：只改请求涉及的项，不顺手重构或加无关配置。
- **不留冗余**：不复制主仓库 schema 副本；不复用未声明字段；不用 `_` 开头 hack 字段。
- **快速失败**：缺必填/字段不在全集/方向错 = 配置错误，直接报错，不兜底。
- **改动必配文档**：改图配置必同步 `NOTES.md`。

#### 纪律来源：与本项目通用 agent-rules 的关系
- 本 Skill 的"纪律"一节已是**制图工作流场景化**的权威约束；`docs/COLLABORATION.md` 有人话版。两者一致，读任一即可。
- 若协作者侧 Agent 所在会话能读到主仓库的 `.agent-rules/`（通用跨项目规则，含查档求证/对齐需求/不静默兜底/改动随文档等），则其中的**通用工作纪律优先适用**，本 Skill 只补充制图场景条款，不复制其正文。
- 若 Agent 只能访问本地图仓库（读不到 `.agent-rules/`），以本 Skill 与 `docs/` 为准——本 SKILL 已内联全部制图所需规范，可完全自足驱动，不依赖外部规则库。

## 疑难定位
- 报"字段不在 UCT 全集" → 加入 `map-meta.uct` 或改用已声明字段。
- 报"regionId 不存在" → 用已有区域 id 或先在 `map-meta.regions` 登记。
- 报"行为不存在" → 在本图 `behaviors/` 补行为，或引用已有行为 id。
- 报"NOTES.md 缺失/过时" → 新建或同步更新该图注释文档。

## 什么时候交给人类
- 需求超出地图/格子（改规则、非地图内容）→ 告诉协作者这不归地图仓库改，转交项目开发者。
- 协作者坚持与 schema 冲突的写法 → 不强行适配，说明"快速失败"纪律并提出在 schema 层解决。