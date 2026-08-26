---
name: map-author
description: 协作者侧地图制作 Skill。当协作者提出"我要一个格子/地图""怎么描述格子""校验""提交"等请求时，按本流程处理：理解需求→确认→生成 UCT 正确的地图 JSON→校验→入库/导出。覆盖地图制作整个工作流，自解释，无需额外文档即可使用。
---

# Map Author — 地图制作 Skill

驱动地图仓库 `tycoon-maps` 的协作者协作全流程。协作方只说话，Agent 负责生成、校验、入库。

## 当你在本仓库时应遵循

- 仓库内容：`maps/`（地图）、`behaviors/`（行为）、`docs/`（人类文档）、`skills/`（本目录）。
- schema 事实源在主仓库 `shared/map-parser` + UCT 行为 schema，本仓库只有内容，不维护 schema 副本。
- 纪律：**校验不过 = 不提交，快速失败，不静默兜底**。

## 工作流（五步）

### 1. 理解需求（自然语言 → 结构化）
- 把协作者的话转成「类型 + 触发时机 + 动作 + 参与字段 + 方向」。
- 能用一句话 S 复述需求时才开始。
- **缺必填信息时必追问**，例如：最高等级、升级费用、分红触发条件、UCT 字段作用域、正负方向。

### 2. 确认（避免歧义）
- 生成前先给一档确认清单，让协作者确认"完整、无歧义"。
- 引用 `docs/CELLS.md` 的逐类要点确认字段齐全。

### 3. 生成地图 JSON（遵循 UCT 规则）
- 参照 `maps/example.map.json`、`maps/example.map-meta.json`、`behaviors/*.behavior.json`。
- 公共字段必须完整：`id, x, y, type, name(i18n), description(i18n), destinations, regionId, timezone`。
- **UCT 正负号**：代码统一 `+=`，正负写在数据里。玩家支付/被扣写负，获得/被加写正；`region.pros` 同理。
- UCT 字段只能来自该图 `map-meta.json` 的 `uct` 全集；无关键省略（=0），但**不要用未声明的字段**。
- `behaviorPass`/`behaviorLand`：仅 `supply`/`event` 使用，值是 `behaviors/` 中某个行为的 id。

### 4. 校验（硬门禁）
- 校验 = 复用主仓库 `shared/map-parser` + UCT 行为 schema（在本仓库运行时就地校验；合并进主仓库时由开发者侧再次校验）。
- 检查点：
  1. 公共字段完整、`id` 唯一、`destinations` 指向存在的格；
  2. `regionId` 在 `map-meta.regions` 中存在；
  3. 每格 UCT 字段都在 `map-meta.uct` 全集内、类型为 number；
  4. 必填专属字段按类型齐全（见 `docs/CELLS.md`）；
  5. `behaviorPass/behaviorLand` 指向的行为存在且自身合法。
- 校验失败：**报错 → 定位 → 修正**，绝不静默回退。

### 5. 入库 / 导出
- 默认写入 `maps/`（新图：`maps/<name>.map.json` + 同名 `.map-meta.json`）+ `behaviors/`，完成后用 git 提交，返回 commit hash。
- **回退路径**：若当前环境无法 git 操作，直接把完整 JSON 文本给协作者，并告知"可贴给开发者（如微信）人工入库"。
- 提交信息用约定的 commit 语义，如 `feat(map): add <name> cells id <...>`。

## 关键规则速记
- 8 类型：`empty|supply|monument|property|investment|jail|transport|event`；**没有 `start` 类型**，起点由 `map-meta.startCellId` 指定。
- `destinations` 是有向边，**不保证双向**。
- `supply`：经过 A、踩中 A+B（`behaviorPass`/`behaviorLand` 均必填）。
- `event`：`behaviorLand` 加权随机触发；行为内用 `exclusive` 区分互斥/独立效果。
- `investment`：用 `investmentTriggers` 条件触发（如 `any-player-lands-event`、`shareholder-bankrupt`），作用于全部持股且未被禁用收款的股东，按股比分。
- `property`：`price`/`rent[]`/`upgradeCost[]`/`maxLevel`；分红给持股股东。
- `monument`：`repairCost`；只可修缮一次。
- `jail`：`jailCooldown` + `jailCost`。
- `transport`：`teleportDestinations[{cellid,cost:UCT}]`，停靠时可选传送。

## 疑难定位
- 校验报"字段不在 UCT 全集" → 该键加到 `map-meta.uct` 或改用已声明字段。
- 校验报"regionId 不存在" → 改用 `map-meta.regions` 中已有 id，或在 map-meta 中新增区域。
- 校验报"行为不存在" → 在 `behaviors/` 补对应行为，或在格子引用已有行为 id。

## 何时交给人类
- 协作者需求超出格子/地图（改规则、非地图内容）→ 明确告知这不是地图仓库该改的，交给项目开发者。
- 协作者坚持某个与 schema 冲突的写法 → 不强行适配，说明"快速失败"纪律并提出在 schema 层解决的路径。