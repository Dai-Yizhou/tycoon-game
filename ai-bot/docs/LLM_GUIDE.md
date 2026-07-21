# LLM 配置指南

AI 评价系统支持多种 LLM 后端。本指南详细介绍每种后端的安装、配置和使用方法。

## 后端对比

| 后端 | 速度 | 隐私 | 成本 | 网络依赖 | 适合场景 |
|---|---|---|---|---|---|
| Ollama | 慢（Intel Mac ~2-5 tokens/s） | 完全本地 | 免费 | 仅下载时需要 | 离线环境、隐私敏感 |
| Groq | 极快（100+ tokens/s） | 云端 | 免费 | 是 | 快速测试、日常使用 |
| OpenRouter | 快 | 云端 | 有免费模型 | 是 | 多模型切换 |
| Together AI | 快 | 云端 | 免费额度 | 是 | 生产环境 |
| llamafile | 中等 | 完全本地 | 免费 | 仅下载时需要 | Intel Mac 本地 |
| 规则引擎 | 即时 | 完全本地 | 免费 | 无 | 无需 LLM 的场景 |

## 方案一：Ollama 本地部署

### 环境要求

- macOS 12+（Intel 或 Apple Silicon）
- 4GB+ 可用内存（小模型）/ 8GB+（3B 模型）
- ~1GB 磁盘空间（模型文件）

### 安装步骤

#### 1. 下载 Ollama

```bash
# 创建安装目录
mkdir -p /Volumes/T7_APFS/monopoly-io-game/ollama/bin

# 下载 CLI 二进制（使用 GitHub 镜像加速）
cd /Volumes/T7_APFS/ollama
curl -L -C - --retry 5 -o ollama-darwin.tgz \
  "https://gh-proxy.com/https://github.com/ollama/ollama/releases/download/v0.31.2/ollama-darwin.tgz"

# 解压
tar -xzf ollama-darwin.tgz -C bin/
chmod +x bin/ollama
```

> **注意**：macOS 12.x 不支持 Ollama.app（需要 macOS 13+ 的 SMAppService），请使用 CLI 二进制版本。

#### 2. 提取共享库（关键步骤）

```bash
# llama-server 需要共享库才能运行
cd /Volumes/T7_APFS/monopoly-io-game/ollama/bin
tar xzf /Volumes/T7_APFS/monopoly-io-game/ollama/ollama-darwin.tgz \
  --exclude=ollama --exclude=llama-server
```

> **注意**：不提取共享库会导致 `llama-server` 崩溃（signal: abort trap）。

#### 3. 配置模型存储路径

```bash
# 设置模型存储到外接硬盘（避免占用内置硬盘）
export OLLAMA_MODELS=/Volumes/T7_APFS/monopoly-io-game/ollama/models
export OLLAMA_LIBRARY_PATH=/Volumes/T7_APFS/monopoly-io-game/ollama/bin
export DYLD_LIBRARY_PATH=/Volumes/T7_APFS/monopoly-io-game/ollama/bin
mkdir -p $OLLAMA_MODELS
```

可将这些行添加到 `~/.zshrc` 或 `~/.bash_profile` 持久化。

#### 4. 启动 Ollama 服务

```bash
# 方式一：使用启动脚本（推荐）
/Volumes/T7_APFS/monopoly-io-game/ollama/start_ollama.sh

# 方式二：手动设置环境变量后启动
export OLLAMA_MODELS="/Volumes/T7_APFS/monopoly-io-game/ollama/models"
export OLLAMA_LIBRARY_PATH="/Volumes/T7_APFS/monopoly-io-game/ollama/bin"
export DYLD_LIBRARY_PATH="/Volumes/T7_APFS/monopoly-io-game/ollama/bin"
/Volumes/T7_APFS/monopoly-io-game/ollama/bin/ollama serve
```

服务默认监听 `http://localhost:11434`。

#### 5. 拉取模型

```bash
# 超小模型（~400MB，推荐 Intel Mac）
/Volumes/T7_APFS/monopoly-io-game/ollama/bin/ollama pull qwen2.5:0.5b

# 或 tinyllama（~637MB）
/Volumes/T7_APFS/monopoly-io-game/ollama/bin/ollama pull tinyllama

# 或 3B 模型（~2GB，需要 8GB+ 内存）
/Volumes/T7_APFS/monopoly-io-game/ollama/bin/ollama pull llama3.2:3b
```

#### 6. 验证服务

```bash
curl http://localhost:11434/api/tags
```

返回 JSON 格式的可用模型列表。

### 配置 AI 评价系统

**方式一：启动时指定**

```bash
npx tsx src/main.ts --count 2 --dashboard --evaluate \
  --llm --llm-type ollama \
  --llm-model qwen2.5:0.5b \
  --llm-url http://localhost:11434
```

