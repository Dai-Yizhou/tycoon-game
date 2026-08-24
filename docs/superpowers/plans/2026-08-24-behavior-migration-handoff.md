# 行为系统迁移进度交接

> 保存时间：2026-08-24
> 开发分支：`dev-Dai`
> 主规格：[2026-08-23-cell-behavior-models-3.md](./2026-08-23-cell-behavior-models-3.md)

## 当前结论

行为系统迁移已完成主干接入，但尚未完成清理和闭环验收。下一阶段暂停继续扩展行为操作，先实现独立运行时状态存储；状态存储完成后再删除旧事件模型、迁移所有遗留测试，并补齐行为引擎的 ownership/position 操作。

## 已完成

- 地图契约切换到 v2，格子类型为 `empty`、`supply`、`monument`、`property`、`investment`、`jail`、`transport`、`event`。
- `start` 类型已由 `supply` 替代，起点由 `mapMeta.startCellId` 表示。
- 格子数据已使用顶层 `type`、`name`、`description`、`regionId`、`timezone`、`theme`、UCT 费用字段。
- 移动路径已区分 `behaviorPass` 和 `behaviorLand`，途经格先执行 pass，最终格再执行 land/native settlement。
- 行为 JSON 已放到服务端地图目录的 `behaviors/` 下。
- BehaviorEngine 已支持 value UCT、player/region 字段、single/team/region/globe 目标的基础解析和独立/互斥效果选择。
- 纪念碑、交通、监狱、地产、投资主要结算路径已迁移到完整 UCT。
- 投资触发已使用 `investmentTriggers[].on` 域事件；已接入 `any-player-lands-event` 和 `shareholder-bankrupt`。
- `client.triggerInvestmentEvent`、生产代码中的旧 `eventImpacts` 和 `defaultEventImpact` 已删除。
- UCT 文本格式化已支持 `valueFieldDefinitions` 的 i18n 名称。
- 客户端主要地图读取、悬浮卡片、时区、价格和 UCT 展示已迁移到 v2 顶层字段。

## 尚未完成与残留

### 旧事件模型

- `packages/server/src/events/EventHandler.ts` 仍保留旧随机事件回退流程。
- `EventRegistry.ts`、`EventEffects.ts`、`eventTemplates.ts` 仍被生产代码引用。
- 旧流程依赖信用值概率选择事件，与行为 JSON 的统一配置模型并存。
- 旧测试仍使用 `eventImpacts`、`defaultEventImpact` 和已删除的 `triggerInvestmentEvent` API。

### BehaviorEngine 未完成能力

- `ownership` 和 `position` 操作仅定义类型，尚未在执行器中真正执行。
- `$ref` 目前主要支持 `$actor.<field>`，尚未覆盖所有允许的 weight、share、cellId 和运行时引用。
- 执行结果中的 `target` 仍固定为 `single`，没有完整反映实际目标。
- 行为执行仍直接修改玩家值和地图区域，尚未统一通过状态服务和结算服务。

### 运行时状态边界

- `cell.extra` 仍保存 `ownerships`、`owners`、`level`、`accumulatedValue`、`projectOwner`、`projectState` 等动态状态。
- `Ownership`、`PropertyHandler`、`InvestmentHandler`、`Bankruptcy`、`MonumentHandler` 仍直接读写这些 `extra` 字段。
- `WorldStore` 当前快照版本为 v1，并把静态 `mapData` 与动态修改后的 `cell.extra` 一起持久化。
- 运行时区域值虽然已有 `GameWorld.regionValues`，但还未抽象成统一的 `WorldRuntimeState`。

### 结果类型和固定字段

- `RepairResult` 仍暴露 `cost`、`creditIncrease`、`prosperityIncrease` 等旧固定字段。
- `TransportResult.cost` 仍为 number，未完全表达目的地 UCT。
- 破产重启结果仍显式返回 `startingMoney`、`startingCredit`。
- 客户端部分旧状态字段仍存在，例如 `currentMoney`、`currentCredit`、`currentEnv`，短期可作为 UI 投影，长期应改为动态 value map。

## 当前验证基线

- Shared 全量测试：89 项通过。
- Server v2 投资与所有权定向测试：通过。
- Server TypeScript build：通过。
- Client TypeScript 检查及相关 v2/UI 测试：通过。
- Server 全量测试尚未通过，主要失败来自旧 v1 地图夹具、缺失的旧 `EraManager` 文件和已有 SocketManager 限流测试问题。

## 后续约束

- 状态存储完成前，不继续扩展 BehaviorEngine 的 ownership/position 操作。
- 不再向 `Cell.extra` 增加新的运行时状态。
- 不恢复已删除的客户端投资事件入口。
- 不通过兼容 fallback 掩盖旧测试或旧配置错误；旧测试应迁移或删除。
- 状态存储迁移完成后，必须重新审计行为系统，确认所有行为操作通过统一状态和结算边界执行。
