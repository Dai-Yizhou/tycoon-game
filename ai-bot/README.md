# AI 玩家程序 (ai-bot)

自动进行游戏操作的 AI 玩家程序，能够模拟真实玩家行为并生成自然语言日志，记录游戏过程、检测 bug 和其他不足。

**完全独立于主项目**，不依赖 `@game/shared` 等包，拥有独立的 `package.json` 和类型定义，不会影响项目其他部分。

## 功能特性

- **自动游戏操作**：掷骰、购买/升级地产、组队、学习天赋、修缮纪念碑、岔路选择
- **规则驱动决策引擎**：模拟真实玩家行为的优先级决策系统
- **自然语言日志**：6 级日志（info/action/event/warning/error/bug），记录完整游戏过程
- **Bug 检测**：自动检测异常情况（掷骰无响应、操作超时、负数资金、状态不一致等）
- **多 Bot 支持**：可同时启动多个 AI 玩家，支持运行时动态添加/删除
- **日志查看面板**：Web 界面实时查看日志，支持按 Bot/级别/关键词过滤
- **多渠道输出**：文件（每个 Bot 独立日志文件）、彩色控制台、WebSocket 实时推送
- **多维度评价引擎**：6 维度评分（gameplay/economy/visuals/bugs/balance/ui），支持 LLM 增强
- **多后端 LLM 集成**：Ollama / Groq / OpenRouter / Together AI / llamafile / 规则引擎，运行时可切换
- **日志自动保存**：每个 Bot 独立日志文件，自动持久化到 `/Volumes/T7_APFS/monopoly-io-game/ai-bot/logs` 目录
- **浏览器 AI 玩家（BrowserAIPlayer）**：基于 Puppeteer 的浏览器 AI 玩家，像真人一样打开游戏页面、截图、点击 UI 按钮（骰子/购买/升级），支持 LLM 视觉分析游戏画面，LLM 不可用时回退到 DOM 状态提取；可在控制面板 Bot 卡片中点击截图查看按钮查看画面
- **增强 Bug 检测**：除 AI Bot 自身 bug 外，还检测游戏服务端 bug（移动步数校验、经济计算校验、位置跳跃检测、广播事件追踪、玩家数据同步校验、地图数据异常检测、冷却不匹配检测）
- **Dashboard 每 Bot LLM 配置**：每个 Bot 卡片支持驱动模式切换（规则引擎/LLM）按钮和内联 LLM prompt 配置面板（性格 + 策略文本框）；浏览器型 Bot 标记 🖥️ 图标并显示截图查看按钮；Bot 卡片分别显示游戏 bug 数和 AI bug 数

## 目录结构

```
ai-bot/
├── src/
│   ├── types.ts              # 本地类型定义（不依赖主项目）
│   ├── Logger.ts             # 自然语言日志生成器
│   ├── BugDetector.ts        # Bug 检测器
│   ├── DecisionEngine.ts     # 规则驱动决策引擎
│   ├── AIBot.ts              # AI 玩家核心类
│   ├── BotManager.ts         # Bot 管理器（动态创建/停止/删除）
│   ├── EvaluationEngine.ts   # 多维度评价引擎（支持 LLM 增强）
│   ├── LLMAdapter.ts         # 多后端 LLM 适配器（Ollama/OpenAI 兼容/Dummy）
│   ├── ScreenshotService.ts  # 游戏页面截图服务
│   ├── main.ts               # CLI 入口
│   └── dashboard/
│       └── server.ts         # 控制面板 Web 服务（含 LLM 配置 UI）
├── logs/                     # 日志文件目录（自动生成）
├── package.json
├── tsconfig.json
└── README.md
```

## 快速开始

### 1. 安装依赖

```bash
cd ai-bot
npm install
```

### 2. 编译

```bash
npm run build
```

### 3. 运行

确保游戏服务端已启动（默认 `http://localhost:3000`），然后启动 AI 玩家：

```bash
# 开发模式（使用 tsx 直接运行 TS）
npm run dev -- --count 3

# 生产模式（先编译再运行）
npm run build && npm start -- --count 3
```

## CLI 选项

