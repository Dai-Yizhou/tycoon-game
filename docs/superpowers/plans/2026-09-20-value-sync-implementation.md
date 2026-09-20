# Value-Sync 首段实施计划（单一状态源 + 权威绝对值广播收敛 + 时钟/心跳）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让客户端只剩一份可写游戏状态，并把服务端数值按域绝对值广播收敛为单一发射点，为"服务端权威 + 覆写不累加 + 重连/心跳兜底"落地打平基础。

**Architecture:** 先做客户端单一状态源（去 footgun/冗余实例）；再在服务端收敛 5 个 handler 的 `server.valueChanged` 发射为统一发布函数（绝对值不变、兼容现有 wire）；客户端覆写（绝对值）不改 delta。测试沿用 jest（shared/server/client 独立跑）。

**Tech Stack:** TypeScript monorepo（`@game/shared`/`@game/server`/`@game/client`），jest 测试。

**范围**：边界见 `specs/2026-09-20-value-sync-boundaries.md`。本计划只做**首段、可独立生效**的增量；心跳与区域时钟权威化并入 Task 3/4。
**explicit out (本计划不做)：** 服务端 worldRevision/gap-resync、他者全字段下发、客户端预测-回滚。

---

## 文件结构

- 修改（server）：`packages/server/src/net/valuePublisher.ts`（新建）——统一 `publishValueChanged`。
- 修改（server）：5 个 handler + 域事件改用 `publishValueChanged`。
- 修改（client）：`packages/client/src/game/systems/SocketEventHandler.ts`（去默认 store）、`packages/client/src/pages/LoadingPage.ts`（去冗余 store）。
- 测试：server `tests/net/valuePublisher.test.ts`；client `tests/client-state-source.test.ts`（新增）。

---

### Task 0: 客户端收敛为单一 GameStore 来源

**Files:**
- Modify: `packages/client/src/game/systems/SocketEventHandler.ts:52`
- Modify: `packages/client/src/pages/LoadingPage.ts:23`
- Test: `tests/client-state-source.test.ts`（新建）

- [ ] **Step 1: 写失败测试（store 必须显式传入，不得内部 new）**

`packages/client/tests/client-state-source.test.ts`:
```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerSocketHandlers } from '../src/game/systems/SocketEventHandler.js';
import { GameStore } from '../src/state/GameStore.js';

describe('单一 GameStore 来源', () => {
  it('registerSocketHandlers 要求显式传入 store（无默认实例）', () => {
    const store = new GameStore();
    // store 必须通过 options 传入；否则应抛错，而非悄悄 new 第二个
    assert.throws(() => registerSocketHandlers({} as never, undefined as never));
    // 显式传入则无错（以 socket 类型允许的最小桩验证签名不抛）
    // 具体链接测试在 Task 1 补全
    assert.ok(store);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/client && npx jest tests/client-state-source.test.ts`
Expected: FAIL —— 当前 `{ store = new GameStore() }` 默认参数，`registerSocketHandlers({} as never, undefined)` 不会抛错（仍可用默认），断言抛错失败。

- [ ] **Step 3: 实现——去默认实例，改为必填**

`packages/client/src/game/systems/SocketEventHandler.ts:52`:
```ts
export interface SocketHandlerOptions {
  store: GameStore; // 必填，禁止默认实例
}
export function registerSocketHandlers(socket: TypedClientSocket, options: SocketHandlerOptions): void {
```
（其余 `options.store` 读取不变。）

- [ ] **Step 4: 删 LoadingPage 冗余 store**

`packages/client/src/pages/LoadingPage.ts`：删掉 `const gameStore = new GameStore();` 及 `gameStore.setLeaderboardOffline()` 调用，离线状态改由 `controller` 统一持有（`controller.setLeaderboardOffline()`，如不存在则新增在 `GameController` 以状态字段承载；确认调用点）。删除后 `GameStore` import 若不再使用一并移除。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd packages/client && npx jest tests/client-state-source.test.ts && npx jest`
Expected: PASS；client 全套不回归。

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/game/systems/SocketEventHandler.ts packages/client/src/pages/LoadingPage.ts packages/client/tests/client-state-source.test.ts
git commit -m "refactor(client): 收敛 GameStore 单一来源，去注册默认实例与 LoadingPage 冗余"
```

---

### Task 1: 服务端统一数值绝对值发布（收拢 5 handler 发射点）