**方式二：运行时切换**

1. 打开 `http://localhost:4040` → 配置标签页
2. 选择「Ollama（本地）」
3. 确认地址为 `http://localhost:11434`
4. 填写模型名称 `qwen2.5:0.5b`
5. 点击「测试连接」→「应用并切换」

### 性能参考

| 模型 | 大小 | Intel i5 速度 | 内存占用 |
|---|---|---|---|
| qwen2.5:0.5b | ~400MB | ~5-10 tokens/s | ~1GB |
| tinyllama | ~637MB | ~3-7 tokens/s | ~1.5GB |
| llama3.2:3b | ~2GB | ~1-3 tokens/s | ~4GB |

> Intel Mac（无 GPU 加速）推理较慢，建议使用 `qwen2.5:0.5b` 超小模型。

## 方案二：Groq 云端（推荐快速测试）

### 优势

- **极快推理**：100+ tokens/s（LPU 加速）
- **免费额度**：每日大量免费请求
- **无需本地资源**：不占用内存和磁盘

### 注册步骤

1. 访问 https://console.groq.com
2. 使用 Google 或 GitHub 账号登录
3. 进入 API Keys 页面
4. 点击「Create API Key」
5. 复制 API Key（格式：`gsk_xxxxxxxxxxxx`）

### 可用模型

| 模型 | 说明 |
|---|---|
| `llama-3.1-8b-instant` | 快速响应，推荐 |
| `llama-3.3-70b-versatile` | 高质量，较慢 |
| `mixtral-8x7b-32768` | 32K 上下文 |
| `gemma2-9b-it` | Google Gemma 2 |

完整列表见 https://console.groq.com/docs/models

### 配置

**方式一：启动时指定**

```bash
npx tsx src/main.ts --count 2 --dashboard --evaluate \
  --llm --llm-type openai-compatible \
  --llm-url https://api.groq.com/openai \
  --llm-model llama-3.1-8b-instant \
  --llm-apikey gsk_xxxxxxxxxxxx
```

**方式二：运行时切换**

1. 打开控制面板 → 配置 → LLM 后端配置
2. 选择「Groq 云端（免费）」
3. 地址自动填入 `https://api.groq.com/openai`
4. 模型自动填入 `llama-3.1-8b-instant`
5. 填入 API Key
6. 点击「测试连接」→「应用并切换」

### 验证连接

```bash
# 直接测试 API
curl https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer gsk_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.1-8b-instant",
    "messages": [{"role": "user", "content": "回复连接成功"}]
  }'
```

## 方案三：OpenRouter 云端

### 优势

- **聚合多提供商**：OpenAI / Anthropic / Meta / Google 等
- **免费模型可用**：部分模型完全免费
- **统一 API**：一个 Key 访问所有模型

### 注册步骤

1. 访问 https://openrouter.ai
2. 注册账号
3. 进入 Keys 页面：https://openrouter.ai/keys
4. 创建 API Key（格式：`sk-or-v1-xxxxxxxxxxxx`）

### 推荐免费模型

| 模型 | 说明 |
|---|---|
| `meta-llama/llama-3.2-3b-instruct:free` | Llama 3.2 3B 免费版 |
| `google/gemini-flash-1.5:free` | Gemini Flash 免费版 |
| `mistralai/mistral-7b-instruct:free` | Mistral 7B 免费版 |

完整列表见 https://openrouter.ai/models （筛选免费）

### 配置

```bash
npx tsx src/main.ts --count 2 --dashboard --evaluate \
  --llm --llm-type openai-compatible \
  --llm-url https://openrouter.ai/api \
  --llm-model meta-llama/llama-3.2-3b-instruct:free \
  --llm-apikey sk-or-v1-xxxxxxxxxxxx
```

## 方案四：Together AI 云端

### 注册步骤

1. 访问 https://api.together.xyz
2. 注册账号（赠送免费额度）
3. 进入 Settings → API Keys
4. 创建 API Key

### 推荐模型

| 模型 | 说明 |
|---|---|
| `meta-llama/Llama-3.2-3B-Instruct-Turbo` | 快速推理 |
| `meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo` | 平衡选择 |

### 配置

```bash
npx tsx src/main.ts --count 2 --dashboard --evaluate \
  --llm --llm-type openai-compatible \
  --llm-url https://api.together.xyz \
  --llm-model meta-llama/Llama-3.2-3B-Instruct-Turbo \
  --llm-apikey xxxxxxxxxxxxxx
```

## 方案五：llamafile 本地部署

### 优势

- **单文件**：一个可执行文件包含模型和推理引擎
- **无需安装**：直接运行
- **OpenAI 兼容**：提供 `/v1/chat/completions` 端点
- **Intel Mac 友好**：支持 AVX2 指令集

