# 事件结算与行为配置边界修复

## 已实施

- 事件格只有在 `EventHandler.handleEventCell()` 成功返回结果时，才派发 `DomainEvents.AnyPlayerLandsEvent`；行为配置缺失、行为引擎未注入、行为加载/执行失败时不会触发投资事件。
- BehaviorEngine 的行为目录由组合根基于已解析地图路径显式注入，不再依赖服务启动时的当前工作目录。
- 服务启动时预加载地图引用的 `behaviorPass` / `behaviorLand` 配置，配置文件不存在或 JSON 结构无效时直接失败。
- 投资触发器 `investmentTriggers[].on` 在地图加载后校验为已知域事件，当前允许的事件来自 shared `DomainEvents`。
- 客户端仅向当前受影响股东展示投资事件个人明细；金额来自服务端 `affectedPlayers[].amount`，不在客户端重复结算；收益/损失分别使用 success/warning 通知类型；无有效股东时不产生个人通知。

## 保留的架构技术债

- 多玩家结算仍使用逐字段 `server.valueChanged`，暂不引入 `economicSettlement` 批次协议；内测期间只观察最终一致性与中间态。
- 当前经济锁仍为格子级，暂不引入玩家级锁或 Redis 跨实例锁；仅在异步经济链路或多实例部署前重新评估。
- 服务端通知仍由各 handler 就地发送，暂不重建 NotificationManager。
