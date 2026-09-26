# 经济饱和与破产机制：缺口、决策与待定项

> **摘要**
>
> - **现状**：地图饱和（格位占满）没有主动回收通道；玩家破产实际只有「税收」「事件」两条途径，其余数值减少路径都被「预检拒绝」消解；长期离线玩家永久占位。
> - **缺口**：存在「穷但死不了」的僵尸态——余额落到低正数或已触底者，既不破产也不能行动。
> - **决策（用户拍板）**：采用**负债式破产**——数值不做 `min` 钳制、允许负债，越线即破产，数值仍按配置计算；客户端检测到操作会触发破产时二次确认。
> - **立场修正**：造币**不是**本游戏的禁忌（破产重开注入起始值、modifier 把定价权交给地图作者，本身都在造币）。真正的约束是「造币必须有意且受地图作者控制」。
> - **落地必改两处**：①破产触发条件（现规则 `before > min` 不再适用）；②`changeValue` 去掉 `min` 钳制并重定义 `min` 语义。
> - 归股释放、长期离线清算等回收通道未定，见 §6、§8。
>
> 本文记录一轮关于「地图饱和 / 破产途径 / 离线占位」的讨论结论，供后续实施与地图机制设计引用。运行时事实以 `docs/architecture/` 三篇为准，本文为机制设计记录。

---

## 1. 背景与目的

讨论起因是三个递进疑问：

1. 地图达到饱和（格位占满）后，是否缺少让平衡继续运行的机制；
2. 玩家破产的途径是否过少，因为「数值不足会导致操作失败」；
3. 是否应补上「玩家向系统归还股份」与「清理长期离线玩家」。

本文先把现状机制核对清楚（第二章），再记录缺口（第三章）、已定决策（第四、五章）与尚未决定的部分（第六章）。

## 2. 现状机制核对

### 2.1 抗饱和的被动机制

| 机制 | 位置 | 作用 | 局限 |
|---|---|---|---|
| 合租 / 多股东 | `Ownership.addOwnership`（`packages/server/src/economy/Ownership.ts:57-75`，上限判定见 `:60` `existing.length >= cell.maxOwnerCount`） | 每格可容纳至多 `maxOwnerCount` 个股东，把饱和点从「格数」抬到「格数 × maxOwnerCount」 | 满员后彻底关闭，`addOwnership` 返回 `null`，新玩家无法入局 |
| 持续税收 | `Taxation`（`packages/server/src/economy/Taxation.ts:202-219` 扣款；`:267-284` 基础税；`:292-309` 股份税） | `baseTax` 按财富征、`shareTax` 按累计持股征，是持续的均贫富/消耗通道 | 有死区，见 §3.3 |
| 升级消耗 | `propertyHandler` 升级路径 | 饱和后仍可继续的金钱出口 | 受 `maxLevel` 上限约束，跑道有限 |
| 破产释放股权 | `Bankruptcy.clearPlayerAssets`（`packages/server/src/economy/Bankruptcy.ts:145-152`） | 清空破产玩家全部持股，**腾出股东位** | 依赖有人破产 |
| 纪元重置 | 运维手动更换地图 | 一次性抹平所有占位 | 非自动；跨地图持股如何处置未定义（见 §6） |

### 2.2 破产触发口径

破产判定在 `Bankruptcy.onPlayerUpdated`（`packages/server/src/economy/Bankruptcy.ts:47-63`）：

- 触发条件为 `before > minimum && field.current <= minimum`（`:55`），即「同一字段从 `> min` 一步掉到 `<= min`」；
- 因为 `EconomyService.changeValue`（`packages/server/src/economy/EconomyService.ts:34`）会把数值**钳制在 `min` 之上**，所以「触底」表现为 `current === min`；
- 注释（`:52-54`）明确：**内测口径为「经济操作一律把数值钳在 `min` 之上，玩家无法负债」，因此跨过 `min` 触底即破产**；起始值本就等于 `min` 时不触发（`before > min` 不成立）。

### 2.3 各数值减少路径的实际行为

