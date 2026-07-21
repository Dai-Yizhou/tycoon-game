import fs from 'fs';
import path from 'path';

interface GenomeRecord {
  id: number;
  gene_json: string;
  fitness: number;
  tier: number;
  generation: number;
  created_at: string;
}

interface TrainingRun {
  id: number;
  config_json: string;
  start_time: string;
  end_time?: string;
  status: string;
}

interface MatchResult {
  id: number;
  genome_id: number;
  rank: number;
  score: number;
  fitness: number;
  comeback_score: number;
  generation: number;
}

export class Database {
  private genomes: GenomeRecord[] = [];
  private trainingRuns: TrainingRun[] = [];
  private matchResults: MatchResult[] = [];
  private dataDir: string;
  private nextId = { genomes: 1, runs: 1, matches: 1 };

  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.load();
  }

  private load(): void {
    const files = ['genomes.json', 'runs.json', 'matches.json'];
    files.forEach(file => {
      const filePath = path.join(this.dataDir, file);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          if (file === 'genomes.json') this.genomes = JSON.parse(content);
          else if (file === 'runs.json') this.trainingRuns = JSON.parse(content);
          else if (file === 'matches.json') this.matchResults = JSON.parse(content);
        } catch {
          // ignore parse errors, start fresh
        }
      }
    });
    
    this.nextId.genomes = this.genomes.length > 0 
      ? Math.max(...this.genomes.map(g => g.id)) + 1 
      : 1;
    this.nextId.runs = this.trainingRuns.length > 0 
      ? Math.max(...this.trainingRuns.map(r => r.id)) + 1 
      : 1;
    this.nextId.matches = this.matchResults.length > 0 
      ? Math.max(...this.matchResults.map(m => m.id)) + 1 
      : 1;
  }

  private save(): void {
    fs.writeFileSync(path.join(this.dataDir, 'genomes.json'), JSON.stringify(this.genomes, null, 2));
    fs.writeFileSync(path.join(this.dataDir, 'runs.json'), JSON.stringify(this.trainingRuns, null, 2));
    fs.writeFileSync(path.join(this.dataDir, 'matches.json'), JSON.stringify(this.matchResults, null, 2));
  }

  saveGenome(geneJson: string, fitness: number, tier: number, generation: number): Promise<number> {
    const record: GenomeRecord = {
      id: this.nextId.genomes++,
      gene_json: geneJson,
      fitness,
      tier,
      generation,
      created_at: new Date().toISOString()
    };
    this.genomes.push(record);
    this.save();
    return Promise.resolve(record.id);
  }

  getBestGenomes(tier: number, limit: number = 10): Promise<any[]> {
    const filtered = this.genomes
      .filter(g => g.tier === tier)
      .sort((a, b) => b.fitness - a.fitness)
      .slice(0, limit);
    return Promise.resolve(filtered);
  }

  getAllGenomes(): Promise<any[]> {
    return Promise.resolve([...this.genomes]);
  }

  saveMatchResult(genomeId: number, rank: number, score: number, fitness: number, comebackScore: number, generation: number): Promise<number> {
    const record: MatchResult = {
      id: this.nextId.matches++,
      genome_id: genomeId,
      rank,
      score,
      fitness,
      comeback_score: comebackScore,
      generation
    };
    this.matchResults.push(record);
    this.save();
    return Promise.resolve(record.id);
  }

  startTrainingRun(configJson: string): Promise<number> {
    const record: TrainingRun = {
      id: this.nextId.runs++,
      config_json: configJson,
      start_time: new Date().toISOString(),
      status: 'running'
    };
    this.trainingRuns.push(record);
    this.save();
    return Promise.resolve(record.id);
  }

  endTrainingRun(runId: number): void {
    const run = this.trainingRuns.find(r => r.id === runId);
    if (run) {
      run.end_time = new Date().toISOString();
      run.status = 'completed';
      this.save();
    }
  }

  close(): void {
    this.save();
  }
}
