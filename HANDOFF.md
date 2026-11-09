# Project Handoff State

- **Last Updated By:** Claude (implementer, M13)
- **Current Goal:** M0 to M13 are built. M13 moved the simulation into a Web Worker; the family tree view (M14) and heatmaps (M15) are next and not started. Not committed or pushed: the lead verifies and commits.
- **Recent Changes (M13, worker):**
  - New in `src/ui`: `protocol.ts` (messages), `simHost.ts` (pure host: world, load job, hash, queries, `createHostRunner`), `sim.worker.ts` (adapter), `simClient.ts` (worker client with inline fallback, inline client), `viewWorld.ts` (`ViewWorld`, `applyFrame`, `toViewWorld`). Tests: `simHost.test.ts`, `simClient.test.ts`, `viewWorld.test.ts`; `store.test.ts` and `loadRun.test.ts` rewritten async (same coverage plus clock, mirror, query tests).
  - `store.ts` rewritten around a client: `dispatch`, `exportSave`, `advance`, `stepOnce` are async; `settled()` waits for all earlier answers; `setSimClient` is for tests; `queryFamily`/`queryFounders` wrap the `query` message (no UI yet). `autosave.ts`, `SavePanel.tsx` use the async `exportSave`. Panels, `render.ts`, `geometry.ts`, `eventInfo.ts` take `ViewWorld`. `App.tsx` sets `data-sim="worker|inline"` on `<main>`.
  - `src/sim` only had types narrowed (`Pick`s in `commands.ts`, `world.ts`, `worldEvents.ts`, `ruins.ts`, `traits.ts`); `vite.config.ts` has `worker: { format: 'es' }`. No behaviour or hash changed (survey rows identical).
  - Docs: `CLAUDE.md` (Worker section), `doc/GAME_DESIGN.md` (section 8 item 5, M13 row, open questions, changelog), idea brief changelog.
- **Active Decisions / Constraints:**
  - The page never holds a `World`, only a `ViewWorld`; new UI that needs more data adds a frame field or a `query`, not the whole world. Frames: per-tick data every frame, slow data (samples, log, commands, selected bot memory) about 4 Hz, when paused, and after commands/selects/resets/loads.
  - One `advance` in flight, ticks pile up (cap 200 = `MAX_TICKS_PER_FRAME`); `alpha` is applied with the matching frame. Frames are plain objects (about 35 KB and 0.4 ms at 64 bots; about 12 ms at the 2,000-bot cap, so typed arrays are an option only if populations ever get that large).
  - The `heat` message is reserved (accepted, ignored) for M15. Autosave flush on page close is best effort (async).
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** A save hashed in Node (CLI) and in Chrome differ for the same 60,000-tick run (same warning in the pre-M13 app), so cross-engine saves warn "different version"; cause not investigated (see GAME_DESIGN section 10). Eden preset numbers still await a feel check.
- **Exact Next Step:** M14 (family tree view) on top of `queryFamily`/`queryFounders`, then M15 (heatmaps using the reserved `heat` message). Before that, the lead should check the deployed site after pushing (worker URL under `/GardenOfEden/`).
