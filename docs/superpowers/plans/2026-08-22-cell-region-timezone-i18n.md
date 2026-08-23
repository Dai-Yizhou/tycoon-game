# Cell Region Timezone i18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each map cell explicitly own its region, timezone, and localized display data, then use that data for server validation, hover cards, themes, and local time.

**Architecture:** `map.json` is the authoritative per-cell configuration. The server strictly validates cell references against `map-meta.json` and exposes map metadata through `/api/map`; the client only scales coordinates and projects the returned data through `GameStore`/`GameViewModel`.

**Tech Stack:** TypeScript, Jest, Express, shared map parser, Vite client, existing i18n and theme token systems.

---

### Task 1: Define and validate the new map contract

**Files:**
- Modify: `packages/shared/src/types/map-meta.ts`
- Modify: `packages/shared/src/map/map-meta-loader.ts`
- Modify: `packages/shared/tests/map/map-meta-loader.test.ts`
- Modify: `packages/server/map.json`
- Modify: `packages/server/map-meta.json`

- [ ] Add `MapCellLocale` and timezone metadata types needed by the client.
- [ ] Make validation reject cells missing `region`, `timezone`, `name`, or `description`, reject unknown references, and reject incomplete `zh-CN`/`en-US` maps.
- [ ] Convert all eight map cells to explicit `region-main`/`tz-main` fields and localized names/descriptions.
- [ ] Add tests for valid localized cells and invalid references/locale maps.
- [ ] Run `pnpm exec jest --runInBand tests/map/map-meta-loader.test.ts` from `packages/shared` and confirm the new tests pass.

### Task 2: Expose complete metadata from the server

**Files:**
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/tests/app.test.ts`

- [ ] Include `timezones` in `/api/map` alongside `mapData`, `regions`, and value fields.
- [ ] Add an API assertion that each returned cell contains explicit region/timezone and localized fields and that timezone metadata is present.
- [ ] Run `pnpm exec jest --runInBand tests/app.test.ts` from `packages/server`.

### Task 3: Store and project cell metadata on the client

**Files:**
- Modify: `packages/client/src/state/GameStore.ts`
- Modify: `packages/client/src/game/GameViewModel.ts`
- Modify: `packages/client/src/game/systems/MapLoader.ts`
- Modify: `packages/client/src/pages/GamePage.ts`
- Modify: `packages/client/tests/game-store-authority.test.ts`
- Modify: `packages/client/tests/region-theme.test.ts`

- [ ] Add `TimeZoneInfo[]` to the client snapshot and make `setRegions()` store regions plus timezones.
- [ ] Remove X-coordinate timezone inference and preserve the map’s explicit `extra.timezone`.
- [ ] Add ViewModel lookup methods for current cell region and timezone metadata.
- [ ] Make theme selection use `cell.extra.region` only and make local time use `offsetMinutes` from stored timezone metadata.
- [ ] Update page loading to pass timezones into the store.
- [ ] Run the targeted client Store/theme tests.

### Task 4: Repair localized hover cards

**Files:**
- Modify: `packages/client/src/components/GameHudShell.ts`
- Modify: `packages/client/src/game/i18n.ts`
- Modify: `packages/client/tests/new-ui-components.test.ts`

- [ ] Resolve localized values using current locale, `zh-CN`, then the first non-empty translation.
- [ ] Render localized name/description, region, and timezone text without coercing objects to `[object Object]`.
- [ ] Add hover-card tests for localized content and explicit metadata.
- [ ] Run the targeted HUD tests.

### Task 5: Full verification

- [ ] Run shared, server, and client builds.
- [ ] Run affected test suites and client/server lint.
- [ ] Run `pnpm run build`, `pnpm exec jest --runInBand --forceExit`, and `git diff --check`.
- [ ] Search for and remove remaining client-side `getTimezoneByX` and `UTC-8` inference paths.