| 路径 | 位置 | 行为 | 能否致破产 |
|---|---|---|---|
| 税收 | `Taxation.ts:202-219` | 走 `changeValue`（钳制） | **能**（主通道） |
| 事件 / behavior 效果 | `packages/server/src/behavior/BehaviorEngine.ts:140` | 直接 `changeValue`，无预检 | **能** |
| 踩中他人格子（租金） | `packages/server/src/handlers/propertyHandler.ts:575-580` | 余额不足则**整笔不结算**（全额或拒绝） | 不能 |
| 购买 / 升级 | `propertyHandler.ts:250` + `:774-781`（`canApplyUct`） | 预检后拒绝 | 不能 |
| 交通 | `packages/server/src/handlers/transportHandler.ts:226-227` | 预检后拒绝 | 不能 |
| 投资 | `packages/server/src/handlers/investmentHandler.ts:215-216` | 预检后拒绝 | 不能 |
| 纪念碑修复 | `packages/server/src/handlers/monumentHandler.ts:196-200` | 预检后拒绝 | 不能 |
| 主动宣告破产 | `Bankruptcy.manualBankruptcy`（`:181`） | 仅运维 / 管理员 | 非玩家途径 |

结论：**实际只有「税收」「事件」两条破产途径**；所有玩家主动操作与租金都是「全额或拒绝」，永不下探到 `min`，因而永不触发破产。

## 3. 缺口

### 3.1 饱和缺主动回收通道

- 破产是**目前唯一**能把已占用的股东位回收的自动机制（`clearPlayerAssets`），但它被 §3.2 与 §3.3 双重削弱 → 位子回收更慢 → 饱和更早到来。
- `releaseOwnership`（`Ownership.ts:122-124`）虽已实现，但运行时无任何调用点，**只在测试中被引用**；即没有服务端清扫，也没有玩家侧退出。
- 缺动态定价之外的占有率调节：`resolvePurchasePrice`（`propertyHandler.ts:707-719`）走 `resolveValueModifier`，上下文含 `ownerCount`，**地图作者可用 modifier 让价格随占有率变化**（此项并非缺口，属既有能力）。

### 3.2 破产通道被「全额拒绝」削弱

「操作时数值不足 → 操作失败」的直接后果：

- 玩家主动操作、租金都不会把数值扣到 `min` 以下；
- 于是把 `min` 当作「死亡线」的破产判定**永远等不到那一步**。

这使破产途径从设计上可能的多条，收敛为仅税收 / 事件两条。

### 3.3 僵尸态：穷但死不了

两个成因叠加：

1. **税收死区**：`calculateBaseTax` 用 `tax = Math.floor(current * rate)` 且 `if (tax <= 0) continue`，并有 `exemptBelow` 阈值（`Taxation.ts:272-281`）；`calculateShareTax` 同理（`:298-299`）。当余额落到低正数（如 `9 × 0.05 → floor 0`）或低于豁免线时，**税收归零**。
2. **已触底者永不触发**：破产条件要求 `before > min`。已停在 `min` 的玩家 `before === min`，条件不成立 → **永久不破产**。

结果：这类玩家既买不起任何东西（操作被拒），踩中他人格子也不掉钱（租金跳过），税收也收不到 → **既不破产，也不能行动**。

### 3.4 长期离线永久占位

离线处理机制（`packages/server/src/world/PlayerManager.ts`）：

- 掉线 → `disconnectPlayer`（`:256-264`）→ `freezePlayer`（`:276-285`）：`status = Frozen`，并记录冻结前的领域状态；
- `getEffectiveStatus`（`:324-329`）返回**冻结前的领域状态**（缺失时保守取 `Normal`）→ 离线者仍以 `Normal` **参与计税与收租**；
- 重连 → `unfreezePlayer`（`:292-305`）复原。

判断：

- **短期离线无问题**：继续持有、继续收租、不受罚，重连即恢复。这是有意且合理的设计。
- **长期离线是饱和的主要堆积源**：没有任何 inactivity / `lastSeen` 兜底，没有休眠降级或强制清仓，账号会**永久占用股东位**；唯一的回收仍依赖「税把离线者逼到破产」，而它同样受 §3.3 的死区限制。
- `lastActiveAt` 字段已在多处维护（如 `EconomyService.ts:36`、移动/交通/连接路径），即**判定所需数据已就绪**，缺的只是「判定 + 动作」。

## 4. 决策：负债式破产

用户拍板的方向：

- **数值不做 `min` 钳制，允许负债**；
- **玩家做出会把数值推入负债的操作后立刻破产**；
- **数值仍按配置计算**（不因钳制而截断）；
- **客户端在检测到该操作会触发破产时做二次确认**。

配套的立场修正（本轮明确）：

- 「不允许造币」**不是**本游戏的硬约束。破产重开调用 `buildInitialPlayerValues()` 重新注入起始值（`Bankruptcy.restartBankruptPlayer`，`:154-172`）本身就在造币；modifier 把定价权交给地图作者也说明数值规模是**地图作者的战略选择**。
- 因此真正的约束是：**造币必须是有意的、受地图作者控制的**。负债式破产满足这一点——交租方的差额成为其债务，破产时随资产一并核销，属刻意设计而非逻辑错配。

