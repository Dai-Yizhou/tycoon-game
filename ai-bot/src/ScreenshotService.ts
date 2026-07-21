import puppeteer, { Browser, Page } from 'puppeteer-core';
import { Logger } from './Logger.js';
import * as fs from 'fs';
import * as path from 'path';

export interface ScreenshotInfo {
  filename: string;
  timestamp: number;
  size: number;
}

export class ScreenshotService {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private timer: NodeJS.Timeout | null = null;
  private interval: number;
  private url: string;
  private screenshotDir: string;
  private maxScreenshots: number;
  private logger: Logger;
  private connected = false;

  constructor(options: {
    url: string;
    screenshotDir: string;
    interval?: number;
    maxScreenshots?: number;
  }) {
    this.url = options.url;
    this.screenshotDir = options.screenshotDir;
    this.interval = options.interval ?? 10000;
    this.maxScreenshots = options.maxScreenshots ?? 100;
    this.logger = new Logger('ScreenshotService', '/private/tmp/ai-bot-logs');

    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true });
    }
  }

  async start(): Promise<void> {
    try {
      const wsEndpoint = process.env.PUPPETEER_WS_ENDPOINT;
      
      if (wsEndpoint) {
        this.browser = await puppeteer.connect({
          browserWSEndpoint: wsEndpoint,
        });
        this.logger.info(`截图服务已连接到远程浏览器: ${wsEndpoint}`);
      } else {
        const chromePaths = [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          '/usr/bin/google-chrome',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
        ];

        let execPath: string | null = null;
        for (const p of chromePaths) {
          try {
            if (fs.existsSync(p)) {
              execPath = p;
              break;
            }
          } catch {}
        }

        if (!execPath) {
          throw new Error('未找到浏览器可执行文件，请设置 PUPPETEER_WS_ENDPOINT 环境变量或确保 Chrome/Chromium 已安装');
        }

        this.browser = await puppeteer.launch({
          executablePath: execPath,
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--window-size=1920,1080'],
        });
        this.logger.info(`截图服务已启动，浏览器: ${execPath}`);
      }

      this.page = await this.browser.newPage();
      await this.page.setViewport({ width: 1920, height: 1080 });
      await this.page.goto(this.url, { waitUntil: 'networkidle2', timeout: 30000 });
      this.connected = true;
      this.logger.info(`截图服务已连接到页面: ${this.url}`);

      this.timer = setInterval(() => this.capture(), this.interval);

      await this.capture();
    } catch (err) {
      this.logger.warning('截图服务启动失败', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
      this.browser = null;
    }
    this.connected = false;
    this.logger.info('截图服务已停止');
  }

  async capture(): Promise<string> {
    if (!this.page || !this.connected) {
      throw new Error('截图服务未启动');
    }

    try {
      const now = new Date();
      const timestamp = now.toISOString().replace(/[-:.]/g, '').slice(0, 15);
      const filename = `screenshot_${timestamp}.png`;
      const filePath = path.join(this.screenshotDir, filename);

      await this.page.screenshot({
        path: filePath,
        type: 'png',
        fullPage: false,
      });

      const stats = fs.statSync(filePath);
      this.logger.info(`截图已保存: ${filename}, 大小: ${stats.size} bytes`);

      this.cleanup();

      return filePath;
    } catch (err) {
      this.logger.warning('截图失败', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  private cleanup(): void {
    try {
      const files = fs.readdirSync(this.screenshotDir)
        .filter(f => f.startsWith('screenshot_') && f.endsWith('.png'))
        .map(f => {
          const fullPath = path.join(this.screenshotDir, f);
          const stats = fs.statSync(fullPath);
          return { filename: f, timestamp: stats.mtime.getTime(), path: fullPath };
        })
        .sort((a, b) => a.timestamp - b.timestamp);

      while (files.length > this.maxScreenshots) {
        const oldest = files.shift();
        if (oldest) {
          fs.unlinkSync(oldest.path);
          this.logger.info(`已删除旧截图: ${oldest.filename}`);
        }
      }
    } catch (err) {
      this.logger.warning('清理旧截图失败', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  getScreenshots(): ScreenshotInfo[] {
    try {
      const files = fs.readdirSync(this.screenshotDir)
        .filter(f => f.startsWith('screenshot_') && f.endsWith('.png'))
        .map(f => {
          const fullPath = path.join(this.screenshotDir, f);
          const stats = fs.statSync(fullPath);
          const match = f.match(/screenshot_(\d{8})_(\d{6})\.png/);
          let timestamp = stats.mtime.getTime();
          if (match) {
            const dateStr = `${match[1]}T${match[2]}`;
            const parsed = new Date(dateStr.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6'));
            if (!isNaN(parsed.getTime())) {
              timestamp = parsed.getTime();
            }
          }
          return { filename: f, timestamp, size: stats.size };
        })
        .sort((a, b) => b.timestamp - a.timestamp);

      return files;
    } catch {
      return [];
    }
  }

  getLatestScreenshot(): string | null {
    const screenshots = this.getScreenshots();
    if (screenshots.length === 0) return null;
    return path.join(this.screenshotDir, screenshots[0].filename);
  }
}