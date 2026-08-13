# 项目交接文档

> 当前交接基线：主运行时为 `@game/shared`、`@game/server`、`@game/client`，无 admin 包。配置直接编辑 JSON；客户端使用单一 Socket 与 `SocketEventHandler`；银行及关键经济状态由服务端权威维护。

> 更新时间：2026-07-12
> 项目：大富翁.io（monopoly-io-game）
> 存储位置：`/Volumes/T7_APFS/monopoly-io-game/`
> 配套阅读：[手写交接备注](./HANDOVER_NOTES.md)（Dai 于 2026/07/12）

---

> **重要提示**：本文档为自动整理的交接文档，请务必同时阅读 [HANDOVER_NOTES.md](./HANDOVER_NOTES.md) 中的手写备注，其中包含第一手开发经验和未完成事项说明。

## 一、项目概览

大富翁.io 是一款结合经典大富翁玩法与 io 游戏大世界概念的多人在线网页游戏。全栈 TypeScript 开发，支持千人级并发、数据驱动规则、插件式扩展。

### 核心模块

| 模块 | 路径 | 说明 |
| --- | --- | --- |
| 游戏服务端 | `packages/server/` | Express + Socket.IO，游戏世界与经济权威 |
| 游戏客户端 | `packages/client/` | Vite + Canvas 2D 渲染 |
| AI Bot 系统 | `ai-bot/` | AI 玩家 + 浏览器 AI + 评价引擎 |
| 配置文件 | `packages/server/config/`、`packages/client/public/config/` | 直接编辑 JSON，重启或构建生效 |
| Ollama 本地 | `ollama/` | 本地 LLM 服务（含模型） |
| llamafile | `llamafile/` | 单文件 LLM 备选方案 |

---

## 二、当前已知问题

### 2.1 视觉 LLM 性能问题（高优先级）

**现象**：在 Intel Mac 上，纯 CPU 推理的视觉 LLM 速度极慢，无法满足实时决策需求。

**详情**：
- `minicpm-v`（7.6B）：首次调用 > 120 秒，常规调用 ~90 秒/次
- `moondream`（1B）：首次调用 > 3 分钟，因 `num_ctx: 2048` 限制导致大图片+长 prompt 溢出
- 已设置 60 秒超时，连续 2 次超时后自动禁用视觉模式，回退到 DOM 提取 + 规则决策

**影响**：
- 浏览器 AI 玩家的视觉决策模式在 Intel Mac 上基本不可用
- AI 玩家主要依赖 DOM 模式（通过 Puppeteer 直接读取页面 DOM 状态 + 规则引擎决策）

**后续建议**：
1. 使用 GPU 加速的 Mac（Apple Silicon M 系列）可大幅提升推理速度
2. 接入云端视觉 API（如 Groq Llama 3.2 Vision）作为备选
3. 进一步压缩图片分辨率（如 320x200）和缩短提示词以适配小模型
4. 研究更小的视觉模型（如 `moondream:1.7b` 量化版本）

### 2.2 文本 LLM 评价超时（中优先级）

**现象**：评价引擎调用本地 LLM 生成评价分析时，60 秒内未返回。

**详情**：
- `qwen2.5:0.5b` 在 Intel Mac 上纯 CPU 推理约 18-30 秒/次（短文本）
- 评价 prompt 较长时可能超时
- 已设置 60 秒 `Promise.race` 超时保护，超时后跳过 LLM 分析，不阻塞评价流程

**后续建议**：
1. 使用更小的模型或量化版本
2. 缩短评价 prompt，减少输出 token 数
3. 接入云端 API（Groq 等）以获得更快响应

### 2.3 系统盘空间不足（高优先级，环境相关）

**现象**：macOS 系统盘仅剩 ~500MB 可用空间，Node.js 进程可能因磁盘空间不足崩溃。

**详情**：
- Puppeteer 的 Chrome profile 临时文件、截图文件等可能占用大量空间
- 已将临时目录设为 `TMPDIR=/Volumes/T7_APFS/monopoly-io-game/ai-bot/tmp`
- Ollama 模型存储在 `/Volumes/T7_APFS/monopoly-io-game/ollama/models/`

**注意事项**：
- 启动 AI Bot 时必须设置 `TMPDIR` 环境变量到外置硬盘
- Ollama 启动时需设置 `OLLAMA_MODELS` 环境变量
- 定期清理 `ai-bot/screenshots/` 和 `ai-bot/logs/` 目录

### 2.5 未充分验证的功能（来自手写备注）

**以下功能仅验证了部分单机逻辑，尚未充分验证：**

- 地产收租与合资系统
- 天赋启用与效果
- 组队数值共享
- 时代结算与切换

**服务端性能：**
- 千人并发未测试（受硬件限制）
- 建议在生产环境进行压力测试

**AI 玩家系统：**
- 文字 LLM 在早期版本可正常输出评价
- 接入视觉 LLM 后出现较多稳定性问题
- 未充分验证 LLM 实际参与了 AI 玩家决策
- AI Bug 检测功能自身可能存在 Bug

