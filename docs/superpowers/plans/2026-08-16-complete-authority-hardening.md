# Complete Authority and Persistence Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成服务端权威、安全边界、监狱冷却、破产清算、可恢复世界状态、并发经济操作和客户端单一事实源收敛，并通过 shared/server/client 全量验证。

**Architecture:** shared 定义唯一协议与规则配置；server 通过认证后的 Socket handler 写入 GameWorld/WorldStore，所有经济变更使用版本检查和幂等键；client 仅由 GameStore 接收服务端快照与事件，GameViewModel 做只读投影，GameController 负责路由，GamePage 不保存业务状态。旧调试和自由移动协议从生产注册链及共享类型中移除，时代计时器使用可分段调度避免 Node 定时器溢出。

**Tech Stack:** TypeScript, Node.js, Express, Socket.IO, Jest, React, TypeScript compiler, ESLint, pnpm workspace。

---

### Task 1: 建立安全与协议基线

**Files:**
- Modify: `packages/shared/src/types/socket-events.ts`
- Modify: `packages/server/src/transport/handlers.ts`
- Modify: `packages/server/src/transport/SocketManager.ts`
- Modify: `packages/server/src/auth/JWTService.ts`
- Modify: `packages/server/src/config.ts`
- Test: `packages/server/tests/SocketManager.test.ts`

- [x] 写测试证明未认证 Socket 被拒绝、缺少生产 `JWT_SECRET` 启动失败、rate limit 超限阻断后续事件。
- [x] 删除过时的客户端移动、客户端骰子预测、调试结算协议与注册链。
- [x] 将认证改为生产必需 JWT，开发测试只能显式传入 authenticate 或测试密钥；超限返回错误并不调用业务 handler。
- [x] 运行 server Socket 与认证测试并修复类型闭环。
- [x] 提交 `security: enforce authoritative socket boundary`。

### Task 2: 统一监狱配置与现实时间语义

**Files:**
- Modify: `packages/shared/src/types/config.ts`
- Modify: `packages/shared/src/types/socket-events.ts`
- Modify: `packages/server/src/handlers/diceHandler.ts`
- Modify: `packages/server/src/handlers/jailHandler.ts`
- Modify: `packages/server/src/transport/handlers.ts`
- Modify: `packages/client/src/game/systems/SocketEventHandler.ts`
- Test: `packages/server/tests/handlers/jailHandler.test.ts`
- Test: `packages/server/tests/handlers/diceHandler.test.ts`

- [x] 先增加失败测试：入狱扣信用、保存 `expiresAt`、冷却期间禁止掷骰、过期后恢复正常掷骰、重建后按时间安全恢复。
- [x] 将 `jailCooldownMs` 作为 shared 配置唯一来源，协议统一发送 `expiresAt` 与 `remainingMs`，不再使用剩余回合释放。
- [x] 使用现实时间过期判断和可恢复状态，不依赖长期单次定时器；保持客户端只读显示。
- [x] 增加最低免税额边界测试，明确税收计算的最小免税额规则。
- [x] 运行监狱、税收、掷骰测试并提交 `feat: make jail cooldown time based`。

### Task 3: 实现破产完整清算与安全重开

**Files:**
- Modify: `packages/server/src/economy/Bankruptcy.ts`
- Modify: `packages/server/src/economy/Taxation.ts`
- Modify: `packages/server/src/handlers/propertyHandler.ts`
- Modify: `packages/server/src/handlers/investmentHandler.ts`
- Modify: `packages/server/src/world/GameWorld.ts`
- Test: `packages/server/tests/economy/Bankruptcy.test.ts`

- [x] 写失败测试覆盖 owners、ownerships、地产等级、累计价值、投资持股、项目所有权、税收记录、Jail 和经济字段全部清除且保留 teamId。
- [x] 让 Bankrupt 玩家完全退出经济操作，`bankruptRestart` 只按地图初始值重开并生成新的状态版本。
- [x] 将清算集中到一个原子世界操作，广播完整服务端事件和重连可用快照。
- [x] 运行破产与地产/投资回归测试并提交 `feat: atomically clear bankrupt assets`。

### Task 4: 增加可恢复 WorldStore 与经济并发保护

**Files:**
- Create: `packages/server/src/storage/WorldStore.ts`
- Modify: `packages/server/src/storage/index.ts`
- Modify: `packages/server/src/world/GameWorld.ts`
- Modify: `packages/server/src/handlers/propertyHandler.ts`
- Modify: `packages/server/src/handlers/investmentHandler.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/tests/storage/WorldStore.test.ts`
- Test: `packages/server/tests/handlers/economyConcurrency.test.ts`

- [x] 写失败测试证明重启恢复地产、投资、队伍、监狱、时代和税收关键状态。
- [x] 定义版本化 WorldSnapshot、load/save、原子更新和内存实现；没有外部存储时明确使用进程内可恢复快照边界。
- [ ] 对买地、升级、投资购买增加世界版本或单元格版本检查，失败时不扣钱不广播；支持幂等请求键避免重复扣款。
- [x] 在组合根注入 WorldStore，关停前保存，启动时加载并校验快照。
- [x] 运行存储、并发和全量 server 测试并提交 `feat: persist and serialize world mutations`。

### Task 5: 修复时代定时器与 Node 浏览器边界

**Files:**
- Modify: `packages/server/src/world/EraManager.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/mapLoader.ts`
- Modify: `packages/client/src/services/mapApi.ts`
- Modify: `packages/client/vite.config.*`
- Test: `packages/server/tests/era/EraManager.test.ts`
- Test: `packages/client/tests/map-loading.test.ts`

- [ ] 写失败测试覆盖超长时代持续时间分段调度，不产生溢出或立即触发。
- [ ] 将服务端文件地图读取与浏览器 `/api/map` 请求拆为不同模块，客户端依赖图不包含 Node `fs`。
- [ ] 运行 era 测试和 client bundle 检查，确认无 fs warning，并提交 `fix: separate map loading runtimes`。

### Task 6: 收敛客户端状态单向数据流

**Files:**
- Modify: `packages/client/src/game/GameStore.ts`
- Modify: `packages/client/src/game/GameViewModel.ts`
- Modify: `packages/client/src/game/GameController.ts`
- Modify: `packages/client/src/pages/GamePage.*`
- Modify: `packages/client/src/game/systems/SocketEventHandler.ts`
- Test: `packages/client/tests/game-store-authority.test.ts`
- Test: `packages/client/tests/game-page-state.test.ts`

- [x] 写失败测试证明 GameStore 是唯一可写事实源，ViewModel 不写状态，Controller 只路由，GamePage 不持有业务状态。
- [x] 将完整 `server.gameState`、玩家事件、地产/投资/监狱/时代/税收事件全部归并到 Store；渲染层只读取 snapshot/projection。
- [ ] 删除客户端预测骰子、自由移动和本地经济修改路径，保留请求意图与 pending 状态。
- [x] 运行 client 全量测试、lint、build 并提交 `refactor: centralize client game state`。

### Task 7: 完成文档、差异检查与全量验证

**Files:**
- Modify: `docs/architecture/API.md`
- Modify: `docs/guides/DEVELOPER.md`
- Create: `docs/architecture/world-persistence.md`

- [ ] 更新协议、权威状态流、监狱、破产、持久化和生产环境变量说明。
- [ ] 检查 `ai-bot/ai_bot_try` 未被读取或修改，扫描危险接口和残留注册点。
- [x] 运行客户端、服务端、共享包 test、lint、typecheck、build 及 diff check。
- [ ] 修复所有失败，记录未执行项、假设和遗留风险，按阶段提交，不重写既有提交。
