# Bug: 聊天区限频可被绕过

> Status: FIXED
> Mode: (default)
> Severity: functional
> Last updated: 2026-09-03

## Symptom
聊天发送链路没有玩家级限频。SocketManager 仅按 socket 统计所有事件，切换频道或使用多个连接可绕过聊天限制。

## Expected
普通聊天以及 `/global`、`/region`、`/team` 指令应共享同一玩家级限频；系统消息不应被玩家限频影响。

## Reproduction
- 测试：`packages/server/tests/chat/ChatRateLimit.test.ts`
- 修复前：同一玩家连续发送 3 条（上限 2）和跨 global/region 发送均未拒绝；3 次连续失败。
- 修复后：回归测试通过；移除修复后连续 3 次恢复失败。

## Hypotheses & diagnosis
| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H1 | ChatManager 没有玩家级发送计数，普通聊天直接写入历史 | confirmed | 修复前直接连续调用 `sendMessage` 均返回消息，测试稳定失败 |
| H2 | SocketManager 的连接级总事件限流可以覆盖聊天需求 | eliminated | 限流按 socket.id 维护；跨频道共用路径但玩家级语义不存在，多连接也可分散计数 |

## Root cause
聊天消息由 ChatManager 统一创建，但 ChatManager 原先只校验频道、内容和历史长度，没有按 senderId 维护时间窗口。SocketManager 的限流维度是连接而非玩家，不能防止同一玩家通过多个连接或多个频道发送。

## Fix
- `packages/server/src/chat/ChatManager.ts`
  - 新增 `maxPlayerMessagesPerMinute`，默认 10。
  - 在所有玩家消息进入历史前按 senderId 共享 60 秒窗口计数。
  - 系统消息 senderId 为 null，不计入限频；clear 同时清除限频状态。
- `packages/server/tests/chat/ChatRateLimit.test.ts`
  - 覆盖超额拒绝、跨频道不可绕过、窗口过期恢复。

## Verification
- V-1：回归测试修复后 GREEN。
- V-2：仅 stash 修复代码后回归测试 RED；连续 3 次均失败。
- V-3：server lint、build、全量 test GREEN（43 suites / 281 tests）。
- V-4：pattern search 确认普通聊天与三类频道指令均经过 ChatManager.sendMessage。

## Pattern analysis
| 搜索方式 | 命中数 | 是否本次同类隐患 |
|---|---:|---|
| `ChatManager.sendMessage` 调用链 | 2 个主要入口 | 否；两条入口均已统一进入玩家级限频 |
| `FeedbackManager.submit` | 1 | 否；反馈已有独立的每玩家每分钟 3 次限流 |
| `SocketManager.consumeRate` | 1 | 否；保留作为连接级总事件保护，不替代聊天业务限频 |

## Open questions / Follow-ups
当前限频为单进程内存状态；若部署多实例且需要跨实例一致限频，应单独评估共享存储方案，不在本次修复中引入。
