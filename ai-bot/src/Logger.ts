/**
 * 日志记录器
 */

import { writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { LogEntry, LogLevel } from './types.js';

const LEVEL_COLORS: Record<LogLevel, string> = {
  info: '\x1b[36m',
  action: '\x1b[32m',
  event: '\x1b[35m',
  warning: '\x1b[33m',
  error: '\x1b[31m',
  bug: '\x1b[41m',
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  info: '信息',
  action: '操作',
  event: '事件',
  warning: '警告',
  error: '错误',
  bug: 'BUG',
};

const RESET = '\x1b[0m';

export class Logger {
  private readonly botName: string;
  private readonly logDir: string;
  private logFile = '';
  private fileWritable = true;
  private static pushCallback: ((entry: LogEntry) => void) | null = null;

  constructor(botName: string, logDir: string) {
    this.botName = botName;
    this.logDir = resolve(logDir);
    try {
      if (!existsSync(this.logDir)) {
        mkdirSync(this.logDir, { recursive: true });
      }
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      this.logFile = join(this.logDir, `${botName}_${dateStr}.log`);
      writeFileSync(this.logFile, `# AI 玩家 ${botName} 日志 - ${new Date().toLocaleString('zh-CN')}\n\n`);
    } catch (e: any) {
      this.fileWritable = false;
      console.warn(`[Logger] 无法写入日志文件 (${e.code}), 将仅输出到控制台和dashboard`);
    }
  }

  static setPushCallback(cb: (entry: LogEntry) => void): void {
    Logger.pushCallback = cb;
  }

  log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      botName: this.botName,
      message,
      context,
    };

    if (this.fileWritable) {
      try {
        const line = this.formatFileLine(entry);
        appendFileSync(this.logFile, line + '\n');
      } catch {
        this.fileWritable = false;
      }
    }

    const color = LEVEL_COLORS[level] || '';
    const label = LEVEL_LABELS[level] || level;
    const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN');
    const ctxStr = context ? ` ${JSON.stringify(context)}` : '';
    console.log(`${color}[${label}]${RESET} [${time}] ${this.botName}: ${message}${ctxStr}`);

    Logger.pushCallback?.(entry);
  }

  private formatFileLine(entry: LogEntry): string {
    const time = new Date(entry.timestamp).toISOString();
    const ctx = entry.context ? ` | ${JSON.stringify(entry.context)}` : '';
    return `[${time}] [${entry.level.toUpperCase()}] ${entry.botName}: ${entry.message}${ctx}`;
  }

  /** 生成统计摘要字符串 */
  summary(stats: Record<string, unknown>): string {
    return Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(', ');
  }

  info(message: string, context?: Record<string, unknown>): void { this.log('info', message, context); }
  action(message: string, context?: Record<string, unknown>): void { this.log('action', message, context); }
  event(message: string, context?: Record<string, unknown>): void { this.log('event', message, context); }
  warning(message: string, context?: Record<string, unknown>): void { this.log('warning', message, context); }
  error(message: string, context?: Record<string, unknown>): void { this.log('error', message, context); }
  bug(message: string, context?: Record<string, unknown>): void { this.log('bug', message, context); }
}
