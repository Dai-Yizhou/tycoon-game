/**
 * LLM 适配器
 *
 * 支持多种 LLM 后端：
 * - OllamaAdapter: 本地 Ollama 服务（原生 API）
 * - OpenAICompatibleAdapter: 兼容 OpenAI API 的服务（Groq / OpenRouter / llamafile server / Together AI）
 * - DummyAdapter: 占位适配器（无需 LLM 服务）
 *
 * 通过 LLMAdapterFactory 按类型创建适配器，支持运行时切换。
 */

export interface LLMAdapter {
  generate(prompt: string): Promise<string>;
  /** 视觉模型：带图片的生成请求（images 为 base64 编码的图片数组） */
  generateWithImage?(prompt: string, images: string[]): Promise<string>;
  isAvailable(): boolean;
  getModelName(): string;
  /** 返回后端类型标识 */
  getBackendType(): LLMBackendType;
  /** 是否支持视觉（图片输入） */
  supportsVision?(): boolean;
}

export type LLMBackendType = 'ollama' | 'openai-compatible' | 'dummy';

export interface LLMConfig {
  type: LLMBackendType;
  model: string;
  baseUrl: string;
  apiKey?: string;
  /** 可选：请求超时毫秒 */
  timeoutMs?: number;
  /** 可选：视觉模型名称（独立于文本模型，如 minicpm-v） */
  visionModel?: string;
  /** 可选：视觉模型请求超时毫秒 */
  visionTimeoutMs?: number;
}

/** 预设后端配置（用于控制面板快速选择） */
export interface LLMPreset {
  id: string;
  label: string;
  type: LLMBackendType;
  defaultBaseUrl: string;
  defaultModel: string;
  needsApiKey: boolean;
  description: string;
  /** 下载/获取说明 */
  setupGuide: string;
}

export const LLM_PRESETS: LLMPreset[] = [
  {
    id: 'ollama',
    label: 'Ollama（本地）',
    type: 'ollama',
    defaultBaseUrl: 'http://localhost:11434',
    defaultModel: 'qwen2.5:0.5b',
    needsApiKey: false,
    description: '本地运行的 Ollama 服务，不依赖网络，Intel Mac 推理较慢',
    setupGuide: '运行 /Volumes/T7_APFS/monopoly-io-game/ollama/start_ollama.sh，再执行 ollama pull qwen2.5:0.5b',
  },
  {
    id: 'groq',
    label: 'Groq 云端（免费）',
    type: 'openai-compatible',
    defaultBaseUrl: 'https://api.groq.com/openai',
    defaultModel: 'llama-3.1-8b-instant',
    needsApiKey: true,
    description: 'Groq 云端 API，推理速度极快（100+ tokens/s），需注册免费 API Key',
    setupGuide: '访问 https://console.groq.com 注册并创建 API Key',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter 云端（免费模型可用）',
    type: 'openai-compatible',
    defaultBaseUrl: 'https://openrouter.ai/api',
    defaultModel: 'meta-llama/llama-3.2-3b-instruct:free',
    needsApiKey: true,
    description: 'OpenRouter 聚合多个模型提供商，含免费模型，需 API Key',
    setupGuide: '访问 https://openrouter.ai 注册并创建 API Key',
  },
  {
    id: 'llamafile',
    label: 'llamafile（本地单文件）',
    type: 'openai-compatible',
    defaultBaseUrl: 'http://localhost:8080',
    defaultModel: 'default',
    needsApiKey: false,
    description: 'llamafile 单可执行文件，启动后提供 OpenAI 兼容 API，适合 Intel Mac',
    setupGuide: '运行 /Volumes/T7_APFS/monopoly-io-game/llamafile/start_llamafile.sh，启动后访问 http://localhost:8080',
  },
  {
    id: 'together',
    label: 'Together AI 云端',
    type: 'openai-compatible',
    defaultBaseUrl: 'https://api.together.xyz',
    defaultModel: 'meta-llama/Llama-3.2-3B-Instruct-Turbo',
    needsApiKey: true,
    description: 'Together AI 云端服务，提供免费额度，推理速度快',
    setupGuide: '访问 https://api.together.xyz 注册并创建 API Key',
  },
  {
    id: 'minicpm-v',
    label: 'MiniCPM-V 视觉模型（本地）',
    type: 'ollama',
    defaultBaseUrl: 'http://localhost:11434',
    defaultModel: 'minicpm-v',
    needsApiKey: false,
    description: '本地视觉语言模型，能理解游戏截图并做出决策，支持中文',
    setupGuide: '运行 ollama pull minicpm-v（约5.5GB），适合浏览器AI视觉决策',
  },
  {
    id: 'dummy',
    label: '规则引擎（无需 LLM）',
    type: 'dummy',
    defaultBaseUrl: '',
    defaultModel: 'dummy',
    needsApiKey: false,
    description: '使用内置规则引擎生成评价，无需任何 LLM 服务',
    setupGuide: '无需配置，直接使用',
  },
];

