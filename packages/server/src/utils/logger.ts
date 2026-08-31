/**
 * 服务端日志工具
 *
 * 提供简单的日志记录器，支持级别（debug/info/warn/error）。
 * debug 级别由 `@game/shared` 的调试开关控制（仅在配置 `debug=true` 时启用）。
 *
 * 用法：
 * ```ts
 * import { logger } from '../utils/logger';
 * logger.info('server started');
 * logger.error('failed', err);
 * ```
 */

import { isFeatureEnabled } from '@game/shared';

/**
 * 日志级别
 */
export const LogLevel = {
  Debug: 'debug',
  Info: 'info',
  Warn: 'warn',
  Error: 'error',
} as const;

/** 日志级别字符串字面量联合 */
export type LogLevelName = (typeof LogLevel)[keyof typeof LogLevel];

/**
 * 日志级别数值（用于比较与过滤）
 */
const LEVEL_VALUES: Readonly<Record<LogLevelName, number>> = {
  [LogLevel.Debug]: 10,
  [LogLevel.Info]: 20,
  [LogLevel.Warn]: 30,
  [LogLevel.Error]: 40,
};

/**
 * 日志条目
 */
export interface LogEntry {
  level: LogLevelName;
  message: string;
  /** 附加上下文（可选） */
  context?: Record<string, unknown>;
  /** 时间戳（Unix 毫秒） */
  timestamp: number;
}

/**
 * 日志输出器接口
 *
 * 注入此接口可在测试中捕获日志输出，或自定义日志格式。
 */
export type LogSink = (entry: LogEntry) => void;

/**
 * 默认控制台输出器
 *
 * 使用 stdout/stderr 分流 warn/error，其它级别输出到 stdout。
 */
const consoleSink: LogSink = (entry) => {
  const prefix = `[${new Date(entry.timestamp).toISOString()}] [${entry.level}]`;
  const ctx = entry.context && Object.keys(entry.context).length > 0 ? ` ${JSON.stringify(entry.context)}` : '';
  const line = `${prefix} ${entry.message}${ctx}`;
  if (entry.level === LogLevel.Error) {
    console.error(line);
  } else if (entry.level === LogLevel.Warn) {
    console.warn(line);
  } else {
    console.info(line);
  }
};

/**
 * 日志器
 *
 * - 内部用链表维护 sink 列表
 * - debug 级别受 `debug=true` 配置与 `isFeatureEnabled` 共同控制
 */
export class Logger {
  private sinks: LogSink[] = [consoleSink];
  private minLevel: number = LEVEL_VALUES[LogLevel.Info];
  private debugEnabled = false;
  private debugFeature = 'debug';

  /**
   * 设置最低日志级别
   *
   * @param level 最低级别，低于此级别的日志将被过滤
   */
  setMinLevel(level: LogLevelName): void {
    this.minLevel = LEVEL_VALUES[level];
  }

  /**
   * 启用/禁用 debug 级别
   *
   * @param enabled 是否启用
   * @param feature 调试功能名（用于 `isFeatureEnabled` 二次判断）
   */
  setDebug(enabled: boolean, feature: string = 'debug'): void {
    this.debugEnabled = enabled;
    this.debugFeature = feature;
  }

  /**
   * 添加日志输出器（不会移除默认 console 输出器）
   *
   * @param sink 输出器
   */
  addSink(sink: LogSink): void {
    this.sinks.push(sink);
  }

  /**
   * 清空所有输出器（仅用于测试）
   */
  clearSinks(): void {
    this.sinks = [];
  }

  /**
   * 输出 debug 级别日志
   *
   * 仅当 `debug=true` 且调试功能被启用时输出。
   */
  debug(message: string, context?: Record<string, unknown>): void {
    if (!this.shouldEmit(LogLevel.Debug)) return;
    this.emit(LogLevel.Debug, message, context);
  }

  /**
   * 输出 info 级别日志
   */
  info(message: string, context?: Record<string, unknown>): void {
    if (!this.shouldEmit(LogLevel.Info)) return;
    this.emit(LogLevel.Info, message, context);
  }

  /**
   * 输出 warn 级别日志
   */
  warn(message: string, context?: Record<string, unknown>): void {
    if (!this.shouldEmit(LogLevel.Warn)) return;
    this.emit(LogLevel.Warn, message, context);
  }

  /**
   * 输出 error 级别日志
   *
   * @param message 错误描述
   * @param error 可选错误对象（仅记录 message 字段，避免泄露敏感信息）
   */
  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    if (!this.shouldEmit(LogLevel.Error)) return;
    const ctx: Record<string, unknown> = { ...(context ?? {}) };
    if (error !== undefined) {
      if (error instanceof Error) {
        ctx['error'] = error.message;
        if (error.stack) ctx['stack'] = error.stack;
      } else {
        ctx['error'] = formatLogValue(error);
      }
    }
    this.emit(LogLevel.Error, message, ctx);
  }

  /**
   * 构造子日志器（自动给所有日志附加 prefix 字段）
   */
  child(prefix: string, baseContext: Record<string, unknown> = {}): Logger {
    const child = new Logger();
    child.sinks = this.sinks;
    child.minLevel = this.minLevel;
    child.debugEnabled = this.debugEnabled;
    child.debugFeature = this.debugFeature;
    const origDebug = child.debug.bind(child);
    const origInfo = child.info.bind(child);
    const origWarn = child.warn.bind(child);
    const origError = child.error.bind(child);
    child.debug = (msg, ctx) => origDebug(msg, { ...baseContext, ...(ctx ?? {}), _child: prefix });
    child.info = (msg, ctx) => origInfo(msg, { ...baseContext, ...(ctx ?? {}), _child: prefix });
    child.warn = (msg, ctx) => origWarn(msg, { ...baseContext, ...(ctx ?? {}), _child: prefix });
    child.error = (msg, err, ctx) => origError(msg, err, { ...baseContext, ...(ctx ?? {}), _child: prefix });
    return child;
  }

  private shouldEmit(level: LogLevelName): boolean {
    if (LEVEL_VALUES[level] < this.minLevel) return false;
    if (level === LogLevel.Debug) {
      if (!this.debugEnabled) return false;
      if (!isFeatureEnabled(this.debugFeature)) return false;
    }
    return true;
  }

  private emit(level: LogLevelName, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      level,
      message,
      context,
      timestamp: Date.now(),
    };
    for (const sink of this.sinks) {
      try {
        sink(entry);
      } catch {
        // sink 自身的错误不应影响主流程；保留为静默
      }
    }
  }
}

/**
 * 全局默认日志器
 *
 * 应用启动后调用 `setDebug(config.debug)` 同步配置。
 */
function formatLogValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

export const logger = new Logger();
