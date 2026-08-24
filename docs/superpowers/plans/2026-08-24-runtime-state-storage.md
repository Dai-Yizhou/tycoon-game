# Runtime State Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将产权、等级、累计价值、纪念碑停靠状态和区域运行时数值从 `Cell.extra` 与分散字段迁移到独立、可持久化、服务端权威的运行时状态存储。

**Architecture:** 地图配置保持只读，`GameWorld` 持有静态 `MapData/MapMeta` 和独立 `WorldRuntimeState`。所有运行时状态通过 `WorldRuntimeState` 的窄接口访问，业务处理器不再直接修改 `Cell.extra`；`WorldStore` 保存 v2 状态快照，静态地图只保存 `mapId`，加载时重新读取地图配置并恢复动态状态。

**Tech Stack:** TypeScript 5、Node.js、Jest、现有 `GameWorld`、`WorldStore`、`Ownership`、`EconomyService`、Socket.IO 类型协议。

---

## 文件结构与职责

### 新增文件

- `packages/server/src/state/WorldRuntimeState.ts`：运行时状态类型、默认状态创建、深拷贝和边界校验。
- `packages/server/src/state/WorldRuntimeStateStore.ts`：对玩家、区域和格子运行时状态提供读写接口。
- `packages/server/tests/state/WorldRuntimeStateStore.test.ts`：状态隔离、默认值、产权和区域值测试。
- `packages/server/tests/storage/WorldStore-v2.test.ts`：v2 快照保存、读取和非法快照拒绝测试。

### 修改文件

- `packages/server/src/world/GameWorld.ts`：持有并暴露运行时状态，加载地图时初始化，保存/恢复快照时接入状态。
- `packages/server/src/storage/WorldStore.ts`：新增 `WorldSnapshotV2`，移除静态地图副本作为动态状态载体。
- `packages/server/src/economy/Ownership.ts`：所有产权、累计价值和买入价格从状态存储读取和更新。
- `packages/server/src/handlers/propertyHandler.ts`：移除直接写入 `cell.extra.level/accumulatedValue`。
- `packages/server/src/handlers/investmentHandler.ts`：移除直接依赖 `cell.extra` 产权状态。
- `packages/server/src/economy/Bankruptcy.ts`：通过状态存储清算玩家产权和项目状态。
- `packages/server/src/handlers/monumentHandler.ts`：将单次修缮状态迁移到状态存储。
- `packages/server/src/handlers/transportHandler.ts`：保持交通网络状态独立，统一从 v2 状态接口恢复和保存。
- `packages/server/src/app.ts`：恢复 v2 快照并注入状态存储。
- `packages/server/src/transport/handlers.ts`：为状态查询和动态格子广播使用统一来源。
- `packages/shared/src/types/socket-events.ts`：如需要，更新产权/动态格子事件为完整运行时状态载荷。
- `packages/server/tests/economy/ownership-v2.test.ts`：改为验证状态存储来源，而不是 `cell.extra`。
- `packages/server/tests/handlers/propertyHandler-v2.test.ts`：增加升级、清空产权和重载状态测试。
- `packages/server/tests/handlers/monumentHandler-v2.test.ts`：增加每次停靠状态的持久化测试。
- `packages/server/tests/economy/Bankruptcy.test.ts`：迁移旧地图夹具到 v2，并验证状态清算。
- `packages/server/tests/storage/WorldStore.test.ts`：迁移旧 v1 夹具到 v2，保留快照行为测试。

## Task 1: 定义运行时状态模型

**Files:**
- Create: `packages/server/src/state/WorldRuntimeState.ts`
- Test: `packages/server/tests/state/WorldRuntimeStateStore.test.ts`

- [ ] **Step 1: 写失败测试，定义独立运行时状态结构**

测试应构造静态地图和空状态，验证每个格子拥有独立状态，且初始化不会修改 `Cell`：