**Files:**
- Create: `packages/server/src/net/valuePublisher.ts`
- Modify: `packages/server/src/handlers/propertyHandler.ts`、`transportHandler.ts`、`investmentHandler.ts`、`jailHandler.ts`、`monumentHandler.ts`（各 valueChanged 发射点）
- Test: `packages/server/tests/net/valuePublisher.test.ts`（新建）

- [ ] **Step 1: 写失败测试（发布必带绝对值 current）**

`packages/server/tests/net/valuePublisher.test.ts`:
```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { publishValueChanged } from '../src/net/valuePublisher.js';

function fakeIo() {
  const seen: unknown[] = [];
  return { emit: (evt: string, payload: unknown) => { seen.push({ evt, payload }); }, seen };
}

describe('publishValueChanged', () => {
  it('广播 server.valueChanged 且必带绝对值 current', () => {
    const io = fakeIo();
    publishValueChanged(io as never, 'p1', 'money', 750);
    const [e] = io.seen as any[];
    assert.equal(e.evt, 'server.valueChanged');
    assert.equal(e.payload.playerId, 'p1');
    assert.equal(e.payload.fieldId, 'money');
    assert.equal(e.payload.current, 750);
    assert.ok('current' in e.payload);          // 绝对值字段必须存在
    assert.equal(typeof e.payload.current, 'number');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/server && npx jest tests/net/valuePublisher.test.ts`
Expected: FAIL —— 模块不存在（`Cannot find module '../src/net/valuePublisher.js'`）。

- [ ] **Step 3: 实现 valuePublisher**

`packages/server/src/net/valuePublisher.ts`:
```ts
import type { Server } from 'socket.io';
import type { ServerToClientEvents } from '@game/shared';

/** 按域绝对值广播：客户端直接覆写，不累加。current 为结算后权威值。 */
export function publishValueChanged(
  io: Server<ServerToClientEvents>,
  playerId: string,
  fieldId: string,
  current: number,
): void {
  io.emit('server.valueChanged', { playerId, fieldId, current, delta: 0 });
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/server && npx jest tests/net/valuePublisher.test.ts`
Expected: PASS。

- [ ] **Step 5: 替换 5 个 handler 发射点**

在 property/transport/investment/jail/monumentHandler 中，把现有的
```ts
io.emit('server.valueChanged', { playerId, fieldId, current: svc.current, delta });
```
统一替换为
```ts
publishValueChanged(io, playerId, fieldId, svc.current);
```
（`delta` 不再由发射点手填；若个别消费点仍需 delta 另行说明。）

- [ ] **Step 6: 回归验证**

Run: `cd packages/server && npx jest`（含既有 resolution.test 的"ack 实付一致"断言）
Expected: 319+ 全过，无回归。

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/net/valuePublisher.ts packages/server/src/handlers packages/server/tests/net/valuePublisher.test.ts
git commit -m "refactor(server): 数值绝对值广播收敛到 publishValueChanged 单一发射点"
```

---

### Task 2: 客户端绝对值覆写 + 单一 store 消费确认（写测试固化语义）

**Files:**
- Modify: `packages/client/src/state/GameStore.ts`（applyEvent 'value' 断言 current 即绝对值）
- Test: `packages/client/tests/gameStore-absolute.test.ts`（新建）

- [ ] **Step 1: 写失败测试（value 事件 current 为绝对值，覆写非累加）**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GameStore } from '../src/state/GameStore.js';

describe('GameStore 绝对值覆写语义', () => {
  it('value 事件以 current 直接覆写，不累加', () => {
    const store = new GameStore();
    store.applySnapshot({ sequence: 1, currentPlayer: null, regionValues: new Map() } as never);
    store.applyEvent({ type: 'value', sequence: 2, playerId: 'p1', fieldId: 'money', current: 100 } as never);
    store.applyEvent({ type: 'value', sequence: 3, playerId: 'p1', fieldId: 'money', current: 300 } as never);
    // 覆写：第二次应为 300，而非 400
    const player = store.getSnapshot().otherPlayers.find(p => p.id === 'p1');
    assert.equal(player?.primaryValue, 300);
  });
});
```

- [ ] **Step 2: 运行确认（先探明 current 填充路径，若已覆写则标记 PASS 缺口）**