**UI 设计：**
- 参考 florr.io wiki 风格调整
- 内测可用，但仍需迭代优化

### 2.6 Ollama 进程卡死（中优先级）

**现象**：当视觉 LLM 请求的上下文超过模型限制时，Ollama 服务可能卡死（CPU 占用高但不返回结果）。

**详情**：
- `moondream` 默认 `num_ctx: 2048`，图片 token 占用大，容易溢出
- 已通过缩短 prompt + 降低图片分辨率缓解
- 不建议在 `options` 中设置 `num_ctx > 2048`（可能导致内存不足和卡死）

**恢复方法**：
```bash
pkill -f "ollama serve"
sleep 2
OLLAMA_MODELS="/Volumes/T7_APFS/monopoly-io-game/ollama/models" \
OLLAMA_LIBRARY_PATH="/Volumes/T7_APFS/monopoly-io-game/ollama/bin" \
DYLD_LIBRARY_PATH="/Volumes/T7_APFS/monopoly-io-game/ollama/bin" \
/Volumes/T7_APFS/monopoly-io-game/ollama/bin/ollama serve &
```

---

## 三、可能出现的问题及预防

### 3.1 浏览器缓存导致代码不更新

**现象**：前端代码修改后，浏览器中仍显示旧版本。

**原因**：Vite 开发模式下的 HMR 可能有缓存，生产构建的 JS 文件名可能相同。

**解决方案**：
- 开发模式：强制刷新浏览器（Cmd + Shift + R）
- 生产模式：确保构建配置使用 content hash 文件名

### 3.2 Socket.IO 连接断开重连

**现象**：玩家频繁掉线重连，游戏状态不同步。

**可能原因**：
- 网络不稳定
- 服务端重启
- 心跳超时

**预防措施**：
- 客户端已实现自动重连
- 重连后通过 `server.gameState` 事件同步全量状态
- 重连后由 `SocketEventHandler` 恢复服务端事件监听并刷新新 HUD
- 检查 `pingInterval` 和 `pingTimeout` 配置是否合理

### 3.3 玩家位置同步延迟

**现象**：玩家移动动画卡顿或位置跳跃。

**可能原因**：
- 网络延迟高
- 插值算法参数不合理
- 服务端广播频率过低

**预防措施**：
- 使用 `easeInOutQuad` 缓动插值
- 相机平滑跟随
- 检查服务端 tick 频率配置

### 3.4 内存泄漏（长时间运行）

**现象**：服务端运行数小时后内存占用持续增长。

**可能原因**：
- Socket.IO 连接未正确清理
- 游戏对象（玩家、格子）未释放
- 定时器未清除

**预防措施**：
- 定期重启服务端（如每天一次）
- 监控内存使用情况
- 检查 `PlayerManager`、`GameWorld` 中的清理逻辑

### 3.5 地图数据格式变更

**现象**：地图 JSON 更新后，游戏加载失败或显示异常。

**可能原因**：
- 地图数据格式与代码预期不匹配
- 新增字段未在 `parseMapData` 中处理
- `normalizeClientMapData` 未适配新格式

**预防措施**：
- 修改地图数据前，检查 `packages/server/src/app.ts` 中的 `parseMapData` 函数
- 检查 `packages/client/src/board/board-renderer.ts` 中的 `normalizeClientMapData`
- 使用 `map_editor_v01.01/` 工具生成符合格式的地图

### 3.6 AI Bot 配置错误

**现象**：AI 玩家不行动、频繁报错、无法连接。

**常见配置问题**：
- `--llm` 参数启用了 LLM 但 Ollama 服务未启动
- `--browser-count > 0` 但未安装 Chrome/Chromium
- `--game-url` 指向的地址不可达
- 用户名重复导致登录失败

**排查步骤**：
1. 检查 `ai-bot/logs/` 下的日志文件
2. 确认游戏服务端和前端是否正常运行
3. 确认 Ollama 服务状态（`curl http://localhost:11434/api/tags`）
4. 确认 Chrome 可执行路径（`which google-chrome` 或检查 Puppeteer 配置）

### 3.7 天赋/成就配置变更

**现象**：天赋树显示异常、成就不触发。

**可能原因**：
- `talents.json` / `achievements.json` 格式错误
- 天赋 ID 重复或缺失
- 前置天赋依赖关系形成环

**预防措施**：
- 直接编辑 `packages/server/config/talents.json` 与 `packages/server/config/achievements.json`，同步客户端 `public/config/` 副本
- 修改后验证 JSON 格式正确性
- 检查天赋树是否有循环依赖

---

## 四、服务启动指南

### 4.1 游戏服务端
```bash
cd /Volumes/T7_APFS/monopoly-io-game/packages/server
pnpm install   # 首次需要
pnpm dev       # 开发模式（tsx）
# 或
pnpm build && pnpm start  # 生产模式
```

