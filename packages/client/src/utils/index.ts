/**
 * 工具模块导出
 */

export type {
  ColorScheme,
} from './colorScheme';

export {
  DEFAULT_CELL_COLOR_SCHEME,
  getColorScheme,
  PLAYER_COLORS,
  getPlayerColor,
  VISION_MASK_COLORS,
} from './colorScheme';

export {
  isPointInCircle,
  isPointInRect,
  isPointInHexagon,
  distance,
  angle,
  DEFAULT_CELL_CONFIG,
  DEFAULT_CONNECTION_CONFIG,
  DEFAULT_PLAYER_CONFIG,
} from './geometry';