# Cell Hover and Act-Bar Information Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align cell-hover and act-bar information with the approved cell configuration, runtime state, and static `cell.price` purchase semantics without changing game rules or introducing a settlement batch protocol.

**Architecture:** Keep the existing server-authoritative action handlers and client UI shell. Extract pure client display/action resolvers for UCT formatting, hover content, and act-bar models; make server purchase and ownership limits read cell configuration only. Validate required cell configuration when parsing/loading maps, while preserving the existing Socket.IO contracts.

**Tech Stack:** TypeScript, Jest, Node.js, Vite, Socket.IO, shared map parser and shared cell types.

---

## Scope and confirmed decisions

- All property and investment shareholders pay the static `cell.price`; later shareholders do not receive a multiplier price.
- `buyInMultiplier` is not part of runtime price calculation. Remove its active gameplay use and update the type/config/documentation as part of this plan; preserve no compatibility fallback unless a test proves an existing non-game consumer requires it.
- `price` accepts finite numeric UCT fields only. Runtime/config variable expressions are out of scope and remain a technical debt.
- `maxOwnerCount` is required on property and investment cells. Missing, non-positive, or non-integer values fail map parsing/loading.
- `ServerConfig` must not provide a second gameplay source for purchase multiplier, shareholder limit, jail cooldown, day/night cycle, or era length. Only remove fields when all current call sites and tests have been migrated.
- Server validation remains authoritative. Client action state is a projection and cannot authorize a request.
- No `economicSettlement` protocol, player lock, NotificationManager, or broad state-layer refactor is included.

## File map

- Modify `packages/shared/src/types/cell.ts`: make `maxOwnerCount` required for the parsed cell contract and remove `buyInMultiplier` from the active cell contract.
- Modify `packages/shared/src/map/map-parser.ts`: validate required purchasable-cell fields and finite static UCT values.
- Modify `packages/shared/src/types/server-config.ts` and `packages/server/src/config.ts`: remove purchase multiplier from infrastructure config only after call-site migration; keep unrelated deployment settings intact.
- Modify `packages/server/src/economy/Ownership.ts`: use `cell.maxOwnerCount` for ownership capacity and remove multiplier-based helper/config fields; retain ownership share and accumulated-value behavior.
- Modify `packages/server/src/handlers/propertyHandler.ts`: use `cell.price` for every purchase and enforce the configured per-cell owner limit and one-action boundary.
- Modify `packages/server/src/handlers/investmentHandler.ts`: use `cell.price` for every purchase and enforce the configured per-cell owner limit.
- Create or modify `packages/shared/src/economy/price.ts` only if a pure static-price helper is needed by both packages; do not add an expression evaluator.
- Create `packages/client/src/game/cellDisplayModel.ts`: pure UCT display groups and cell-hover model resolver.
- Create `packages/client/src/game/cellActionResolver.ts`: pure act-bar action model resolver using `cell.price`, runtime ownership, and current player state.
- Modify `packages/client/src/components/GameHudShell.ts`: render the hover model and existing action model without embedding cell-type business rules.
- Modify `packages/client/src/pages/GamePage.ts`: use the action resolver, correct action IDs, and pass existing runtime context to action handlers.
- Modify `packages/client/src/game/systems/GameLogic.ts`: make transport destination display use the shared UCT display formatter and preserve the existing request flow.
- Modify `packages/shared/tests/map/map-parser.test.ts` or the existing map parser test file: required configuration and static UCT validation.
- Modify/create `packages/server/tests/economy/ownership.test.ts`: per-cell owner limit and static price behavior.
- Modify `packages/server/tests/handlers/propertyHandler*.test.ts` and `packages/server/tests/handlers/investmentHandler*.test.ts`: first/later purchase price, limits, and server authority.
- Create `packages/client/tests/cell-display-model.test.ts`: UCT grouping and hover boundaries.
- Create `packages/client/tests/cell-action-resolver.test.ts`: action visibility, static price, affordability, limits, and action IDs.
- Modify existing client lifecycle/GameLogic tests for transport, monument, and action dispatch behavior.

## Task 1: Lock static price and required cell configuration in shared parsing

**Files:**
- Modify: `packages/shared/src/types/cell.ts`
- Modify: `packages/shared/src/map/map-parser.ts`
- Test: `packages/shared/tests/map/map-parser.test.ts` (or the repository’s existing parser test file)