### 4.2 游戏前端
```bash
cd /Volumes/T7_APFS/monopoly-io-game/packages/client
pnpm install   # 首次需要
pnpm dev       # 开发模式（Vite，端口 5173）
# 或
pnpm build     # 生产构建到 dist/
```

### 4.3 Ollama 本地 LLM
```bash
OLLAMA_MODELS="/Volumes/T7_APFS/monopoly-io-game/ollama/models" \
OLLAMA_LIBRARY_PATH="/Volumes/T7_APFS/monopoly-io-game/ollama/bin" \
DYLD_LIBRARY_PATH="/Volumes/T7_APFS/monopoly-io-game/ollama/bin" \
/Volumes/T7_APFS/monopoly-io-game/ollama/bin/ollama serve &

# 验证
curl http://localhost:11434/api/tags
```

### 4.4 AI Bot 系统
```bash
cd /Volumes/T7_APFS/monopoly-io-game/ai-bot
npm install    # 首次需要
npx tsc        # 编译 TypeScript

# 完整启动（含控制面板、评价、LLM、浏览器AI）
TMPDIR=/Volumes/T7_APFS/monopoly-io-game/ai-bot/tmp \
node dist/main.js \
  --dashboard \
  --evaluate \
  --llm \
  --llm-type ollama \
  --llm-model qwen2.5:0.5b \
  --llm-vision-model moondream \
  --llm-url http://localhost:11434 \
  --browser-count 1 \
  --browser-headless \
  --count 1 \
  --screenshot-dir /Volumes/T7_APFS/monopoly-io-game/ai-bot/screenshots \
  --log-dir /Volumes/T7_APFS/monopoly-io-game/ai-bot/logs \
  --interval 5000
```

**访问控制面板**：http://localhost:4040

---

## 五、关键文档索引

| 文档 | 路径 | 说明 |
| --- | --- | --- |
| 项目说明 | `README.md` | 项目整体介绍 |
| 架构文档 | `docs/ARCHITECTURE.md` | 系统架构、技术选型、模块划分 |
| API 参考 | `docs/API.md` | Socket.IO 事件、REST 端点、数据类型 |
| 开发指南 | `docs/DEVELOPER.md` | 开发环境搭建、代码规范 |
| 编码风格 | `docs/CODING_STYLE.md` | 代码风格约定 |
| 内容创作 | `docs/CONTENT_CREATOR.md` | 地图/天赋/事件配置指南 |
| 玩家手册 | `docs/PLAYER.md` | 游戏玩法说明 |
| AI Bot 指南 | `ai-bot/docs/LLM_GUIDE.md` | LLM 配置和使用指南 |
| 需求规格 | `.trae/specs/monopoly-io-game/spec.md` | 产品需求规格 |
| 验收清单 | `.trae/specs/monopoly-io-game/checklist.md` | 验收检查清单 |
| 任务列表 | `.trae/specs/monopoly-io-game/tasks.md` | 开发任务分解 |
| 本文档 | `docs/HANDOVER.md` | 项目交接 |

---

## 六、打包规范

项目打包遵循以下规则（参考 `backup_monopoly.sh`）：

### 排除项
- `node_modules/` - 依赖包
- `dist/` - 构建产物
- `.git/` - Git 仓库
- `ai-bot/logs/` - AI Bot 日志
- `ai-bot/screenshots/` - AI Bot 截图
- `ai-bot/tmp/` - 临时文件
- `ollama/` - Ollama 服务及模型（体积大）
- `llamafile/*.gguf` - llamafile 模型文件
- `.DS_Store` - macOS 系统文件
- `.trae/` - TRAE 工作区配置

### 包含项
- 所有源代码（`packages/`, `ai-bot/src/`）
- 配置文件（`package.json`, `tsconfig.json`, `vite.config.ts` 等）
- 文档（`docs/`）
- JSON 配置（`packages/server/config/`、`packages/client/public/config/`）
- 地图编辑器（`map_editor_v01.01/`）
- 游戏配置（`packages/server/config/`, `packages/client/public/config/`）
- AI Bot 配置（`ai-bot/package.json`, `ai-bot/tsconfig.json`）

---

## 七、下一步开发建议

> 补充：详见 [HANDOVER_NOTES.md](./HANDOVER_NOTES.md) 中的手写备注

1. **功能验证**：充分验证地产收租/合资、天赋、组队、时代等核心系统
2. **AI 玩家修复**：修复视觉 LLM 接入后的稳定性问题，验证 LLM 实际参与决策
3. **功能完善**：实现更多格子类型（机场、监狱、事件卡等）的完整交互
4. **测试覆盖**：增加单元测试和集成测试覆盖率
5. **监控告警**：添加服务端性能监控和错误告警
6. **部署方案**：制定生产环境部署方案（Docker、Nginx、PM2 等）
7. **数据持久化**：完善 MongoDB 集成，支持玩家存档
8. **AI 增强**：优化浏览器 AI 的视觉决策能力，支持更多 UI 交互场景

---

*本文档最后更新：2026-07-12*
