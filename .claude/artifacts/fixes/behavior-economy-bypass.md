# Bug: BehaviorEngine 绕过 EconomyService 直接修改玩家数值

> Status: FIXED
> Mode: (default)
> Severity: functional
> Last updated: 2026-09-05

## Symptom
BehaviorEngine 虽然接收 economy 注入，但 value operation 仍直接修改 Player.values.current。

## Expected
行为配置中的玩家数值变更应统一经过 EconomyService，复用下限/上限截断、playerUpdated、成就回调和统一变更结果语义；区域数值仍使用 WorldRuntimeStateStore 的区域变更入口。

## Reproduction
- 测试位置：`packages/server/tests/behavior/behavior-contract-v2.test.ts`
- 触发：向 BehaviorEngine 注入 EconomyService，执行 `contract-test`。
- 修复前：注入的 `changeValue` 调用次数为 0。
- 修复后：`changeValue('p1', 'credit', 5, 'behavior:contract-test')` 被调用。
- 反向验证：临时移除 BehaviorEngine 修复后回归测试重新失败。

## Hypotheses & diagnosis
| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H1 | value operation 直接写入 target.values，导致 economy 注入未使用 | confirmed | 原代码在 BehaviorEngine 中直接赋值；注入 EconomyService 的 spy 调用次数为 0 |
| H2 | 调用方未把 EconomyService 注入 BehaviorEngine | eliminated | app.ts 已以 `{ economy }` 创建 BehaviorEngine；失败测试直接注入同一实例仍不调用 |
| H3 | 经济旁路仅存在于测试路径，不影响生产 | eliminated | app.ts 的行为引擎用于 EventHandler、property、investment 等生产事件路径 |

## Root cause
BehaviorEngine 的构造接口已经预留 economy，但实例没有保存该依赖，value operation 仍自行执行 clamp、updatePlayer 和结果计算。生产行为事件因此绕过 EconomyService 的统一经济写入路径。

## Fix
- `packages/server/src/behavior/BehaviorEngine.ts`
  - 保存注入的 EconomyService；未注入时使用当前 world 创建默认实例。
  - 玩家 value operation 改为调用 `economy.changeValue()`。
  - 失败结果抛错，沿用现有行为原子回滚路径。
  - valueChanges 使用 EconomyService 返回的 previous/current/delta。
- `packages/server/tests/behavior/behavior-contract-v2.test.ts`
  - 增加注入 EconomyService 的回归测试。

## Verification
- V-1：修复前注入 economy 的回归测试 RED。
- V-2：修复后行为 contract/region 定向测试 GREEN（2 suites / 9 tests）。
- V-3：临时移除 BehaviorEngine 修复后回归测试 RED。
- V-4：Server lint GREEN，仅保留既有 2 个 warning。
- V-5：Server build GREEN。
- V-6：Server 全量测试 GREEN（44 suites / 287 tests）。

## Regression test
- 路径：`packages/server/tests/behavior/behavior-contract-v2.test.ts`
- 名称：`applies value operations through the injected EconomyService`

## Pattern analysis
| 搜索方式 | 命中数 | 是否本次同类隐患 |
|---|---:|---|
| `BehaviorEngine` 中 `target.values` 直接写入 | 1 | 已修复 |
| 服务端经济直接创建 `new EconomyService(world)` | 5 | 否；这些是缺省依赖回退，已有调用方会传入共享实例 |
| `world.updatePlayer` 的数值写入路径 | 多个 | 否；位置/快照恢复等非经济路径不属于本次 value operation |

## Open questions / Follow-ups
结算级批次广播和跨实例玩家级经济锁仍未实施，已记录在 ARCHITECTURE.md。事件行为失败不触发投资域事件、投资事件股东通知和域事件常量已在后续修复中完成。
