/**
 * 地图加载器
 *
 * 管理地图数据的加载、标准化和回退逻辑。
 */

import type { MapData } from '@game/shared';
import { loadMapFromObject } from '@game/shared/map/browser-loader';
import type { RegionInfo, ValueFieldDef } from '../../state/GameStore.js';
import type { GameStore } from '../../state/GameStore.js';
import type { MapIndex } from '@game/shared';
import { getExtra } from '@game/shared';

const MAP_SCALE = 3.0;

export function getTimezoneByX(x: number): string {
  const scaledX = x * MAP_SCALE;
  if (scaledX < 1100) return 'UTC-8';
  if (scaledX < 1800) return 'UTC-4';
  if (scaledX < 2500) return 'UTC+0';
  return 'UTC+4';
}

export function normalizeClientMapData(data: unknown[]): MapData {
  return data.map((raw) => {
    const cell = raw as Record<string, unknown>;
    const id = cell['id'] as number;
    const origX = cell['x'] as number;
    const origY = cell['y'] as number;
    const x = origX * MAP_SCALE;
    const y = origY * MAP_SCALE;
    const destinations = (cell['destinations'] as number[]) ?? [];
    const timezone = getTimezoneByX(origX);
    const existingExtra = cell['extra'];
    if (existingExtra && typeof existingExtra === 'object' && !Array.isArray(existingExtra)) {
      return { id, x, y, destinations, extra: { ...(existingExtra as Record<string, unknown>), timezone } };
    }
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(cell)) {
      if (!['id', 'x', 'y', 'destinations'].includes(key)) {
        extra[key] = value;
      }
    }
    extra['timezone'] = timezone;
    return { id, x, y, destinations, extra };
  });
}

export async function loadMapData(): Promise<{
  mapData: MapData;
  regions: RegionInfo[];
  valueFields: ValueFieldDef[];
} | null> {
  try {
    const response = await fetch('/api/map');
    if (response.ok) {
      const data = await response.json();
      const mapData = normalizeClientMapData(loadMapFromObject(data.mapData));
      const regions: RegionInfo[] = (data.regions || []).map((r: Record<string, unknown>) => ({
        id: String(r['id'] || ''),
        name: String(r['name'] || ''),
        cellIds: Array.isArray(r['cellIds']) ? r['cellIds'] as number[] : [],
        prosperity: typeof r['prosperity'] === 'number' ? r['prosperity'] : 100,
        ...(typeof r['environmentValue'] === 'number' ? { environmentValue: r['environmentValue'] } : {}),
      }));
      const valueFields: ValueFieldDef[] = (data.valueFieldDefinitions || []).map((f: Record<string, unknown>) => ({
        id: String(f['id'] || ''),
        name: String(f['name'] || ''),
        scope: (f['scope'] === 'region' ? 'region' : 'player') as 'player' | 'region',
        ...(typeof f['min'] === 'number' ? { min: f['min'] } : {}),
        ...(typeof f['max'] === 'number' ? { max: f['max'] } : {}),
      }));
      return { mapData, regions, valueFields };
    }
  } catch {
    console.warn('[MapLoader] 使用本地地图数据');
  }
  return { mapData: normalizeClientMapData(getFallbackMapData()), regions: [], valueFields: [] };
}