| 选项 | 说明 | 默认值 |
|---|---|---|
| `--server <url>` | 服务端地址 | `http://localhost:3000` |
| `--count <n>` | AI 玩家数量 | `1` |
| `--prefix <name>` | 用户名前缀 | `AI_Bot` |
| `--guest` | 使用游客模式 | `false` |
| `--interval <ms>` | 决策间隔（毫秒） | `2000` |
| `--no-buy` | 禁用自动购买 | - |
| `--no-upgrade` | 禁用自动升级 | - |
| `--no-team` | 禁用自动组队 | - |
| `--no-talent` | 禁用自动学习天赋 | - |
| `--reserve <n>` | 购买保留资金 | `500` |
| `--log-dir <path>` | 日志文件目录 | `/Volumes/T7_APFS/monopoly-io-game/ai-bot/logs` |
| `--dashboard` | 启动控制面板（端口 4040） | - |
| `--dashboard-port <n>` | 控制面板端口 | `4040` |
| `--evaluate` | 启用评价引擎（定时生成报告） | - |
| `--evaluate-interval <ms>` | 评价间隔毫秒 | `300000`（5分钟） |
| `--llm` | 启用 LLM 评价增强 | - |
| `--llm-type <type>` | LLM 类型：`ollama` / `openai-compatible` / `dummy` | `ollama` |
| `--llm-model <name>` | LLM 模型名称 | `qwen2.5:0.5b` |
| `--llm-url <url>` | LLM API 地址 | `http://localhost:11434` |
| `--llm-apikey <key>` | API Key（用于 openai-compatible 类型） | - |
| `--screenshot` | 启用截图服务 | - |
| `--screenshot-url <url>` | 截图目标 URL | `http://localhost:5173` |
| `--screenshot-dir <path>` | 截图保存目录 | `./screenshots` |
| `--screenshot-interval <ms>` | 截图间隔毫秒 | `10000` |
| `--browser` | 启用浏览器 AI 玩家模式 | - |
| `--browser-url <url>` | 游戏页面 URL | `http://localhost:5173` |
| `--browser-headless` | 浏览器无头模式运行 | `true` |
| `--browser-screenshot-dir <path>` | 浏览器截图保存目录 | `/Volumes/T7_APFS/monopoly-io-game/ai-bot/screenshots` |
| `--help` | 显示帮助 | - |

### 使用示例

```bash
# 启动 2 个 AI 玩家并开启控制面板和评价引擎
npx tsx src/main.ts --count 2 --dashboard --evaluate

# 启动 1 个游客 AI 玩家，禁用组队
npx tsx src/main.ts --guest --no-team

# 启动 AI 玩家并启用本地 Ollama LLM
npx tsx src/main.ts --count 2 --dashboard --evaluate --llm --llm-type ollama --llm-model qwen2.5:0.5b

# 启动 AI 玩家并启用 Groq 云端 LLM
npx tsx src/main.ts --count 2 --dashboard --evaluate --llm --llm-type openai-compatible --llm-url https://api.groq.com/openai --llm-model llama-3.1-8b-instant --llm-apikey gsk_xxxxx

# 仅启动控制面板（LLM 可运行时从面板切换）
npx tsx src/main.ts --count 2 --dashboard

# 启动浏览器 AI 玩家（像真人一样操作游戏页面，可在面板查看截图）
npx tsx src/main.ts --count 1 --dashboard --browser --browser-url http://localhost:5173
```

> **提示**：即使启动时未指定 `--llm`，也可以从控制面板「配置」标签页运行时切换 LLM 后端。

## 日志查看面板

使用 `--dashboard` 选项启动控制面板 Web 服务：

```bash
npx tsx src/main.ts --dashboard
```

然后访问 `http://localhost:4040` 即可查看实时日志。

### Dashboard 功能

- **实时日志流**：WebSocket 推送，新日志自动滚动显示
- **级别过滤**：info / action / event / warning / error / bug
- **Bot 过滤**：选择特定 AI 玩家的日志
- **关键词搜索**：按消息内容过滤
- **Bug 高亮**：bug 级别日志带脉冲动画提醒
- **统计信息**：显示各 Bot 的操作数、掷骰数、Bug 数等
- **添加/删除 AI 玩家**：运行时动态创建或移除 Bot
- **手动控制**：向指定 Bot 发送命令（掷骰、购买、升级等）
- **评价报告**：一键生成多维度评价报告，支持 LLM 增强
- **LLM 后端配置**：运行时切换 LLM 后端（详见下方）

### Dashboard 标签页

| 标签 | 功能 |
|---|---|
| 日志 | 实时日志流，支持 Bot/级别/关键词三维过滤 |
| 评价报告 | 多维度评分、改进建议、LLM 分析 |
| 手动控制 | 向指定 Bot 发送命令 |
| 添加 AI | 动态创建新 AI 玩家 |
| 配置 | 全局配置 + LLM 后端选择 |

### Dashboard API

