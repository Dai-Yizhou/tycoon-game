# 服务端权威与 UI 交接实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (required when implementing this plan). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将移动最终停留唯一落点、事件/监狱/租金/组队服务端权威、客户端请求渲染和按钮状态重构落地，并完成 UI 与技术文档交接。

**Architecture:** 服务端以一次移动结算事务为边界：校验请求、计算唯一最终落点、更新玩家位置，再按落点顺序执行起点、事件、监狱、租金及其他格子效果，最后广播权威状态。客户端只发送 Socket.IO 请求、播放服务端路径动画并根据服务端事件更新 Store/UI；按钮状态由集中式状态函数计算，不由业务模块分散写入。

**Tech Stack:** TypeScript 5.4、Node.js >=18、Express、Socket.IO 4.7、Vite 5、Canvas 2D、Jest 29 + ts-jest、ESLint、pnpm workspace。

---

## 范围与约束

- 目标分支：`dev-Dai`；只规划 `packages/shared`、`packages/server`、`packages/client` 和 `docs/`。
- 明确忽略：`ai-bot/`、`ai_bot_try/`，不读取、修改、测试或更新其中内容。
- 本轮只创建计划，不改源码、不提交、不合并。
- 当前问题依据：`MovementHandler` 会中途更新位置并触发格子逻辑，`HandlerRegistry.handleMovement` 还会再次调用 `handleCellEvent`；客户端 `GameLogic` 仍有本地随机事件、买地、升级、投资、传送和修缮数值路径；`UIUpdates.updateActionPanel` 依据本地缓存分散生成按钮。
- 复用现有 `AckResult`、`PositionChangedPayload`、`ValueChangedPayload`、`TeamMemberView`、Handler、TeamManager 和 GameStore，不引入新框架或状态库。

## 文件地图

### 服务端与共享协议

- Modify: `packages/shared/src/types/socket-events.ts` — 移动事务回执、最终落点/结算事件和请求状态字段。
- Modify: `packages/server/src/handlers/movementHandler.ts` — 移动计算、唯一最终落点、路径动画数据和结算入口。
- Modify: `packages/server/src/transport/handlers.ts` — 移除重复到达结算，统一调用移动事务。
- Modify: `packages/server/src/events/EventHandler.ts` — 事件只由服务端移动结算触发并返回结构化效果。
- Modify: `packages/server/src/handlers/jailHandler.ts` — 服务端权威入狱/出狱状态与回合扣减。
- Modify: `packages/server/src/handlers/propertyHandler.ts` — 服务端权威租金、持股分配和数值广播。
- Modify: `packages/server/src/handlers/teamHandler.ts`、`packages/server/src/team/TeamManager.ts` — 完整队伍快照与共享值。
- Test: `packages/server/tests/handlers/movementHandler.test.ts`、`packages/server/tests/events/EventHandler.test.ts`、`packages/server/tests/handlers/propertyHandler.test.ts`、新增 `packages/server/tests/handlers/jailHandler.test.ts`、新增 `packages/server/tests/handlers/teamHandler.test.ts`。

### 客户端请求与渲染

- Modify: `packages/client/src/game/systems/MovementSystem.ts` — 只播放服务端路径并发送路径选择请求。
- Modify: `packages/client/src/game/systems/SocketEventHandler.ts` — 同步服务端位置、事件、监狱、租金、队伍和按钮状态。
- Modify: `packages/client/src/game/systems/GameLogic.ts` — 游戏动作改为请求，删除本地业务推测。
- Modify: `packages/client/src/game/systems/UIUpdates.ts` — 集中计算按钮状态、禁用、冷却和原因。
- Modify: `packages/client/src/game/systems/TeamSystem.ts`、`packages/client/src/components/NotificationCenter.ts` — 只展示服务端快照，动作回调只发请求。
- Modify: `packages/client/src/state/GameStore.ts` — 服务端快照、请求中状态和 setter。
- Test: `packages/client/tests/pages.test.ts`、`packages/client/tests/notification-center.test.ts`、新增 `packages/client/tests/server-authority-rendering.test.ts`、新增 `packages/client/tests/button-state.test.ts`。

