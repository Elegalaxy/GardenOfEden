# Project Handoff State

- **Last Updated By:** Claude (implementer)
- **Current Goal:** Garden of Eden MVP (M0 to M5) is built. M6 (trait inheritance with mutation) is next, not started.
- **Recent Changes (M4, player tools):**
  - `src/sim/commands.ts` (`checkCommand`, `applyCommand`), `replay.ts` (`replayWorld`), `stats.ts` (window change, per-minute rates). `types.ts`: `SimEvent` got `command` and `nodeKind`; `Tuning` got `stats.minuteTicks` (600), `player.minNodeGap` (1), `player.maxNodes` (400).
  - `src/ui`: `store.ts` rewritten (tool, selection, notice, `dispatch`, `clickMap`, `resetWorld`), `tools.ts`, `labels.ts`, `geometry.ts`, `Toolbar.tsx` (keys 1-6, Esc), `Inspector.tsx`, `WorldCanvas.tsx` (click, hover ghost, keyboard cursor), `render.ts` (overlay: selection, target line, ghost).
- **Recent Changes (M5, observability):**
  - `StatsStrip.tsx` replaces the deleted `Readout.tsx`; `PopulationChart.tsx` (+ `chartMath.ts`), `DeathCauses.tsx`, `EventLog.tsx`, `RunPanel.tsx` (seed + reset, confirm if commands exist), `App.tsx` layout, `panels.css`.
  - Tests: `tests/commands.test.ts` (replay hash equals live run), `src/sim/stats.test.ts`, `src/ui/{geometry,chartMath,store}.test.ts`.
  - Docs: `CLAUDE.md`, `doc/GAME_DESIGN.md` (tags, milestone table, changelog), `../docs/ideas/garden-of-eden.md` changelog.
- **Active Decisions / Constraints:**
  - A command is applied between ticks and recorded as `{tick, cmd}`; refused commands are not recorded. Placed bots draw their heading from the `world` stream, never `ai`.
  - UI snaps placements to cell centres. Same-kind nodes closer than 1 cell are refused; different kinds may overlap. Removing a bot is not a command.
  - Remove tool picks the smallest node under the click, newest first on ties.
  - A "minute" is 600 ticks (1 minute at 1x). Chart markers come from `world.commands`; the event log only holds the newest 500 events.
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** `depleted` events fill the 500-event log within a few hundred ticks, pushing player commands out of it. Filter depletions by default, or log fewer? Eden preset numbers (40 bots, swings about 2x) still await a feel check.
- **Exact Next Step:** M6 per the plan (offspring inherit traits with small mutations; `Traits` already exist, children copy the parent exactly in `reproduction.ts`). Before it, the user may want to look at the MVP in a visible browser window: the built-in pane was hidden during testing, so frame-loop timing and smooth bot motion were not judged by eye.
