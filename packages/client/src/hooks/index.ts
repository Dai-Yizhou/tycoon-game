/**
 * Hooks 导出
 */

export {
  createSocket,
  ping,
  waitForConnection,
  type TypedClientSocket,
  type SocketStatus,
  type SocketOptions,
} from './useSocket.js';

export {
  PlayerStateManager,
  createPlayerStateManager,
  type PlayerState,
  type PlayerStateListener,
  type ValueChangeListener,
  type OtherPlayersListener,
  type OtherPlayerInfo,
} from './usePlayerState.js';

export {
  UseDice,
  createUseDice,
  type DiceState,
  type UseDiceOptions,
} from './useDice.js';

export {
  UseMovement,
  createUseMovement,
  type MovementState,
  type UseMovementOptions,
} from './useMovement.js';