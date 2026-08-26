# 8 类格子速查表

> 每个格子必填的公共字段：`id`、`x`、`y`、`type`、`name`（i18n）、`description`（i18n）、`destinations`（有向边）、`regionId`。
> `踩中`= 掷骰移动后停在该格；`经过`= 移动路径经过（不含停靠格）。`踩中` 是 `经过` 的一种情况。

| 类型 | 触发 | 行为 | 专属字段 |
|---|---|---|---|
| `empty` | 无 | 什么都不做，可有描述 | — |
| `supply` | 经过/踩中 | 经过触发 A（`behaviorPass`）；踩中先 A 再 B（`behaviorLand`） | `behaviorPass`、`behaviorLand`（均必填） |
| `monument` | 踩中（可选） | 可选修缮一次：付 `repairCost`，得信用、区域繁荣升 | `repairCost`（UCT） |
| `property` | 踩中（可选） | 未持股可购；持有可升（`upgradeCost`）；他人踩中按持股分红（`rent`） | `maxOwnerCount`、`buyInMultiplier`、`price`、`maxLevel`、`rent[]`、`upgradeCost[]` |
| `investment` | 条件触发 | 可购；持有者在条件触发时收/付（与位置无关） | `maxOwnerCount`、`buyInMultiplier`、`price`、`investmentTriggers[]` |
| `jail` | 踩中 | 已实现：延长 cooldown、降信用、期间禁用收款 | `jailCooldown`、`jailCost` |
| `transport` | 踩中选路 | 普通相邻格可去；停靠时可选传送（付费，不掷骰） | `teleportDestinations[]` |
| `event` | 踩中 | 按加权随机触发行为 | `behaviorLand` |

## 逐类要点与正负号

### `empty`
无任何配置。经过/踩中均为零效果、不广播。

### `supply`
- 经过 → 执行 A（`behaviorPass` 指向的行为）。
- 踩中 → 先 A 再 B（`behaviorLand`）。
- 两个钩子都**必填**，指向 `behaviors/` 里的行为 JSON 的 id。
- 例：经过 +10 现金 → `behaviorPass` 指向一个 `delta.money=10` 的行为。

### `monument`
- 踩中时**可选**：玩家可选择是否修缮。
- 修缮只限一次，支付 `repairCost`，通常"扣钱 + 加信用 + 区域繁荣升"：
  ```jsonc
  "repairCost": { "player": { "money": -20, "credit": 5 }, "region": { "pros": 10 } }
  ```

### `property`
- 踩中且未持股且未满 `maxOwnerCount`：可选购买，支付 `price`。
- 踩中且已持股且未满 `maxLevel`：可选升级，支付 `upgradeCost[当前级]`。
- 任一不持股玩家踩中 → 向**所有持股且未被禁用收款的玩家**分发 `rent[当前级]`。
- 单人持股价 = `price × buyInMultiplier`；合租按股比计算。
- 升级费用是数组，下标=目标等级，例 `upgradeCost[0]` 升到 1 级。

### `investment`
- 踩中未持股且未满 `maxOwnerCount`：可选购买，支付 `price`。
- 不再靠"踩中"触发！而是**条件触发**：声明 `investmentTriggers` 订阅全局域事件。
  ```jsonc
  "investmentTriggers": [
    { "id": "div-on-event", "on": "any-player-lands-event",
      "delta": { "player": { "money": 5 }, "region": { "pros": 1 } } },
    { "id": "loss-on-bankrupt", "on": "shareholder-bankrupt",
      "delta": { "player": { "money": -3 } } }
  ]
  ```
- 触发时作用于**全部持股且未被禁用收款的股东**，按股比分配 `delta`。

### `jail`
- 踩中：延长 `jailCooldown`、扣 `jailCost`、该期间禁用收款。
- 例：`{ "jailCooldown": 8000, "jailCost": { "player": { "credit": -3 } } }`

### `transport`
- 与很多格相连，连接**不一定双向**（`destinations` 只是有向边）。
- 普通相邻格：停靠后岔路可选前往。
- 传送：**停靠在该 transport 格时**可选前往 `teleportDestinations`，付费、不掷骰：
  ```jsonc
  "teleportDestinations": [
    { "cellid": 3, "cost": { "player": { "money": -10 } } }
  ]
  ```

### `event`
- 踩中时触发 `behaviorLand` 指向的行为。
- 行为按加权随机命中；内部可用 `exclusive` 区分"互斥"与"独立"效果。
- 详见 `behaviors/` 与 `skills/mapcraft/`（`mapcraft.md` / `spec.md` / `examples.md`）。

## 公共字段速记

```jsonc
{
  "id": 0, "x": 0, "y": 0,
  "type": "...",
  "name": { "zh-CN": "", "en-US": "" },
  "description": { "zh-CN": "", "en-US": "" },
  "destinations": [0, 1],
  "regionId": "r1",
  "timezone": 0
}
```

> `regionId` 必须引用 `map-meta.json` 里已声明的区域 id。