function getFallbackMapData(): unknown[] {
  return [
    { id: 0, x: 600, y: 500, destinations: [1, 39], name: '起点', type: 'start', price: 0, rent: [], description: ['游戏起点', '经过可得200元'], extra: [], behavior: '', icon: '🚩', level: 0, upgradeCost: [], owners: [] },
    { id: 1, x: 750, y: 480, destinations: [0, 2], name: '樱花大道', type: 'property', price: 120, rent: [8, 40, 120, 280, 450], description: ['浪漫商业街'], extra: [], behavior: '', icon: '🌸', level: 0, upgradeCost: [50, 100, 150, 200], owners: [] },
    { id: 2, x: 880, y: 420, destinations: [1, 3], name: '市中心事件', type: 'event', price: 0, rent: [], description: ['繁华市中心的随机事件'], extra: [], behavior: 'event_city_center', icon: '❓', level: 0, upgradeCost: [], owners: [] },
    { id: 3, x: 980, y: 330, destinations: [2, 4], name: '科技大厦', type: 'property', price: 200, rent: [16, 80, 200, 450, 700], description: ['高科技办公楼'], extra: [], behavior: '', icon: '🏢', level: 0, upgradeCost: [100, 150, 200, 300], owners: [] },
    { id: 4, x: 1020, y: 220, destinations: [3, 5], name: '交通枢纽', type: 'transport', price: 0, rent: [], description: ['快速传送点', '付费传送到其他枢纽'], extra: [], behavior: '', icon: '🚇', level: 0, upgradeCost: [], owners: [], transportCost: 50 },
    { id: 5, x: 980, y: 110, destinations: [4, 6], name: '翡翠公园', type: 'property', price: 280, rent: [24, 120, 300, 650, 1000], description: ['绿色生态住宅区'], extra: ['环保+5'], behavior: '', icon: '🌳', level: 0, upgradeCost: [120, 180, 240, 350], owners: [] },
    { id: 6, x: 880, y: 20, destinations: [5, 7], name: '投资中心', type: 'investment', price: 350, rent: [], description: ['金融投资项目', '可合租'], extra: [], behavior: '', icon: '💎', level: 0, upgradeCost: [], owners: [], investmentReturn: 50 },
    { id: 7, x: 750, y: -40, destinations: [6, 8], name: '水晶港湾', type: 'property', price: 350, rent: [35, 175, 420, 900, 1400], description: ['海景豪宅区'], extra: [], behavior: '', icon: '🌊', level: 0, upgradeCost: [150, 220, 300, 400], owners: [] },
    { id: 8, x: 600, y: -60, destinations: [7, 9], name: '纪念碑', type: 'monument', price: 0, rent: [], description: ['时代纪念碑', '修缮增加信用值'], extra: [], behavior: '', icon: '🗿', level: 0, upgradeCost: [], owners: [], monumentCost: 200 },
    { id: 9, x: 450, y: -40, destinations: [8, 10], name: '云端花园', type: 'property', price: 400, rent: [45, 220, 550, 1200, 1800], description: ['空中花园别墅'], extra: [], behavior: '', icon: '🌺', level: 0, upgradeCost: [180, 250, 350, 500], owners: [] },
    { id: 10, x: 320, y: 20, destinations: [9, 11], name: '住宅区事件', type: 'event', price: 0, rent: [], description: ['宁静住宅区的随机事件'], extra: [], behavior: 'event_residential', icon: '❓', level: 0, upgradeCost: [], owners: [] },
    { id: 11, x: 220, y: 110, destinations: [10, 12], name: '黄金海岸', type: 'property', price: 450, rent: [55, 275, 680, 1500, 2200], description: ['黄金地段'], extra: [], behavior: '', icon: '🏖️', level: 0, upgradeCost: [200, 300, 400, 550], owners: [] },
    { id: 12, x: 180, y: 220, destinations: [11, 13], name: '投资银行', type: 'investment', price: 400, rent: [], description: ['顶级金融机构', '可合租'], extra: [], behavior: '', icon: '🏦', level: 0, upgradeCost: [], owners: [], investmentReturn: 60 },
    { id: 13, x: 220, y: 330, destinations: [12, 14], name: '监狱', type: 'jail', price: 0, rent: [], description: ['违反规则会被关进来', '掷骰冷却大幅延长'], extra: [], behavior: '', icon: '🔒', level: 0, upgradeCost: [], owners: [] },
    { id: 14, x: 320, y: 420, destinations: [13, 15], name: '美食街', type: 'property', price: 180, rent: [12, 60, 180, 400, 600], description: ['世界各地美食'], extra: [], behavior: '', icon: '🍜', level: 0, upgradeCost: [80, 120, 180, 250], owners: [] },
    { id: 15, x: 450, y: 480, destinations: [14, 16], name: '交通中心', type: 'transport', price: 0, rent: [], description: ['城市公交枢纽'], extra: [], behavior: '', icon: '🚌', level: 0, upgradeCost: [], owners: [], transportCost: 30 },
    { id: 16, x: 600, y: 380, destinations: [15, 17], name: '星光广场', type: 'property', price: 300, rent: [30, 150, 380, 850, 1300], description: ['娱乐购物中心'], extra: [], behavior: '', icon: '⭐', level: 0, upgradeCost: [130, 190, 260, 380], owners: [] },
    { id: 17, x: 600, y: 260, destinations: [16, 18], name: '商业区事件', type: 'event', price: 0, rent: [], description: ['商业中心的随机事件'], extra: [], behavior: 'event_commercial', icon: '❓', level: 0, upgradeCost: [], owners: [] },
    { id: 18, x: 500, y: 180, destinations: [17, 19], name: '大学城', type: 'property', price: 250, rent: [20, 100, 250, 550, 850], description: ['知识的殿堂'], extra: [], behavior: '', icon: '🎓', level: 0, upgradeCost: [110, 160, 220, 300], owners: [] },
    { id: 19, x: 380, y: 150, destinations: [18, 20], name: '艺术区', type: 'property', price: 220, rent: [18, 90, 220, 500, 750], description: ['创意与灵感'], extra: [], behavior: '', icon: '🎨', level: 0, upgradeCost: [90, 140, 200, 280], owners: [] },
    { id: 20, x: 280, y: 180, destinations: [19, 21], name: '科技园', type: 'investment', price: 380, rent: [], description: ['创新企业聚集地', '可合租'], extra: [], behavior: '', icon: '🔬', level: 0, upgradeCost: [], owners: [], investmentReturn: 55 },
    { id: 21, x: 220, y: 260, destinations: [20, 22], name: '体育馆', type: 'property', price: 260, rent: [22, 110, 280, 620, 950], description: ['运动的天堂'], extra: [], behavior: '', icon: '⚽', level: 0, upgradeCost: [120, 170, 230, 320], owners: [] },
    { id: 22, x: 220, y: 380, destinations: [21, 23], name: '动物园', type: 'property', price: 160, rent: [10, 50, 150, 350, 520], description: ['可爱的动物们'], extra: [], behavior: '', icon: '🦁', level: 0, upgradeCost: [70, 110, 160, 220], owners: [] },
    { id: 23, x: 280, y: 480, destinations: [22, 24], name: '住宅区事件', type: 'event', price: 0, rent: [], description: ['宁静住宅区的随机事件'], extra: [], behavior: 'event_residential', icon: '❓', level: 0, upgradeCost: [], owners: [] },
    { id: 24, x: 380, y: 520, destinations: [23, 25], name: '图书馆', type: 'property', price: 150, rent: [9, 45, 140, 320, 480], description: ['知识的海洋'], extra: [], behavior: '', icon: '📚', level: 0, upgradeCost: [60, 100, 150, 210], owners: [] },
    { id: 25, x: 500, y: 520, destinations: [24, 26], name: '医院', type: 'property', price: 190, rent: [14, 70, 190, 420, 650], description: ['健康守护'], extra: [], behavior: '', icon: '🏥', level: 0, upgradeCost: [85, 130, 180, 260], owners: [] },
    { id: 26, x: 720, y: 380, destinations: [1, 27], name: '游乐园', type: 'property', price: 210, rent: [16, 80, 210, 480, 720], description: ['欢乐的海洋'], extra: [], behavior: '', icon: '🎢', level: 0, upgradeCost: [90, 140, 190, 270], owners: [] },
    { id: 27, x: 820, y: 320, destinations: [26, 28], name: '电影院', type: 'property', price: 170, rent: [12, 60, 160, 380, 580], description: ['光影世界'], extra: [], behavior: '', icon: '🎬', level: 0, upgradeCost: [75, 115, 165, 240], owners: [] },
    { id: 28, x: 880, y: 230, destinations: [27, 29], name: '投资基金', type: 'investment', price: 420, rent: [], description: ['专业理财', '可合租'], extra: [], behavior: '', icon: '📈', level: 0, upgradeCost: [], owners: [], investmentReturn: 70 },
    { id: 29, x: 880, y: 130, destinations: [28, 30], name: '太空港', type: 'transport', price: 0, rent: [], description: ['星际旅行起点'], extra: [], behavior: '', icon: '🚀', level: 0, upgradeCost: [], owners: [], transportCost: 100 },
    { id: 30, x: 820, y: 50, destinations: [29, 31], name: '天文台', type: 'property', price: 320, rent: [28, 140, 350, 780, 1200], description: ['仰望星空'], extra: [], behavior: '', icon: '🔭', level: 0, upgradeCost: [140, 200, 280, 400], owners: [] },
    { id: 31, x: 720, y: 0, destinations: [30, 32], name: '市中心事件', type: 'event', price: 0, rent: [], description: ['繁华市中心的随机事件'], extra: [], behavior: 'event_city_center', icon: '❓', level: 0, upgradeCost: [], owners: [] },
    { id: 32, x: 480, y: 0, destinations: [31, 33], name: '海底世界', type: 'property', price: 380, rent: [38, 190, 480, 1050, 1600], description: ['深海探索'], extra: ['环保+3'], behavior: '', icon: '🐠', level: 0, upgradeCost: [170, 240, 330, 450], owners: [] },
    { id: 33, x: 360, y: 50, destinations: [32, 34], name: '赌场', type: 'investment', price: 500, rent: [], description: ['一掷千金', '可合租'], extra: [], behavior: '', icon: '🎰', level: 0, upgradeCost: [], owners: [], investmentReturn: 80 },
    { id: 34, x: 260, y: 100, destinations: [33, 35], name: '豪华酒店', type: 'property', price: 480, rent: [60, 300, 750, 1650, 2500], description: ['五星级享受'], extra: [], behavior: '', icon: '🏨', level: 0, upgradeCost: [220, 320, 420, 600], owners: [] },
    { id: 35, x: 180, y: 180, destinations: [34, 36], name: '商业区事件', type: 'event', price: 0, rent: [], description: ['商业中心的随机事件'], extra: [], behavior: 'event_commercial', icon: '❓', level: 0, upgradeCost: [], owners: [] },
    { id: 36, x: 160, y: 280, destinations: [35, 37], name: '政府大楼', type: 'property', price: 300, rent: [25, 125, 320, 720, 1100], description: ['权力中心'], extra: [], behavior: '', icon: '🏛️', level: 0, upgradeCost: [130, 190, 260, 380], owners: [] },
    { id: 37, x: 180, y: 380, destinations: [36, 38], name: '公园', type: 'property', price: 140, rent: [7, 35, 110, 260, 400], description: ['城市绿洲'], extra: ['环保+2'], behavior: '', icon: '🌲', level: 0, upgradeCost: [60, 90, 130, 180], owners: [] },
    { id: 38, x: 260, y: 460, destinations: [37, 39], name: '火车站', type: 'transport', price: 0, rent: [], description: ['城市门户'], extra: [], behavior: '', icon: '🚂', level: 0, upgradeCost: [], owners: [], transportCost: 40 },
    { id: 39, x: 480, y: 500, destinations: [38, 0], name: '自由港', type: 'property', price: 360, rent: [32, 160, 400, 900, 1400], description: ['自由贸易区'], extra: [], behavior: '', icon: '⚓', level: 0, upgradeCost: [160, 230, 310, 440], owners: [] },
  ];
}

export function getLocalDayNight(store: GameStore, timezone: string): { isDay: boolean; progress: number; hour: number; minute: number; timeStr: string } {
  const snapshot = store.getSnapshot();
  const serverElapsed = Date.now() + snapshot.serverTimeOffset - snapshot.dayNightStartTime;
  const offset = parseInt(timezone.replace('UTC', '')) || 0;
  const localProgress = ((serverElapsed / (15 * 60 * 1000)) + offset) % 1;
  const totalMinutes = Math.floor(localProgress * 24 * 60);
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  const isDay = hour >= 6 && hour < 18;
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  return { isDay, progress: localProgress, hour, minute, timeStr };
}

export function getPlayerTimezone(store: GameStore, mapIndex: MapIndex): string {
  const cell = mapIndex.getById(store.getSnapshot().currentPlayerPosition);
  if (!cell) return 'UTC+0';
  return getExtra<string>(cell, 'timezone', '') || 'UTC+0';
}
