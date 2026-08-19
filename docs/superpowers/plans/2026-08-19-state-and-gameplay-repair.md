# State and Gameplay Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unused authentication-owned `GameStateStore` and restore client-authoritative state flow for player rendering, dice requests, movement, and camera following.

**Architecture:** `AuthService` will only depend on `UserStore`; player persistence remains in `PlayerStore`. The client will use the existing `GameStore` instance as the single source for current player, other players, socket-dependent gameplay state, and position projection. Rendering and gameplay systems will receive explicit runtime dependencies instead of reading stale module-level state.

**Tech Stack:** TypeScript, Socket.IO typed events, Jest, pnpm workspace, Canvas renderer.

---

### Task 1: Remove the unused GameStateStore boundary

**Files:**
- Modify: `packages/server/src/auth/AuthService.ts`
- Modify: `packages/server/src/auth/index.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/tests/auth/AuthService.test.ts`
- Modify: `packages/server/tests/auth/authRoutes.test.ts`

- [ ] **Step 1: Update the authentication tests to construct AuthService without game state storage**

Remove the test-only `MockGameStateStore` and `TestGameStateStore` classes and change construction from:

```ts
new AuthService(userStore, gameStateStore, jwtService)
```

to:

```ts
new AuthService(userStore, jwtService)
```

Keep all assertions about registration, login, guest migration, and token verification unchanged.

- [ ] **Step 2: Run the focused authentication tests and verify the expected TypeScript failure**

Run:

```bash
pnpm exec jest tests/auth/AuthService.test.ts tests/auth/authRoutes.test.ts --runInBand
```

Expected: compilation fails because `AuthService` still requires the old `GameStateStore` argument. This confirms the tests exercise the intended public boundary change.

- [ ] **Step 3: Remove GameStateStore from AuthService**

In `packages/server/src/auth/AuthService.ts`:

- Remove the `PlayerGameState` type import.
- Remove the `GameStateStore` interface.
- Remove `gameStateStore` from the class fields.
- Change the constructor to accept `userStore`, `jwtService`, and optional auth config.
- Remove `saveGameState`, `loadGameState`, and `deleteGameState`.

The constructor must preserve existing defaults:

```ts
constructor(
  userStore: UserStore,
  jwtService: JWTService = new JWTService(),
  config: Omit<AuthConfig, 'jwt'> = DEFAULT_AUTH_CONFIG,
) {
  this.userStore = userStore;
  this.jwtService = jwtService;
  this.config = config;
}
```

- [ ] **Step 4: Remove the empty app injection and stale export**

In `packages/server/src/app.ts`, remove the `GameStateStore` import, the empty implementation, and pass only `userStore` and `authJwt` to `AuthService`.

In `packages/server/src/auth/index.ts`, export only `UserStore` and `AuthConfig` from `AuthService.ts`.

- [ ] **Step 5: Run focused authentication verification**

Run:

```bash
pnpm exec jest tests/auth/AuthService.test.ts tests/auth/authRoutes.test.ts --runInBand
pnpm exec tsc --noEmit
```

Expected: all focused tests pass and server TypeScript compilation succeeds.

- [ ] **Step 6: Commit the isolated server cleanup**

```bash
git add packages/server/src/auth/AuthService.ts packages/server/src/auth/index.ts packages/server/src/app.ts packages/server/tests/auth/AuthService.test.ts packages/server/tests/auth/authRoutes.test.ts
git commit -m "refactor(server): remove unused game state store"
```

### Task 2: Define explicit client runtime dependencies

**Files:**
- Modify: `packages/client/src/game/ClientRenderLoop.ts`
- Modify: `packages/client/src/game/systems/GameLogic.ts`
- Modify: `packages/client/src/game/systems/MovementSystem.ts`
- Modify: `packages/client/src/pages/GamePage.ts`
- Test: `packages/client/tests/game-store-authority.test.ts`

- [ ] **Step 1: Add a failing Store projection test for the gameplay runtime**

Add a test that applies a current-player event to a `GameStore`, then asserts the snapshot exposes the player and position required by rendering and gameplay:

```ts
it('为渲染和游戏逻辑提供当前玩家及位置的权威投影', () => {
  const store = new GameStore();
  store.applyEvent({
    sequence: 1,
    type: 'player',
    player: {
      id: 'player-1',
      username: '玩家一',
      position: { cellId: 7 },
      values: { money: { current: 100 }, credit: { current: 50 } },
      status: 'normal',
    } as never,
  });

  expect(store.getSnapshot()).toMatchObject({
    currentPlayer: { id: 'player-1' },
    currentPlayerPosition: 7,
    canRoll: true,
    isBankrupt: false,
  });
});
```

