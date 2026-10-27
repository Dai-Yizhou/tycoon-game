# 股份释放功能边界

## 1. 目标

为地产（property）与投资项目（investment）增加"释放股份"动作：持股玩家主动退出，按释放时的 `price` 获得返还，并交还该格股份。

本文件只定义边界，不包含实现。

## 2. 前置核查结论

### 2.1 区域值触底是否导致破产

不会，且现有实现已经满足"不破产、区域仍可进入"。

- 区域数值存放在运行时区域状态中，`changeRegionValue` 按字段定义的 `min/max` 钳制；`pros` 的 `min = 0`，因此区域值不会低于 0。
- 破产判定只遍历 `player.values`，不读取任何区域值。
- 不存在"区域值低于阈值即禁止进入该区域"的规则。

结论：本项无需改动，也不需要为股份释放额外加保护。

### 2.2 是否存在运行时修改状态/配置的调试方法

不存在应用内的运行时修改入口。

- 仅支持启动期环境变量 `DEBUG_FLAGS`；实际生效的只有 `show-debug-info`、`tutorial`、`onboarding` 与日志级别。
- `cheat-economy`、`quick-reset`、`inject-test-data` 等只是 `DebugFeatures` 常量占位，全仓无实现。
- REST 仅有 `/health`、`/`、`/api/map`；Socket 无开发态改值事件。
- `map-meta.json` 等配置在启动时加载，修改配置需重启；运行时状态在 MongoDB，只能直接改库或重置 `WORLD_ID` 使用临时新档。

结论：若后续需要"边玩边改"，需要单独新增受 `DEBUG_FLAGS` 保护的调试事件；本文件不设计该能力。

## 3. 已确认决策

- 返还金额：按**释放时的完整 `price`** 返还，不按持股比例折算。一份股份对应一次 `price`。
- 资金来源：**凭空增发（银行回购）**，无单一付款方。
- 位置约束：**与现有购买/升级一致，不校验玩家是否就在该格**，只校验持股关系。
- 释放粒度：**整份释放**，一次释放该玩家在该格的全部持股，不支持部分释放。
- 释放属于"本次停留的一次行动"，与该格其他动作互斥。
- 适用范围：`property` 与 `investment` 两种可持股格子。

## 4. 返还口径

### 4.1 价格解析

释放时的 `price` 与该格"现在有新股东买入时的价格"同口径：

- property：`level = 0`，`ownerCount = 当前持股人数`，`payer = 释放者`，按现有 `valueModifier` 规则解析。
- investment：`level = 当前等级`，`ownerCount = 当前持股人数`，`payer = 释放者`，按现有 `valueModifier` 规则解析。

解析结果复用现有 `resolvePurchasePrice` 语义，不引入新公式。

### 4.2 返还字段

- 只返还 `price.player` 中的字段；`price.region` 部分不返还（与购买时 `applyUct` 只结算 `player` 部分一致）。
- 逐字段按绝对值返还（与 `getUctCost` 使用 `Math.abs` 的口径一致），多字段时分别入账。
- 不按持股比例折扣，也不向其他股东分摊。
- 入账走 `EconomyService.changeValue`，因此仍受字段 `max` 钳制；超过上限的部分直接截断。
- 返还是收入，不触发破产判定。

### 4.3 价格缺失

- `price` 缺失或 `price.player` 为空：拒绝，返回 `no_price`（与购买一致）。
- `price` 引用了玩家身上不存在的字段：拒绝，返回 `no_price`（与购买预检一致）。
- `price` 为 0：允许释放，返还为 0。

## 5. 持股与状态边界

- 只有在该格 `share > 0` 的玩家可以释放；否则返回 `not_owner`。
- 状态判定沿用同格购买动作的现状：
  - property：拒绝 `Bankrupt` 与 `Frozen`。
  - investment：使用 `participatesInEconomy`（`Normal` / `Frozen` 可参与）。
- 已知不一致：property 与 investment 对 `Frozen` 的购买资格口径不同。本次不为释放动作单独统一，保持与各自购买动作一致；若后续统一状态口径，释放随之调整。

## 6. 持股结构变化

- 释放后剩余股东按现有平均持股规则重新归一为 `1/(n-1)`。
- 剩余股东的 `purchasePrice` 记账值不修改。
- 部分释放不影响 `accumulatedValue`。
- 最后一名股东释放后：
  - 所有权清空；
  - `level` 重置为 0；
  - `accumulatedValue` 重置为 0；
  - 该格回到可被重新购买的状态，价格按购买时重新解析。