| 接口 | 方法 | 说明 |
|---|---|---|
| `/` | GET | 控制面板前端页面 |
| `/api/logs?bot=&level=&keyword=&limit=` | GET | 获取历史日志（支持过滤） |
| `/api/bots` | GET | 获取所有 AI 玩家列表 |
| `/api/bots/:name` | GET | 获取指定 Bot 详细状态 |
| `/api/bots/create` | POST | 动态创建并启动 AI 玩家 |
| `/api/bots/:name` | DELETE | 停止并删除指定 Bot |
| `/api/bots/:name/control` | POST | 控制指定 Bot（pause/resume/stop） |
| `/api/bots/control` | POST | 批量控制（pauseAll/resumeAll/stopAll） |
| `/api/bots/:name/config` | PUT | 更新 Bot 配置 |
| `/api/bots/:name/command` | POST | 向指定 Bot 发送命令 |
| `/api/stats` | GET | 获取统计信息 |
| `/api/evaluation` | GET | 获取最新评价报告 |
| `/api/evaluation/run` | POST | 立即生成评价报告 |
| `/api/llm/presets` | GET | 获取 LLM 预设后端列表 |
| `/api/llm/config` | POST | 设置并切换 LLM 后端 |
| `/api/llm/test` | POST | 测试 LLM 连接（不切换） |
| `/api/llm/status` | GET | 获取当前 LLM 状态 |
| `/ws` | WS | WebSocket 实时推送新日志 |

## 日志格式

日志分为 6 个级别，每个级别有不同颜色和用途：

| 级别 | 颜色 | 说明 | 示例 |
|---|---|---|---|
| `info` | 灰色 | 一般信息 | `已连接到服务端，socketId=xxx` |
| `action` | 蓝色 | AI 主动操作 | `掷骰子，结果：7 步` |
| `event` | 绿色 | 服务端事件 | `地产格子 5 被「AI_Bot」购买` |
| `warning` | 黄色 | 警告信息 | `与服务端断开连接` |
| `error` | 红色 | 错误信息 | `登录失败：用户名已存在` |
| `bug` | 品红 | 检测到 bug | `掷骰后 10 秒未收到移动响应` |

日志文件存储在 `--log-dir` 指定目录（默认 `/Volumes/T7_APFS/monopoly-io-game/ai-bot/logs`），每个 AI 玩家一个文件，命名为 `{username}_{timestamp}.log`。

> **自动保存**：日志在 Bot 运行期间自动持续写入文件，无需手动操作。文件包含完整的事件上下文，可用于离线分析。

## 评价引擎

评价引擎（`EvaluationEngine`）对游戏进行多维度评分，支持规则引擎和 LLM 增强两种模式。

### 评价维度

| 维度 | 权重 | 评分依据 |
|---|---|---|
| gameplay | 25% | AI 操作数量、路径选择、组队机制 |
| economy | 20% | 地产交易、升级、资金状态 |
| bugs | 20% | 检测到的 Bug 数量、错误次数 |
| balance | 15% | 破产情况、平均资金、难度 |
| ui | 10% | 界面布局、操作流程（需人工确认） |
| visuals | 10% | 渲染效果、动画流畅度（需人工确认） |

### 启用评价引擎

```bash
# 启动时启用（5分钟间隔）
npx tsx src/main.ts --count 2 --dashboard --evaluate

# 自定义评价间隔（10分钟）
npx tsx src/main.ts --count 2 --dashboard --evaluate --evaluate-interval 600000
```

### 手动运行评价

在控制面板中点击「运行评价」按钮，或在 API 调用：

```bash
curl -X POST http://localhost:4040/api/evaluation/run
```

### 评价报告结构

```json
{
  "timestamp": 1234567890,
  "overallScore": 75,
  "categories": {
    "gameplay": { "score": 80, "maxScore": 100, "notes": [...] },
    "economy": { "score": 70, "maxScore": 100, "notes": [...] },
    ...
  },
  "suggestions": ["优先修复检测到的 Bug", ...],
  "llmAnalysis": "（LLM 生成的分析，若启用）"
}
```

## LLM 后端配置

AI 评价系统支持多种 LLM 后端，可在启动时通过 CLI 指定，也可在运行时从控制面板切换。

### 支持的后端

| 后端 ID | 类型 | 标签 | 需要 API Key | 说明 |
|---|---|---|---|---|
| `ollama` | ollama | Ollama（本地） | 否 | 本地 Ollama 服务，不依赖网络 |
| `groq` | openai-compatible | Groq 云端（免费） | 是 | 推理极快（100+ tokens/s） |
| `openrouter` | openai-compatible | OpenRouter 云端 | 是 | 聚合多提供商，含免费模型 |
| `llamafile` | openai-compatible | llamafile（本地单文件） | 否 | 单可执行文件，适合 Intel Mac |
| `together` | openai-compatible | Together AI 云端 | 是 | 免费额度，推理快 |
| `dummy` | dummy | 规则引擎 | 否 | 内置评价，无需 LLM |

### 运行时切换（推荐）

1. 打开控制面板 `http://localhost:4040`
2. 切换到「配置」标签页
3. 在「LLM 后端配置」区域：
   - 从下拉菜单选择后端
   - 查看 description 和 setupGuide
   - 填写 API 地址、模型名称、API Key（若需要）
   - 点击「测试连接」验证配置
   - 点击「应用并切换」生效

