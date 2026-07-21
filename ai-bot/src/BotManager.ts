/**
 * Bot 管理器
 *
 * 管理多个 AI Bot 实例，提供创建、获取、控制、停止等方法。
 */

import { AIBot } from './AIBot.js';
import { BrowserAIPlayer, type BrowserAIPlayerConfig } from './BrowserAIPlayer.js';
import type { BotConfig, FullBotState, BotStats } from './types.js';
import type { LLMAdapter } from './LLMAdapter.js';

export class BotManager {
  private readonly bots: Map<string, AIBot> = new Map();
  private readonly browserBots: Map<string, BrowserAIPlayer> = new Map();
  private defaultServerUrl: string;
  private currentLLMAdapter: LLMAdapter | null = null;

  constructor(defaultServerUrl: string = 'http://localhost:3000') {
    this.defaultServerUrl = defaultServerUrl;
  }

  createBot(config: BotConfig): AIBot {
    const bot = new AIBot(config);
    if (this.currentLLMAdapter) {
      bot.setLLMAdapter(this.currentLLMAdapter);
    }
    this.bots.set(config.username, bot);
    return bot;
  }

  /** 动态创建并启动一个 AI 玩家 */
  async createAndStartBot(config: Partial<BotConfig> & { username: string }): Promise<AIBot> {
    const fullConfig: BotConfig = {
      username: config.username,
      serverUrl: config.serverUrl ?? this.defaultServerUrl,
      guest: config.guest ?? false,
      decisionInterval: config.decisionInterval ?? 3000,
      autoBuy: config.autoBuy ?? true,
      autoUpgrade: config.autoUpgrade ?? true,
      autoTeam: config.autoTeam ?? true,
      autoTalent: config.autoTalent ?? true,
      reserveMoney: config.reserveMoney ?? 500,
      logDir: config.logDir ?? './logs',
    };

    if (this.bots.has(fullConfig.username)) {
      throw new Error(`AI 玩家 ${fullConfig.username} 已存在`);
    }

    const bot = this.createBot(fullConfig);
    await bot.start();
    return bot;
  }

  /** 动态创建并启动一个浏览器 AI 玩家 */
  async createAndStartBrowserBot(config: Partial<BrowserAIPlayerConfig> & { username: string }): Promise<BrowserAIPlayer> {
    const fullConfig: BrowserAIPlayerConfig = {
      username: config.username,
      gameUrl: config.gameUrl ?? 'http://localhost:5173',
      serverUrl: config.serverUrl ?? this.defaultServerUrl,
      guest: config.guest ?? false,
      logDir: config.logDir ?? './logs',
      decisionInterval: config.decisionInterval ?? 5000,
      useVision: config.useVision ?? false,
      llmAdapter: config.llmAdapter ?? this.currentLLMAdapter ?? undefined,
      customPersonality: config.customPersonality,
      customStrategy: config.customStrategy,
      headless: config.headless ?? true,
      screenshotDir: config.screenshotDir ?? './screenshots',
    };

    if (this.bots.has(fullConfig.username) || this.browserBots.has(fullConfig.username)) {
      throw new Error(`AI 玩家 ${fullConfig.username} 已存在`);
    }

    const bot = new BrowserAIPlayer(fullConfig);
    this.browserBots.set(fullConfig.username, bot);
    await bot.start();
    return bot;
  }

  /** 获取默认服务端地址 */
  getDefaultServerUrl(): string {
    return this.defaultServerUrl;
  }

  getBot(name: string): AIBot | undefined {
    return this.bots.get(name);
  }

  getBrowserBot(name: string): BrowserAIPlayer | undefined {
    return this.browserBots.get(name);
  }

  getAllBots(): AIBot[] {
    return Array.from(this.bots.values());
  }

  getBotNames(): string[] {
    return Array.from(this.bots.keys());
  }

  getBotStats(name: string): BotStats | null {
    const bot = this.bots.get(name);
    return bot ? bot.getStats() : null;
  }

