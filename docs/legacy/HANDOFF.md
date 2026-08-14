# 临时交接文档

> Task 9 文档基线：运行时仅有 `packages/shared/server/client` 三包；无 admin；配置文件直接编辑；客户端单一 Socket 与单一事件入口；服务端银行权威。

> 生成日期：2026-08-02
> 工作仓库：`tycoon-game`（monorepo、pnpm workspace）
> 远程地址：https://github.com/Dai-Yizhou/tycoon-game.git
> 当前分支：`dev-Dai`

---

## 一、近期完成的主要任务

### 1. 服务端权威验证（commit `e3b58e8`、`1ef8ccd`）
- **目标**：确保客户端只发送请求，所有事件处理在服务端完成。
- **改动**：清理客户端本地回退逻辑（组队、掷骰、移动、数值变更等），所有事件走 Socket.IO 服务端校验。
- **关键文件**：
  - `packages/server/src/socket/` — 服务端事件处理器（TeamHandler、SocketManager 等）
  - `packages/client/src/game/systems/SocketEventHandler.ts` — 客户端仅监听服务端推送
  - `packages/shared/src/types/socket-events.ts` — 规范化的 ClientToServerEvents / ServerToClientEvents 类型

### 2. 代码模块化拆分（commit `2075174`）
- **目标**：将 `GamePage.ts`（原 ~3900 行）按职责拆分独立模块。
- **拆分结果**：
  - `packages/client/src/game/systems/` 下 16 个模块：
    - `GameLogic.ts` — 核心业务逻辑
    - `UIUpdates.ts` / `UIBuilders.ts` / `UIRenderer.ts` — UI 渲染与更新
    - `ModalSystem.ts` — 模态窗口管理
    - `MovementSystem.ts` — 移动逻辑
    - `SocketEventHandler.ts` — Socket 事件处理
    - `TeamSystem.ts` / `ChatSystem.ts` / `ItemSystem.ts` — 各子系统
    - `TalentSystem.ts` / `AchievementSystem.ts` / `TutorialSystem.ts` — 天赋/成就/教程
    - `MapLoader.ts` / `ConfigLoader.ts` — 配置加载
  - `packages/client/src/state/GameStore.ts` — 全局状态集中管理（getter + setter）
  - `GamePage.ts` 精简为 ~1220 行的编排层

### 3. 国际化完善（commit `2075174`）
- **新增文件**：`packages/client/src/game/i18n.ts` — 包装层，支持语言切换 + localStorage 持久化
- **替换范围**：`LoadingPage.ts`、`GameStore.ts`（频道标签）、`BoardRenderer.ts`、`DayNightRenderer.ts`、`ChatSystem.ts`、`UIBuilders.ts` 等硬编码中文
- **语言包**：`packages/shared/src/i18n/zh-CN.json` / `en-US.json`
- **未覆盖**：`MapLoader.ts` 和 `ConfigLoader.ts` 中的地图/天赋/成就数据文本（应按硬约束改为独立 JSON 配置文件，属另一任务范围）

---

## 二、分支结构

| 分支 | 用途 | 说明 |
|------|------|------|
| `main` | 稳定版 | 初始提交，未同步最新 `dev-Dai` 变更 |
| `dev-Dai` | 主开发分支 | 包含服务端权威、模块拆分、国际化等最新功能 |
| `ui-Dai` | UI 设计分支 | 当前与 `dev-Dai` 有历史分叉，含 UI 相关改动 |

**计划清理**：远程 `Dais_branch_1` 分支将被删除。

---

## 三、架构与开发约定

### 技术栈
- **Monorepo**：`packages/client/` + `packages/server/` + `packages/shared/`
- **前端**：TypeScript + Vite + Canvas 2D 渲染（无框架）
- **后端**：Express + Socket.IO
- **构建**：TypeScript 编译 + pnpm workspace

