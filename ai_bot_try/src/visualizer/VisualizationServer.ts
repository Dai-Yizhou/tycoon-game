import express from 'express';
import * as http from 'http';
import { Server } from 'socket.io';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TrainingStatsCollector } from './TrainingStatsCollector';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class VisualizationServer {
  private app: express.Application;
  private httpServer: http.Server;
  private io: Server;
  private port: number;
  private statsCollector: TrainingStatsCollector;
  
  constructor(port: number = 3001, statsCollector: TrainingStatsCollector) {
    this.port = port;
    this.statsCollector = statsCollector;
    this.app = express();
    this.httpServer = http.createServer(this.app);
    this.io = new Server(this.httpServer, {
      cors: { origin: '*' }
    });
    
    this.setupRoutes();
    this.setupSocketHandlers();
  }
  
  private setupRoutes(): void {
    const publicDir = path.join(__dirname, '../../public');
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    
    this.app.use(express.static(publicDir));
    
    this.app.get('/api/stats', (req, res) => {
      res.json(this.statsCollector.getStats());
    });
    
    this.app.get('/api/ai-history/:genomeId', (req, res) => {
      const history = this.statsCollector.getAIHistory(req.params.genomeId);
      if (history) {
        res.json(history);
      } else {
        res.status(404).json({ error: 'AI not found' });
      }
    });
    
    this.app.get('/api/latest-stats', (req, res) => {
      const stats = this.statsCollector.getStats();
      if (stats.length > 0) {
        res.json(stats[stats.length - 1]);
      } else {
        res.json({ message: 'No stats available' });
      }
    });
  }
  
  private setupSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`);
      
      const latestStats = this.statsCollector.getStats();
      if (latestStats.length > 0) {
        socket.emit('statsUpdate', latestStats[latestStats.length - 1]);
      }
      
      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
      });
    });
  }
  
  broadcastStatsUpdate(stats: any): void {
    this.io.emit('statsUpdate', stats);
  }
  
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer.listen(this.port, () => {
        console.log(`Visualization server running on http://localhost:${this.port}`);
        resolve();
      }).on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`Port ${this.port} is already in use, skipping visualization server...`);
          resolve();
        } else {
          reject(err);
        }
      });
    });
  }
  
  stop(): void {
    this.httpServer.close();
  }
}