- [x] Step 1: Add failing parser tests for a property and investment cell without `maxOwnerCount`; expect `MapParseError` naming the missing field.
- [x] Step 2: Add failing parser tests for non-integer and non-positive `maxOwnerCount`; expect `MapParseError`.
- [x] Step 3: Add a parser test proving a static numeric `price` remains unchanged and a string/object variable expression is rejected.
- [x] Step 4: Run the parser test and confirmed the new tests failed before implementation.
- [x] Step 5: Make `maxOwnerCount` required in the parsed cell type and validate it only for `property` and `investment` cells.
- [x] Step 6: Remove `buyInMultiplier` from the active shared cell type and reject it as an unsupported gameplay field; the chosen behavior is covered by the parser test.
- [x] Step 7: Run the same parser test and confirm all tests pass.
- [x] Step 8: Verify every current property/investment map cell has explicit `maxOwnerCount`; no `buyInMultiplier` entries are present.
- [x] Step 9: Run `npm --prefix packages/shared test -- --runInBand` and `npm --prefix packages/shared run lint`. (94 tests passed; lint 0 errors)

## Task 2: Remove multiplier-based server pricing and use cell owner limits

**Files:**
- Modify: `packages/server/src/economy/Ownership.ts`
- Modify: `packages/server/src/handlers/propertyHandler.ts`
- Modify: `packages/server/src/handlers/investmentHandler.ts`
- Modify: `packages/server/src/config.ts`
- Modify: `packages/shared/src/types/server-config.ts` if config type cleanup is required
- Test: server ownership/property/investment handler tests

- [x] Step 1: Add a property purchase regression test with an existing shareholder and a non-default global multiplier; assert the economy receives exactly `cell.price`.
- [x] Step 2: Add the equivalent investment purchase regression test.
- [x] Step 3: Run the narrow server tests and confirm both fail because handlers currently scale by `ownershipConfig.buyInMultiplier`. (RED→GREEN verified before implementation)
- [x] Step 4: Replace the two handler price branches with `const priceUct = cell.price;`; keep the existing affordability, CAS, economy, and ownership update flow.
- [x] Step 5: Change ownership capacity checks to use the current cell’s required `maxOwnerCount`, and remove `buyInMultiplier` from ownership configuration and environment parsing after all callers are migrated.
- [x] Step 6: Run the narrow server tests and expect them to pass.
- [x] Step 7: Add a regression test for the configured owner limit; parser coverage for missing/invalid configuration is covered by Task 1.
- [x] Step 8: Run the affected server handler/economy tests and server build.

## Task 3: Enforce server action boundaries without changing settlement protocol

**Files:**
- Modify: `packages/server/src/handlers/propertyHandler.ts`
- Modify: `packages/server/src/handlers/investmentHandler.ts`
- Modify: `packages/server/src/handlers/monumentHandler.ts` if its existing guard is incomplete
- Modify: `packages/server/src/handlers/transportHandler.ts` if its existing guard is incomplete
- Test: affected server handler tests

- [x] Step 1: Add one test per action proving a second action during the same stop is rejected by the server, including property purchase and transport use.
- [x] Step 2: Run those tests and confirm the currently missing checks fail.
- [x] Step 3: Add per-stop entry-point guards in property (buy/upgrade share one flag), investment (buy), and transport (teleport), mirroring the existing monument `repairedThisVisit` pattern with arrival reset wired through `HandlerRegistry.handleCellEvent`.
- [x] Step 4: Run the affected tests and expect them to pass.
- [x] Step 5: Verify the change does not alter movement settlement or economic distribution tests (full server suite: 294 passed).

## Task 4: Extract and implement the client UCT display model

**Files:**
- Create: `packages/client/src/game/cellDisplayModel.ts`
- Modify: `packages/client/src/components/GameHudShell.ts`
- Modify: `packages/client/src/game/systems/GameLogic.ts`
- Test: `packages/client/tests/cell-display-model.test.ts`

- [x] Step 1: Add tests for grouped `Player`/`Region` output, localized field labels, positive/negative signs, empty-field omission, and omission of empty groups.
- [x] Step 2: Add tests for hover boundaries: all cells show only name/description; property shows static price, current-level rent, level/max, owner count/max; investment shows static price, owner count/max, and each trigger; jail shows cooldown and jail cost; other types show no extra fields.
- [x] Step 3: Run the new client tests and confirm they fail because the model does not exist.
- [x] Step 4: Implement pure display model functions with no DOM access and no business-side effects.
- [x] Step 5: Replace `GameHudShell.buildCellHoverContent()`’s generic holder/timezone output with rendering of the model in the existing hover DOM.
- [x] Step 6: Replace the transport modal’s local UCT formatter with the shared formatter.
- [x] Step 7: Run the display tests and existing client component tests. (17 suites, 100 tests passed)