### 启动时指定

```bash
# Ollama 本地
npx tsx src/main.ts --llm --llm-type ollama --llm-model qwen2.5:0.5b --llm-url http://localhost:11434

# Groq 云端
npx tsx src/main.ts --llm --llm-type openai-compatible --llm-url https://api.groq.com/openai --llm-model llama-3.1-8b-instant --llm-apikey gsk_xxxxx

# OpenRouter 云端（免费模型）
npx tsx src/main.ts --llm --llm-type openai-compatible --llm-url https://openrouter.ai/api --llm-model meta-llama/llama-3.2-3b-instruct:free --llm-apikey sk-or-v1-xxxxx
```

> 详细配置指南见 [LLM 配置指南](./docs/LLM_GUIDE.md)。

### LLM API

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/llm/presets` | GET | 获取预设后端列表和当前状态 |
| `/api/llm/config` | POST | 设置并切换 LLM 后端 |
| `/api/llm/test` | POST | 测试连接（发送测试 prompt） |
| `/api/llm/status` | GET | 获取当前 LLM 配置和可用性 |

### 适配器架构

```
LLMAdapterFactory
├── OllamaAdapter          # Ollama 原生 API (/api/generate)
├── OpenAICompatibleAdapter # OpenAI 兼容 API (/v1/chat/completions)
│   ├── Groq
│   ├── OpenRouter
│   ├── Together AI
│   └── llamafile server
└── DummyAdapter           # 规则引擎回退
```

所有适配器实现统一的 `LLMAdapter` 接口：

```typescript
interface LLMAdapter {
  generate(prompt: string): Promise<string>;
  isAvailable(): boolean;
  getModelName(): string;
  getBackendType(): LLMBackendType;
}
```

## Bug 检测

BugDetector 会自动检测以下异常情况：

| 检测项 | 触发条件 | 超时 |
|---|---|---|
| 掷骰无响应 | 发送 `client.rollDice` 后未收到移动事件 | 10 秒 |
| 购买无响应 | 发送 `client.buyProperty` 后未收到广播 | 5 秒 |
| 升级无响应 | 发送 `client.upgradeProperty` 后未收到广播 | 5 秒 |
| 组队无响应 | 接受邀请后未收到队伍更新 | 8 秒 |
| 负数资金 | 玩家资金出现负数 | 即时 |
| 破产异常 | 破产时资金为正数 | 即时 |
| 操作卡死 | 待处理操作超过 15 秒未完成 | 15 秒 |
| 玩家不移动 | 其他玩家长时间位置不变 | 5 分钟（提醒） |

### 游戏服务端 Bug 检测

增强版 BugDetector 除了检测 AI Bot 自身异常外，还会检测游戏服务端的 bug：

| 检测项 | 说明 |
|---|---|
| 移动步数校验 | 掷骰结果与实际移动步数不一致 |
| 经济计算校验 | 操作花费与实际资金变化不一致 |
| 位置跳跃检测 | 非连续移动（位置瞬间跳变） |
| 广播事件追踪 | 缺失应有的服务端广播事件 |
| 玩家数据同步校验 | 服务端状态与本地状态不一致 |
| 地图数据异常检测 | 地图数据格式或内容异常 |
| 冷却不匹配检测 | 服务端冷却时间与配置不一致 |

> **提示**：在控制面板的 Bot 卡片中，游戏 bug 数和 AI bug 数会分别显示，便于区分问题来源。

## 决策引擎

AI 玩家采用规则驱动的决策系统，按优先级依次判断：

1. **岔路选择**（最高优先级）：遇到岔路时随机选择方向
2. **组队邀请响应**：收到邀请时自动接受
3. **状态检查**：破产/监狱等异常状态处理
4. **天赋学习**：在起点且有天赋点时学习天赋
5. **格子操作**：根据停留格子类型执行购买/升级/修缮/传送
6. **掷骰**：无冷却时掷骰移动
7. **主动组队**：偶尔邀请其他玩家组队
8. **聊天**：偶尔发送聊天消息

### 购买策略

- 地产无主且资金充足（扣除后仍 > `reserveMoney`）时购买
- 已拥有地产且资金充足时升级
- 保留资金通过 `--reserve` 选项配置

## 独立性说明

本包完全独立于主项目：

- **不依赖** `@game/shared`、`@game/server` 或 `@game/client`
- 使用本地类型定义（`src/types.ts`），与服务端类型结构保持一致但不直接引用
- 独立的 `package.json` 和 `tsconfig.json`
- 不修改主项目的任何文件

## 技术细节

- **运行时**：Node.js >= 18
- **语言**：TypeScript 5.4，ESM 模块
- **依赖**：socket.io-client（连接服务端）、express + ws（日志面板）
- **通信**：通过 Socket.IO 与游戏服务端通信，模拟真实客户端行为
