# Project Handoff State

- **Last Updated By:** Claude (implementer)
- **Current Goal:** Garden of Eden M0 to M6 are committed and pushed. M7a (ruin node) is built but NOT committed or pushed (the lead verifies and commits). M7b (water) is not started.
- **Recent Changes (M7a, ruins):**
  - New `src/sim/ruins.ts` (`ruinAmount`, `leaveRuin`, `decayRuins`). `step.ts`: after children are spawned each dead bot leaves a ruin, then resources regrow, then ruins decay and emptied ones are removed.
  - `types.ts`: `NodeKind` + `ruin`, `WorldNode`/`NodeDef` + `decay`, `Tuning.ruin` (`baseAmount` 24, `energyShare` 0.5, `mergeRadius` 2, `maxCount` 60), `World.eaten` ({resource, ruin} food units eaten), `SimEventType` lost `depleted`. `nodeDefs.ruin`: radius 1, capacity 60, decay 0.05.
  - `nodes.ts`: `exposureAt` skips ruins (it only reads danger and shelter), `eat` counts `world.eaten` and no longer logs. `perception.ts`: `isFood`, `chooseFood` takes ruins (no retry of an empty one). `commands.ts`: ruins cannot be placed; `maxNodes` counts placed nodes only (`placedNodeCount` in `world.ts`).
  - UI: ruin is a violet diamond with U (`render.ts`, `labels.ts`, legend in `App.tsx`, `.key-ruin` in `styles.css`), Inspector rows (amount, decay, time left), Food tile detail "+N in ruins" (resource food stays the tile value and chart line; chart legend says "Resource food"), EventLog lost the Depleted filter.
  - Harness: `ruin%` column (share of food eaten from ruins) in the survey and CLI, plus a `ruins` column (food units in ruins) in the single-run CLI table.
  - Tests: new `tests/ruins.test.ts` (amount, merge, cap, decay, eating, safe removal, player cap, determinism, replay); additions in `nodes.test.ts` and `perception.test.ts`; test helpers got `decay` and `eaten`.
- **Active Decisions / Constraints:**
  - Ruins are sim-made only. Player can inspect and Remove them (a recorded `removeNode`), not place them. No RNG, no log events for ruins. Depletions are no longer logged, so the log holds births, deaths and commands.
  - Tuning kept all 10 seeds surviving 20,000 ticks (27 to 76 bots, swings about 1.5 to 2.2x); `tests/tuning.test.ts` thresholds unchanged. Ruins give about 6 to 8% of food eaten at 20,000 ticks, 8 to 10% at 60,000.
  - Side effect to watch: over 60,000 ticks mean caution drifts down to about 0.28 to 0.35 and danger deaths rise (up to about 170 per run on some seeds), since ruins in groves feed desperate bots.
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** Is the lower caution / more danger deaths over long runs a story worth keeping, or should ruins in danger zones be smaller? Eden swings (about 2x) and the founders' age-death dip near tick 3000 still await a feel check. Built-in browser pane was used for M7a (ruins render, inspect and remove fine at desktop and 375px), but smooth motion was not judged by eye.
- **Exact Next Step:** Lead verifies and commits M7a. Then M7b (water) needs a design decision first (what does water do: a second need, a drain, a new death cause?) before code; record it in `doc/GAME_DESIGN.md` section 4 as `[PROVISIONAL]`.