## 5. 落地必改（两处语义重写）

若采纳 §4，以下两处**必须改**，否则方案不成立：

1. **破产触发条件**：现有 `before > minimum && field.current <= minimum`（`Bankruptcy.ts:55`）是**专为钳制口径写的**（`:52-54` 注释）。在负债口径下它会漏判——正好停在 `min` 的玩家超支后 `before === min` 不成立 → 不会破产，僵尸态原样保留。应改为**不看 `before`、只看结果**：`current < min` 即破产。
   - 附带收益：改对之后，停在 `min` 的玩家只要能发起一次负债操作就会掉入负债并立即破产，**僵尸态随之解决**。
2. **`changeValue` 去 `min` 钳制 + 重定义 `min`**：`EconomyService.changeValue`（`:34`）改为只钳 `max`、不钳 `min`；`min` 的语义从「数值下限」变为「**破产阈值**」。这会影响全部调用方（税收 / 事件 / 租金 / 各类操作），属全局行为变更，需一次性对齐，并同步更新 UCT / 字段定义契约与地图编写文档，避免地图作者误以为 `min` 是防作弊下限。

随方案落地的既有顾虑（本轮已澄清，无需改）：

- 去掉钳制后，`changeValue` 返回的实际 `delta` 等于配置 `delta`，`applyUct`（`propertyHandler.ts:783-796`）「记录配置值而非实付值」的隐患不再出现；
- 租金按全额分给股东（`propertyHandler.ts:590`）不再算「凭空造币」——差额是交租方的债务，破产时核销，属 §4 认可的有意造币。

## 6. 待定项

1. **范围**：负债致破产只对「玩家主动操作」生效，还是也含**租金 / 税收 / 事件**？若不含租金，「踩中他人格子不掉钱」这一原始毛病仍在。要让回收通道真正打通，建议租金也纳入。
2. **二次确认由谁算**：建议**服务端权威**——首次请求返回 `would_bankrupt` + 预览值，客户端确认后带 `confirm` 重发。不要让客户端自行推算：动态价格走 modifier、合租价随 `ownerCount` 变化，客户端必然算不准，会误报或漏报。
3. **多字段**：任一字段越线即破产（统一口径），各字段的 `min` 由地图作者决定。
4. **换图时的持股处置**：跨地图对持股是保留还是作废？这条未定义，直接决定「换图能否充当泄压阀」，也决定是否需要独立的离线清理器（见 §8）。

## 7. 相关代码锚点

- 破产判定与触发：`packages/server/src/economy/Bankruptcy.ts:47-63`、`:86-114`
- 破产重开（造币证据）：`packages/server/src/economy/Bankruptcy.ts:154-172`
- 数值变更与钳制：`packages/server/src/economy/EconomyService.ts:24-40`（`:34`）
- 持股上限与释放：`packages/server/src/economy/Ownership.ts:57-75`（`:60`）、`:122-124`、`normalizeOwnerships` `:16-36`
- 租金结算（全额或拒绝）：`packages/server/src/handlers/propertyHandler.ts:560-635`（`:575-580`）
- 购买可负担性预检：`packages/server/src/handlers/propertyHandler.ts:250`、`:774-781`
- 税收计算与死区：`packages/server/src/economy/Taxation.ts:267-309`
- 事件扣减：`packages/server/src/behavior/BehaviorEngine.ts:140`
- 离线冻结与有效状态：`packages/server/src/world/PlayerManager.ts:256-329`

## 8. 未决 / 后续建议

以下方向本轮未拍板，留待后续讨论与实施：

- **归股释放（玩家主动退出）**：机制价值真实（饱和态下格位满员、无人能接盘，退回系统是唯一流动性出口）。若采纳，建议**无偿释放**，或把回报设为非货币字段并设上限；若给货币回报，须来自玩家间转移而非系统，且需防「按 `purchasePrice` 全额退款」的套利。注意释放会经 `normalizeOwnerships`（`Ownership.ts:31-35`）**隐性增厚剩余股东**（份额归一），需显式承认。
- **长期离线清理**：判定数据（`lastActiveAt`）已就绪。建议动作 = 释放全部股份（复用 `clearPlayerAssets`）+ 置为休眠/破产态，**不删号**（避免排行榜 / 成就 / 纪念碑对玩家 id 的引用悬空）；阈值可配置并留宽限期，避免误伤短期离线。
- **已触底者的清算判定**：为 §3.3 的僵尸态提供独立兜底（与长期离线清理同源，本质是同一个「回收通道」问题）。