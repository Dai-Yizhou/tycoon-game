# Bug: 监狱冷却未结束时掷骰按钮提前解禁

> Status: FIXED
> Mode: default
> Severity: functional
> Author: user
> Last updated: 2026-08-22

## Symptom
玩家仍在监狱且监狱冷却未结束时，普通掷骰冷却结束后按钮提前解除禁用。

## Expected
监狱冷却结束前按钮始终禁用；监狱冷却结束后才允许掷骰。

## Reproduction
- 测试位置：`packages/client/tests/new-ui-components.test.ts`
- 场景：监狱状态结束时间在未来，普通冷却结束时间已在过去。
- 修复前结果：按钮 `disabled` 为 `false`。
- 修复后结果：测试稳定通过，按钮 `disabled` 为 `true`。

## Hypotheses & diagnosis
| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H1 | HUD 只检查普通 `rollCooldownEnd`，没有检查监狱结束时间 | confirmed | 回归测试在 `rollCooldownEnd` 已过期、`jailEndTime` 未来时复现；原 `GameHudShell.updateDiceButton()` 只读取普通冷却。 |
| H2 | 服务端监狱冷却配置或广播时间错误 | eliminated | 服务端 `DiceHandler` 已按 `PlayerStatus.Jail` 返回 `JailHandler` 的 `cooldownMs`，现象可由客户端状态组合单独复现。 |

## Root cause
客户端 HUD 将普通掷骰冷却视为唯一禁用条件。监狱状态切换时 Store 保留了 `isInJail` 与 `jailEndTime`，但 HUD 没有使用 `jailEndTime`，因此普通冷却结束后按钮提前启用。

## Fix
- `packages/client/src/components/GameHudShell.ts`：新增监狱冷却判断，并与普通冷却共同决定按钮可用性。
- `packages/client/src/game/systems/GameLogic.ts`：发送掷骰前同时阻止未结束的监狱冷却，避免非 UI 入口绕过按钮状态。
- `packages/client/tests/new-ui-components.test.ts`：增加监狱冷却未结束时按钮保持禁用的回归测试。

## Verification
- V-1：回归测试修复前失败，确认测试能够捕获原问题。
- V-2：修复后 `pnpm exec jest --runInBand tests/new-ui-components.test.ts` 通过，5 个测试通过。
- V-3：客户端 lint、build，以及相关 Store/HUD 测试通过。
- V-4：`git diff --check` 通过。

## Regression test
- 路径：`packages/client/tests/new-ui-components.test.ts`
- 名称：`监狱冷却未结束时即使普通冷却结束也保持禁用`

## Pattern analysis
| 搜索方式 | 命中数 | 是否本次同类隐患 |
|---|---:|---|
| `rollCooldownEnd` 客户端引用 | 7 | HUD 与掷骰入口均已补充监狱结束时间检查；其余为状态存储或投影。 |
| `isInJail` 客户端引用 | 10 | 监狱状态事件仍由服务端驱动，未发现另一个按钮禁用入口。 |

## Open questions / Follow-ups
- 服务端仍是最终裁判；客户端时间判断只用于避免明显的提前点击，网络时钟偏差仍由服务端 ACK 拒绝路径兜底。
