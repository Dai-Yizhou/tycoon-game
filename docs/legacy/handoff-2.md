# 临时交接文档

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
    - `TeamSystem.ts` / `ChatSystem.ts` / `ItemSystem.ts` / `BankSystem.ts` — 各子系统
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
- **前端**：TypeScript + Canvas 2D 渲染（无框架）
- **后端**：Koa + Socket.IO
- **构建**：TypeScript 编译 + pnpm workspace

### 关键架构决策
- **服务端权威**：所有游戏事件处理在服务端完成，客户端仅发送请求并同步状态。
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
1. **MapLoader.ts / ConfigLoader.ts 数据硬编码**：地图格子名称/描述、天赋/成就定义仍为 TypeScript 硬编码中文，应改为独立 JSON 配置文件以便多语言支持。
2. **`components/`、`hud/`、`tutorial/` 目录弃用**：这些目录已被 `tsconfig.json` exclude 且无引用，后续可安全删除。
3. **`main` 分支落后**：`main` 分支停留在初始提交，未同步 `dev-Dai` 的最新重构。若需从 `main` 发布，需要先合并。

### 中优先级
4. **pnpm-lock 变更大**：`pnpm-lock.yaml` 有大量变更（+785/-492），可能引入依赖版本不一致。
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

# 类型检查
pnpm -r exec tsc --noEmit
```

---

## 六、共享仓库说明

本仓库已同步至 `~/tycoon-game/shared-repo/`，包含完整 Git 历史和多分支。
多个会话通过此共享仓库在不同分支上协作编辑。
推送/拉取操作通过远程 `origin`（GitHub）进行同步。