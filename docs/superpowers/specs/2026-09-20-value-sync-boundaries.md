# 数值同步边界（value-sync boundaries）

- 状态：已确认（决议记录 + 交接写字边界）
- 日期：2026-09-20
- 关联：`specs/2026-09-16-D8-value-system.md`（展示边界）、`reviews/2026-09-19-value-sync-analysis-rebuttal.md`、`specs/2026-09-19-value-sync-strategy.md`

## 0. 一句话
服务端永远权威；状态变化时按域下发**绝对值**作客户端展示依据；重连时 + 低频全量校验兜底；客户端仅保留**一份**可写游戏状态作为权威镜像。

## 1. 权威边界（谁决定）

| 状态 | 权威方 | 读取/展示 | 说明 |
|---|---|---|---|
| 玩家数值 `values[field].current` | 服务端 `player.values` | 客户端镜像 | 变更后按域广播绝对值 |
| 区域数值 `region UCT` | 服务端 `WorldRuntimeStateStore` | 客户端镜像 + 同构预览 | 昼夜相位另走时钟通道 |
| 格子 runtime（归属/等级/ownerSet） | 服务端 runtime store | 客户端镜像 | 身份映射，非 UCT 字段 |
| 移动/回合/行动态 | 服务端 `server.playerMove`/回合 | 客户端投影/动画 | 与数值域不同粒度 |
| 社交（聊天/榜/成就/组队） | 服务端 | 客户端独立通道 | 不入权威数值域 |

## 2. 同步的 5 类状态域（前次会议收敛）

1. **移动/回合**：位置路径、当前玩家、是否能行动/冷却。
2. **定位 runtime**：cell 归属身份（ownerSet/ownerships）、等级。
3. **数值**：即得 D8 modifier 变量表（`price/rent/upgradeCost/teleportCost/invDelta/jailCost/repair`）+ `level/ownerCount`。
4. **区域时钟**：`dayRatio`/相位（`region.time` 属此，不在变量表、非数值变更）。
5. **社交**：聊天、榜单、成就、组队。

> 数值域（3）与区域时钟（4）分离：`region.time` 不在 BASE_FIELDS，不由数值变更驱动；由服务端低频下发 `dayRatio`，客户端本地推演。

## 3. 消息契约（原则）
- **按域发绝对值**，客户端**直接覆写**，不做累加。丢/乱件由下一次广播自然自愈。
- `server.valueChanged` / `server.regionValueChanged` 现存即为绝对值（`current` / `value`），本契约仅是**收拢发射点 + 明确"覆写"语义**，非新增 delta 语义。
- **不引入服务端版本号/gap-resync**（状态量小，绝此复杂）。收敛依靠：绝对值覆写静默自愈 + 重连全量 + 低频心跳摘要核对。
- 结算敏感值（购买/租金实付）保留 **ack 返回实付额**（D8 既有），客户端以 ack 为最终展示。

## 4. 客户端展示边界（维持既有决议，不逆向）
- **两端同构求值仅用于展示层乐观预览 / `base→final`**，不入库、不作为扣款依据，最终以服务端广播/ack 为准。
- **仅允许查看当前格子**（宽松不加防护，记录在案）；他者字段是否全量下发**另立议题**，本次不并入。

## 5. 客户端单一状态源（本计划前置于一切的前置项）
- 全客户端**只有一份可写 `GameStore.snapshot`**。
- 消除：`SocketEventHandler` 默认 `new GameStore()`（footgun）、`LoadingPage` 冗余实例。
- `GameViewModel`/`cellDisplayModel`/`GameController` 只读投影于该 snapshot。

## 6. 生命周期
- 登录/重连：`client.login` 幂等全量（已具备）。
- 会话中：按域绝对值广播。
- 兜底：低频心跳（30s 摘要：自己关键数值哈希/版本摘要），服务端比对不一致才补发对应域（可选，低成本）。

## 7. out of scope
- 服务端 worldRevision + gap-resync 协议（否决）。
- 客户端预测-回滚（否决，数值敏感）。
- 他者全字段下发（另议）。
- 队列/锁串行化——`changeValue` 同步、Node 单线程已串行；仅需审查 handler 内跨 await 的 check-then-act（独立编码审查，不在本计划）。