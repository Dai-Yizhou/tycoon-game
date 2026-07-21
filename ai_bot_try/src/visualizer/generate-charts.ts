import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const statsDir = path.join(__dirname, '../../output/stats');
const outputDir = path.join(__dirname, '../../output/charts');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const statsPath = path.join(statsDir, 'generation_stats.json');
const historyPath = path.join(statsDir, 'ai_histories.json');

if (!fs.existsSync(statsPath)) {
  console.error('No stats file found');
  process.exit(1);
}

const stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
const histories = fs.existsSync(historyPath) 
  ? JSON.parse(fs.readFileSync(historyPath, 'utf-8')) 
  : [];

function generateChartHTML(chartType: string, title: string, data: any): string {
  const colors = {
    t1: '#ef4444',
    t2: '#f59e0b',
    t3: '#22c55e'
  };
  
  let datasets = '';
  let yAxisConfig = '';
  
  if (chartType === 'fitness') {
    datasets = `
      { label: 'Tier 1 (困难)', data: [], borderColor: '${colors.t1}', backgroundColor: '${colors.t1}33', tension: 0.3, fill: true },
      { label: 'Tier 2 (普通)', data: [], borderColor: '${colors.t2}', backgroundColor: '${colors.t2}33', tension: 0.3, fill: true },
      { label: 'Tier 3 (简单)', data: [], borderColor: '${colors.t3}', backgroundColor: '${colors.t3}33', tension: 0.3, fill: true }
    `;
    yAxisConfig = '{ beginAtZero: true, max: 1.6 }';
  } else if (chartType === 'winrate') {
    datasets = `
      { label: 'Tier 1 (困难)', data: [], borderColor: '${colors.t1}', backgroundColor: '${colors.t1}33', tension: 0.3, fill: true },
      { label: 'Tier 2 (普通)', data: [], borderColor: '${colors.t2}', backgroundColor: '${colors.t2}33', tension: 0.3, fill: true },
      { label: 'Tier 3 (简单)', data: [], borderColor: '${colors.t3}', backgroundColor: '${colors.t3}33', tension: 0.3, fill: true }
    `;
    yAxisConfig = '{ beginAtZero: true, max: 1 }';
  } else if (chartType === 'comeback') {
    datasets = `
      { label: 'Tier 1 (困难)', data: [], borderColor: '${colors.t1}', backgroundColor: '${colors.t1}33', tension: 0.3, fill: true },
      { label: 'Tier 2 (普通)', data: [], borderColor: '${colors.t2}', backgroundColor: '${colors.t2}33', tension: 0.3, fill: true },
      { label: 'Tier 3 (简单)', data: [], borderColor: '${colors.t3}', backgroundColor: '${colors.t3}33', tension: 0.3, fill: true }
    `;
    yAxisConfig = '{ beginAtZero: true }';
  } else if (chartType === 'distribution') {
    datasets = `
      { label: 'Tier 1', data: [], backgroundColor: '${colors.t1}' },
      { label: 'Tier 2', data: [], backgroundColor: '${colors.t2}' },
      { label: 'Tier 3', data: [], backgroundColor: '${colors.t3}' }
    `;
    yAxisConfig = '{ beginAtZero: true }';
  }
  
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { margin: 0; padding: 20px; background: #fff; }
    canvas { max-width: 100%; }
  </style>
</head>
<body>
  <h1 style="text-align: center; font-family: Arial, sans-serif; color: #333;">${title}</h1>
  <div style="width: 1200px; margin: 0 auto;">
    <canvas id="chart"></canvas>
  </div>
  <script>
    const labels = ${JSON.stringify(data.labels)};
    const t1Data = ${JSON.stringify(data.t1)};
    const t2Data = ${JSON.stringify(data.t2)};
    const t3Data = ${JSON.stringify(data.t3)};
    
    new Chart(document.getElementById('chart'), {
      type: '${chartType === 'distribution' ? 'bar' : 'line'}',
      data: {
        labels: labels,
        datasets: [
          ${datasets}
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: 'top', labels: { font: { size: 14 } } },
          title: { display: true, text: '${title}', font: { size: 18 } }
        },
        scales: {
          y: ${yAxisConfig},
          x: { title: { display: true, text: '世代' } }
        }
      }
    });
    
    document.querySelectorAll('canvas')[0].parentElement.style.height = '600px';
  </script>
</body>
</html>
  `.trim();
}

const labels = stats.map((s: any) => s.generation);

const fitnessData = {
  labels,
  t1: stats.map((s: any) => s.tierStats.find((t: any) => t.tier === 1)?.avgFitness || 0),
  t2: stats.map((s: any) => s.tierStats.find((t: any) => t.tier === 2)?.avgFitness || 0),
  t3: stats.map((s: any) => s.tierStats.find((t: any) => t.tier === 3)?.avgFitness || 0)
};

const winRateData = {
  labels,
  t1: stats.map((s: any) => s.tierStats.find((t: any) => t.tier === 1)?.winRate || 0),
  t2: stats.map((s: any) => s.tierStats.find((t: any) => t.tier === 2)?.winRate || 0),
  t3: stats.map((s: any) => s.tierStats.find((t: any) => t.tier === 3)?.winRate || 0)
};

const comebackData = {
  labels,
  t1: stats.map((s: any) => s.tierStats.find((t: any) => t.tier === 1)?.avgComebackScore || 0),
  t2: stats.map((s: any) => s.tierStats.find((t: any) => t.tier === 2)?.avgComebackScore || 0),
  t3: stats.map((s: any) => s.tierStats.find((t: any) => t.tier === 3)?.avgComebackScore || 0)
};

const distributionData = {
  labels: labels.slice(-20),
  t1: stats.slice(-20).map((s: any) => s.tierStats.find((t: any) => t.tier === 1)?.count || 0),
  t2: stats.slice(-20).map((s: any) => s.tierStats.find((t: any) => t.tier === 2)?.count || 0),
  t3: stats.slice(-20).map((s: any) => s.tierStats.find((t: any) => t.tier === 3)?.count || 0)
};

fs.writeFileSync(path.join(outputDir, 'fitness_chart.html'), generateChartHTML('fitness', '各层级平均适应度曲线', fitnessData));
fs.writeFileSync(path.join(outputDir, 'winrate_chart.html'), generateChartHTML('winrate', '各层级胜率曲线', winRateData));
fs.writeFileSync(path.join(outputDir, 'comeback_chart.html'), generateChartHTML('comeback', '各层级翻盘指数', comebackData));
fs.writeFileSync(path.join(outputDir, 'distribution_chart.html'), generateChartHTML('distribution', '层级分布变化', distributionData));

console.log('✓ 图表HTML文件已生成');
console.log(`  - ${outputDir}/fitness_chart.html`);
console.log(`  - ${outputDir}/winrate_chart.html`);
console.log(`  - ${outputDir}/comeback_chart.html`);
console.log(`  - ${outputDir}/distribution_chart.html`);

function generateAIReport(histories: any[]): string {
  const topAIs = histories
    .filter((h: any) => h.records.length > 0)
    .sort((a: any, b: any) => {
      const lastA = a.records[a.records.length - 1];
      const lastB = b.records[b.records.length - 1];
      return lastB.fitness - lastA.fitness;
    })
    .slice(0, 10);
  
  let html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI 排行榜报告</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { text-align: center; color: #333; }
    .ai-card { background: white; padding: 20px; margin: 15px 0; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
    .ai-header { display: flex; justify-content: space-between; align-items: center; }
    .rank-badge { font-size: 24px; font-weight: bold; color: white; padding: 5px 15px; border-radius: 5px; }
    .rank-1 { background: #ef4444; }
    .rank-2 { background: #f59e0b; }
    .rank-3 { background: #22c55e; }
    .rank-other { background: #6b7280; }
    .tier-badge { padding: 3px 10px; border-radius: 3px; font-size: 12px; }
    .tier-1 { background: #fee2e2; color: #dc2626; }
    .tier-2 { background: #fef3c7; color: #d97706; }
    .tier-3 { background: #dcfce7; color: #16a34a; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-top: 15px; }
    .stat-item { text-align: center; padding: 10px; background: #f9fafb; border-radius: 5px; }
    .stat-label { font-size: 12px; color: #6b7280; }
    .stat-value { font-size: 18px; font-weight: bold; color: #1f2937; }
    .history-chart { height: 200px; margin-top: 15px; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <div class="container">
    <h1>🏆 AI 排行榜报告</h1>
    <p style="text-align: center; color: #666;">共 ${histories.length} 个AI个体，展示前10名</p>
  `;
  
  topAIs.forEach((ai: any, index: number) => {
    const latest = ai.records[ai.records.length - 1];
    const fitnessHistory = ai.records.map((r: any) => r.fitness);
    const genLabels = ai.records.map((r: any) => r.generation);
    const rankClass = index < 3 ? `rank-${index + 1}` : 'rank-other';
    
    html += `
    <div class="ai-card">
      <div class="ai-header">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div class="rank-badge ${rankClass}">${index + 1}</div>
          <div>
            <h3>AI #${ai.genomeId.slice(0, 8)}</h3>
            <span class="tier-badge tier-${latest.tier}">Tier ${latest.tier}</span>
          </div>
        </div>
        <div style="text-align: right;">
          <div>当前适应度: <strong>${latest.fitness.toFixed(4)}</strong></div>
          <div>当前排名: #${latest.rank}</div>
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-label">总世代数</div>
          <div class="stat-value">${ai.records.length}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">平均胜率</div>
          <div class="stat-value">${(ai.records.reduce((sum: number, r: any) => sum + r.winRate, 0) / ai.records.length * 100).toFixed(1)}%</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">翻盘指数</div>
          <div class="stat-value">${latest.comebackScore.toFixed(3)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">适应度提升</div>
          <div class="stat-value">${(latest.fitness - ai.records[0].fitness).toFixed(4)}</div>
        </div>
      </div>
      <div class="history-chart">
        <canvas id="chart-${index}"></canvas>
      </div>
      <script>
        new Chart(document.getElementById('chart-${index}'), {
          type: 'line',
          data: {
            labels: ${JSON.stringify(genLabels)},
            datasets: [{
              label: '适应度',
              data: ${JSON.stringify(fitnessHistory)},
              borderColor: '#3b82f6',
              backgroundColor: '#3b82f633',
              tension: 0.3,
              fill: true
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              y: { beginAtZero: true, max: 1.6 },
              x: { title: { display: true, text: '世代' } }
            }
          }
        });
      <\/script>
    </div>
    `;
  });
  
  html += `
  </div>
</body>
</html>
  `.trim();
  
  return html;
}