### 关键架构决策
- **服务端权威**：所有游戏事件处理在服务端完成，客户端仅发送请求并同步状态。
- **单一 Socket 入口**：`createSocket` 创建连接，`SocketEventHandler` 集中消费服务端事件，`GameHudShell` 只消费 ViewModel。
- **直接编辑配置**：编辑 `packages/server/config/` 与 `packages/client/public/config/` 中的 JSON，重启或构建后生效。
- **状态管理**：通过 `GameStore.ts` 的 getter/setter 统一管理，禁止直接修改导入变量。
- **国际化**：使用 `t()` 函数动态获取文本，语言包键按命名空间组织（`loading.*`、`chat.*`、`board.*` 等）。
- **Canvas 渲染**：使用 `devicePixelRatio` 保持视觉尺寸，摄像机自动跟随玩家，禁止缩放/拖拽。

### 工作规则
- 工作规则仓库：`agent-rules/`（已同步至 `rules/` 目录，参考 `CLAUDE.md`）
- 遵循 `work-principles.md`、`verification-and-debugging.md`、`communication.md`
- 所有修改需通过 `tsc --noEmit` 验证

---

## 四、已知问题与风险

### 高优先级
1. **完整联机回归**：继续覆盖登录、移动、断线重连、银行和破产流程。
2. **`main` 分支落后**：`main` 未同步 `dev-Dai` 的最新重构，发布前需按流程合并。

### 中优先级
3. **pnpm-lock 变更大**：`pnpm-lock.yaml` 有大量变更（+785/-492），可能引入依赖版本不一致。
5. **国际化覆盖率**：`zh-CN.json` 和 `en-US.json` 的 key 结构需保持同步，当前 en-US 部分键缺少翻译。
6. **游戏测试**：模块拆分后未进行完整的 E2E 游戏流程测试，可能存在回归。

### 低优先级
7. **临时脚本清理**：根目录曾有临时脚本（已清理），注意不要提交临时文件。
8. **TypeScript 严格模式**：当前未启用 `strict: true`，建议未来启用以提升类型安全。

---

## 五、启动与验证

```bash
# 安装依赖
pnpm install

# 启动服务端
pnpm --filter @game/server dev

# 启动客户端
pnpm --filter @game/client dev

# 三包构建与测试
pnpm build:shared && pnpm build:server && pnpm build:client
pnpm --filter @game/shared test
pnpm --filter @game/server test
pnpm --filter @game/client test
```

---

## 六、共享仓库说明

本仓库已同步至 `~/tycoon-game/shared-repo/`，包含完整 Git 历史和多分支。
多个会话通过此共享仓库在不同分支上协作编辑。
推送/拉取操作通过远程 `origin`（GitHub）进行同步。

---

## 七、2026-08-05 更新

- 已从远程 `dev-Dai` 恢复主项目文档与独立工具目录；这些工具不属于三包运行时。
- 恢复时排除了 `.obsidian`、截图、`output`、`individual_reports`、`test-dist`、编译产物、训练产物和模型文件。
- 已确认 `packages/server/map.json` 存在。
- 工具链版本：Node `v24.18.0`，pnpm `v11.18.0`。
- 已在隔离目录 `/tmp/tycoon-work` 安装依赖并完成四包构建，构建成功。
- admin 测试通过。
- 其他测试当前失败原因：shared 存在 i18n Jest 映射和性能阈值问题；server 存在 JWT `exp`/`expiresIn`、昼夜、MongoDB 和 vi 相关问题；client 存在 Jest/Vitest、Canvas、mock 和模块解析问题。
- 桌面仓库受权限限制，无法创建 `node_modules` 和 `.git/index.lock`。
- 后端技术栈更正为 Express + Socket.IO。
- 共享仓库路径：`~/Desktop/tycoon-game/shared-repo`。

---

## 八、2026-08-07 更新

### 1. 服务端权威全面收敛