```ts
const state = createWorldRuntimeState([{ id: 7 }], [{ id: 'r1' }]);
expect(state.cells.get(7)).toEqual({ ownerships: [], level: 0, accumulatedValue: 0 });
expect(state.regions.get('r1')).toEqual({ values: {} });
```

- [ ] **Step 2: 运行测试确认失败**

运行：`npx jest tests/state/WorldRuntimeStateStore.test.ts --runInBand`

预期：因 `WorldRuntimeState` 尚不存在而失败。

- [ ] **Step 3: 实现最小状态模型**

定义：

```ts
export interface CellRuntimeState {
  ownerships: Ownership[];
  level: number;
  accumulatedValue: number;
  repairedBy?: string;
  repairedAt?: number;
}

export interface RegionRuntimeState {
  values: Record<string, number>;
}

export interface WorldRuntimeState {
  cells: Map<number, CellRuntimeState>;
  regions: Map<string, RegionRuntimeState>;
}
```

提供 `createWorldRuntimeState(cellIds, regionIds)`，所有集合使用新实例。

- [ ] **Step 4: 运行测试确认通过**

运行：`npx jest tests/state/WorldRuntimeStateStore.test.ts --runInBand`

预期：PASS。

## Task 2: 实现状态访问服务

**Files:**
- Create: `packages/server/src/state/WorldRuntimeStateStore.ts`
- Modify: `packages/server/src/world/GameWorld.ts`
- Test: `packages/server/tests/state/WorldRuntimeStateStore.test.ts`

- [ ] **Step 1: 写失败测试，覆盖状态读写和静态地图隔离**

测试以下接口：

```ts
store.getCellState(7);
store.updateCellState(7, state => ({ ...state, level: 2 }));
store.getRegionValue('r1', 'pros');
store.changeRegionValue('r1', 'pros', 3);
store.replaceOwnerships(7, ownerships);
```

并断言 `cell.extra` 没有新增或修改运行时字段。

- [ ] **Step 2: 运行测试确认失败**

运行：`npx jest tests/state/WorldRuntimeStateStore.test.ts --runInBand`

预期：因访问接口尚不存在而失败。

- [ ] **Step 3: 实现窄接口**

实现以下方法：

```ts
getCellState(cellId: number): CellRuntimeState;
updateCellState(cellId: number, updater: (state: CellRuntimeState) => CellRuntimeState): void;
getOwnerships(cellId: number): Ownership[];
replaceOwnerships(cellId: number, ownerships: Ownership[]): void;
getRegionValue(regionId: string, fieldId: string): number;
changeRegionValue(regionId: string, fieldId: string, delta: number): number;
snapshot(): SerializedWorldRuntimeState;
restore(snapshot: SerializedWorldRuntimeState): void;
```

所有返回对象必须复制，防止处理器绕过服务修改内部状态。

- [ ] **Step 4: 接入 `GameWorld`**

在 `GameWorld.loadMap()` 中根据地图格子 ID 和 `mapMeta.regions` 初始化状态；保留 `GameWorld.getRegionValue/changeRegionValue` 作为外部入口，但实现委托给状态服务。

- [ ] **Step 5: 运行测试确认通过**

运行：`npx jest tests/state/WorldRuntimeStateStore.test.ts --runInBand` 和 `npx tsc -p packages/server/tsconfig.json --noEmit`。

预期：PASS 且无类型错误。

## Task 3: 迁移 Ownership 与地产/投资处理器

**Files:**
- Modify: `packages/server/src/economy/Ownership.ts`
- Modify: `packages/server/src/handlers/propertyHandler.ts`
- Modify: `packages/server/src/handlers/investmentHandler.ts`
- Test: `packages/server/tests/economy/ownership-v2.test.ts`
- Test: `packages/server/tests/handlers/propertyHandler-v2.test.ts`
- Test: `packages/server/tests/handlers/investmentHandler-v2.test.ts`

- [ ] **Step 1: 增加失败测试**

验证购买、合租、升级、租金和投资收益都更新状态服务，而不修改：

