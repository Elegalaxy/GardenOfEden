# Project Handoff State

- **Last Updated By:** Claude (implementer)
- **Current Goal:** Garden of Eden MVP plus M6-M12 are built. M12 (long-run tuning) is done and awaits the lead's verification and commit. Next planned work: web worker, family-tree view, heatmaps (not started).
- **Recent Changes (M12, long-run tuning):**
  - Problem: over 60,000 ticks mean caution fell to 0.22-0.37 (founders 0.5) and danger deaths rose (seeds c, e, i about 190-200). Ruins inside danger lured starving bots, and caution cost nothing.
  - `src/sim/ruins.ts`: `insideAnyDanger`, `ruinDecayRate`; `decayRuins(world, tuning)` now takes the tuning; a ruin whose centre is inside any danger node (zone, grove, crater) decays `ruin.dangerDecayMult` (5) times as fast.
  - `src/sim/brain.ts`: `desperateFraction(bot, tuning)` = `desperateBelow x (1 + cautionDesperate x (founder caution - caution))` clamped to `[minDesperate, maxDesperate]`; used by `decide` (food and water) and `isDesperate` (movement).
  - `src/sim/types.ts` + `src/content/tuning.ts`: `ruin.dangerDecayMult` 5; `brain.cautionDesperate` 4, `minDesperate` 0.05, `maxDesperate` 0.4. `src/ui/Inspector.tsx`: ruin Decay and Time left use `ruinDecayRate` (shows "(in danger)").
  - Result (seeds a..j, 60,000 ticks): mean caution 0.34 to 0.60 (every seed 0.46+), danger deaths 789 to 287, lowest/highest population 19/97 to 21/91, swings kept (lowest max/min 1.83). Decay alone: 0.41 and 563. 20,000 ticks: 0.48 to 0.52, danger 118 to 83.
  - Tests: `tests/desperate.test.ts` (new), `tests/ruins.test.ts` (decay in danger, crater), `tests/lineage.test.ts` (one test uses cap 150/100; seed c breeds slightly less early). Docs: `doc/GAME_DESIGN.md` (items 3, 8, 9, ruin item 6, M12 row, changelog), `../docs/ideas/garden-of-eden.md`, `CLAUDE.md`.
- **Active Decisions / Constraints:**
  - With `dangerDecayMult` 1 and `cautionDesperate` 0 the run equals the post-M11 run (same hashes). Both new rules are `[PROVISIONAL]`.
  - Starvation deaths are up about 6% (cautious bots no longer dive into groves); births up 3%. Groves in the eden preset are rarely fatal now on seeds d, f, g (0 to 1 danger deaths per 60,000 ticks).
  - `tests/sim.test.ts` "same state hash ... 5000 ticks" times out (5 s default) when the whole suite runs at once on this machine; it fails the same way on the pre-M12 code and passes alone. Not changed.
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** Are groves too safe now (a feel check in the browser)? Eden preset numbers still await a feel check; `depleted`-style log crowding is solved, but old births and deaths still scroll out of the 500-event log.
- **Exact Next Step:** Lead verifies (`npm test`, `npm run lint`, `npm run typecheck`, `npm run build`), then commits M12. After that, pick the next stage (worker, tree view or heatmaps) with the user.