- [ ] **Step 2: Run the new Store test before changing production code**

Run:

```bash
pnpm exec jest tests/game-store-authority.test.ts --runInBand
```

Expected: the new Store test passes for the existing Store projection; this locks the required data contract before changing consumers.

- [ ] **Step 3: Refactor render-loop consumers to read the Store snapshot**

Change the render-loop entry points to accept a `GameStore` argument and read:

```ts
const snapshot = store.getSnapshot();
const player = snapshot.currentPlayer;
const position = snapshot.currentPlayerPosition;
const otherPlayers = snapshot.otherPlayers;
```

`updateRendererPlayers` must return without rendering a piece when `currentPlayer` or `mapIndex` is absent. `startRenderLoop` must refresh the camera target from the Store position each frame, while the initial focus uses the current player cell when available and falls back to cell `0` only when no player exists.

- [ ] **Step 4: Refactor GameLogic to use explicit Store and Socket values**

Change the dice handler to receive the active `GameStore` and `TypedClientSocket | null`, or an equivalent injected runtime object. Read `canRoll`, `isBankrupt`, and `isInJail` from `store.getSnapshot()`; retain animation and cooldown presentation state in the existing client presentation state until those slices are migrated.

The handler must:

- return without emitting when no socket is available;
- emit `client.rollDice` through the active socket;
- keep server-authoritative state updates unchanged;
- restore `canRoll` after an unsuccessful ACK;
- retain the existing cooldown behavior.

- [ ] **Step 5: Refactor MovementSystem to use the same Store and Socket runtime**

Pass the Store into the movement frame entry point so the render loop has one explicit runtime boundary. Preserve server-authoritative movement: the client may animate a server-provided path, but must not invent a final position. A complete migration of all movement presentation fields is a follow-up if it would expand this repair beyond the reported rendering/dice/camera failure.

- [ ] **Step 6: Wire GamePage to one Store and one active Socket**

Pass `gameStore` and `controller.getSocket()` into render-loop, dice, and movement entry points. After map loading:

```ts
const playerCellId = gameStore.getSnapshot().currentPlayerPosition;
centerCameraOnCell(gameStore, playerCellId || 0);
updateRendererPlayers(gameStore);
```

Ensure the authenticated Socket retained from LoadingPage is the same Socket used by dice and chat sends.

### Task 3: Add gameplay regression coverage

**Files:**
- Modify: `packages/client/tests/pages.test.ts`
- Modify: `packages/client/tests/movement-authority.test.ts`
- Modify: `packages/client/tests/game-store-sequence.test.ts`

- [ ] **Step 1: Add a failing test for game-page wiring**

Use a mocked authenticated Socket and a logged-in controller context. Assert that creating the game page wires the existing Socket to the dice action and that clicking the dice button emits `client.rollDice` rather than reporting a local connection error.

- [ ] **Step 2: Run the focused page test and verify the expected failure**

```bash
pnpm exec jest tests/pages.test.ts --runInBand
```

Expected: the new dice-wiring assertion fails before the GamePage runtime dependency refactor.

- [ ] **Step 3: Add movement and camera assertions**

Cover:

- a Store current-player snapshot is passed to the renderer;
- the renderer receives the current player at the authoritative cell;
- a server movement event changes the projected position used by the render loop;
- camera focus uses the player cell rather than always using cell `0`.

- [ ] **Step 4: Run the focused client regression tests**

```bash
pnpm exec jest tests/pages.test.ts tests/movement-authority.test.ts tests/game-store-sequence.test.ts --runInBand
```

Expected: all tests pass.

### Task 4: Full verification and client repair commit

**Files:**
- Modify only files changed by Tasks 2 and 3.

- [ ] **Step 1: Run client type checking and lint**

```bash
pnpm exec tsc --noEmit
pnpm exec eslint src --ext .ts
```

Expected: TypeScript succeeds and ESLint reports no errors.

- [ ] **Step 2: Run the complete client test suite**

```bash
pnpm exec jest --runInBand
```

Expected: all client suites and tests pass.

- [ ] **Step 3: Run the complete server test suite after the GameStateStore cleanup**

```bash
pnpm exec jest --runInBand
```

Run from `packages/server`. Expected: all server suites and tests pass.

- [ ] **Step 4: Check the diff and commit the client repair**

```bash
git diff --check
git status --short
git add packages/client/src packages/client/tests
git commit -m "fix(client): restore authoritative gameplay state flow"
```

Expected: no whitespace errors and a separate client repair commit.

### Scope Exclusion

The chat command team interface is intentionally excluded from this plan. It will be handled after these repairs are verified, using the existing team Socket.IO events and a dedicated `ChatCommandRouter` design.