  getAllBotStats(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [name, bot] of this.bots) {
      result[name] = bot.getStats();
    }
    for (const [name, bot] of this.browserBots) {
      const state = bot.getState();
      result[name] = {
        actionsTaken: state.stats.actionsTaken,
        diceRolled: state.stats.diceRolled,
        propertiesBought: state.stats.propertiesBought,
        propertiesUpgraded: state.stats.propertiesUpgraded,
        errors: state.stats.errors,
        bugsDetected: state.bugsDetected,
        gameBugsDetected: state.gameBugsDetected,
        clientBugsDetected: state.clientBugsDetected,
        uptime: state.uptime,
        connected: state.browserReady,
        loggedIn: state.loggedIn,
        screenshotsTaken: state.stats.screenshotsTaken,
        avgResponseTimeMs: state.avgResponseTimeMs,
        slowResponseRatio: state.slowResponseRatio,
        type: 'browser',
      };
    }
    return result;
  }

  getBotState(name: string): FullBotState | null {
    const bot = this.bots.get(name);
    return bot ? bot.getFullState() : null;
  }

  getAllBotStates(): any[] {
    const socketStates = Array.from(this.bots.values()).map(bot => bot.getFullState());
    const browserStates = Array.from(this.browserBots.values()).map(bot => {
      const state = bot.getState();
      return {
        name: state.username,
        type: 'browser',
        config: { username: state.username },
        stats: {
          actionsTaken: state.stats.actionsTaken,
          diceRolled: state.stats.diceRolled,
          propertiesBought: state.stats.propertiesBought,
          propertiesUpgraded: state.stats.propertiesUpgraded,
          errors: state.stats.errors,
          bugsDetected: state.bugsDetected,
          gameBugsDetected: state.gameBugsDetected,
          clientBugsDetected: state.clientBugsDetected,
          uptime: state.uptime,
          connected: state.browserReady,
          loggedIn: state.loggedIn,
          screenshotsTaken: state.stats.screenshotsTaken,
          avgResponseTimeMs: state.avgResponseTimeMs,
          slowResponseRatio: state.slowResponseRatio,
          type: 'browser',
        },
        gameState: { currentPlayer: null },
        paused: state.paused,
        llmInfo: { enabled: state.useVision, available: state.useVision, backend: 'browser', model: 'vision' },
      };
    });
    return [...socketStates, ...browserStates];
  }

  pauseBot(name: string): boolean {
    const bot = this.bots.get(name);
    if (bot) {
      bot.pause();
      return true;
    }
    const bb = this.browserBots.get(name);
    if (bb) {
      bb.pause();
      return true;
    }
    return false;
  }

  resumeBot(name: string): boolean {
    const bot = this.bots.get(name);
    if (bot) {
      bot.resume();
      return true;
    }
    const bb = this.browserBots.get(name);
    if (bb) {
      bb.resume();
      return true;
    }
    return false;
  }

  pauseAll(): void {
    this.bots.forEach(bot => bot.pause());
    this.browserBots.forEach(bot => bot.pause());
  }

  resumeAll(): void {
    this.bots.forEach(bot => bot.resume());
    this.browserBots.forEach(bot => bot.resume());
  }

  async stopBot(name: string): Promise<boolean> {
    const bot = this.bots.get(name);
    if (bot) {
      await bot.stop();
      this.bots.delete(name);
      return true;
    }
    const bb = this.browserBots.get(name);
    if (bb) {
      await bb.stop();
      this.browserBots.delete(name);
      return true;
    }
    return false;
  }

  async stopAll(): Promise<void> {
    for (const bot of this.bots.values()) {
      await bot.stop();
    }
    for (const bot of this.browserBots.values()) {
      await bot.stop();
    }
    this.bots.clear();
    this.browserBots.clear();
  }

  updateBotConfig(name: string, config: Partial<BotConfig>): boolean {
    const bot = this.bots.get(name);
    if (bot) {
      bot.updateConfig(config);
      return true;
    }
    return false;
  }

  async executeCommand(name: string, command: string, args?: Record<string, unknown>): Promise<boolean> {
    const bot = this.bots.get(name);
    if (bot) {
      await bot.executeCommand(command, args);
      return true;
    }
    return false;
  }

  async executeCommandAll(command: string, args?: Record<string, unknown>): Promise<void> {
    for (const bot of this.bots.values()) {
      await bot.executeCommand(command, args);
    }
  }

  getBotCount(): number {
    return this.bots.size + this.browserBots.size;
  }

  isBotActive(name: string): boolean {
    return this.bots.has(name) || this.browserBots.has(name);
  }

  setLLMAdapter(adapter: LLMAdapter | null): void {
    this.currentLLMAdapter = adapter;
    for (const bot of this.bots.values()) {
      bot.setLLMAdapter(adapter);
    }
    for (const bot of this.browserBots.values()) {
      bot.setLLMAdapter(adapter ?? undefined);
    }
  }

  getAllLLMInfo(): Record<string, { enabled: boolean; available: boolean; backend: string; model: string; personality?: string; strategy?: string }> {
    const result: Record<string, { enabled: boolean; available: boolean; backend: string; model: string; personality?: string; strategy?: string }> = {};
    for (const [name, bot] of this.bots.entries()) {
      result[name] = bot.getLLMInfo();
    }
    for (const [name, bot] of this.browserBots.entries()) {
      result[name] = bot.getLLMInfo();
    }
    return result;
  }

  setBotLLMEnabled(name: string, enabled: boolean): boolean {
    const socketBot = this.bots.get(name);
    if (socketBot) {
      socketBot.updateConfig({ useLLM: enabled });
      return true;
    }
    const browserBot = this.browserBots.get(name);
    if (browserBot) {
      browserBot.setUseVision(enabled);
      return true;
    }
    return false;
  }

  setBotLLMPersonality(name: string, personality: string): boolean {
    const socketBot = this.bots.get(name);
    if (socketBot) {
      socketBot.updateConfig({ llmPersonality: personality });
      return true;
    }
    const browserBot = this.browserBots.get(name);
    if (browserBot) {
      browserBot.setPersonality(personality);
      return true;
    }
    return false;
  }

  setBotLLMStrategy(name: string, strategy: string): boolean {
    const socketBot = this.bots.get(name);
    if (socketBot) {
      socketBot.updateConfig({ llmStrategy: strategy });
      return true;
    }
    const browserBot = this.browserBots.get(name);
    if (browserBot) {
      browserBot.setStrategy(strategy);
      return true;
    }
    return false;
  }
}