### 文档交接

- Create: `docs/UI_REBUILD_HANDOFF.md` — 页面入口、模块职责、事件到 UI 映射、按钮规则和验收清单。
- Modify: `docs/ARCHITECTURE.md` — 移动事务、权威边界和数据流。
- Modify: `docs/API.md` — 移动、事件、监狱、租金、组队事件及 Ack 约定。
- Modify: `docs/HANDOFF.md` — 本次交接范围、验证命令、风险和执行顺序。

## Task 1: 固化共享移动事务协议

**Files:**
- Modify: `packages/shared/src/types/socket-events.ts`
- Test: `packages/shared/tests/types.test.ts`

- [ ] **Step 1: 写失败测试，锁定协议字段**

```ts
test('移动事务回执包含唯一最终落点和完整路径', () => {
  const result: AckResult<MovementTransactionResult> = {
    ok: true,
    data: {
      playerId: 'p1', startCellId: 0, finalCellId: 4,
      path: [0, 1, 3, 4], stepsTaken: 3, settlementId: 'settlement-1',
    },
  };
  expect(result.data?.finalCellId).toBe(4);
  expect(result.data?.settlementId).toBe('settlement-1');
});
```

- [ ] **Step 2: 运行共享类型测试确认失败**

Run: `pnpm --filter @game/shared test -- --runInBand tests/types.test.ts`

Expected: FAIL，提示 `MovementTransactionResult` 未定义。

- [ ] **Step 3: 增加最小共享类型和事件签名**

定义 `MovementTransactionResult`：`playerId`、`startCellId`、`finalCellId`、`path`、`stepsTaken`、`settlementId`；将 `client.choosePath` Ack 改为该结果，保留 `server.playerMoved.path` 供动画，并增加可选的 `server.settlementComplete` 结构化事件。

- [ ] **Step 4: 运行类型测试和共享包检查**

Run: `pnpm --filter @game/shared test -- --runInBand tests/types.test.ts && pnpm --filter @game/shared lint && pnpm --filter @game/shared exec tsc --noEmit`

Expected: PASS；无 ESLint 或 TypeScript 错误。

## Task 2: 实现移动最终落点唯一事务

**Files:**
- Modify: `packages/server/src/handlers/movementHandler.ts`
- Modify: `packages/server/src/transport/handlers.ts`
- Test: `packages/server/tests/handlers/movementHandler.test.ts`

- [ ] **Step 1: 写失败测试覆盖直线、岔路和重复结算**