fs.writeFileSync(path.join(outputDir, 'ai_ranking_report.html'), generateAIReport(histories));
console.log(`✓ AI排行榜报告已生成: ${outputDir}/ai_ranking_report.html`);

function generateTrainingSummary(stats: any[]): string {
  const latest = stats[stats.length - 1];
  const overallStats = {
    totalGenerations: stats.length,
    avgFitness: stats.reduce((sum, s) => {
      const t1 = s.tierStats.find((t: any) => t.tier === 1)?.avgFitness || 0;
      const t2 = s.tierStats.find((t: any) => t.tier === 2)?.avgFitness || 0;
      const t3 = s.tierStats.find((t: any) => t.tier === 3)?.avgFitness || 0;
      return sum + (t1 + t2 + t3) / 3;
    }, 0) / stats.length
  };
  
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>训练总结报告</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #1a1a2e; color: white; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { text-align: center; color: #4ade80; }
    .summary-card { background: #16213e; padding: 25px; margin: 20px 0; border-radius: 15px; }
    .metric { text-align: center; padding: 20px; }
    .metric-value { font-size: 48px; font-weight: bold; color: #4ade80; }
    .metric-label { font-size: 16px; color: #9ca3af; }
    .tier-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 20px; }
    .tier-box { background: #0f3460; padding: 20px; border-radius: 10px; text-align: center; }
    .tier-1 { border-left: 5px solid #ef4444; }
    .tier-2 { border-left: 5px solid #f59e0b; }
    .tier-3 { border-left: 5px solid #22c55e; }
    .tier-title { font-size: 18px; font-weight: bold; }
    .tier-fitness { font-size: 28px; color: #4ade80; }
    .chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
    .chart-box { background: #16213e; padding: 20px; border-radius: 10px; }
    .chart-box canvas { width: 100% !important; height: 300px !important; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <div class="container">
    <h1>📊 训练总结报告</h1>
    <p style="text-align: center; color: #9ca3af;">生成时间: ${new Date().toLocaleString('zh-CN')}</p>
    
    <div class="summary-card">
      <div class="metric">
        <div class="metric-value">${overallStats.totalGenerations}</div>
        <div class="metric-label">总训练世代</div>
      </div>
    </div>
    
    <div class="summary-card">
      <h2 style="text-align: center; margin-bottom: 20px;">各层级最终状态</h2>
      <div class="tier-summary">
        <div class="tier-box tier-1">
          <div class="tier-title">Tier 1 (困难)</div>
          <div class="tier-fitness">${(latest.tierStats.find((t: any) => t.tier === 1)?.avgFitness || 0).toFixed(4)}</div>
          <div style="color: #9ca3af; font-size: 12px;">平均适应度</div>
          <div style="color: #4ade80; margin-top: 10px;">胜率: ${((latest.tierStats.find((t: any) => t.tier === 1)?.winRate || 0) * 100).toFixed(1)}%</div>
        </div>
        <div class="tier-box tier-2">
          <div class="tier-title">Tier 2 (普通)</div>
          <div class="tier-fitness">${(latest.tierStats.find((t: any) => t.tier === 2)?.avgFitness || 0).toFixed(4)}</div>
          <div style="color: #9ca3af; font-size: 12px;">平均适应度</div>
          <div style="color: #4ade80; margin-top: 10px;">胜率: ${((latest.tierStats.find((t: any) => t.tier === 2)?.winRate || 0) * 100).toFixed(1)}%</div>
        </div>
        <div class="tier-box tier-3">
          <div class="tier-title">Tier 3 (简单)</div>
          <div class="tier-fitness">${(latest.tierStats.find((t: any) => t.tier === 3)?.avgFitness || 0).toFixed(4)}</div>
          <div style="color: #9ca3af; font-size: 12px;">平均适应度</div>
          <div style="color: #4ade80; margin-top: 10px;">胜率: ${((latest.tierStats.find((t: any) => t.tier === 3)?.winRate || 0) * 100).toFixed(1)}%</div>
        </div>
      </div>
    </div>
    
    <div class="summary-card">
      <h2 style="text-align: center; margin-bottom: 20px;">适应度趋势</h2>
      <canvas id="summaryChart"></canvas>
    </div>
  </div>
  
  <script>
    new Chart(document.getElementById('summaryChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(stats.map((s: any) => s.generation))},
        datasets: [
          { label: 'Tier 1', data: ${JSON.stringify(stats.map((s: any) => s.tierStats.find((t: any) => t.tier === 1)?.avgFitness || 0))}, borderColor: '#ef4444', tension: 0.3, fill: true, backgroundColor: '#ef444433' },
          { label: 'Tier 2', data: ${JSON.stringify(stats.map((s: any) => s.tierStats.find((t: any) => t.tier === 2)?.avgFitness || 0))}, borderColor: '#f59e0b', tension: 0.3, fill: true, backgroundColor: '#f59e0b33' },
          { label: 'Tier 3', data: ${JSON.stringify(stats.map((s: any) => s.tierStats.find((t: any) => t.tier === 3)?.avgFitness || 0))}, borderColor: '#22c55e', tension: 0.3, fill: true, backgroundColor: '#22c55e33' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: true, max: 1.6 }, x: { title: { display: true, text: '世代' } } }
      }
    });
  <\/script>
</body>
</html>
  `.trim();
}

fs.writeFileSync(path.join(outputDir, 'training_summary.html'), generateTrainingSummary(stats));
console.log(`✓ 训练总结报告已生成: ${outputDir}/training_summary.html`);

console.log('\n📁 所有报告已保存到:', outputDir);