```ts
expect(cell.extra.ownerships).toBeUndefined();
expect(cell.extra.level).toBeUndefined();
expect(runtimeState.getOwnerships(cell.id)).toHaveLength(1);
```

- [ ] **Step 2: 运行相关测试确认失败**

运行：`npx jest tests/economy/ownership-v2.test.ts tests/handlers/propertyHandler-v2.test.ts tests/handlers/investmentHandler-v2.test.ts --runInBand`。

预期：旧实现仍写入 `cell.extra`，新增断言失败。

- [ ] **Step 3: 迁移 Ownership API**

将 `getOwnerships(cell)`、`addOwnership(cell, ...)`、`syncOwnerships(cell, ...)` 改为接收 `WorldRuntimeStateStore` 和 `cellId`；累计价值从 `CellRuntimeState` 读取，UCT 价格从静态 `cell.price` 和 `cell.upgradeCost` 计算。

- [ ] **Step 4: 迁移 PropertyHandler 和 InvestmentHandler**

所有产权读写改成状态服务调用；广播的 `cell` 保留静态配置，另行携带运行时产权/等级快照，禁止把动态字段重新写回 `extra`。

- [ ] **Step 5: 运行测试确认通过**

运行同一组 Jest 测试和 server build。预期：所有 v2 测试通过，静态 Cell 不含运行时字段。

## Task 4: 迁移纪念碑和破产清算状态

**Files:**
- Modify: `packages/server/src/handlers/monumentHandler.ts`
- Modify: `packages/server/src/economy/Bankruptcy.ts`
- Modify: `packages/server/src/world/GameWorld.ts`
- Test: `packages/server/tests/handlers/monumentHandler-v2.test.ts`
- Test: `packages/server/tests/economy/Bankruptcy.test.ts`

- [ ] **Step 1: 增加失败测试**

验证纪念碑修缮状态和产权清算只影响运行时状态，不写入地图配置；同一玩家同一纪念碑在一次停靠期间第二次修缮被拒绝。

- [ ] **Step 2: 迁移实现**

纪念碑状态使用 `CellRuntimeState.repairedBy/repairedAt` 或独立 `monuments` Map；破产清算通过 `getOwnerships/replaceOwnerships` 清除产权，并在无股东时重置 level 和 accumulatedValue。

- [ ] **Step 3: 统一结果类型**

将 `RepairResult.cost`、`creditIncrease`、`prosperityIncrease` 改为 `cost: Uct`，或使用统一 `SettlementResult`，禁止继续新增固定字段。

- [ ] **Step 4: 运行测试确认通过**

运行：`npx jest tests/handlers/monumentHandler-v2.test.ts tests/economy/Bankruptcy.test.ts --runInBand` 和 server build。

## Task 5: WorldStore v2 快照

**Files:**
- Modify: `packages/server/src/storage/WorldStore.ts`
- Modify: `packages/server/src/world/GameWorld.ts`
- Modify: `packages/server/src/app.ts`
- Create: `packages/server/tests/storage/WorldStore-v2.test.ts`
- Modify: `packages/server/tests/storage/WorldStore.test.ts`

- [ ] **Step 1: 写失败测试**

验证 v2 快照只保存 `mapId` 和运行时状态，不保存运行时修改后的 `mapData`：

```ts
store.save(snapshot);
const loaded = store.load();
expect(loaded?.version).toBe(2);
expect(loaded).not.toHaveProperty('mapData');
expect(loaded?.runtime.cells[7].level).toBe(2);
```

- [ ] **Step 2: 实现 v2 序列化与校验**

定义：

```ts
interface WorldSnapshotV2 {
  version: 2;
  savedAt: number;
  mapId: string;
  players: Player[];
  teams: Team[];
  runtime: SerializedWorldRuntimeState;
  era: EraInfo | null;
  taxRecords: Record<string, TaxRecord[]>;
  jailStates: Record<string, JailState>;
}
```

