# Path Choice Action Group Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move intersection choices into the themed bottom action group so path selection is rendered by the existing HUD system instead of a body-level floating overlay.

**Architecture:** The server remains authoritative for available paths and final movement. `GameViewModel` owns the path-selection presentation state, `GameHudShell` renders themed action buttons from that state, and `MovementSystem` only sends the selected path request. Existing `DesignAdapter` CSS variables and `.act-btn` styles remain the sole visual source.

**Tech Stack:** TypeScript, Jest, Socket.IO typed events, existing GameViewModel/GameHudShell, CSS theme tokens.

---

### Task 1: Add path-selection state to the ViewModel

**Files:**
- Modify: `packages/client/src/game/GameViewModel.ts`
- Test: `packages/client/tests/game-store-authority.test.ts`

- [ ] **Step 1: Add a failing state projection test**

Add a test that sets path options and asserts the ViewModel exposes them:

```ts
it('保存岔路选择状态供 HUD 行动组投影', () => {
  const viewModel = new GameViewModel(new GameStore());
  viewModel.setPathChoice([
    { cellId: 4, label: '华尔街' },
    { cellId: 8, label: '纪念碑' },
  ]);

  expect(viewModel.getPathChoice()).toEqual({
    active: true,
    options: [
      { cellId: 4, label: '华尔街' },
      { cellId: 8, label: '纪念碑' },
    ],
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm exec jest tests/game-store-authority.test.ts --runInBand
```

Expected: FAIL because `setPathChoice` and `getPathChoice` do not exist.

- [ ] **Step 3: Implement the minimal ViewModel state**

Add:

```ts
export interface PathChoiceOption {
  cellId: number;
  label: string;
}

export interface PathChoiceSlice {
  active: boolean;
  options: PathChoiceOption[];
}
```

Initialize the slice with `active: false` and an empty array. Add `getPathChoice()`, `setPathChoice(options, source)`, and `clearPathChoice(source)`. `setPathChoice([])` must clear the active state.

- [ ] **Step 4: Run the focused test**

```bash
pnpm exec jest tests/game-store-authority.test.ts --runInBand
```

Expected: PASS.

### Task 2: Render choices in the existing bottom action group

**Files:**
- Modify: `packages/client/src/components/GameHudShell.ts`
- Modify: `packages/client/src/pages/GamePage.ts`
- Test: `packages/client/tests/new-ui-components.test.ts`

- [ ] **Step 1: Add a failing HUD test**

Create a `GameViewModel` with two path choices, construct `GameHudShell`, and assert the action group contains two buttons with classes and labels:

```ts
expect(shell.getElement().querySelectorAll('[data-action="path-choice"]')).toHaveLength(2);
expect(shell.getElement().querySelector('[data-action="path-choice"][data-cell-id="4"]')?.textContent).toContain('华尔街');
```

Clicking the first button must call `onPathChoice(4)`.

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm exec jest tests/new-ui-components.test.ts --runInBand
```

Expected: FAIL because the config callback and path button rendering do not exist.

- [ ] **Step 3: Extend the HUD config and render function**

Add `onPathChoice?: (cellId: number) => void` to `GameHudShellConfig`. Render path buttons inside the existing `[data-ui="action-cluster"]` element:

```ts
const pathChoice = this.vm.getPathChoice();
cluster.replaceChildren(...pathChoice.options.map((option, index) => {
  const button = document.createElement('button');
  button.className = 'act-btn act-btn--accent';
  button.dataset.action = 'path-choice';
  button.dataset.cellId = String(option.cellId);
  button.textContent = `选择路径 ${String.fromCharCode(65 + index)}`;
  const detail = document.createElement('span');
  detail.className = 'act-btn__price';
  detail.textContent = `→ ${option.label}`;
  button.appendChild(detail);
  button.addEventListener('click', () => this.config.onPathChoice?.(option.cellId));
  return button;
}));
```

When no path choice is active, leave the cluster empty. Do not add colors, inline styles, or new visual constants; `.act-btn` and existing theme variables provide styling.

- [ ] **Step 4: Wire GamePage callback**

Pass `onPathChoice: (cellId) => onIntersectionChoice(cellId)` from GamePage. The callback must use the existing `MovementSystem` request path and must not duplicate Socket.IO protocol logic in the component.

- [ ] **Step 5: Run focused UI tests**

```bash
pnpm exec jest tests/new-ui-components.test.ts --runInBand
```

Expected: PASS.

### Task 3: Route server path events into the HUD state

**Files:**
- Modify: `packages/client/src/game/systems/SocketEventHandler.ts`
- Modify: `packages/client/src/game/systems/MovementSystem.ts`
- Modify: `packages/client/src/pages/GamePage.ts`
- Test: `packages/client/tests/socket-handler-lifecycle.test.ts`

- [ ] **Step 1: Add a failing event-routing test**

Register handlers with a fake socket and a `GameViewModel` callback or injected path-choice sink. Invoke the registered `server.askPath` handler with two labeled options and assert the sink receives both `{ cellId, label }` entries.

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm exec jest tests/socket-handler-lifecycle.test.ts --runInBand
```

Expected: FAIL because the current handler only creates the body-level overlay.

- [ ] **Step 3: Add a path-choice handler option**

Extend `SocketHandlerOptions` with:

```ts
onPathChoiceOptions?: (options: Array<{ cellId: number; label: string }>) => void;
onPathChoiceCleared?: () => void;
```

In `server.askPath`, call `onPathChoiceOptions` with the labeled options. Keep the system chat notice, but do not call `showIntersectionChoice`.

- [ ] **Step 4: Remove the legacy body-level path overlay**

Delete the DOM creation path from `MovementSystem.showIntersectionChoice`. Keep the function only if existing callers still need a compatibility no-op; otherwise remove its import and call sites. `onIntersectionChoice` remains the single request path and continues to emit `client.choosePath`.

- [ ] **Step 5: Clear the HUD choice after selection**

After `onIntersectionChoice` sends the request, clear the ViewModel path choice only on a successful ACK. On failure, retain the options and append the existing error chat message so the player can retry.

- [ ] **Step 6: Run event and UI regression tests**

```bash
pnpm exec jest tests/socket-handler-lifecycle.test.ts tests/new-ui-components.test.ts tests/game-store-authority.test.ts --runInBand
```

Expected: all focused tests pass.

### Task 4: Full verification and commit

**Files:**
- Modify only the files listed in Tasks 1–3.

- [ ] **Step 1: Run type checking, lint, and build**

```bash
pnpm exec tsc --noEmit
pnpm run lint
pnpm run build
```

Expected: TypeScript and build succeed; lint has no errors and may retain existing warnings.

- [ ] **Step 2: Run the complete client test suite**

```bash
pnpm exec jest --runInBand
```

Expected: all client test suites pass.

- [ ] **Step 3: Check diff and commit**

```bash
git diff --check
git status --short
git add packages/client/src packages/client/tests
git commit -m "fix(client): render path choices in action bar"
```

Expected: no whitespace errors and a clean worktree after commit.
