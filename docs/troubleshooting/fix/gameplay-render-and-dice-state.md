# Bug: 玩家棋子、摄像机和二次掷骰状态未同步

> Status: FIXED
> Mode: default
> Severity: functional
> Last updated: 2026-08-19

## Symptom

玩家登录后看不到自己的棋子，摄像机不跟随服务端位置；第一次掷骰只出现系统消息，后续掷骰按钮没有响应。

## Expected

当前玩家应在服务端位置显示，服务端移动事件应更新棋子和摄像机；掷骰成功后应结束动画和冷却状态，按钮恢复可用。

## Diagnosis

| 假设 | 结论 | 证据 |
|---|---|---|
| Store 中的玩家没有同步到旧渲染状态桥 | confirmed | 页面测试在修复前读取模块状态得到 `undefined`，而 `GameStore` 已有玩家快照 |
| GameViewModel 的移动切片没有响应 Store 的掷骰状态 | confirmed | Store `setCanRoll(false)` 后 ViewModel 监听器未被调用 |
| 服务端没有返回掷骰结果 | eliminated | 服务端 `DiceHandler` 先 ACK 成功，再广播 `server.diceRolled` |

## Root cause

GameStore、GameViewModel 和遗留模块状态之间没有完整的同步桥。GamePage 的渲染和 HUD 仍读取遗留变量，而服务端事件主要写入 GameStore。掷骰成功后只更新遗留 `diceAnimating` 和冷却状态，Store 中的可掷状态没有完整投影到 HUD，导致后续点击被状态门控拦截。

## Fix

- GamePage 订阅 GameStore，把当前玩家、位置、其他玩家和 `canRoll` 同步到遗留系统。
- GameViewModel 从 Store 投影 `canRoll`，并在 Store 发布时通知玩家、移动和聊天订阅者。
- GameLogic 将掷骰动画和冷却完成状态写回 Store。
- SocketEventHandler 在服务端移动事件后同步玩家位置并刷新 HUD。
- ClientRenderLoop 每帧使用 Store 位置更新渲染和摄像机目标。

## Verification

- Client TypeScript：通过
- Client 全量测试：14 个套件、97 个测试通过
- Client production build：通过
- 修改文件 ESLint：0 个错误，保留既有 warning
- `git diff --check`：通过

## Regression tests

- `packages/client/tests/pages.test.ts`
  - GamePage 初始化同步当前玩家到渲染状态桥
  - 掷骰按钮使用已认证 Socket
- `packages/client/tests/game-store-authority.test.ts`
  - 掷骰完成后可恢复下一次操作
  - ViewModel 响应 Store 掷骰状态变化

## Follow-ups

- MovementSystem 的动画展示字段仍有遗留模块状态，后续可单独迁移到 GameStore。
- Vite 对 GameLogic 的动态/静态混合导入仍有既有 chunk warning，不影响构建结果。