### 部署架构

本系统采用**引擎 + 模型分离**的部署方式，所有文件存储在外接硬盘 `/Volumes/T7_APFS/monopoly-io-game/` 下：

```
/Volumes/T7_APFS/monopoly-io-game/
├── llamafile/
│   ├── qwen2.5-0.5b-instruct-q5_k_m.gguf   # GGUF 模型文件（498MB）
│   └── start_llamafile.sh                    # 启动脚本
├── ollama/
│   ├── bin/
│   │   ├── llama-server                      # llama.cpp 推理引擎（与 llamafile 等效）
│   │   ├── libggml-base.0.15.3.dylib         # 共享库
│   │   ├── libggml-cpu-*.so                  # CPU 指令集优化库
│   │   └── ...
│   ├── models/                               # Ollama 模型存储
│   ├── ollama-darwin.tgz                     # 安装包
│   └── start_ollama.sh                       # 启动脚本
├── ai-bot/
│   └── node_modules/                         # AI Bot 依赖（符号链接目标）
└── packages/                                 # 游戏服务端/客户端依赖
```

> **说明**：由于网络限制导致 llamafile 官方引擎下载困难，本系统使用 Ollama 内置的 `llama-server` 作为替代引擎。两者均基于 llama.cpp，提供完全相同的 OpenAI 兼容 API。如果后续下载了真正的 llamafile 引擎，启动脚本会自动优先使用。

### 下载

#### 方式一：下载 GGUF 模型（推荐，已部署）

```bash
# 从 HuggingFace 镜像下载 GGUF 模型
mkdir -p /Volumes/T7_APFS/monopoly-io-game/llamafile
cd /Volumes/T7_APFS/monopoly-io-game/llamafile

curl -L -o qwen2.5-0.5b-instruct-q5_k_m.gguf \
  "https://hf-mirror.com/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q5_k_m.gguf"
```

#### 方式二：下载真正的 llamafile 引擎（可选）

```bash
# 下载 llamafile thin 引擎（44MB）
cd /Volumes/T7_APFS/monopoly-io-game/llamafile
curl -L -o llamafile-0.10.3-thin \
  "https://github.com/mozilla-ai/llamafile/releases/download/0.10.3/llamafile-0.10.3-thin"
chmod +x llamafile-0.10.3-thin
```

如果此文件存在，启动脚本会自动使用它替代 llama-server。

### 启动服务

```bash
# 方式一：使用启动脚本（推荐）
/Volumes/T7_APFS/monopoly-io-game/llamafile/start_llamafile.sh

# 方式二：直接运行 llama-server（需要设置库路径）
export DYLD_LIBRARY_PATH="/Volumes/T7_APFS/monopoly-io-game/ollama/bin"
/Volumes/T7_APFS/monopoly-io-game/ollama/bin/llama-server \
  --model /Volumes/T7_APFS/monopoly-io-game/llamafile/qwen2.5-0.5b-instruct-q5_k_m.gguf \
  --host 127.0.0.1 --port 8080 \
  --ctx-size 2048 --threads 2

# 方式三：使用真正的 llamafile 引擎（如果已下载）
/Volumes/T7_APFS/monopoly-io-game/llamafile/llamafile-0.10.3-thin \
  --server \
  --model /Volumes/T7_APFS/monopoly-io-game/llamafile/qwen2.5-0.5b-instruct-q5_k_m.gguf \
  --host 127.0.0.1 --port 8080
```

服务监听 `http://localhost:8080`，提供 OpenAI 兼容 API。

### 验证服务

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"default","messages":[{"role":"user","content":"Hello"}],"max_tokens":10}'
```

### 配置 AI 评价系统

**方式一：启动时指定**

```bash
npx tsx src/main.ts --count 2 --dashboard --evaluate \
  --llm --llm-type openai-compatible \
  --llm-url http://localhost:8080 \
  --llm-model default
```

**方式二：运行时切换**

1. 打开 `http://localhost:4040` → 配置标签页
2. 选择「llamafile（本地单文件）」
3. 确认地址为 `http://localhost:8080`
4. 模型名称填 `default`
5. 点击「测试连接」→「应用并切换」

### 性能参考

| 模型 | 大小 | Intel i5 速度 | 内存占用 |
|---|---|---|---|
| Qwen2.5-0.5B Q5_K_M | ~498MB | ~20 tokens/s | ~1GB |
| Qwen2.5-1.5B Q5_K_M | ~1.1GB | ~8 tokens/s | ~2GB |

## 方案六：规则引擎（无需 LLM）

无需任何配置，使用内置的多维度规则引擎生成评价。

### 启用方式