```ts
it('移动事务只写入一次最终位置并广播一次结算落点', () => {
  const player = createTestPlayer('player1', 1);
  world.addPlayer(player);
  const result = handler.handleMovement('player1', 2, mockSocket);
  expect(result?.finalCellId).toBe(3);
  expect(world.getPlayer('player1')?.position.cellId).toBe(3);
  expect(mockIO.emit).toHaveBeenCalledTimes(1);
});

it('岔路选择继续同一 settlementId，不重复触发落点效果', () => {
  const player = createTestPlayer('player1', 1);
  world.addPlayer(player);
  handler.handleMovement('player1', 3, mockSocket);
  const choosePath = getRegisteredHandler(mockSocket, 'client.choosePath');
  const ack = vi.fn();
  choosePath({ fromCellId: 2, toCellId: 3 }, ack);
  expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  expect(mockIO.emit).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: 运行移动测试确认现状暴露重复/中途行为**

Run: `pnpm --filter @game/server test -- --runInBand tests/handlers/movementHandler.test.ts`

Expected: FAIL 或暴露现有调用次数与新事务断言不一致。

- [ ] **Step 3: 重构为单一事务入口**

让 `handleMovement` 和 `handleChoosePath` 都进入同一事务函数；事务先保存 `startCellId`，计算完整路径，岔路只保存 pending 状态，不调用落点结算；最终选择完成后一次写入 `player.position`，生成唯一 `settlementId`，一次广播 `server.playerMoved`，再调用注册器的单一结算入口。禁止 `MovementHandler` 与 `HandlerRegistry` 同时触发同一落点结算。

- [ ] **Step 4: 补输入校验与异常回执**

拒绝负步数、非法格子、过期 pending movement、非相邻路径和未认证请求；Ack 使用既有错误码字符串，不发送异常堆栈或敏感数据。

- [ ] **Step 5: 运行服务端移动测试与类型检查**

Run: `pnpm --filter @game/server test -- --runInBand tests/handlers/movementHandler.test.ts && pnpm --filter @game/server lint && pnpm --filter @game/server exec tsc --noEmit`

Expected: PASS；移动相关无 lint/type 错误。

## Task 3: 收敛事件、监狱和租金落点结算

**Files:**
- Modify: `packages/server/src/transport/handlers.ts`
- Modify: `packages/server/src/events/EventHandler.ts`
- Modify: `packages/server/src/handlers/jailHandler.ts`
- Modify: `packages/server/src/handlers/propertyHandler.ts`
- Test: `packages/server/tests/events/EventHandler.test.ts`
- Test: `packages/server/tests/handlers/propertyHandler.test.ts`
- Create: `packages/server/tests/handlers/jailHandler.test.ts`

- [ ] **Step 1: 写服务端权威失败测试**

```ts
test('同一个 settlementId 不重复触发事件和租金', () => {
  const first = registry.settleLanding('player-1', 10, 'settlement-1', socket);
  const second = registry.settleLanding('player-1', 10, 'settlement-1', socket);
  expect(first).toBe(true);
  expect(second).toBe(false);
  expect(mockSocket.emit).toHaveBeenCalledTimes(1);
});

