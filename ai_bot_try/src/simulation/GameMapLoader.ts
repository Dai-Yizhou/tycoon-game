import * as fs from 'fs';
import * as path from 'path';

export interface MapCell {
  id: number;
  x: number;
  y: number;
  destinations: number[];
  name: string;
  type: 'start' | 'property' | 'event' | 'transport' | 'investment' | 'monument' | 'jail';
  price: number;
  rent: number[];
  description: string[];
  extra: string[];
  behavior: string;
  icon: string;
  level: number;
  upgradeCost: number[];
  owners: string[];
  isMortgaged: number;
  mortgagePrice: number;
}

export interface MapMeta {
  id: string;
  name: string;
  version: string;
  templateName: string;
  startCellId: number;
  dayNightCycleMinutes: number;
  timezones: {
    id: string;
    name: string;
    offsetMinutes: number;
    parentId?: string;
    cellIds: number[];
  }[];
  regions: {
    id: string;
    name: string;
    cellIds: number[];
    prosperity: number;
    environmentValue: number;
    color: string;
  }[];
  valueFieldDefinitions: {
    id: string;
    name: string;
    current: number;
    min: number;
    max?: number;
    scope: 'player' | 'region';
  }[];
  config: {
    era: string;
    startBonus: number;
    passBonus: number;
    taxRate: {
      property: number;
      money: number;
      investment: number;
    };
    diceCooldownSeconds: number;
    jailCooldownSeconds: number;
    jailDurationTurns: number;
  };
}

export interface CellState {
  id: string;
  type: 'property' | 'investment' | 'bank' | 'event' | 'start' | 'jail' | 'transport' | 'monument';
  owner: string | null;
  level: number;
  price: number;
  upgradeCost: number;
  rent: number[];
  mortgagePrice: number;
  isMortgaged: boolean;
}

export class GameMapLoader {
  private static mapCache: MapCell[] | null = null;
  private static metaCache: MapMeta | null = null;

  static loadMap(): MapCell[] {
    if (this.mapCache) {
      return this.mapCache;
    }

    const mapPath = path.join(__dirname, '../../../packages/server/map.json');
    
    try {
      const data = fs.readFileSync(mapPath, 'utf-8');
      this.mapCache = JSON.parse(data);
      console.log(`[GameMapLoader] 成功加载地图: ${this.mapCache.length} 个格子`);
      return this.mapCache;
    } catch (err) {
      console.warn(`[GameMapLoader] 无法加载地图文件: ${mapPath}`);
      console.warn('[GameMapLoader] 使用默认生成的地图');
      return this.generateDefaultMap();
    }
  }

  static loadMeta(): MapMeta {
    if (this.metaCache) {
      return this.metaCache;
    }

    const metaPath = path.join(__dirname, '../../../packages/server/map-meta.json');
    
    try {
      const data = fs.readFileSync(metaPath, 'utf-8');
      this.metaCache = JSON.parse(data);
      console.log(`[GameMapLoader] 成功加载地图元数据: ${this.metaCache.id}`);
      return this.metaCache;
    } catch (err) {
      console.warn(`[GameMapLoader] 无法加载元数据文件: ${metaPath}`);
      return this.generateDefaultMeta();
    }
  }

  static convertToCellStates(mapCells: MapCell[]): CellState[] {
    return mapCells.map(cell => ({
      id: `cell-${cell.id}`,
      type: this.convertCellType(cell.type),
      owner: null,
      level: cell.level,
      price: cell.price,
      upgradeCost: cell.upgradeCost[0] || 0,
      rent: cell.rent,
      mortgagePrice: cell.mortgagePrice,
      isMortgaged: cell.isMortgaged === 1
    }));
  }

  private static convertCellType(type: string): CellState['type'] {
    const typeMap: Record<string, CellState['type']> = {
      'start': 'start',
      'property': 'property',
      'event': 'event',
      'transport': 'transport',
      'investment': 'investment',
      'monument': 'monument',
      'jail': 'jail'
    };
    return typeMap[type] || 'property';
  }