Run: `cd packages/client && npx jest tests/gameStore-absolute.test.ts`
说明：若通过，说明 client 已是"current 绝对值覆写"（无需改实现，仅固化测试）；若失败，按 `current: 300` 覆写修 `applyEvent` 对应分支。

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/state/GameStore.ts packages/client/tests/gameStore-absolute.test.ts
git commit -m "test(client): 固化 value 事件绝对值覆写语义"
```

---

### Task 3: 低频心跳摘要（可选，低成本，无服务器版本号）

**Files:**
- Create: `packages/server/src/net/heartbeat.ts`
- Modify: `packages/server/src/app.ts`（挂 `client.heartbeat` handler）
- Modify: `packages/client/src/game/systems/SocketEventHandler.ts`（周期发摘要）

- [ ] **Step 1: 定义契约（写测试）**

`packages/server/tests/net/heartbeat.test.ts`：服务端收到 `client.heartbeat {digest}`，比对自身权威摘要；不一致时才 `io.to(socket).emit('server.resyncDomain', { domains: [...] })`，否则静默。

- [ ] **Step 2: 实现 + 接线 + 客户端每 30s 发送**

摘要 = 自身数值字段 `values[field].current` 排序拼接 + 简单哈希；`server.resyncDomain` 触发客户端对指定域重拉全量（复用 login 幂等返回的权威字段）。

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/net/heartbeat.ts packages/server/src/app.ts packages/server/tests/net/heartbeat.test.ts packages/client/src/game/systems/SocketEventHandler.ts
git commit -m "feat(server,client): 低频心跳摘要，不一致才补发对应域"
```

---

### Task 4: 区域时钟权威化（dayRatio 域）

**Files:**
- Modify: `packages/server/src/world/DayNightCycle.ts`（把当前相位/`dayRatio` 纳入一处权威提供者）
- Modify: `packages/client`（`isDay`/HUD 改读服务端 `dayRatio` 权威值，删除本地硬编码 0.5 边界）

- [ ] **Step 1: 服务端在 `server.regionValueChanged` 附属下发当日 `dayRatio`（或独立 `server.regionTime` 事件）**
- [ ] **Step 2: 客户端 HUD/`isDay` 改以该权威值为准（本地仅做日期变更时刻的平滑插值）**
- [ ] **Step 3: 补 `isDay` 与 dayRatio 边界的回归测试（对齐既有 0.5 断言）**

---

### Task 5: 回写 ARCHITECTURE.md（纪律必需，非可选）

**Files:**
- Modify: `docs/architecture/ARCHITECTURE.md`

**背景**：ARCHITECTURE.md 短期内未同步。本计划涉及三处新/改语义，必须在合并前跟文档对齐，避免"代码先于文档"再次成为债（L158 已声明单一快照源，但代码此前待清理）。

- [ ] **Step 1: 声明"单一 GameStore 实例"为硬约束**
    在 `ARCHITECTURE.md` 客户端节（对应 L158 附近）明确：全客户端**仅一份** `GameStore`；`SocketEventHandler.registerSocketHandlers` 的 `store` 为必填、禁内部实例化；`GameViewModel`/`cellDisplayModel` 仅只读投影。删除"旧模块级变量可作为业务写入口"的模糊表述，改为只读渲染。
- [ ] **Step 2: 补 `server.resyncDomain` + `client.heartbeat` 事件**
    在"服务端权威流 / server.* 事件"清单（L100/L104 附近）追加：低频心跳摘要（`client.heartbeat`）用于一致性兜底，仅在摘要不一致时补发 `server.resyncDomain`；并注明"不采用版本号/gap-resync"的明确取舍，锁定边界。
- [ ] **Step 3: 标住 `dayRatio` 为权威区域时钟域**
    在昼夜/繁荣度转写段（L115 附近）注明 `dayRatio` 由服务端权威下发、客户端仅插值，`region.time` 属此域不属数值变更。
- [ ] **Step 4: Commit**

```bash
git add docs/architecture/ARCHITECTURE.md
git commit -m "docs(architecture): 同步单一状态源/心跳对账/dayRatio 权威语义"
```

---

## Self-Review
- 覆盖：单一状态源（Task 0）；绝对值收敛（Task 1/2）；兜底与时钟（Task 3/4）。✅
- Placeholder 扫描：Task 3/4 为概要性的二阶任务，含明确文件与测试名，无空占位；若进入执行再逐 Task 补全步进代码。
- 类型一致性：`publishValueChanged(io, playerId, fieldId, current)` 全篇一致；`SocketHandlerOptions.store` 由可选改必填，Task 0 已同步调用点。

**待执行选择：** 双选项——1) Subagent-Driven（每次一个子代理、任务间评审，推荐）；2) Inline（本会话 executing-plans 批量执行 + 检查点）。请选其一后再动代码（本阶段仍不写代码）。