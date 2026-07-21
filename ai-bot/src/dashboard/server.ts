/**
 * AI 玩家控制面板服务端
 */

import express from 'express';
import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { LogEntry } from '../types.js';
import type { BotManager } from '../BotManager.js';
import type { EvaluationEngine } from '../EvaluationEngine.js';
import { LLMAdapterFactory, type LLMConfig, type LLMAdapter, type LLMPreset } from '../LLMAdapter.js';

const MAX_LOGS = 5000;

const LEVEL_LABELS: Record<string, string> = {
  info: '信息',
  action: '操作',
  event: '事件',
  warning: '警告',
  error: '错误',
  bug: 'BUG',
};

interface DashboardOptions {
  port?: number;
  botManager?: BotManager;
  evaluationEngine?: EvaluationEngine;
}

export function startDashboard(options: DashboardOptions = {}): (entry: LogEntry) => void {
  const port = options.port ?? 4040;
  const botManager = options.botManager;
  const evaluationEngine = options.evaluationEngine;

  const app = express();
  const server = http.createServer(app);

  const logs: LogEntry[] = [];
  const botNames = new Set<string>();
  const clients = new Set<WebSocket>();

  app.use(express.json());

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    const recent = logs.slice(-100);
    for (const entry of recent) {
      ws.send(JSON.stringify(entry));
    }
    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(CONTROL_PANEL_HTML);
  });

  app.post('/api/bots/create', async (req, res) => {
    const { username, serverUrl, guest, decisionInterval, autoBuy, autoUpgrade, autoTeam, autoTalent, reserveMoney } = req.body;

    if (!username) {
      res.status(400).json({ error: '用户名不能为空' });
      return;
    }

    if (!botManager) {
      res.status(500).json({ error: 'BotManager not available' });
      return;
    }

    try {
      const bot = await botManager.createAndStartBot({
        username,
        serverUrl,
        guest,
        decisionInterval,
        autoBuy,
        autoUpgrade,
        autoTeam,
        autoTalent,
        reserveMoney,
      });
      res.json({ success: true, bot: bot.getFullState() });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete('/api/bots/:name', async (req, res) => {
    const name = req.params.name;

    if (!botManager) {
      res.status(500).json({ error: 'BotManager not available' });
      return;
    }

    const success = await botManager.stopBot(name);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Bot not found' });
    }
  });

  app.get('/api/logs', (req, res) => {
    let result = [...logs];
    const bot = req.query['bot'] as string | undefined;
    const level = req.query['level'] as string | undefined;
    const keyword = req.query['keyword'] as string | undefined;
    const limit = parseInt(req.query['limit'] as string | '200', 10);

    if (bot) {
      result = result.filter(l => l.botName === bot);
    }
    if (level) {
      result = result.filter(l => l.level === level);
    }
    if (keyword) {
      const lowerKeyword = keyword.toLowerCase();
      result = result.filter(l => l.message.toLowerCase().includes(lowerKeyword));
    }

    res.json({
      total: result.length,
      logs: result.slice(-limit),
    });
  });

  app.get('/api/logs/export', (req, res) => {
    let result = [...logs];
    const bot = req.query['bot'] as string | undefined;
    const level = req.query['level'] as string | undefined;
    const keyword = req.query['keyword'] as string | undefined;
    const format = (req.query['format'] as string | undefined) || 'json';

    if (bot) {
      result = result.filter(l => l.botName === bot);
    }
    if (level) {
      result = result.filter(l => l.level === level);
    }
    if (keyword) {
      const lowerKeyword = keyword.toLowerCase();
      result = result.filter(l => l.message.toLowerCase().includes(lowerKeyword));
    }

    const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `ai-bot-logs_${dateStr}.${format === 'json' ? 'json' : 'txt'}`;

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json({
        exportTime: new Date().toISOString(),
        totalLogs: result.length,
        logs: result,
      });
    } else {
      const lines = result.map(entry => {
        const timeStr = new Date(entry.timestamp).toLocaleString('zh-CN', { hour12: false });
        const levelLabel = LEVEL_LABELS[entry.level] || entry.level;
        let line = `[${timeStr}] [${levelLabel}] [${entry.botName}] ${entry.message}`;
        if (entry.context && Object.keys(entry.context).length > 0) {
          line += ` | ${JSON.stringify(entry.context)}`;
        }
        return line;
      });
      const header = `# AI 玩家日志导出 - ${new Date().toLocaleString('zh-CN')}\n# 共 ${result.length} 条\n\n`;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(header + lines.join('\n'));
    }
  });

  app.get('/api/bots', (_req, res) => {
    const botList = botManager?.getAllBotStates() ?? [];
    res.json({ bots: botList });
  });

  app.get('/api/bots/:name', (req, res) => {
    const name = req.params.name;
    const state = botManager?.getBotState(name);
    if (state) {
      res.json(state);
    } else {
      res.status(404).json({ error: 'Bot not found' });
    }
  });

  app.post('/api/bots/:name/control', (req, res) => {
    const name = req.params.name;
    const { action } = req.body;

    if (!botManager) {
      res.status(500).json({ error: 'BotManager not available' });
      return;
    }

    switch (action) {
      case 'pause':
        botManager.pauseBot(name);
        res.json({ success: true, action: 'pause' });
        break;
      case 'resume':
        botManager.resumeBot(name);
        res.json({ success: true, action: 'resume' });
        break;
      case 'stop':
        botManager.stopBot(name).then(() => {
          res.json({ success: true, action: 'stop' });
        });
        break;
      default:
        res.status(400).json({ error: 'Invalid action' });
    }
  });

  app.post('/api/bots/control', (req, res) => {
    const { action } = req.body;

    if (!botManager) {
      res.status(500).json({ error: 'BotManager not available' });
      return;
    }

    switch (action) {
      case 'pauseAll':
        botManager.pauseAll();
        res.json({ success: true, action: 'pauseAll' });
        break;
      case 'resumeAll':
        botManager.resumeAll();
        res.json({ success: true, action: 'resumeAll' });
        break;
      case 'stopAll':
        botManager.stopAll().then(() => {
          res.json({ success: true, action: 'stopAll' });
        });
        break;
      default:
        res.status(400).json({ error: 'Invalid action' });
    }
  });

  app.put('/api/bots/:name/config', (req, res) => {
    const name = req.params.name;
    const config = req.body;

    if (!botManager) {
      res.status(500).json({ error: 'BotManager not available' });
      return;
    }

    const success = botManager.updateBotConfig(name, config);
    res.json({ success });
  });

  app.post('/api/bots/:name/command', async (req, res) => {
    const name = req.params.name;
    const { command, args } = req.body;

    if (!botManager) {
      res.status(500).json({ error: 'BotManager not available' });
      return;
    }

    const success = await botManager.executeCommand(name, command, args);
    res.json({ success });
  });

  app.get('/api/stats', (_req, res) => {
    const stats = {
      totalLogs: logs.length,
      bots: Array.from(botNames),
      byLevel: {
        info: logs.filter(l => l.level === 'info').length,
        action: logs.filter(l => l.level === 'action').length,
        event: logs.filter(l => l.level === 'event').length,
        warning: logs.filter(l => l.level === 'warning').length,
        error: logs.filter(l => l.level === 'error').length,
        bug: logs.filter(l => l.level === 'bug').length,
      },
      clients: clients.size,
    };
    res.json(stats);
  });

  app.get('/api/evaluation', (_req, res) => {
    const report = evaluationEngine?.getLatestReport();
    res.json(report || { error: 'No report available' });
  });

  app.post('/api/evaluation/run', (_req, res) => {
    if (!evaluationEngine) {
      res.status(500).json({ error: 'EvaluationEngine not available' });
      return;
    }

    const timeoutMs = 180000;
    const timeout = setTimeout(() => {
      res.status(504).json({ error: '评价生成超时（3分钟），LLM 响应过慢' });
    }, timeoutMs);

    evaluationEngine.evaluate().then(report => {
      clearTimeout(timeout);
      if (!res.headersSent) {
        res.json(report);
      }
    }).catch(err => {
      clearTimeout(timeout);
      if (!res.headersSent) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });
  });

  // ===== LLM 配置管理 =====

  // 当前 LLM 配置（运行时可切换）
  let currentLLMConfig: LLMConfig = { type: 'dummy', model: 'dummy', baseUrl: '' };
  let currentLLMAdapter: LLMAdapter | undefined = undefined;

  // 获取 LLM 预设列表
  app.get('/api/llm/presets', (_req, res) => {
    const presets: LLMPreset[] = LLMAdapterFactory.getPresets();
    const llmInfo = evaluationEngine?.getLLMInfo();
    res.json({
      presets,
      current: currentLLMConfig,
      currentInfo: llmInfo ?? null,
    });
  });

  // 设置 LLM 后端（运行时切换）
  app.post('/api/llm/config', (req, res) => {
    const { type, model, baseUrl, apiKey } = req.body;

    if (!type || !['ollama', 'openai-compatible', 'dummy'].includes(type)) {
      res.status(400).json({ error: '无效的 LLM 类型' });
      return;
    }

    const config: LLMConfig = {
      type,
      model: model || 'dummy',
      baseUrl: baseUrl || '',
      apiKey: apiKey || undefined,
    };

    try {
      const adapter = LLMAdapterFactory.create(config);
      currentLLMConfig = config;
      currentLLMAdapter = adapter;

      if (evaluationEngine) {
        evaluationEngine.setLLMAdapter(adapter);
      }

      // 同时设置到所有 bot
      if (botManager) {
        botManager.setLLMAdapter(adapter);
      }

      console.log(`  [LLM] 后端已切换: ${type} / ${config.model} @ ${config.baseUrl || 'N/A'}`);
      res.json({
        success: true,
        config: { ...config, apiKey: config.apiKey ? '***' : undefined },
        info: evaluationEngine?.getLLMInfo(),
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // 测试 LLM 连接（不切换当前后端）
  app.post('/api/llm/test', async (req, res) => {
    const { type, model, baseUrl, apiKey } = req.body;

    if (!type || !baseUrl) {
      res.status(400).json({ error: '缺少必要参数' });
      return;
    }

    try {
      const config: LLMConfig = {
        type,
        model: model || 'test',
        baseUrl,
        apiKey: apiKey || undefined,
      };
      const adapter = LLMAdapterFactory.create(config);

      // 发送测试 prompt
      const testPrompt = '请回复"连接成功"四个字。';
      const response = await Promise.race([
        adapter.generate(testPrompt),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('超时(30s)')), 30000)),
      ]);

      res.json({
        success: true,
        available: adapter.isAvailable(),
        model: adapter.getModelName(),
        backendType: adapter.getBackendType(),
        response: response.slice(0, 500),
      });
    } catch (e) {
      res.status(500).json({
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  // 获取当前 LLM 状态
  app.get('/api/llm/status', (_req, res) => {
    const info = evaluationEngine?.getLLMInfo();
    res.json({
      config: { ...currentLLMConfig, apiKey: currentLLMConfig.apiKey ? '***' : undefined },
      info: info ?? null,
      botLLMInfo: botManager?.getAllLLMInfo() ?? {},
    });
  });

  // 获取浏览器型 AI 玩家的最新截图
  app.get('/api/bots/:name/screenshot', async (req, res) => {
    const name = req.params.name;
    if (!botManager) {
      res.status(500).json({ error: 'BotManager not available' });
      return;
    }
    // 先查 socket 型 bot，再查浏览器型 bot
    const socketBot = botManager.getBot(name);
    const browserBot = botManager.getBrowserBot?.(name);

    if (!socketBot && !browserBot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    if (browserBot) {
      // 浏览器型 AI：直接从内存获取截图 buffer
      const state = browserBot.getState();
      const buffer = (browserBot as any).lastScreenshotBuffer;
      if (buffer) {
        res.setHeader('Content-Type', 'image/png');
        res.send(buffer);
      } else {
        res.status(404).json({ error: '暂无截图' });
      }
      return;
    }

    // socket 型 AI 不支持截图
    res.status(400).json({ error: '该 AI 玩家不支持截图查看（非浏览器型）' });
  });

  // ===== LLM 决策控制 =====

  // 获取所有 bot 的 LLM 决策状态
  app.get('/api/bots/llm', (_req, res) => {
    if (!botManager) {
      res.status(500).json({ error: 'BotManager not available' });
      return;
    }
    res.json({ bots: botManager.getAllLLMInfo() });
  });

  // 设置指定 bot 的 LLM 决策启用状态
  app.post('/api/bots/:name/llm/enabled', (req, res) => {
    const name = req.params.name;
    const { enabled } = req.body;

    if (!botManager) {
      res.status(500).json({ error: 'BotManager not available' });
      return;
    }

    const success = botManager.setBotLLMEnabled(name, enabled);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Bot not found' });
    }
  });

  // 设置指定 bot 的 LLM 性格
  app.post('/api/bots/:name/llm/personality', (req, res) => {
    const name = req.params.name;
    const { personality } = req.body;

    if (!botManager) {
      res.status(500).json({ error: 'BotManager not available' });
      return;
    }

    const success = botManager.setBotLLMPersonality(name, personality);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Bot not found' });
    }
  });

  // 设置指定 bot 的 LLM 策略
  app.post('/api/bots/:name/llm/strategy', (req, res) => {
    const name = req.params.name;
    const { strategy } = req.body;

    if (!botManager) {
      res.status(500).json({ error: 'BotManager not available' });
      return;
    }

    const success = botManager.setBotLLMStrategy(name, strategy);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Bot not found' });
    }
  });

  server.listen(port, () => {
    console.log(`  [控制面板] 运行于 http://localhost:${port}`);
  });

  return (entry: LogEntry) => {
    botNames.add(entry.botName);
    logs.push(entry);
    if (logs.length > MAX_LOGS) {
      logs.shift();
    }
    const data = JSON.stringify(entry);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(data);
        } catch {
          // ignore
        }
      }
    }
  };
}

const CONTROL_PANEL_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI 玩家控制面板</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: #0d1117; color: #e6edf3; height: 100vh; display: flex; flex-direction: column; }
  .header { background: #161b22; padding: 12px 20px; display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #30363d; }
  .header h1 { font-size: 18px; color: #58a6ff; }
  .stats { display: flex; gap: 12px; font-size: 13px; }
  .stat { padding: 4px 10px; border-radius: 4px; background: #21262d; }
  .stat-bug { color: #f85149; }
  .stat-error { color: #d29922; }
  .top-controls { padding: 8px 20px; background: #0d1117; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; border-bottom: 1px solid #30363d; }
  .top-controls button { padding: 6px 12px; border-radius: 4px; border: 1px solid #30363d; background: #21262d; color: #e6edf3; cursor: pointer; font-size: 13px; }
  .top-controls button:hover { background: #30363d; }
  .top-controls button.danger { color: #f85149; border-color: #f85149; }
  .top-controls button.success { color: #3fb950; border-color: #3fb950; }
  .main-content { flex: 1; display: flex; overflow: hidden; }
  .sidebar { width: 280px; background: #161b22; border-right: 1px solid #30363d; overflow-y: auto; padding: 12px; }
  .bot-card { background: #21262d; border-radius: 6px; padding: 12px; margin-bottom: 8px; border: 1px solid #30363d; }
  .bot-card .bot-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .bot-card .bot-name { font-weight: bold; color: #58a6ff; }
  .bot-card .status { width: 10px; height: 10px; border-radius: 50%; }
  .status.connected { background: #3fb950; }
  .status.disconnected { background: #f85149; }
  .bot-card .bot-stats { font-size: 12px; color: #8b949e; }
  .bot-card .bot-stats div { margin: 2px 0; }
  .bot-card .bot-controls { display: flex; gap: 4px; margin-top: 8px; }
  .bot-card .bot-controls button { flex: 1; padding: 4px; font-size: 11px; border-radius: 3px; border: none; cursor: pointer; }
  .bot-card .btn-pause { background: #d29922; color: #000; }
  .bot-card .btn-resume { background: #3fb950; color: #000; }
  .bot-card .btn-stop { background: #f85149; color: #fff; }
  .bot-card.paused { opacity: 0.6; }
  .content-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .tabs { display: flex; background: #161b22; border-bottom: 1px solid #30363d; }
  .tab { padding: 8px 16px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent; color: #8b949e; }
  .tab.active { color: #e6edf3; border-bottom-color: #58a6ff; }
  .tab-content { flex: 1; overflow-y: auto; padding: 12px; }
  .log-container { height: 100%; overflow-y: auto; }
  .log-entry { padding: 4px 8px; margin: 2px 0; border-radius: 3px; font-size: 13px; line-height: 1.5; display: flex; gap: 8px; border-left: 3px solid transparent; }
  .log-time { color: #8b949e; min-width: 70px; font-size: 11px; }
  .log-level { min-width: 45px; font-weight: bold; text-align: center; border-radius: 3px; padding: 0 4px; font-size: 11px; }
  .log-bot { color: #3fb950; min-width: 80px; }
  .log-msg { flex: 1; word-break: break-word; }
  .log-ctx { color: #8b949e; font-size: 11px; }
  .level-info { background: rgba(56,139,253,0.1); border-color: #388bfd; }
  .level-info .log-level { background: #388bfd; color: #fff; }
  .level-action { background: rgba(63,185,80,0.1); border-color: #3fb950; }
  .level-action .log-level { background: #3fb950; color: #000; }
  .level-event { background: rgba(139,92,246,0.1); border-color: #8b5cf6; }
  .level-event .log-level { background: #8b5cf6; color: #fff; }
  .level-warning { background: rgba(210,153,34,0.15); border-color: #d29922; }
  .level-warning .log-level { background: #d29922; color: #000; }
  .level-error { background: rgba(248,81,73,0.15); border-color: #f85149; }
  .level-error .log-level { background: #f85149; color: #fff; }
  .level-bug { background: rgba(248,81,73,0.3); border-color: #f85149; }
  .level-bug .log-level { background: #f85149; color: #fff; animation: pulse 1s infinite; }
  @keyframes pulse { 50% { opacity: 0.6; } }
  .auto-scroll { cursor: pointer; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
  .auto-scroll.active { background: #3fb950; color: #000; }
  .empty { text-align: center; padding: 40px; color: #8b949e; }
  .eval-report { background: #21262d; border-radius: 6px; padding: 16px; }
  .eval-score { font-size: 24px; font-weight: bold; color: #58a6ff; }
  .eval-category { margin: 12px 0; padding: 8px; background: #0d1117; border-radius: 4px; }
  .eval-category .cat-header { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .eval-category .cat-name { font-weight: bold; }
  .eval-category .cat-score { color: #3fb950; }
  .eval-category .cat-notes { font-size: 12px; color: #8b949e; }
  .eval-suggestions { margin-top: 12px; }
  .eval-suggestions h4 { margin-bottom: 8px; color: #d29922; }
  .eval-suggestions ul { list-style: none; padding-left: 0; }
  .eval-suggestions li { padding: 4px 0; font-size: 13px; border-bottom: 1px solid #30363d; }
  .eval-llm { margin-top: 12px; padding: 12px; background: #0d1117; border-radius: 4px; }
  .eval-llm h4 { margin-bottom: 8px; color: #8b5cf6; }
  .eval-llm p { font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
  .controls-panel { padding: 12px; }
  .controls-panel label { display: block; margin: 8px 0 4px; font-size: 13px; }
  .controls-panel input, .controls-panel select { width: 100%; padding: 6px; background: #21262d; border: 1px solid #30363d; border-radius: 4px; color: #e6edf3; font-size: 13px; }
  .controls-panel button { margin-top: 12px; padding: 8px 16px; background: #58a6ff; color: #000; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; }
  .controls-panel button:hover { background: #79c0ff; }
  .config-panel { padding: 12px; background: #21262d; border-radius: 6px; }
  .config-panel h3 { margin-bottom: 12px; color: #58a6ff; }
  .config-panel .config-item { margin-bottom: 10px; }
  .config-panel .config-item label { display: block; font-size: 12px; margin-bottom: 4px; color: #8b949e; }
  .config-panel .config-item input { width: 100%; padding: 5px; background: #0d1117; border: 1px solid #30363d; border-radius: 3px; color: #e6edf3; font-size: 12px; }
  .config-panel .config-item input[type="checkbox"] { width: auto; margin-right: 6px; }
  .log-filters { padding: 6px 20px; background: #0d1117; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; border-bottom: 1px solid #30363d; }
  .log-filters select, .log-filters input { padding: 4px 8px; background: #21262d; border: 1px solid #30363d; border-radius: 4px; color: #e6edf3; font-size: 12px; }
  .log-filters input { flex: 1; min-width: 120px; }
  .log-filters button { padding: 4px 8px; border-radius: 4px; border: 1px solid #30363d; background: #21262d; color: #f85149; cursor: pointer; font-size: 12px; }
  .add-bot-panel { padding: 12px; }
  .add-bot-panel label { display: block; margin: 8px 0 4px; font-size: 13px; }
  .add-bot-panel input, .add-bot-panel select { width: 100%; padding: 6px; background: #21262d; border: 1px solid #30363d; border-radius: 4px; color: #e6edf3; font-size: 13px; }
  .add-bot-panel button { margin-top: 12px; padding: 8px 16px; background: #3fb950; color: #000; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; width: 100%; }
  .add-bot-panel button:hover { background: #56d364; }
  .bot-card .btn-delete { background: #484f58; color: #f85149; width: 100%; margin-top: 4px; padding: 4px; font-size: 11px; border-radius: 3px; border: none; cursor: pointer; }
  .bot-card .driver-section { margin-top: 8px; padding-top: 8px; border-top: 1px solid #30363d; }
  .bot-card .driver-label { font-size: 11px; color: #8b949e; margin-bottom: 4px; }
  .bot-card .driver-buttons { display: flex; gap: 4px; }
  .bot-card .driver-btn { flex: 1; padding: 4px; font-size: 11px; border-radius: 3px; border: 1px solid #30363d; cursor: pointer; background: #21262d; color: #8b949e; text-align: center; }
  .bot-card .driver-btn.active { background: #1f6feb; color: #fff; border-color: #1f6feb; }
  .bot-card .driver-btn.llm.active { background: #8b5cf6; border-color: #8b5cf6; }
  .bot-card .llm-config-btn { margin-top: 4px; width: 100%; padding: 4px; font-size: 11px; border-radius: 3px; border: 1px solid #30363d; background: #21262d; color: #58a6ff; cursor: pointer; }
  .bot-card .llm-config-btn:hover { background: #30363d; }
  .bot-card .llm-inline-config { display: none; margin-top: 8px; padding: 8px; background: #0d1117; border-radius: 4px; }
  .bot-card .llm-inline-config.show { display: block; }
  .bot-card .llm-inline-config textarea { width: 100%; background: #161b22; border: 1px solid #30363d; border-radius: 3px; color: #e6edf3; padding: 4px; font-size: 11px; font-family: inherit; resize: vertical; }
  .bot-card .llm-inline-config label { font-size: 10px; color: #8b949e; margin: 4px 0 2px; display: block; }
  .bot-card .llm-inline-config button { margin-top: 4px; padding: 4px 8px; font-size: 11px; border-radius: 3px; border: 1px solid #30363d; background: #238636; color: #fff; cursor: pointer; }
  .bot-card .browser-view-btn { margin-top: 4px; width: 100%; padding: 4px; font-size: 11px; border-radius: 3px; border: 1px solid #8b5cf6; background: #21262d; color: #8b5cf6; cursor: pointer; }
  .bot-card .browser-view-btn:hover { background: #30363d; }
  .browser-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 1000; display: none; justify-content: center; align-items: center; }
  .browser-modal.show { display: flex; }
  .browser-modal-content { background: #161b22; border-radius: 8px; padding: 16px; max-width: 90vw; max-height: 90vh; overflow: auto; }
  .browser-modal-content h3 { color: #58a6ff; margin-bottom: 12px; }
  .browser-modal-content img { max-width: 100%; border-radius: 4px; }
  .browser-modal-content .close-btn { position: absolute; top: 16px; right: 16px; padding: 4px 12px; background: #f85149; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
</style>
</head>
<body>
<div class="header">
  <h1>AI 玩家控制面板</h1>
  <div class="stats" id="stats"></div>
</div>
<div class="top-controls">
  <button class="success" id="btn-resume-all">全部恢复</button>
  <button id="btn-pause-all">全部暂停</button>
  <button class="danger" id="btn-stop-all">全部停止</button>
  <button id="btn-evaluate">运行评价</button>
  <span style="color: #8b949e; font-size: 12px;">|</span>
  <label class="auto-scroll active" id="auto-scroll">自动滚动</label>
</div>
<div class="log-filters">
  <select id="filter-bot"><option value="">全部 AI</option></select>
  <select id="filter-level">
    <option value="">全部级别</option>
    <option value="info">信息</option>
    <option value="action">操作</option>
    <option value="event">事件</option>
    <option value="warning">警告</option>
    <option value="error">错误</option>
    <option value="bug">BUG</option>
  </select>
  <input type="text" id="filter-keyword" placeholder="关键词搜索..." />
  <button id="btn-export-json" style="padding: 4px 8px; font-size: 12px; background: #1f6feb; border: 1px solid #1f6feb; color: #fff; border-radius: 4px; cursor: pointer;">导出 JSON</button>
  <button id="btn-export-txt" style="padding: 4px 8px; font-size: 12px; background: #238636; border: 1px solid #238636; color: #fff; border-radius: 4px; cursor: pointer;">导出文本</button>
  <button id="btn-clear-logs" class="danger" style="padding: 4px 8px; font-size: 12px;">清空日志</button>
</div>
<div class="main-content">
  <div class="sidebar" id="sidebar">
    <div class="empty">加载中...</div>
  </div>
  <div class="content-area">
    <div class="tabs">
      <div class="tab active" data-tab="logs">日志</div>
      <div class="tab" data-tab="evaluation">评价报告</div>
      <div class="tab" data-tab="controls">手动控制</div>
      <div class="tab" data-tab="addbot">添加 AI</div>
      <div class="tab" data-tab="config">配置</div>
    </div>
    <div class="tab-content" id="tab-logs">
      <div class="log-container" id="logs">
        <div class="empty">等待日志...</div>
      </div>
    </div>
    <div class="tab-content" id="tab-evaluation" style="display:none;">
      <div class="eval-report" id="evaluation-content">
        <div class="empty">暂无评价报告，点击上方「运行评价」按钮生成</div>
      </div>
    </div>
    <div class="tab-content" id="tab-controls" style="display:none;">
      <div class="controls-panel">
        <label>选择 AI 玩家:</label>
        <select id="control-bot"></select>
        <label>命令:</label>
        <select id="control-command">
          <option value="rollDice">掷骰</option>
          <option value="buyProperty">购买地产</option>
          <option value="upgradeProperty">升级地产</option>
          <option value="learnTalent">学习天赋</option>
          <option value="chat">发送聊天</option>
          <option value="repairMonument">修缮纪念碑</option>
        </select>
        <label>参数 (JSON):</label>
        <input type="text" id="control-args" placeholder='{"cellId": 1}' />
        <button id="btn-execute">执行命令</button>
      </div>
    </div>
    <div class="tab-content" id="tab-addbot" style="display:none;">
      <div class="add-bot-panel">
        <h3 style="color: #58a6ff; margin-bottom: 12px;">添加 AI 玩家</h3>
        <label>用户名:</label>
        <input type="text" id="addbot-username" placeholder="AI_Bot_3" />
        <label>服务端地址:</label>
        <input type="text" id="addbot-server" value="http://localhost:3000" />
        <label>决策间隔 (ms):</label>
        <input type="number" id="addbot-interval" value="3000" />
        <label>保留资金:</label>
        <input type="number" id="addbot-reserve" value="500" />
        <label><input type="checkbox" id="addbot-guest" style="width:auto;margin-right:6px;" /> 游客模式</label>
        <label><input type="checkbox" id="addbot-buy" style="width:auto;margin-right:6px;" checked /> 自动购买</label>
        <label><input type="checkbox" id="addbot-upgrade" style="width:auto;margin-right:6px;" checked /> 自动升级</label>
        <label><input type="checkbox" id="addbot-team" style="width:auto;margin-right:6px;" checked /> 自动组队</label>
        <label><input type="checkbox" id="addbot-talent" style="width:auto;margin-right:6px;" checked /> 自动天赋</label>
        <button id="btn-add-bot">创建并启动 AI 玩家</button>
        <div id="addbot-status" style="margin-top: 8px; font-size: 12px; color: #8b949e;"></div>
      </div>
    </div>
    <div class="tab-content" id="tab-config" style="display:none;">
      <div class="config-panel">
        <h3>全局配置</h3>
        <div class="config-item">
          <label>决策间隔 (ms):</label>
          <input type="number" id="config-interval" value="3000" />
        </div>
        <div class="config-item">
          <label><input type="checkbox" id="config-auto-buy" checked /> 自动购买地产</label>
        </div>
        <div class="config-item">
          <label><input type="checkbox" id="config-auto-upgrade" checked /> 自动升级地产</label>
        </div>
        <div class="config-item">
          <label>保留资金:</label>
          <input type="number" id="config-reserve" value="500" />
        </div>
        <div class="config-item">
          <label>选择 AI 玩家:</label>
          <select id="config-bot"></select>
        </div>
        <button id="btn-save-config">保存配置</button>
      </div>
      <div class="config-panel" style="margin-top: 12px;">
        <h3>LLM 决策配置</h3>
        <div class="config-item">
          <label>选择 AI 玩家:</label>
          <select id="llm-decision-bot">
            <option value="">-- 选择 AI 玩家 --</option>
          </select>
        </div>
        <div class="config-item">
          <label><input type="checkbox" id="llm-decision-enabled" style="width:auto;margin-right:6px;" /> 启用 LLM 决策（LLM 不可用时自动回退到规则引擎）</label>
        </div>
        <div id="llm-decision-status" style="margin: 8px 0; padding: 8px; background: #0d1117; border-radius: 4px; font-size: 12px; color: #8b949e;">
          请选择一个 AI 玩家查看 LLM 状态
        </div>
        <div class="config-item">
          <label>性格设定:</label>
          <textarea id="llm-personality" rows="4" style="width:100%;background:#0d1117;border:1px solid #30363d;border-radius:4px;color:#e6edf3;padding:8px;font-size:12px;font-family:inherit;resize:vertical;" placeholder="设定 AI 玩家的性格，如：稳健、冒险、友善等"></textarea>
        </div>
        <div class="config-item">
          <label>策略偏好:</label>
          <textarea id="llm-strategy" rows="4" style="width:100%;background:#0d1117;border:1px solid #30363d;border-radius:4px;color:#e6edf3;padding:8px;font-size:12px;font-family:inherit;resize:vertical;" placeholder="设定 AI 玩家的游戏策略偏好"></textarea>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <button id="btn-save-llm-personality" style="flex: 1; background: #21262d; color: #58a6ff; border: 1px solid #58a6ff;">保存性格</button>
          <button id="btn-save-llm-strategy" style="flex: 1; background: #21262d; color: #3fb950; border: 1px solid #3fb950;">保存策略</button>
        </div>
        <div style="margin-top: 12px; padding: 8px; background: rgba(56,139,253,0.1); border: 1px solid rgba(56,139,253,0.3); border-radius: 4px; font-size: 11px; color: #58a6ff;">
          💡 提示：LLM 决策使 AI 玩家行为更接近真实玩家，适合用于游戏设计评价和测试。LLM 不可用时会自动回退到规则引擎。
        </div>
      </div>
      <div class="config-panel" style="margin-top: 12px;">
        <h3>LLM 后端配置</h3>
        <div id="llm-current-status" style="margin-bottom: 12px; padding: 8px; background: #0d1117; border-radius: 4px; font-size: 12px; color: #8b949e;">
          加载中...
        </div>
        <div class="config-item">
          <label>选择后端:</label>
          <select id="llm-preset">
            <option value="">-- 选择 LLM 后端 --</option>
          </select>
        </div>
        <div id="llm-preset-info" style="margin: 8px 0; padding: 8px; background: #0d1117; border-radius: 4px; font-size: 12px; color: #8b949e; display: none;">
        </div>
        <div class="config-item">
          <label>API 地址:</label>
          <input type="text" id="llm-url" value="http://localhost:11434" placeholder="http://localhost:11434" />
        </div>
        <div class="config-item">
          <label>模型名称:</label>
          <input type="text" id="llm-model" value="qwen2.5:0.5b" placeholder="qwen2.5:0.5b" />
        </div>
        <div class="config-item" id="llm-apikey-row" style="display:none;">
          <label>API Key:</label>
          <input type="password" id="llm-apikey" placeholder="sk-..." />
        </div>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <button id="btn-test-llm" style="flex: 1; background: #21262d; color: #d29922; border: 1px solid #d29922;">测试连接</button>
          <button id="btn-apply-llm" style="flex: 1; background: #238636; color: #fff; border: none;">应用并切换</button>
        </div>
        <div id="llm-status" style="margin-top: 8px; font-size: 12px; color: #8b949e;"></div>
      </div>
    </div>
  </div>
</div>
<div class="browser-modal" id="browser-modal">
  <div class="browser-modal-content" id="browser-modal-content">
  </div>
</div>
<script>
const logsEl = document.getElementById('logs');
const statsEl = document.getElementById('stats');
const sidebarEl = document.getElementById('sidebar');
const autoScrollEl = document.getElementById('auto-scroll');
let expandedLLMConfigBot = null;
const llmPromptCache = {};
const evaluationContent = document.getElementById('evaluation-content');
const controlBotSelect = document.getElementById('control-bot');
const controlCommandSelect = document.getElementById('control-command');
const controlArgsInput = document.getElementById('control-args');
const configBotSelect = document.getElementById('config-bot');
const filterBotSelect = document.getElementById('filter-bot');
const filterLevelSelect = document.getElementById('filter-level');
const filterKeywordInput = document.getElementById('filter-keyword');

let allLogs = [];
let autoScroll = true;
let stats = { totalLogs: 0, byLevel: {}, bots: [] };
let botStates = [];
let logFilter = { bot: '', level: '', keyword: '' };

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function levelLabel(level) {
  const labels = { info: '信息', action: '操作', event: '事件', warning: '警告', error: '错误', bug: 'BUG' };
  return labels[level] || level;
}

function renderLog(entry) {
  const div = document.createElement('div');
  div.className = 'log-entry level-' + entry.level;
  const ctx = entry.context ? ' <span class="log-ctx">' + JSON.stringify(entry.context) + '</span>' : '';
  div.innerHTML =
    '<span class="log-time">' + formatTime(entry.timestamp) + '</span>' +
    '<span class="log-level">' + levelLabel(entry.level) + '</span>' +
    '<span class="log-bot">[' + entry.botName + ']</span>' +
    '<span class="log-msg">' + entry.message + ctx + '</span>';
  return div;
}

function toggleAutoScroll() {
  autoScroll = !autoScroll;
  autoScrollEl.classList.toggle('active', autoScroll);
}

function updateStats() {
  const parts = [];
  parts.push('<span class="stat">日志: ' + stats.totalLogs + '</span>');
  if (stats.byLevel.bug > 0) parts.push('<span class="stat stat-bug">BUG: ' + stats.byLevel.bug + '</span>');
  if (stats.byLevel.error > 0) parts.push('<span class="stat stat-error">错误: ' + stats.byLevel.error + '</span>');
  parts.push('<span class="stat">AI: ' + (stats.bots.length || 0) + '</span>');
  statsEl.innerHTML = parts.join('');
}

function shouldShowLog(entry) {
  if (logFilter.bot && entry.botName !== logFilter.bot) return false;
  if (logFilter.level && entry.level !== logFilter.level) return false;
  if (logFilter.keyword && !entry.message.toLowerCase().includes(logFilter.keyword.toLowerCase())) return false;
  return true;
}

function rerenderLogs() {
  logsEl.innerHTML = '';
  var frag = document.createDocumentFragment();
  for (var i = 0; i < allLogs.length; i++) {
    if (shouldShowLog(allLogs[i])) {
      frag.appendChild(renderLog(allLogs[i]));
    }
  }
  logsEl.appendChild(frag);
  if (autoScroll) logsEl.scrollTop = logsEl.scrollHeight;
}

function updateFilterOptions() {
  var botOptions = '<option value="">全部 AI</option>';
  for (var i = 0; i < botStates.length; i++) {
    botOptions += '<option value="' + botStates[i].name + '">' + botStates[i].name + '</option>';
  }
  filterBotSelect.innerHTML = botOptions;
}

function updateSidebar() {
  if (botStates.length === 0) {
    sidebarEl.innerHTML = '<div class="empty">暂无 AI 玩家</div>';
    return;
  }

  // 保存当前展开状态和输入内容（避免刷新导致输入框收起/内容丢失）
  for (const name of Object.keys(llmPromptCache)) {
    const pEl = document.getElementById('llm-personality-' + name);
    const sEl = document.getElementById('llm-strategy-' + name);
    if (pEl) llmPromptCache[name].personality = pEl.value;
    if (sEl) llmPromptCache[name].strategy = sEl.value;
  }

  sidebarEl.innerHTML = '';
  for (const state of botStates) {
    const card = document.createElement('div');
    card.className = 'bot-card' + (state.paused ? ' paused' : '');
    const llmEnabled = state.llmInfo && state.llmInfo.enabled;
    const llmAvailable = state.llmInfo && state.llmInfo.available;
    const isBrowser = state.type === 'browser';
    const isExpanded = expandedLLMConfigBot === state.name;

    if (!llmPromptCache[state.name]) {
      llmPromptCache[state.name] = {
        personality: (state.llmInfo?.personality) || '',
        strategy: (state.llmInfo?.strategy) || '',
      };
    }
    card.innerHTML =
      '<div class="bot-header">' +
        '<span class="bot-name">' + state.name + (isBrowser ? ' 🖥️' : '') + '</span>' +
        '<span class="status ' + (state.stats.connected ? 'connected' : 'disconnected') + '"></span>' +
      '</div>' +
      '<div class="bot-stats">' +
        '<div>状态: ' + (state.paused ? '已暂停' : '运行中') + '</div>' +
        '<div>操作: ' + state.stats.actionsTaken + '</div>' +
        '<div>掷骰: ' + state.stats.diceRolled + '</div>' +
        '<div>地产: ' + state.stats.propertiesBought + '</div>' +
        '<div>Bug: ' + state.stats.bugsDetected + (state.stats.gameBugsDetected ? ' (游戏:' + state.stats.gameBugsDetected + ')' : '') + '</div>' +
        '<div>错误: ' + state.stats.errors + '</div>' +
      '</div>' +
      '<div class="bot-controls">' +
        '<button class="' + (state.paused ? 'btn-resume' : 'btn-pause') + '" data-action="' + (state.paused ? 'resume' : 'pause') + '" data-name="' + state.name + '">' +
          (state.paused ? '恢复' : '暂停') +
        '</button>' +
        '<button class="btn-stop" data-action="stop" data-name="' + state.name + '">停止</button>' +
      '</div>' +
      '<div class="driver-section">' +
        '<div class="driver-label">驱动方式</div>' +
        '<div class="driver-buttons">' +
          '<button class="driver-btn rule' + (!llmEnabled ? ' active' : '') + '" data-action="set-rule" data-name="' + state.name + '">规则引擎</button>' +
          '<button class="driver-btn llm' + (llmEnabled ? ' active' : '') + '" data-action="set-llm" data-name="' + state.name + '"' + (llmAvailable === false ? ' style="opacity:0.5"' : '') + '>LLM</button>' +
        '</div>' +
        '<button class="llm-config-btn" data-action="toggle-llm-config" data-name="' + state.name + '">⚙ LLM 提示词配置</button>' +
        '<div class="llm-inline-config' + (isExpanded ? ' show' : '') + '" id="llm-config-' + state.name + '">' +
          '<label>性格设定:</label>' +
          '<textarea id="llm-personality-' + state.name + '" rows="3" placeholder="如：谨慎保守，优先保证资金安全">' + escapeHtml(llmPromptCache[state.name].personality) + '</textarea>' +
          '<label>策略偏好:</label>' +
          '<textarea id="llm-strategy-' + state.name + '" rows="3" placeholder="如：优先升级地产，喜欢组队合作">' + escapeHtml(llmPromptCache[state.name].strategy) + '</textarea>' +
          '<button data-action="save-llm-prompts" data-name="' + state.name + '">保存配置</button>' +
        '</div>' +
        (isBrowser ? '<button class="browser-view-btn" data-action="view-browser" data-name="' + state.name + '">📷 查看 AI 看到的页面</button>' : '') +
      '</div>' +
      '<button class="btn-delete" data-action="delete" data-name="' + state.name + '">删除</button>';
    sidebarEl.appendChild(card);
  }

  updateControlBotSelect();
  updateFilterOptions();
  updateLLMDecisionBotSelect();
}

function updateControlBotSelect() {
  const options = botStates.map(function(b) { return '<option value="' + b.name + '">' + b.name + '</option>'; }).join('');
  controlBotSelect.innerHTML = options;
  configBotSelect.innerHTML = options;
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str || ''));
  return div.innerHTML;
}

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.tab-content').forEach(function(c) { c.style.display = 'none'; });
  document.querySelector('.tab[data-tab="' + tabName + '"]').classList.add('active');
  document.getElementById('tab-' + tabName).style.display = 'block';
}

async function fetchBotStates() {
  try {
    const response = await fetch('/api/bots');
    const data = await response.json();
    botStates = data.bots || [];
    updateSidebar();
  } catch (e) {
    console.error('Failed to fetch bot states:', e);
  }
}

async function controlBot(name, action) {
  await fetch('/api/bots/' + name + '/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: action })
  });
  fetchBotStates();
}

async function controlAll(action) {
  await fetch('/api/bots/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: action })
  });
  fetchBotStates();
}

async function executeCommand() {
  const botName = controlBotSelect.value;
  const command = controlCommandSelect.value;
  let args = {};
  try {
    if (controlArgsInput.value) {
      args = JSON.parse(controlArgsInput.value);
    }
  } catch {
    alert('无效的 JSON 参数');
    return;
  }

  await fetch('/api/bots/' + botName + '/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, args })
  });
  alert('命令已发送');
}

async function runEvaluation() {
  evaluationContent.innerHTML = '<div class="empty">正在生成评价报告...</div>';
  try {
    const response = await fetch('/api/evaluation/run', { method: 'POST' });
    const report = await response.json();
    renderEvaluationReport(report);
    switchTab('evaluation');
  } catch (e) {
    evaluationContent.innerHTML = '<div class="empty">评价失败: ' + e.message + '</div>';
  }
}

function renderEvaluationReport(report) {
  if (!report) {
    evaluationContent.innerHTML = '<div class="empty">暂无评价报告</div>';
    return;
  }

  var categoriesHtml = '';
  for (var catName in report.categories) {
    var score = report.categories[catName];
    categoriesHtml +=
      '<div class="eval-category">' +
        '<div class="cat-header">' +
          '<span class="cat-name">' + catName + '</span>' +
          '<span class="cat-score">' + score.score + '/' + score.maxScore + '</span>' +
        '</div>' +
        '<div class="cat-notes">' + score.notes.join(', ') + '</div>' +
      '</div>';
  }

  var suggestionsHtml = report.suggestions.map(function(s) { return '<li>' + s + '</li>'; }).join('');

  var llmHtml = report.llmAnalysis ?
    '<div class="eval-llm">' +
      '<h4>LLM 分析</h4>' +
      '<p>' + report.llmAnalysis + '</p>' +
    '</div>' : '';

  evaluationContent.innerHTML =
    '<div style="margin-bottom: 16px;">' +
      '<span class="eval-score">整体评分: ' + report.overallScore + '/100</span>' +
      '<span style="margin-left: 16px; color: #8b949e;">' +
        new Date(report.timestamp).toLocaleString('zh-CN') +
      '</span>' +
    '</div>' +
    categoriesHtml +
    '<div class="eval-suggestions">' +
      '<h4>改进建议</h4>' +
      '<ul>' + suggestionsHtml + '</ul>' +
    '</div>' +
    llmHtml;
}

async function saveConfig() {
  const botName = configBotSelect.value;
  const config = {
    decisionInterval: parseInt(document.getElementById('config-interval').value),
    autoBuy: document.getElementById('config-auto-buy').checked,
    autoUpgrade: document.getElementById('config-auto-upgrade').checked,
    reserveMoney: parseInt(document.getElementById('config-reserve').value)
  };

  await fetch('/api/bots/' + botName + '/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  alert('配置已保存');
}

let llmPresets = [];
let llmCurrentConfig = null;

async function loadLLMPresets() {
  try {
    const response = await fetch('/api/llm/presets');
    const data = await response.json();
    llmPresets = data.presets || [];
    llmCurrentConfig = data.current;

    var select = document.getElementById('llm-preset');
    var options = '<option value="">-- 选择 LLM 后端 --</option>';
    for (var i = 0; i < llmPresets.length; i++) {
      var p = llmPresets[i];
      options += '<option value="' + p.id + '">' + p.label + '</option>';
    }
    select.innerHTML = options;

    updateLLMCurrentStatus(data.currentInfo);
  } catch (e) {
    console.error('Failed to load LLM presets:', e);
  }
}

function updateLLMCurrentStatus(info) {
  var el = document.getElementById('llm-current-status');
  if (!info) {
    el.innerHTML = '<span style="color: #f85149;">未启用 LLM（使用规则引擎）</span>';
    return;
  }
  var color = info.available ? '#3fb950' : '#d29922';
  var statusText = info.available ? '可用' : '待验证';
  el.innerHTML =
    '<span style="color: ' + color + ';">● ' + statusText + '</span> ' +
    '<span style="color: #58a6ff;">' + info.type + '</span> / ' +
    '<span style="color: #e6edf3;">' + info.model + '</span>';
}

function onLLMPresetChange() {
  var presetId = document.getElementById('llm-preset').value;
  var preset = llmPresets.find(function(p) { return p.id === presetId; });
  var infoEl = document.getElementById('llm-preset-info');
  var apikeyRow = document.getElementById('llm-apikey-row');

  if (!preset) {
    infoEl.style.display = 'none';
    apikeyRow.style.display = 'none';
    return;
  }

  infoEl.style.display = 'block';
  infoEl.innerHTML =
    '<div style="color: #e6edf3; margin-bottom: 4px;">' + preset.description + '</div>' +
    '<div style="color: #8b949e; margin-top: 4px;">配置指南: ' + preset.setupGuide + '</div>';

  document.getElementById('llm-url').value = preset.defaultBaseUrl;
  document.getElementById('llm-model').value = preset.defaultModel;
  apikeyRow.style.display = preset.needsApiKey ? 'block' : 'none';
}

async function testLLM() {
  var presetId = document.getElementById('llm-preset').value;
  var type = 'dummy';
  if (presetId) {
    var preset = llmPresets.find(function(p) { return p.id === presetId; });
    if (preset) type = preset.type;
  }
  var model = document.getElementById('llm-model').value;
  var baseUrl = document.getElementById('llm-url').value;
  var apiKey = document.getElementById('llm-apikey').value;
  var statusEl = document.getElementById('llm-status');

  if (!baseUrl && type !== 'dummy') {
    statusEl.innerHTML = '<span style="color: #f85149;">请填写 API 地址</span>';
    return;
  }

  statusEl.innerHTML = '<span style="color: #d29922;">正在测试连接（最多等待 30 秒）...</span>';
  document.getElementById('btn-test-llm').disabled = true;

  try {
    var response = await fetch('/api/llm/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: type, model: model, baseUrl: baseUrl, apiKey: apiKey })
    });
    var data = await response.json();
    if (data.success) {
      statusEl.innerHTML =
        '<span style="color: #3fb950;">✓ 连接成功</span>' +
        '<div style="margin-top: 6px; padding: 8px; background: #0d1117; border-radius: 4px; font-size: 12px; color: #e6edf3; white-space: pre-wrap;">' +
        (data.response || '无响应内容') +
        '</div>';
    } else {
      statusEl.innerHTML = '<span style="color: #f85149;">✗ 连接失败: ' + (data.error || '未知错误') + '</span>';
    }
  } catch (e) {
    statusEl.innerHTML = '<span style="color: #f85149;">✗ 测试失败: ' + e.message + '</span>';
  } finally {
    document.getElementById('btn-test-llm').disabled = false;
  }
}

async function applyLLM() {
  var presetId = document.getElementById('llm-preset').value;
  if (!presetId) {
    document.getElementById('llm-status').innerHTML = '<span style="color: #f85149;">请先选择一个后端</span>';
    return;
  }
  var preset = llmPresets.find(function(p) { return p.id === presetId; });
  if (!preset) return;

  var model = document.getElementById('llm-model').value;
  var baseUrl = document.getElementById('llm-url').value;
  var apiKey = document.getElementById('llm-apikey').value;
  var statusEl = document.getElementById('llm-status');

  statusEl.innerHTML = '<span style="color: #d29922;">正在切换后端...</span>';
  document.getElementById('btn-apply-llm').disabled = true;

  try {
    var response = await fetch('/api/llm/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: preset.type, model: model, baseUrl: baseUrl, apiKey: apiKey })
    });
    var data = await response.json();
    if (data.success) {
      statusEl.innerHTML = '<span style="color: #3fb950;">✓ LLM 后端已切换为 ' + preset.label + '</span>';
      updateLLMCurrentStatus(data.info);
    } else {
      statusEl.innerHTML = '<span style="color: #f85149;">✗ 切换失败: ' + (data.error || '未知错误') + '</span>';
    }
  } catch (e) {
    statusEl.innerHTML = '<span style="color: #f85149;">✗ 切换失败: ' + e.message + '</span>';
  } finally {
    document.getElementById('btn-apply-llm').disabled = false;
  }
}

document.getElementById('btn-resume-all').addEventListener('click', function() { controlAll('resumeAll'); });
document.getElementById('btn-pause-all').addEventListener('click', function() { controlAll('pauseAll'); });
document.getElementById('btn-stop-all').addEventListener('click', function() { controlAll('stopAll'); });
document.getElementById('btn-evaluate').addEventListener('click', runEvaluation);
document.getElementById('auto-scroll').addEventListener('click', toggleAutoScroll);
document.getElementById('btn-execute').addEventListener('click', executeCommand);
document.getElementById('btn-save-config').addEventListener('click', saveConfig);
document.getElementById('btn-test-llm').addEventListener('click', testLLM);
document.getElementById('btn-apply-llm').addEventListener('click', applyLLM);
document.getElementById('btn-add-bot').addEventListener('click', addBot);
document.getElementById('llm-preset').addEventListener('change', onLLMPresetChange);

filterBotSelect.addEventListener('change', function() { logFilter.bot = this.value; rerenderLogs(); });
filterLevelSelect.addEventListener('change', function() { logFilter.level = this.value; rerenderLogs(); });
filterKeywordInput.addEventListener('input', function() { logFilter.keyword = this.value; rerenderLogs(); });
document.getElementById('btn-clear-logs').addEventListener('click', function() {
  allLogs = [];
  logsEl.innerHTML = '<div class="empty">日志已清空</div>';
  fetch('/api/logs?limit=1').then(function() {});
});

function getExportUrl(format) {
  const params = new URLSearchParams();
  if (logFilter.bot) params.set('bot', logFilter.bot);
  if (logFilter.level) params.set('level', logFilter.level);
  if (logFilter.keyword) params.set('keyword', logFilter.keyword);
  params.set('format', format);
  return '/api/logs/export?' + params.toString();
}

document.getElementById('btn-export-json').addEventListener('click', function() {
  window.open(getExportUrl('json'), '_blank');
});

document.getElementById('btn-export-txt').addEventListener('click', function() {
  window.open(getExportUrl('text'), '_blank');
});

document.querySelectorAll('.tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    switchTab(this.getAttribute('data-tab'));
  });
});

sidebarEl.addEventListener('click', async function(e) {
  const btn = e.target.closest('button[data-action]');
  if (btn) {
    const action = btn.getAttribute('data-action');
    const name = btn.getAttribute('data-name');

    if (action === 'delete') {
      if (confirm('确定删除 AI 玩家 ' + name + '？')) {
        fetch('/api/bots/' + name, { method: 'DELETE' }).then(function() { fetchBotStates(); });
      }
    } else if (action === 'set-rule') {
      await fetch('/api/bots/' + encodeURIComponent(name) + '/llm/enabled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false })
      });
      fetchBotStates();
    } else if (action === 'set-llm') {
      await fetch('/api/bots/' + encodeURIComponent(name) + '/llm/enabled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true })
      });
      fetchBotStates();
    } else if (action === 'toggle-llm-config') {
      if (expandedLLMConfigBot === name) {
        expandedLLMConfigBot = null;
      } else {
        expandedLLMConfigBot = name;
        loadLLMPromptsForBot(name);
      }
      const configEl = document.getElementById('llm-config-' + name);
      if (configEl) {
        configEl.classList.toggle('show');
      }
    } else if (action === 'save-llm-prompts') {
      var personality = document.getElementById('llm-personality-' + name);
      var strategy = document.getElementById('llm-strategy-' + name);
      if (personality && strategy) {
        try {
          await fetch('/api/bots/' + encodeURIComponent(name) + '/llm/personality', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personality: personality.value })
          });
          await fetch('/api/bots/' + encodeURIComponent(name) + '/llm/strategy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ strategy: strategy.value })
          });
          alert('LLM 配置已保存');
        } catch (e2) {
          alert('保存失败: ' + e2.message);
        }
      }
    } else if (action === 'view-browser') {
      openBrowserView(name);
    } else {
      controlBot(name, action);
    }
  }
});

async function loadLLMPromptsForBot(botName) {
  try {
    var response = await fetch('/api/bots/llm');
    var data = await response.json();
    var info = data.bots ? data.bots[botName] : null;
    if (info) {
      var pEl = document.getElementById('llm-personality-' + botName);
      var sEl = document.getElementById('llm-strategy-' + botName);
      if (pEl && info.personality) pEl.value = info.personality;
      if (sEl && info.strategy) sEl.value = info.strategy;
    }
  } catch (e) {
    console.error('Failed to load LLM prompts:', e);
  }
}

async function openBrowserView(botName) {
  var modal = document.getElementById('browser-modal');
  var content = document.getElementById('browser-modal-content');
  content.innerHTML = '<h3>AI 玩家 ' + botName + ' 的视角</h3><div style="color:#8b949e">正在获取截图...</div>';

  try {
    var response = await fetch('/api/bots/' + encodeURIComponent(botName) + '/screenshot');
    if (response.ok) {
      var blob = await response.blob();
      var url = URL.createObjectURL(blob);
      content.innerHTML =
        '<button class="close-btn" onclick="document.getElementById(\\'browser-modal\\').classList.remove(\\'show\\')">关闭</button>' +
        '<h3>AI 玩家 ' + botName + ' 的视角</h3>' +
        '<img src="' + url + '" alt="AI 玩家截图" style="border:1px solid #30363d" />' +
        '<div style="margin-top:8px;font-size:12px;color:#8b949e">截图时间: ' + new Date().toLocaleTimeString('zh-CN') + '</div>' +
        '<button style="margin-top:8px;padding:6px 12px;background:#21262d;color:#58a6ff;border:1px solid #58a6ff;border-radius:4px;cursor:pointer" onclick="openBrowserView(\\'' + botName + '\\')">刷新截图</button>';
      modal.classList.add('show');
    } else {
      content.innerHTML = '<h3>AI 玩家 ' + botName + ' 的视角</h3><div style="color:#f85149">该 AI 玩家不是浏览器型，无法查看页面截图。仅浏览器视觉型 AI 玩家（🖥️标记）支持此功能。</div>';
      modal.classList.add('show');
    }
  } catch (e) {
    content.innerHTML = '<h3>AI 玩家 ' + botName + ' 的视角</h3><div style="color:#f85149">获取截图失败: ' + e.message + '</div>';
    modal.classList.add('show');
  }
}

async function addBot() {
  var username = document.getElementById('addbot-username').value.trim();
  var serverUrl = document.getElementById('addbot-server').value.trim();
  var interval = parseInt(document.getElementById('addbot-interval').value) || 3000;
  var reserve = parseInt(document.getElementById('addbot-reserve').value) || 500;
  var guest = document.getElementById('addbot-guest').checked;
  var autoBuy = document.getElementById('addbot-buy').checked;
  var autoUpgrade = document.getElementById('addbot-upgrade').checked;
  var autoTeam = document.getElementById('addbot-team').checked;
  var autoTalent = document.getElementById('addbot-talent').checked;
  var statusEl = document.getElementById('addbot-status');

  if (!username) {
    statusEl.innerHTML = '<span style="color: #f85149;">请输入用户名</span>';
    return;
  }

  statusEl.innerHTML = '正在创建...';
  try {
    var response = await fetch('/api/bots/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username,
        serverUrl: serverUrl,
        decisionInterval: interval,
        reserveMoney: reserve,
        guest: guest,
        autoBuy: autoBuy,
        autoUpgrade: autoUpgrade,
        autoTeam: autoTeam,
        autoTalent: autoTalent
      })
    });
    var data = await response.json();
    if (response.ok) {
      statusEl.innerHTML = '<span style="color: #3fb950;">✓ AI 玩家 ' + username + ' 已创建并启动</span>';
      document.getElementById('addbot-username').value = '';
      fetchBotStates();
    } else {
      statusEl.innerHTML = '<span style="color: #f85149;">✗ 创建失败: ' + (data.error || '未知错误') + '</span>';
    }
  } catch (e) {
    statusEl.innerHTML = '<span style="color: #f85149;">✗ 创建失败: ' + e.message + '</span>';
  }
}

fetch('/api/logs?limit=500').then(function(r) { return r.json(); }).then(function(data) {
  allLogs = data.logs || [];
  var frag = document.createDocumentFragment();
  for (var i = 0; i < allLogs.length; i++) {
    frag.appendChild(renderLog(allLogs[i]));
  }
  logsEl.innerHTML = '';
  logsEl.appendChild(frag);
  if (autoScroll) logsEl.scrollTop = logsEl.scrollHeight;
});

fetch('/api/stats').then(function(r) { return r.json(); }).then(function(data) {
  stats = data;
  updateStats();
});

fetchBotStates();

// 加载 LLM 预设
loadLLMPresets();

var wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
var ws = new WebSocket(wsProtocol + '//' + location.host + '/ws');
ws.onmessage = function(event) {
  var entry = JSON.parse(event.data);
  allLogs.push(entry);
  if (allLogs.length > 5000) allLogs.shift();
  if (shouldShowLog(entry)) {
    var empty = logsEl.querySelector('.empty');
    if (empty) empty.remove();
    logsEl.appendChild(renderLog(entry));
    if (autoScroll) logsEl.scrollTop = logsEl.scrollHeight;
  }
  stats.totalLogs++;
  stats.byLevel[entry.level] = (stats.byLevel[entry.level] || 0) + 1;
  if (stats.bots.indexOf(entry.botName) === -1) {
    stats.bots.push(entry.botName);
  }
  updateStats();
};

function updateLLMDecisionBotSelect() {
  const select = document.getElementById('llm-decision-bot');
  const options = '<option value="">-- 选择 AI 玩家 --</option>' +
    botStates.map(function(b) { return '<option value="' + b.name + '">' + b.name + '</option>'; }).join('');
  select.innerHTML = options;
}

async function updateLLMDecisionStatus(botName) {
  const statusEl = document.getElementById('llm-decision-status');
  const enabledCheckbox = document.getElementById('llm-decision-enabled');
  const personalityTextarea = document.getElementById('llm-personality');
  const strategyTextarea = document.getElementById('llm-strategy');

  if (!botName) {
    statusEl.textContent = '请选择一个 AI 玩家查看 LLM 状态';
    enabledCheckbox.checked = false;
    personalityTextarea.value = '';
    strategyTextarea.value = '';
    return;
  }

  try {
    const response = await fetch('/api/bots/llm');
    const data = await response.json();
    const info = data.bots ? data.bots[botName] : null;

    if (info) {
      const statusText = info.available
        ? '<span style="color: #3fb950;">✓ LLM 可用</span>'
        : '<span style="color: #d29922;">⚠ LLM 不可用（将回退到规则引擎）</span>';
      statusEl.innerHTML =
        '后端: ' + info.backend + ' | 模型: ' + info.model + '<br>' +
        statusText;
      enabledCheckbox.checked = info.enabled;
    } else {
      statusEl.textContent = '未找到该 AI 玩家的 LLM 信息';
    }
  } catch (e) {
    statusEl.textContent = '获取 LLM 状态失败: ' + e.message;
  }
}

async function toggleLLMDecision(enabled) {
  const botName = document.getElementById('llm-decision-bot').value;
  if (!botName) {
    alert('请先选择一个 AI 玩家');
    return;
  }

  try {
    await fetch('/api/bots/' + encodeURIComponent(botName) + '/llm/enabled', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enabled })
    });
    updateLLMDecisionStatus(botName);
  } catch (e) {
    alert('设置失败: ' + e.message);
  }
}

async function saveLLMPersonality() {
  const botName = document.getElementById('llm-decision-bot').value;
  const personality = document.getElementById('llm-personality').value;
  if (!botName) {
    alert('请先选择一个 AI 玩家');
    return;
  }

  try {
    const response = await fetch('/api/bots/' + encodeURIComponent(botName) + '/llm/personality', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personality: personality })
    });
    if (response.ok) {
      alert('性格设定已保存');
    } else {
      const data = await response.json();
      alert('保存失败: ' + (data.error || '未知错误'));
    }
  } catch (e) {
    alert('保存失败: ' + e.message);
  }
}

async function saveLLMStrategy() {
  const botName = document.getElementById('llm-decision-bot').value;
  const strategy = document.getElementById('llm-strategy').value;
  if (!botName) {
    alert('请先选择一个 AI 玩家');
    return;
  }

  try {
    const response = await fetch('/api/bots/' + encodeURIComponent(botName) + '/llm/strategy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy: strategy })
    });
    if (response.ok) {
      alert('策略偏好已保存');
    } else {
      const data = await response.json();
      alert('保存失败: ' + (data.error || '未知错误'));
    }
  } catch (e) {
    alert('保存失败: ' + e.message);
  }
}

document.getElementById('llm-decision-bot').addEventListener('change', function() {
  updateLLMDecisionStatus(this.value);
});
document.getElementById('llm-decision-enabled').addEventListener('change', function() {
  toggleLLMDecision(this.checked);
});
document.getElementById('btn-save-llm-personality').addEventListener('click', saveLLMPersonality);
document.getElementById('btn-save-llm-strategy').addEventListener('click', saveLLMStrategy);

setInterval(fetchBotStates, 5000);
</script>
</body>
</html>`;