- **移动最终落点事务唯一化**：中间格不触发业务逻辑，只有最终停留格触发一次结算。
  - 关键文件：`packages/server/src/handlers/movementHandler.ts`、`transport/handlers.ts`
- **监狱所有者不可收租**：租金计算时过滤处于监狱状态的所有者。
  - 关键文件：`packages/server/src/handlers/propertyHandler.ts`
- **道具出狱校验**：完善玩家状态、道具持有、道具类型的校验。
  - 关键文件：`packages/server/src/handlers/jailHandler.ts`
- **组队状态收敛**：`TeamManager` 与 `GameWorld Player.teamId` 同步，退出/踢人/解散时通知所有成员。
  - 关键文件：`packages/server/src/handlers/teamHandler.ts`
- **客户端业务请求收敛**：`GameLogic.ts` 中所有操作只发送 `client.*` 请求，不修改本地业务状态。
  - 关键文件：`packages/client/src/game/systems/GameLogic.ts`
- **ModalSystem 弹窗收敛**：交通枢纽、银行、道具弹窗改为只发送请求，等待服务端事件驱动状态更新。
  - 关键文件：`packages/client/src/game/systems/ModalSystem.ts`
- **Socket 事件集中管理**：使用 `WeakSet` 防止重复注册，`unregisterSocketHandlers` 正确清理。
  - 关键文件：`packages/client/src/game/systems/SocketEventHandler.ts`
- **`client.move` 拒绝非授权调用**：普通移动请求返回错误，必须由服务端移动流程发起。
  - 关键文件：`packages/server/src/handlers/movementHandler.ts`

### 2. 新增测试

| 测试文件 | 验证内容 |
|----------|----------|
| `packages/server/tests/transport/authoritativeMovement.test.ts` | 移动权威：中间格不触发、最终格唯一触发 |
| `packages/server/tests/handlers/rentAuthority.test.ts` | 租金权威：被监禁所有者不收租 |
| `packages/server/tests/handlers/jailItemRelease.test.ts` | 道具出狱：各种校验场景 |
| `packages/client/tests/socket-handler-lifecycle.test.ts` | Socket 监听生命周期：重复注册和清理 |
| `packages/client/tests/server-authority-rendering.test.ts` | 客户端渲染权威：GameLogic 和 ModalSystem 无本地状态修改 |
| `packages/client/tests/client-authoritative-actions.test.ts` | 客户端操作权威：所有操作只发送请求 |

### 3. 新增文档

- `docs/legacy/UI_REBUILD_HANDOFF.md` — UI 重构交接文档，明确需要显示的信息、数据流和组件拆分建议。

### 4. 破产重开服务端处理器

- **`client.bankruptRestart` 服务端处理器**：`HandlerRegistry.handleBankruptRestart` 调用 `Bankruptcy.revivePlayer()` 处理破产重开请求。
  - 关键文件：`packages/server/src/transport/handlers.ts`
  - 注入点：`packages/server/src/app.ts` → `handlerRegistry.setBankruptcy(bankruptcy)`
- **Socket 事件类型补充**：`shared/src/types/socket-events.ts` 新增 `client.bankruptRestart` 事件定义。
- **客户端 `checkBankruptcy` 导出**：`GameLogic.ts` 新增 `checkBankruptcy()` 函数，`SocketEventHandler.ts` 恢复导入。
- **TypeScript 编译错误修复**：清理 `GameLogic.ts`、`ModalSystem.ts`、`SocketEventHandler.ts` 中的未使用变量和导入。

### 5. 文档更新

- `docs/architecture/ARCHITECTURE.md` 新增「破产重开流程」章节。
- `docs/architecture/API.md` 新增 `client.bankruptRestart` 事件文档。

### 6. 客户端测试注意事项

- 客户端测试使用 `jest` + `ts-jest` + `jsdom` 环境
- `server-authority-rendering.test.ts` 和 `client-authoritative-actions.test.ts` 通过文件内容静态分析验证服务端权威
- 运行：`pnpm --filter @game/client test`
