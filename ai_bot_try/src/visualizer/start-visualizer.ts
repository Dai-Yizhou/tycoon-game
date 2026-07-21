import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

const statsDir = path.join(__dirname, '../../output/stats');
const publicDir = path.join(__dirname, '../../public');

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

app.use(express.static(publicDir));

app.get('/api/stats', (req, res) => {
  const statsPath = path.join(statsDir, 'generation_stats.json');
  if (fs.existsSync(statsPath)) {
    const content = fs.readFileSync(statsPath, 'utf-8');
    res.json(JSON.parse(content));
  } else {
    res.json([]);
  }
});

app.get('/api/latest-stats', (req, res) => {
  const statsPath = path.join(statsDir, 'generation_stats.json');
  if (fs.existsSync(statsPath)) {
    const content = fs.readFileSync(statsPath, 'utf-8');
    const stats = JSON.parse(content);
    if (stats.length > 0) {
      res.json(stats[stats.length - 1]);
    } else {
      res.json({ message: 'No stats available' });
    }
  } else {
    res.json({ message: 'No stats available' });
  }
});

app.get('/api/ai-history', (req, res) => {
  const historyPath = path.join(statsDir, 'ai_histories.json');
  if (fs.existsSync(historyPath)) {
    const content = fs.readFileSync(historyPath, 'utf-8');
    res.json(JSON.parse(content));
  } else {
    res.json([]);
  }
});

let lastStats = [];

function watchStats() {
  const statsPath = path.join(statsDir, 'generation_stats.json');
  fs.watch(statsPath, (eventType) => {
    if (eventType === 'change') {
      try {
        const content = fs.readFileSync(statsPath, 'utf-8');
        const stats = JSON.parse(content);
        if (stats.length > lastStats.length) {
          const newStats = stats[stats.length - 1];
          io.emit('stats-update', newStats);
        }
        lastStats = stats;
      } catch (e) {
        console.error('Failed to read stats:', e);
      }
    }
  });
  
  if (fs.existsSync(statsPath)) {
    const content = fs.readFileSync(statsPath, 'utf-8');
    lastStats = JSON.parse(content);
  }
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  if (lastStats.length > 0) {
    socket.emit('stats-update', lastStats[lastStats.length - 1]);
  }
  
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

watchStats();

httpServer.listen(3001, () => {
  console.log('Visualization server running on http://localhost:3001');
});