export class DummyAdapter implements LLMAdapter {
  private readonly responses: string[] = [
    '这是一个测试响应。',
    "规则引擎连接正常。",
  ];

  generate(_prompt: string): Promise<string> {
    const response = this.responses[Math.floor(Math.random() * this.responses.length)];
    return Promise.resolve(response);
  }

  isAvailable(): boolean {
    return true;
  }

  getModelName(): string {
    return 'dummy';
  }

  getBackendType(): LLMBackendType {
    return 'dummy';
  }
}

export class OllamaAdapter implements LLMAdapter {
  private readonly model: string;
  private readonly visionModel: string;
  private readonly baseUrl: string;
  private available: boolean = false;
  private readonly timeoutMs: number;
  private readonly visionTimeoutMs: number;

  constructor(options: { model?: string; visionModel?: string; baseUrl?: string; timeoutMs?: number; visionTimeoutMs?: number } = {}) {
    this.model = options.model ?? 'qwen2.5:0.5b';
    this.visionModel = options.visionModel ?? this.model;
    this.baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.visionTimeoutMs = options.visionTimeoutMs ?? 60000;
    this.checkAvailability();
  }

  private async checkAvailability(): Promise<void> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      this.available = response.ok;
    } catch {
      this.available = false;
    }
  }

  async generate(prompt: string): Promise<string> {
    if (!this.isAvailable()) {
      await this.checkAvailability();
      if (!this.isAvailable()) {
        return 'LLM 服务不可用，无法生成评价。';
      }
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 768,
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        return `LLM 请求失败: ${response.status}`;
      }

      const data: any = await response.json();
      return data.response ?? '未获取到响应';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return 'LLM 请求超时';
      }
      return `LLM 调用异常: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  getModelName(): string {
    return this.model;
  }

  getBackendType(): LLMBackendType {
    return 'ollama';
  }

  /** 视觉模型请求：使用 /api/chat 端点发送带图片的消息 */
  async generateWithImage(prompt: string, images: string[]): Promise<string> {
    if (!this.isAvailable()) {
      await this.checkAvailability();
      if (!this.isAvailable()) {
        throw new Error('Ollama 服务不可用');
      }
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.visionTimeoutMs);
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.visionModel,
          messages: [
            {
              role: 'user',
              content: prompt,
              images: images,
            },
          ],
          stream: false,
          options: {
            temperature: 0.3,
            num_predict: 512,
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`视觉 LLM 请求失败: ${response.status} ${errText.slice(0, 200)}`);
      }
      const data: any = await response.json();
      return data.message?.content ?? '未获取到响应';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('视觉 LLM 请求超时');
      }
      throw error;
    }
  }

  /** 检查当前模型是否支持视觉（通过模型名称推断） */
  supportsVision(): boolean {
    const visionModels = ['minicpm-v', 'llama3.2-vision', 'llava', 'moondream', 'qwen2.5-vl', 'qwen2-vl', 'cogvlm', 'phi3-vision'];
    return visionModels.some(m => this.visionModel.toLowerCase().includes(m));
  }

  async ensureModel(): Promise<boolean> {
    if (this.isAvailable()) {
      try {
        const response = await fetch(`${this.baseUrl}/api/tags`);
        const data: any = await response.json();
        const models = data.models ?? [];
        const exists = models.some((m: any) => m.name === this.model);
        if (exists) {
          return true;
        }
      } catch {
        return false;
      }
    }
    return false;
  }
}

/**
 * OpenAI 兼容适配器
 *
 * 适用于：
 * - Groq (https://api.groq.com/openai)
 * - OpenRouter (https://openrouter.ai/api)
 * - Together AI (https://api.together.xyz)
 * - llamafile server (http://localhost:8080)
 * - 任何提供 /v1/chat/completions 端点的服务
 */
export class OpenAICompatibleAdapter implements LLMAdapter {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private available: boolean = false;

  constructor(options: { model: string; baseUrl: string; apiKey?: string; timeoutMs?: number }) {
    this.model = options.model;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey ?? '';
    this.timeoutMs = options.timeoutMs ?? 120000;
    this.checkAvailability();
  }

  private async checkAvailability(): Promise<void> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      // 尝试 /v1/models 端点
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);
      this.available = response.ok;
    } catch {
      // 某些服务（如 llamafile）可能不提供 /v1/models，标记为待验证
      this.available = false;
    }
  }

  async generate(prompt: string): Promise<string> {
    // 即使 isAvailable 为 false 也尝试请求（某些服务不提供 /v1/models）
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
      // OpenRouter 额外头
      if (this.baseUrl.includes('openrouter.ai')) {
        headers['HTTP-Referer'] = 'http://localhost:4040';
        headers['X-Title'] = 'AI Bot Evaluation';
      }

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: '你是一个游戏评测专家，请用中文给出专业、简洁的评价。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 1024,
          stream: false,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        return `LLM 请求失败: ${response.status} ${errText.slice(0, 200)}`;
      }

      const data: any = await response.json();
      const content = data.choices?.[0]?.message?.content;
      return content ?? '未获取到响应';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return 'LLM 请求超时';
      }
      return `LLM 调用异常: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  getModelName(): string {
    return this.model;
  }

  getBackendType(): LLMBackendType {
    return 'openai-compatible';
  }

  /** 视觉模型请求：使用 OpenAI Vision API 格式 */
  async generateWithImage(prompt: string, images: string[]): Promise<string> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(this.timeoutMs, 60000));
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...images.map(img => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${img}` } })),
            ],
          }],
          temperature: 0.3,
          max_tokens: 512,
          stream: false,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`视觉 LLM 请求失败: ${response.status}`);
      const data: any = await response.json();
      return data.choices?.[0]?.message?.content ?? '未获取到响应';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('视觉 LLM 请求超时');
      throw error;
    }
  }

  supportsVision(): boolean {
    const visionModels = ['vision', 'vl', 'llava', 'moondream', 'minicpm-v'];
    return visionModels.some(m => this.model.toLowerCase().includes(m));
  }

  /** 主动重新检测可用性 */
  async recheckAvailability(): Promise<boolean> {
    await this.checkAvailability();
    return this.available;
  }
}

/**
 * LLM 适配器工厂
 *
 * 根据配置创建对应的 LLM 适配器实例。
 */
export class LLMAdapterFactory {
  static create(config: LLMConfig): LLMAdapter {
    switch (config.type) {
      case 'ollama':
        return new OllamaAdapter({
          model: config.model,
          visionModel: config.visionModel,
          baseUrl: config.baseUrl,
          timeoutMs: config.timeoutMs,
          visionTimeoutMs: config.visionTimeoutMs,
        });

      case 'openai-compatible':
        return new OpenAICompatibleAdapter({
          model: config.model,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          timeoutMs: config.timeoutMs,
        });

      case 'dummy':
      default:
        return new DummyAdapter();
    }
  }

  static getPresets(): LLMPreset[] {
    return LLM_PRESETS;
  }

  /** 根据 preset id 获取预设 */
  static getPreset(id: string): LLMPreset | undefined {
    return LLM_PRESETS.find(p => p.id === id);
  }
}