## Task 5: Extract and implement the client act-bar action resolver

**Files:**
- Create: `packages/client/src/game/cellActionResolver.ts`
- Modify: `packages/client/src/pages/GamePage.ts`
- Modify: `packages/client/src/state/GameStore.ts` only if action models need typed request metadata
- Modify: `packages/client/src/game/systems/GameLogic.ts` only if handler mapping requires it
- Test: `packages/client/tests/cell-action-resolver.test.ts`

- [x] Step 1: Add tests for property buy/upgrade, investment buy, monument repair, and transport destination actions.
- [x] Step 2: Assert property/investment actions show and afford-check against static `cell.price`, never a multiplier.
- [x] Step 3: Assert owner count, max level, bankrupt, and `actionUsedThisTurn` boundaries.
- [x] Step 4: Assert action IDs map to registered handlers, specifically `buy-investment` rather than the stale `invest` ID.
- [x] Step 5: Run the new tests and confirm they fail against the current inline `syncCellActions()` implementation.
- [x] Step 6: Implement the pure resolver with explicit inputs for snapshot, cell, runtime state, and localized definitions; it must not emit sockets or touch the DOM.
- [x] Step 7: Replace `syncCellActions()` rule construction with the resolver and retain existing rendering/handler registration.
- [x] Step 8: Add repair cost details and next-level property rent details.
- [x] Step 9: Run client resolver/lifecycle tests and client build. (18 suites / 110 tests passed; vite build OK)

## Task 6: Update configuration boundaries and documents

**Files:**
- Modify: `docs/superpowers/specs/2026-09-06-cell-hover-act-bar-information-boundaries.md`
- Modify: `docs/architecture/ARCHITECTURE.md`
- Modify: `docs/architecture/FILE_MAP.md` if file responsibilities change
- Modify: `packages/server/map.json`
- Modify: `packages/server/map-meta.json` only if required configuration is missing

- [x] Step 1: Update the spec’s purchase sections to state static `cell.price` for all shareholders and keep expression pricing as technical debt.
- [x] Step 2: Record that `maxOwnerCount` is mandatory and `buyInMultiplier` is removed from runtime gameplay.
- [x] Step 3: Document that expression/variable-backed `price` is not supported and is a future design item.
- [x] Step 4: Document the final ownership/config boundary and any compatibility choice for legacy `buyInMultiplier` data. (parser rejects the field; no compatibility fallback)
- [x] Step 5: Validate the map files against the parser and ensure all property/investment cells have explicit `maxOwnerCount`. (map.json / map-meta.json valid; 3 purchasable cells all configured; no buyInMultiplier entries)

## Task 7: Full verification and handoff

**Files:**
- No production file changes unless verification exposes a regression.

- [x] Step 1: Build shared: `npm run build:shared`.
- [x] Step 2: Build server: `npm --prefix packages/server run build`.
- [x] Step 3: Build client: `npm --prefix packages/client run build`.
- [x] Step 4: Lint all packages: `npm --prefix packages/shared run lint`, `npm --prefix packages/server run lint`, `npm --prefix packages/client run lint`. (0 errors; 2 pre-existing `no-explicit-any` warnings in untouched code)
- [x] Step 5: Run shared tests: `npm --prefix packages/shared test -- --runInBand`. (94 passed)
- [x] Step 6: Run server tests: `npm --prefix packages/server test -- --runInBand`. (294 passed)
- [x] Step 7: Run client tests: `npm --prefix packages/client test -- --runInBand`. (110 passed)
- [x] Step 8: Check `git diff` for unrelated changes, generated artifacts, and stale multiplier references. (all multiplier references are deletions; app.ts change is the Task 2 config migration)
- [x] Step 9: Do not commit unless explicitly requested by the user.

## Known risks and decision gates

- Removing `buyInMultiplier` from `ServerConfig` may affect old tests or external callers; migrate all in-repository callers first, then report any external compatibility concern instead of inventing a fallback.
- Parser rejection of legacy `buyInMultiplier` must be chosen deliberately during Task 1 because the current parser has an allow-list but does not reject every unknown property. The plan assumes removal from active type and runtime behavior; it does not silently reinterpret the field.
- Transport destination availability may require retaining the existing modal request flow rather than inventing a new socket event. The resolver should model known destinations only and keep loading/empty states explicit.
- If a requested change requires a new shared socket contract or settlement batch protocol, stop and ask before expanding scope.