- 上述行为复用 `replaceOwnerships` 的现有归一与清空逻辑。

## 7. 行动互斥

- 复用各处理器现有的 `actedThisVisit`（以 `playerId:cellId` 为键）：
  - 到达该格（`PlayerPositionChanged`）时复位；
  - 购买、升级、释放任一成功后置为已行动；
  - 同一停留内再次发起任一动作返回 `action_used_this_stop`。
- 客户端 `actionUsedThisTurn` 同样在动作成功后置位，用于禁用动作按钮。
- 释放不消耗额外回合，不产生移动。

## 8. 并发与幂等

- 使用 `EconomicOperationGuard`：
  - 复用现有格子锁键：property 使用 `property:<cellId>`，investment 使用 `investment:<cellId>`，确保释放与购买/升级在同一格上串行；
  - 支持 `requestId` 去重，命中已完成的请求直接回放 ack。
- 与购买一致，通过 `compareAndSwapEconomicVersions(cellId, expectedResourceVersion, expectedCellVersion)` 校验资源/格子版本；失败分别返回 `resource_version_conflict` / `cell_version_conflict`。
- 锁冲突返回 `operation_in_progress`。

## 9. 协议

新增请求事件：

- `client.releaseProperty`：payload 为 `{ cellId, requestId?, expectedResourceVersion?, expectedCellVersion? }`。
- `client.releaseInvestment`：payload 同上。

ack 成功返回 `{ cell, refund: Uct, share }`。

新增广播事件：

- `server.propertyReleased`：`{ cell, playerId, refund: Uct, share, runtime }`。
- `server.investmentReleased`：`{ cell, playerId, refund: Uct, share, runtime }`。

`runtime` 使用现有 `{ ownerships, level, accumulatedValue }` 结构，供客户端直接覆盖格子运行时状态。

不新增 `would_bankrupt` 预检：返还是入账，不会把玩家扣到破产阈值以下。

## 10. 客户端边界

- property 已持股时，动作栏从"仅升级"变为"升级（若未满级）+ 释放"；
- investment 已持股时，动作栏从空变为"释放"；
- 释放按钮的 detail 按当前 `price` 的 `base → final` 展示，与购买/升级成本展示一致；
- `isBankrupt` 或 `actionUsedThisTurn` 时释放按钮禁用；
- 收到释放广播后：
  - 覆盖格子运行时状态；
  - 从本地 `ownedProperties` / `ownedInvestments` 移除该格；
  - 通过 `server.valueChanged` 更新玩家数值展示。
- 新增动作 ID：`release-property`、`release-investment`，与处理器一一对应。

## 11. 行为与消息

- 释放不触发 `behaviorLand`，不派发领域事件。现有 `behaviorLand` 在购买时以 `action: 'purchase'` 触发、升级时另有触发点；释放不复用这些触发语义。若需要释放触发 behavior，需另行确认。
- 建议向聊天框广播一条系统消息，包含释放者、格子名与返还金额；文案走 i18n。

## 12. 已知边界与遗留问题

- 位置不校验（已确认）：服务端只校验持股，不校验 `player.position.cellId`。该宽松口径与现有购买/升级一致，属于既有实现现状。
- property 与 investment 的 `Frozen` 资格口径不一致（见第 5 节），本次不修。
- 返还为增发，`accumulatedValue` 不随释放减少；这是"银行回购"语义，不是股东间转让。
- 不支持部分释放，因此不引入任意比例持股或拆分记账。

## 13. 实现时需要补充的测试

- 单人持有：释放返还完整 `price`，所有权清空，`level` 与 `accumulatedValue` 归零。
- 多人合持：释放者按完整 `price` 获得返还，剩余股东重分为 `1/(n-1)`。
- 多字段 `price`：逐字段返还，`region` 字段不返还。
- 非股东释放：`not_owner`。
- 状态限制：property 的 `Frozen` / `Bankrupt`，investment 的非经济状态。
- 行动互斥：同一次停留内购买后再释放、升级后再释放、释放后再升级均被拒绝。
- 幂等：相同 `requestId` 重复提交返回同一结果，不重复返还。
- 版本冲突：`expectedResourceVersion` / `expectedCellVersion` 不匹配时拒绝。
- 价格缺失或字段缺失：`no_price`。
- 释放后再次购买：格子按当前 `price` 重新可买。