test('进入监狱由服务端写入状态并广播状态', () => {
  const entered = jailHandler.handleEnterJail('player-1', 10);
  expect(entered).toBe(true);
  expect(world.getPlayer('player-1')?.status).toBe('jail');
  expect(mockIo.emit).toHaveBeenCalledWith('server.playerJailed', expect.objectContaining({ playerId: 'player-1' }));
});
```

- [ ] **Step 2: 运行事件、租金和监狱测试确认失败**

Run: `pnpm --filter @game/server test -- --runInBand tests/events/EventHandler.test.ts tests/handlers/propertyHandler.test.ts tests/handlers/jailHandler.test.ts`

Expected: 新增的幂等结算和监狱测试先失败。

- [ ] **Step 3: 增加幂等落点结算入口**

在 `HandlerRegistry` 增加按 `settlementId` 去重的 `settleLanding`，按固定顺序调用起点、事件、监狱、租金及其他格子 Handler；只允许移动事务调用它，并为 pending settlement 设置清理策略。

- [ ] **Step 4: 统一事件效果和数值广播**

`EventHandler` 返回结构化事件和效果结果；所有玩家数值变更使用 `server.valueChanged`，客户端不根据事件文本计算 money/credit/env；事件通知只承载展示信息。

- [ ] **Step 5: 统一监狱状态来源**

`JailHandler` 负责状态、剩余回合和广播；客户端不得根据 `durationMs` 自行解除，出狱只能由服务端掷骰回合结算或明确服务端操作触发。保持 `canCollectRent` 作为租金服务端门禁。

- [ ] **Step 6: 验证正常、异常和边界场景**

覆盖事件格/非事件格、重复 settlement、地图缺失、玩家缺失、监狱中收租、无主地产、单持股和多持股租金分配、资金不足与破产边界。

- [ ] **Step 7: 运行服务端检查**

Run: `pnpm --filter @game/server test -- --runInBand tests/events/EventHandler.test.ts tests/handlers/propertyHandler.test.ts tests/handlers/jailHandler.test.ts tests/handlers/movementHandler.test.ts && pnpm --filter @game/server lint && pnpm --filter @game/server exec tsc --noEmit`

Expected: PASS；无 lint/type 错误。

## Task 4: 完成组队服务端权威快照

**Files:**
- Modify: `packages/server/src/handlers/teamHandler.ts`
- Modify: `packages/server/src/team/TeamManager.ts`
- Modify: `packages/shared/src/types/team.ts`
- Modify: `packages/shared/src/types/socket-events.ts`
- Test: `packages/server/tests/team/TeamManager.test.ts`
- Create: `packages/server/tests/handlers/teamHandler.test.ts`

- [ ] **Step 1: 写失败测试覆盖邀请、响应、离开和共享值**

```ts
test('组队变更后每个成员收到完整权威快照', () => {
  const invite = manager.sendInvite('p1', '一号', 'p2');
  manager.respondInvite(invite!.id, 'p2', true);
  expect(teamUpdatedPayload.members).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'p1', money: expect.any(Number), isLeader: true }),
    expect.objectContaining({ id: 'p2', money: expect.any(Number), isLeader: false }),
  ]));
});
```

- [ ] **Step 2: 运行组队测试确认快照断言失败**

Run: `pnpm --filter @game/server test -- --runInBand tests/team/TeamManager.test.ts tests/handlers/teamHandler.test.ts`

Expected: 新增 Handler 测试因缺少完整快照或 mock 注册而失败。

- [ ] **Step 3: 固化队伍快照和请求幂等边界**

所有邀请、接受、拒绝、离开、踢出和查询都从服务端 `TeamManager` 读取；`teamUpdated` 必须包含队伍、成员显示数据和共享值；重复请求返回稳定 Ack，客户端不直接修改 `teamId`、成员列表或共享值。

- [ ] **Step 4: 运行组队与服务端验证**

Run: `pnpm --filter @game/server test -- --runInBand tests/team/TeamManager.test.ts tests/handlers/teamHandler.test.ts && pnpm --filter @game/server lint && pnpm --filter @game/server exec tsc --noEmit`

Expected: PASS；无 lint/type 错误。

## Task 5: 移除客户端本地业务推测

**Files:**
- Modify: `packages/client/src/game/systems/MovementSystem.ts`
- Modify: `packages/client/src/game/systems/SocketEventHandler.ts`
- Modify: `packages/client/src/game/systems/GameLogic.ts`
- Modify: `packages/client/src/state/GameStore.ts`
- Test: `packages/client/tests/useSocket.test.ts`
- Test: `packages/client/tests/pages.test.ts`
- Create: `packages/client/tests/server-authority-rendering.test.ts`

- [ ] **Step 1: 写失败测试证明客户端只发请求**

```ts
test('到达事件格时客户端不随机修改玩家数值', () => {
  const socket = createMockSocket();
  registerSocketHandlers(socket);
  emitServerEvent(socket, 'server.playerMoved', { playerId: 'p1', cellId: 10, path: [9, 10] });
  expect(currentPlayer?.values.money.current).toBe(1000);
  expect(socket.emit).not.toHaveBeenCalledWith('client.buyProperty', expect.anything(), expect.anything());
});
```

- [ ] **Step 2: 运行客户端测试确认现有本地逻辑不符合断言**

Run: `pnpm --filter @game/client test -- --runInBand tests/server-authority-rendering.test.ts tests/pages.test.ts`

Expected: 新增测试先失败或暴露测试桩需要的最小接口。

- [ ] **Step 3: 将 GameLogic 动作改成请求适配器**

`handleBuyProperty`、`handleUpgradeProperty`、投资、交通、纪念碑、银行、道具和破产重开只校验 UI 前置条件并 `gameSocket.emit`；不直接改 `currentMoney`、资产集合、等级、事件效果或玩家状态。Ack 失败只提示错误并恢复请求状态。

- [ ] **Step 4: 删除到达后的本地事件和本地租金推测**

`onPlayerArrived` 只做定位、动画收尾和面板刷新；删除 `triggerRandomEvent` 对玩家数值的写入以及由 cell 文本推导服务端效果的路径。`server.valueChanged`、监狱、通知和地产广播成为唯一业务来源。

- [ ] **Step 5: 保留移动动画而不改变权威位置**

`MovementSystem` 只播放 `server.playerMoved.path`；路径选择按钮只发送 `client.choosePath`；动画结束使用服务端 `finalCellId` 对齐显示，不在客户端计算下一格或剩余步数。

- [ ] **Step 6: 运行客户端检查**

Run: `pnpm --filter @game/client test -- --runInBand tests/server-authority-rendering.test.ts tests/pages.test.ts tests/useSocket.test.ts && pnpm --filter @game/client lint && pnpm --filter @game/client exec tsc --noEmit`

Expected: PASS；无 lint/type 错误。

## Task 6: 重构集中式按钮状态

**Files:**
- Modify: `packages/client/src/state/GameStore.ts`
- Modify: `packages/client/src/game/systems/UIUpdates.ts`
- Modify: `packages/client/src/game/systems/GameLogic.ts`
- Modify: `packages/client/src/game/systems/SocketEventHandler.ts`
- Modify: `packages/client/src/game/systems/TeamSystem.ts`
- Modify: `packages/client/src/components/NotificationCenter.ts`
- Test: `packages/client/tests/notification-center.test.ts`
- Create: `packages/client/tests/button-state.test.ts`

- [ ] **Step 1: 写失败测试覆盖按钮状态矩阵**

```ts
test.each([
  ['移动中', { isMoving: true }, false],
  ['服务端判定监狱', { isInJail: true }, false],
  ['服务端状态破产', { isBankrupt: true }, false],
  ['请求处理中', { pendingAction: 'buyProperty' }, false],
  ['正常且金额足够', { isMoving: false, isInJail: false, isBankrupt: false, currentMoney: 1000, price: 100 }, true],
])('%s决定购买按钮可用性', (_name, state, expected) => {
  expect(getButtonState('buyProperty', state as any).enabled).toBe(expected);
});
```

- [ ] **Step 2: 运行按钮测试确认状态函数不存在**

Run: `pnpm --filter @game/client test -- --runInBand tests/button-state.test.ts`

Expected: FAIL，提示按钮状态计算函数未定义。

- [ ] **Step 3: 增加纯函数状态计算和请求状态**

在 Store 暴露最小的 `pendingActions`、服务端玩家状态、当前落点和资金快照；在 `UIUpdates` 增加无 DOM 副作用的 `getButtonState`，返回 `enabled`、`reason`、`pending`。覆盖掷骰、买地、升级、投资、传送、修缮、组队邀请和通知动作。

- [ ] **Step 4: 统一渲染入口和请求生命周期**

`updateActionPanel` 只读取状态计算结果并设置 `disabled`、文本和可访问提示；请求发送前标记 pending，Ack 或服务端广播后清除 pending；禁止业务模块直接写 `button.disabled`。

- [ ] **Step 5: 验证按钮、通知和页面回归**

Run: `pnpm --filter @game/client test -- --runInBand tests/button-state.test.ts tests/notification-center.test.ts tests/pages.test.ts && pnpm --filter @game/client lint && pnpm --filter @game/client exec tsc --noEmit`

Expected: PASS；按钮禁用、加载和错误提示行为一致。

## Task 7: 更新 UI_REBUILD_HANDOFF.md 和技术文档

**Files:**
- Create: `docs/UI_REBUILD_HANDOFF.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/API.md`
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: 编写 UI 交接梗概**

`UI_REBUILD_HANDOFF.md` 开头用一屏说明页面入口、状态流、服务端权威边界和不应恢复的本地逻辑；随后按 Canvas、HUD、通知、队伍、操作按钮、Socket 事件和测试分层说明。

- [ ] **Step 2: 记录移动和业务事件数据流**

使用实际事件名描述：`client.rollDice`/`client.choosePath` → 服务端移动事务 → `server.playerMoved` → 动画；落点结算 → `server.valueChanged`、`server.playerJailed`、`server.playerReleased`、`server.notification`、地产/队伍事件 → Store → UI。

- [ ] **Step 3: 记录按钮状态矩阵和 UI 验收清单**

明确移动中、监狱、破产、请求中、资金不足、非当前落点、服务端错误和正常状态下的按钮行为；验收要求包括无重复请求、无客户端本地数值漂移、断线重连后服务端快照可恢复。

- [ ] **Step 4: 更新 ARCHITECTURE.md 和 API.md**

把移动事务、唯一 settlement、事件/监狱/租金/队伍边界、Ack 错误和客户端只渲染的约束写入现有章节；同步修正旧的“待接入”或“客户端本地处理”描述。

- [ ] **Step 5: 更新 HANDOFF.md**

记录当前分支、计划范围、忽略目录、验证命令、既有测试风险和后续执行顺序；不把未执行的实现写成已完成。

- [ ] **Step 6: 做文档一致性检查**

Run: `grep -R "ai-bot\|ai_bot_try" docs/UI_REBUILD_HANDOFF.md docs/ARCHITECTURE.md docs/API.md docs/HANDOFF.md || true && grep -R "client\.choosePath\|server\.playerMoved\|server\.valueChanged\|server\.teamUpdated" docs/UI_REBUILD_HANDOFF.md docs/ARCHITECTURE.md docs/API.md`

Expected: 交接文档不包含 AI 目录内容；关键事件均有协议和架构说明。

## Task 8: 全量验证与执行交接

**Files:**
- Verify: `packages/shared/`、`packages/server/`、`packages/client/`、`docs/`

- [ ] **Step 1: 执行类型检查和 lint**

Run: `pnpm --filter @game/shared exec tsc --noEmit && pnpm --filter @game/server exec tsc --noEmit && pnpm --filter @game/client exec tsc --noEmit && pnpm lint`

Expected: 三包类型检查与根 lint 均通过。

- [ ] **Step 2: 执行受影响测试**

Run: `pnpm --filter @game/shared test -- --runInBand && pnpm --filter @game/server test -- --runInBand && pnpm --filter @game/client test -- --runInBand`

Expected: 受影响测试全部通过；既有非本计划失败需记录真实错误，不修改两个 AI 目录来规避。

- [ ] **Step 3: 执行三包构建**

Run: `pnpm build:shared && pnpm build:server && pnpm build:client`

Expected: shared、server、client 构建成功；不要求 admin 或 AI 目录构建。

- [ ] **Step 4: 进行人工端到端验收**

启动 `pnpm dev:server` 和 `pnpm dev:client`，用两个浏览器连接：掷骰后只见服务端位置广播；经过事件格只出现服务端通知/数值广播；进入监狱后客户端不能自行解除；经过他人地产只由服务端扣租；组队变更后两端队伍快照一致；重复点击按钮不产生重复请求。

- [ ] **Step 5: 交付前检查范围与版本控制**

Run: `git status --short --branch && git diff -- packages/shared packages/server packages/client docs`

Expected: 仅出现批准范围内的改动；不提交、不合并、不触碰稳定分支；两个 AI 目录的既有变化保持原样。

## 自审清单

- 覆盖移动唯一最终落点事务、事件/监狱/租金/组队服务端权威、客户端请求渲染、按钮状态重构、`UI_REBUILD_HANDOFF.md` 和技术文档更新。
- 文件地图列出每项实现、测试和文档责任，未把两个 AI 目录纳入变更范围。
- 每个实现任务包含失败测试、实际命令、预期结果、异常/边界验证和 TypeScript/ESLint 检查。
- 计划不要求新增依赖，沿用现有 Socket.IO、shared 类型、Handler、GameStore 和 Jest。
- 当前任务只创建计划文件，不执行源码实现和 git commit。
