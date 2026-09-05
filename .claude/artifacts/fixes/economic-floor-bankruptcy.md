# Bug: 经济操作下限截断后未触发破产

> Status: FIXED
> Mode: (default)
> Severity: functional
> Last updated: 2026-09-04

## Symptom
经济扣款会由 EconomyService 截断到字段 min，但 Bankruptcy 原有判定只检查 current < min，因此扣款触底时不会触发破产。

## Expected
允许部分扣款；实际值最多扣到 min；当一次经济变更使字段从高于 min 触达 min 时，沿用现有破产流程立即将玩家标记为破产并清理资产。玩家初始或普通同步时合法处于 min 不应被误判破产。

## Reproduction
- 测试：`packages/server/tests/economy/EconomyService.test.ts`
- 触发：玩家 money=5、min=0，调用 `changeValue(..., -20, ...)`。
- 修复前：实际 current=0、delta=-5，但 status 保持 normal。
- 反向验证：仅移除 Bankruptcy 修复后测试失败。

## Hypotheses & diagnosis
| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H1 | 破产判定使用 `< min`，而 EconomyService 将结果截断为 `=== min` | confirmed | 代码直接显示 clamp 到 min；回归测试修复前 current=0 但 status=normal |
| H2 | 仅改为 `<= min` 即可解决 | eliminated | 会把初始合法 min 值误判；现有 `bankruptcy socket authority` 测试明确要求合法最小值保持 normal |
| H3 | 可从 playerUpdated 事件对象中直接读取修改前数值 | eliminated | PlayerManager 保存可变 Player 引用，事件发生时对象已经是修改后状态，无法从事件对象恢复 previous |

## Root cause
EconomyService 采用部分扣款并将数值 clamp 到 min，但 Bankruptcy 监听器没有记录修改前的数值，因此既不能识别“跨越到 min”，也不能简单用当前值判断。缺少可靠的 previous-value 基线导致触底不会破产，而直接使用 `<=` 又会误伤初始合法下限状态。

## Fix
- `packages/server/src/economy/Bankruptcy.ts`
  - 对 playerAdded 和构造时已有玩家建立数值基线。
  - playerUpdated 时比较 previous > min 且 current <= min，只在本次变更触底时触发现有破产流程。
  - cleanup 时清理监听器和数值基线。
- `packages/server/tests/economy/EconomyService.test.ts`
  - 增加部分扣款后触底破产回归测试。

## Verification
- V-1：修复后 EconomyService 触底回归测试 GREEN。
- V-2：既有破产边界测试 GREEN。
- V-3：仅 stash Bankruptcy 修复后，触底回归测试 RED。
- V-4：Server lint、build、全量测试 GREEN（44 suites / 286 tests）。
- V-5：经济分配回归测试 GREEN（Jail 股东不重归一、新股东/Bankrupt ownership 变更按新结构处理）。

## Regression test
- `packages/server/tests/economy/EconomyService.test.ts`
- 名称：`触底后按现有破产机制立即将玩家标记为破产`

## Pattern analysis
| 搜索方式 | 命中数 | 是否本次同类隐患 |
|---|---:|---|
| `current < (field.min` 破产边界搜索 | 1 | 已修复为基于变更前后值的触底判断 |
| `changeValue` 经济入口 | 多个调用点 | 否；均复用 EconomyService，触底会通过 playerUpdated 进入统一破产判定 |
| `playerUpdated` 监听 | Bankruptcy、排行榜等 | 否；排行榜只标记刷新，不处理经济状态 |

## Open questions / Follow-ups
结算级批次广播和跨实例玩家级经济锁仍未实施；这两项涉及协议/部署架构，不属于本次“部分扣款后触底破产”的业务修复。