  private static generateDefaultMap(): MapCell[] {
    const cells: MapCell[] = [];
    
    cells.push({
      id: 0, x: 600, y: 500, destinations: [1], name: '起点', type: 'start',
      price: 0, rent: [], description: ['游戏起点', '经过可得200元'],
      extra: [], behavior: '', icon: '🚩', level: 0, upgradeCost: [],
      owners: [], isMortgaged: 0, mortgagePrice: 0
    });

    const properties = [
      { name: '樱花大道', price: 120, rent: [8, 40, 120, 280, 450], upgradeCost: [50, 100, 150, 200] },
      { name: '科技大厦', price: 200, rent: [16, 80, 200, 450, 700], upgradeCost: [100, 150, 200, 300] },
      { name: '翡翠公园', price: 280, rent: [24, 120, 300, 650, 1000], upgradeCost: [120, 180, 240, 350] },
      { name: '水晶港湾', price: 350, rent: [35, 175, 420, 900, 1400], upgradeCost: [150, 220, 300, 400] },
      { name: '云端花园', price: 400, rent: [45, 220, 550, 1200, 1800], upgradeCost: [180, 250, 350, 500] },
      { name: '黄金海岸', price: 450, rent: [55, 275, 680, 1500, 2200], upgradeCost: [200, 300, 400, 550] },
      { name: '美食街', price: 180, rent: [12, 60, 180, 400, 600], upgradeCost: [80, 120, 180, 250] },
      { name: '星光广场', price: 300, rent: [30, 150, 380, 850, 1300], upgradeCost: [130, 190, 260, 380] },
      { name: '大学城', price: 250, rent: [20, 100, 250, 550, 850], upgradeCost: [110, 160, 220, 300] },
      { name: '艺术区', price: 220, rent: [18, 90, 220, 500, 750], upgradeCost: [90, 140, 200, 280] },
      { name: '体育馆', price: 260, rent: [22, 110, 280, 620, 950], upgradeCost: [120, 170, 230, 320] },
      { name: '动物园', price: 160, rent: [10, 50, 150, 350, 520], upgradeCost: [70, 110, 160, 220] },
      { name: '图书馆', price: 150, rent: [9, 45, 140, 320, 480], upgradeCost: [60, 100, 150, 210] },
      { name: '医院', price: 190, rent: [14, 70, 190, 420, 650], upgradeCost: [85, 130, 180, 260] },
      { name: '游乐园', price: 210, rent: [16, 80, 210, 480, 720], upgradeCost: [90, 140, 190, 270] },
      { name: '电影院', price: 170, rent: [12, 60, 160, 380, 580], upgradeCost: [75, 115, 165, 240] },
      { name: '天文台', price: 320, rent: [28, 140, 350, 780, 1200], upgradeCost: [140, 200, 280, 400] },
      { name: '海底世界', price: 380, rent: [38, 190, 480, 1050, 1600], upgradeCost: [170, 240, 330, 450] },
      { name: '豪华酒店', price: 480, rent: [60, 300, 750, 1650, 2500], upgradeCost: [220, 320, 420, 600] },
      { name: '政府大楼', price: 300, rent: [25, 125, 320, 720, 1100], upgradeCost: [130, 190, 260, 380] },
      { name: '公园', price: 140, rent: [7, 35, 110, 260, 400], upgradeCost: [60, 90, 130, 180] },
      { name: '自由港', price: 360, rent: [32, 160, 400, 900, 1400], upgradeCost: [160, 230, 310, 440] }
    ];

    let id = 1;
    for (let i = 0; i < properties.length; i++) {
      const prop = properties[i];
      cells.push({
        id, x: 0, y: 0, destinations: [id - 1, id + 1], name: prop.name, type: 'property',
        price: prop.price, rent: prop.rent, description: ['地产'],
        extra: [], behavior: '', icon: '🏠', level: 0, upgradeCost: prop.upgradeCost,
        owners: [], isMortgaged: 0, mortgagePrice: Math.floor(prop.price / 2)
      });
      id++;
    }

    cells.push({
      id, x: 0, y: 0, destinations: [id - 1, id + 1], name: '投资中心', type: 'investment',
      price: 350, rent: [], description: ['金融投资'],
      extra: [], behavior: '', icon: '💎', level: 0, upgradeCost: [],
      owners: [], isMortgaged: 0, mortgagePrice: 175
    });
    id++;

    cells.push({
      id, x: 0, y: 0, destinations: [id - 1, id + 1], name: '事件', type: 'event',
      price: 0, rent: [], description: ['随机事件'],
      extra: [], behavior: '', icon: '❓', level: 0, upgradeCost: [],
      owners: [], isMortgaged: 0, mortgagePrice: 0
    });
    id++;

    cells.push({
      id, x: 0, y: 0, destinations: [id - 1, 0], name: '监狱', type: 'jail',
      price: 0, rent: [], description: ['违反规则会被关进来'],
      extra: [], behavior: '', icon: '🔒', level: 0, upgradeCost: [],
      owners: [], isMortgaged: 0, mortgagePrice: 0
    });

    return cells;
  }

  private static generateDefaultMeta(): MapMeta {
    return {
      id: 'default-map',
      name: '默认地图',
      version: '1.0.0',
      templateName: 'default',
      startCellId: 0,
      dayNightCycleMinutes: 15,
      timezones: [],
      regions: [],
      valueFieldDefinitions: [
        { id: 'money', name: '财产', current: 2000, min: 0, scope: 'player' },
        { id: 'credit', name: '信用值', current: 0, min: 0, scope: 'player' }
      ],
      config: {
        era: '古典时代',
        startBonus: 2000,
        passBonus: 200,
        taxRate: { property: 0.01, money: 0.02, investment: 0.015 },
        diceCooldownSeconds: 5,
        jailCooldownSeconds: 10,
        jailDurationTurns: 3
      }
    };
  }
}