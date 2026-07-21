/**
 * 地图加载器测试
 *
 * 覆盖：
 * 1. 从字符串加载（正常 + 错误）
 * 2. 从对象加载
 * 3. 从文件加载（Node.js 环境）
 * 4. 错误信息详细性
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  loadMapFromFile,
  loadMapFromObject,
  loadMapFromString,
} from '../../src/map/map-loader';
import { MapParseError } from '../../src/map/map-parser';

const REAL_MAP_JSON = JSON.stringify([
  {
    id: 0,
    x: 356,
    y: 109,
    destinations: [],
    name: '',
    type: 'start',
    price: 0,
    rent: [0, 10],
    description: ['hi'],
    extra: [''],
    behavior: '',
    icon: '',
    level: 0,
    upgradeCost: [],
    owners: [],
    isMortgaged: 0,
    mortgagePrice: 0,
  },
  {
    id: 1,
    x: 521,
    y: 284,
    destinations: [0],
    name: '',
    type: 'property',
    price: 0,
    rent: [],
    description: [],
    extra: ['34436'],
    behavior: '',
    icon: '',
    level: 0,
    upgradeCost: [],
    owners: [],
    isMortgaged: 0,
    mortgagePrice: 0,
  },
]);

describe('map-loader - loadMapFromString', () => {
  it('解析合法 JSON 字符串', async () => {
    const map = await loadMapFromString(REAL_MAP_JSON);
    expect(map).toHaveLength(2);
    expect(map[0]?.id).toBe(0);
    expect(map[0]?.extra['rent']).toEqual([0, 10]);
  });

  it('空字符串抛错', async () => {
    await expect(loadMapFromString('')).rejects.toThrow(MapParseError);
    await expect(loadMapFromString('   ')).rejects.toThrow(/空/);
  });

  it('非字符串参数抛错', async () => {
    await expect(loadMapFromString(123 as unknown as string)).rejects.toThrow(
      MapParseError,
    );
  });

  it('非法 JSON 抛错并提示解析失败', async () => {
    await expect(loadMapFromString('{not valid json')).rejects.toThrow(
      /JSON 解析失败/,
    );
  });

  it('JSON 是合法对象但不是数组抛错', async () => {
    await expect(loadMapFromString('{"a": 1}')).rejects.toThrow(/顶层必须是数组/);
  });
});

describe('map-loader - loadMapFromObject', () => {
  it('解析合法数组', () => {
    const map = loadMapFromObject([
      { id: 0, x: 0, y: 0, destinations: [] },
    ]);
    expect(map).toHaveLength(1);
  });

  it('非数组抛错', () => {
    expect(() => loadMapFromObject({})).toThrow(MapParseError);
  });

  it('数组中包含非法元素抛错', () => {
    expect(() =>
      loadMapFromObject([{ id: 0, x: 'oops', y: 0, destinations: [] }]),
    ).toThrow(MapParseError);
  });
});

describe('map-loader - loadMapFromFile', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'map-loader-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('从临时文件成功加载', async () => {
    const file = path.join(tmpDir, 'valid.json');
    fs.writeFileSync(file, REAL_MAP_JSON, 'utf-8');
    const map = await loadMapFromFile(file);
    expect(map).toHaveLength(2);
  });

  it('文件不存在抛错', async () => {
    const file = path.join(tmpDir, 'not-exists.json');
    await expect(loadMapFromFile(file)).rejects.toThrow(/读取文件失败/);
  });

  it('文件内容非法抛错', async () => {
    const file = path.join(tmpDir, 'invalid.json');
    fs.writeFileSync(file, '{not valid json', 'utf-8');
    await expect(loadMapFromFile(file)).rejects.toThrow(/JSON 解析失败/);
  });

  it('空路径抛错', async () => {
    await expect(loadMapFromFile('')).rejects.toThrow(MapParseError);
  });
});
