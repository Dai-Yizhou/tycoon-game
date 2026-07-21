/**
 * 地图文件加载工具
 *
 * 提供三种加载入口：
 * - {@link loadMapFromString} : 解析 JSON 字符串（用于浏览器/HTTP 响应）
 * - {@link loadMapFromObject} : 解析已反序列化的对象
 * - {@link loadMapFromFile}   : 从文件系统读取（仅 Node.js 环境）
 *
 * 加载流程：
 * 1. 反序列化（仅 string/file）
 * 2. 通过 `parseMapData` 转换为 MapData
 * 3. 抛出带上下文的错误（行号、字段名）
 */

import type { MapData } from '../types/cell';
import { MapParseError, parseMapData } from './map-parser';

/**
 * 从 JSON 字符串加载地图
 *
 * @param jsonString 地图编辑器的导出（JSON 字符串）
 * @returns MapData
 * @throws {MapParseError} 当 JSON 解析失败或数据不合法时
 */
export async function loadMapFromString(jsonString: string): Promise<MapData> {
  if (typeof jsonString !== 'string') {
    throw new MapParseError(
      `loadMapFromString: 参数必须是字符串（收到 ${typeof jsonString}）`,
    );
  }
  if (jsonString.trim() === '') {
    throw new MapParseError('loadMapFromString: 输入字符串为空');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(jsonString);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new MapParseError(`loadMapFromString: JSON 解析失败（${message}）`);
  }

  return loadMapFromObject(raw);
}

/**
 * 从已反序列化的对象加载地图
 *
 * @param obj 任意已 JSON.parse 的对象
 * @returns MapData
 * @throws {MapParseError} 当对象不是合法数组或格子数据不合法时
 */
export function loadMapFromObject(obj: unknown): MapData {
  return parseMapData(obj);
}

/**
 * 从文件系统加载地图（仅 Node.js 环境）
 *
 * 使用 `fs/promises` 异步读取文件。
 *
 * @param path 文件绝对路径
 * @returns MapData
 * @throws {MapParseError} 当文件不存在、读取失败或内容不合法时
 */
export async function loadMapFromFile(path: string): Promise<MapData> {
  if (typeof path !== 'string' || path.length === 0) {
    throw new MapParseError(`loadMapFromFile: 路径不能为空（收到 ${typeof path}）`);
  }

  // 避免在浏览器/无 fs 的环境下被引用时崩溃
  let fs: typeof import('fs').promises;
  try {
    fs = (await import('fs')).promises;
  } catch {
    throw new MapParseError(
      'loadMapFromFile: 当前环境不支持 fs 模块（仅在 Node.js 下可用）',
    );
  }

  let content: string;
  try {
    content = await fs.readFile(path, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new MapParseError(`loadMapFromFile: 读取文件失败（${path}：${message}）`);
  }

  return loadMapFromString(content);
}