不指定 `--llm` 参数即为规则引擎模式：

```bash
npx tsx src/main.ts --count 2 --dashboard --evaluate
```

### 规则引擎评价维度

- **gameplay**（25%）：AI 操作数量、路径选择、组队机制
- **economy**（20%）：地产交易、升级、资金状态
- **bugs**（20%）：检测到的 Bug 数量、错误次数
- **balance**（15%）：破产情况、平均资金、难度
- **ui**（10%）：界面布局（需人工确认）
- **visuals**（10%）：渲染效果（需人工确认）

## 运行时切换

所有后端均可在运行时从控制面板切换，无需重启 AI 玩家程序。

### 操作步骤

1. 打开 `http://localhost:4040`
2. 切换到「配置」标签页
3. 找到「LLM 后端配置」区域
4. 当前状态显示在顶部（绿色=可用，黄色=待验证，红色=未启用）
5. 从下拉菜单选择后端
6. 查看后端说明和配置指南
7. 填写配置参数（API 地址、模型名称、API Key）
8. 点击「测试连接」验证
9. 点击「应用并切换」生效
10. 点击顶部「运行评价」生成 LLM 增强的评价报告

### API 调用

```bash
# 获取预设列表
curl http://localhost:4040/api/llm/presets

# 测试连接（不切换）
curl -X POST http://localhost:4040/api/llm/test \
  -H "Content-Type: application/json" \
  -d '{
    "type": "openai-compatible",
    "model": "llama-3.1-8b-instant",
    "baseUrl": "https://api.groq.com/openai",
    "apiKey": "gsk_xxxxx"
  }'

# 切换后端
curl -X POST http://localhost:4040/api/llm/config \
  -H "Content-Type: application/json" \
  -d '{
    "type": "openai-compatible",
    "model": "llama-3.1-8b-instant",
    "baseUrl": "https://api.groq.com/openai",
    "apiKey": "gsk_xxxxx"
  }'

# 查看当前状态
curl http://localhost:4040/api/llm/status
```

## 故障排查

### Ollama 相关

| 问题 | 解决方案 |
|---|---|
| `ollama: command not found` | 确认解压路径正确，使用完整路径执行 |
| `connection refused` | 确认 `ollama serve` 正在运行 |
| 模型不存在 | 执行 `ollama pull <model>` 下载模型 |
| 推理太慢 | 使用更小的模型（如 `qwen2.5:0.5b`） |
| 内存不足 | 关闭其他应用，或使用更小模型 |
| macOS 12 报错 SMAppService | 使用 CLI 二进制版本，不要用 Ollama.app |

### 云端 API 相关

| 问题 | 解决方案 |
|---|---|
| `401 Unauthorized` | 检查 API Key 是否正确 |
| `429 Too Many Requests` | 超出免费额度，稍后重试或升级计划 |
| `404 model not found` | 检查模型名称是否正确 |
| 连接超时 | 检查网络连接，或尝试其他后端 |
| SSL 证书错误 | 确认系统时间正确，更新根证书 |

### 控制面板相关

| 问题 | 解决方案 |
|---|---|
| 预设列表为空 | 确认 AI Bot 程序正在运行，刷新页面 |
| 测试连接无响应 | 检查 API 地址是否可达，查看程序日志 |
| 切换后评价无 LLM 分析 | 确认后端可用（状态为绿色），重新运行评价 |

## 最佳实践

### Intel Mac（8GB RAM）推荐

1. **快速测试**：Groq 云端（`llama-3.1-8b-instant`）— 极快且免费
2. **离线使用**：Ollama + `qwen2.5:0.5b` — 超小模型，推理尚可
3. **平衡选择**：OpenRouter 免费模型 — 多模型可选

### Apple Silicon Mac 推荐

1. **本地部署**：Ollama + `llama3.2:3b` — Apple Silicon 加速，推理流畅
2. **快速测试**：Groq 云端 — 最快速度

### 安全注意事项

- API Key 存储在内存中，不持久化到磁盘
- 控制面板 API 返回时会对 API Key 脱敏（显示 `***`）
- 不要在公开环境中暴露 API Key
- 云端请求通过 HTTPS 加密传输

## 扩展自定义后端

如需添加自定义 LLM 后端，实现 `LLMAdapter` 接口：

```typescript
import type { LLMAdapter, LLMBackendType } from './LLMAdapter.js';

export class CustomAdapter implements LLMAdapter {
  generate(prompt: string): Promise<string> {
    // 实现生成逻辑
  }
  isAvailable(): boolean { return true; }
  getModelName(): string { return 'custom-model'; }
  getBackendType(): LLMBackendType { return 'dummy'; }
}
```

然后在 `LLMAdapterFactory.create()` 中注册。