将 Map 序列化为数组，读取时校验版本、mapId、玩家、runtime cells/regions 和税收记录。

- [ ] **Step 3: 接入 GameWorld 保存与恢复**

`saveSnapshot()` 生成 v2 快照；启动时仅接受 v2 快照。旧 v1 快照不得静默读取；如需迁移，单独实现一次性 `WorldSnapshotV1Migrator`，迁移后立即写成 v2。

- [ ] **Step 4: 运行快照测试**

运行：`npx jest tests/storage/WorldStore-v2.test.ts tests/storage/WorldStore.test.ts --runInBand`。

## Task 6: 删除 `Cell.extra` 运行时状态

**Files:**
- Modify: `packages/server/src/economy/Ownership.ts`
- Modify: `packages/server/src/economy/Bankruptcy.ts`
- Modify: `packages/server/src/handlers/propertyHandler.ts`
- Modify: `packages/server/src/handlers/investmentHandler.ts`
- Modify: `packages/client/src/state/GameStore.ts`
- Modify: `packages/client/src/game/systems/SocketEventHandler.ts`
- Modify: `packages/client/src/components/GameHudShell.ts`

- [ ] **Step 1: 搜索并建立零残留断言**

搜索：`ownerships|owners|accumulatedValue|projectOwner|projectState|extra.level`。

生产代码中只允许存在状态服务和显式动态状态协议，不允许直接读写 `Cell.extra`。

- [ ] **Step 2: 更新客户端状态协议**

客户端从 `server.propertyBought`、`server.propertyUpgraded`、`server.investmentBought` 接收独立 runtime payload，写入 `GameStore` 的 `cellRuntimeStates`，悬浮卡片从该状态读取产权和等级。

- [ ] **Step 3: 运行客户端与服务端定向测试**

运行：`npx tsc --noEmit`、客户端完整测试、server v2 测试和 shared 全量测试。

## Task 7: 状态存储完成后的行为系统收尾

**Files:**
- Modify: `packages/server/src/behavior/BehaviorEngine.ts`
- Modify: `packages/server/src/events/EventHandler.ts`
- Delete or remove production references: `packages/server/src/events/EventRegistry.ts`, `EventEffects.ts`, `eventTemplates.ts`
- Modify: `packages/server/tests/handlers/investmentHandler.test.ts`
- Modify: `packages/server/tests/events/*.test.ts`

- [ ] **Step 1: 先迁移行为操作测试**

增加 ownership acquire/lose、position moveTo/teleport、region UCT 和真实 target 结果测试。

- [ ] **Step 2: 删除 EventHandler 的旧随机回退**

事件格只允许通过 `behaviorLand` 或明确的新事件行为配置执行；缺少必需行为配置时快速失败，不再使用 `EventRegistry` 和 `EventEffectsHandler` 回退。

- [ ] **Step 3: 删除旧事件模块和旧测试夹具**

删除生产引用及不符合 v2 合同的测试，所有新测试使用地图级 behaviors 和 UCT。

- [ ] **Step 4: 完成最终验证**

运行 shared、client、server 全量测试、三端 TypeScript 检查，并再次搜索旧字段和旧事件 API，结果必须为空或只存在迁移文档中。

## 验收标准

- 地图静态配置在一局游戏中不被修改。
- `Cell.extra` 不再保存产权、等级、累计价值、项目所有者或纪念碑修缮状态。
- WorldStore v2 可在重启后恢复玩家、队伍、区域值、产权、等级、纪念碑状态、税收、监狱和时代。
- 所有费用、收益和行为数值仍按完整 UCT 字段结算。
- 行为 `value`、`ownership`、`position` 三类操作都通过统一状态/结算边界执行。
- 生产代码不再引用旧随机事件注册表、旧事件效果处理器、旧投资事件入口或旧固定 UCT 字段。
- 所有迁移相关测试通过；未迁移的 v1 测试不得通过 fallback 继续保留。
