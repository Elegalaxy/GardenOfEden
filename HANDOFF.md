# Project Handoff State

- **Last Updated By:** Claude (implementer)
- **Current Goal:** Garden of Eden MVP (M0 to M5) plus M6 (trait inheritance with mutation) is built. Nothing is planned beyond M6; saves (`src/persist`), more node purposes and societal events are `[LATER]` / `[OPEN]` in `doc/GAME_DESIGN.md`.
- **Recent Changes (M6, traits):**
  - Sim: `src/sim/traits.ts` (new: `mutateTraits`, `traitStats`, `meanTraits`, `TRAIT_NAMES`), `reproduction.ts` (child traits mutate, 8 extra `birth` draws per child, parent burns `birthCost`), `metabolism.ts` (`speedOf`, sense-radius drain), `movement.ts` (uses `speedOf`), `world.ts` (`Sample.traits` = population mean), `stats.ts` (`traitDrift`), `types.ts`.
  - Content: `tuning.ts` got `mutation` (rate 0.5, strength 0.1, bounds), `bot.senseDrain` 0.02, `bot.metabolismSpeed` 2, `bot.birthCost` 20.
  - UI: `TraitChart.tsx` (small multiples), `TraitSummary.tsx` (mean/min/max table + spread bar), `traitMath.ts`, `useElementWidth.ts` (moved out of `PopulationChart`), Inspector shows +/- vs population mean, `labels.ts` trait labels, `panels.css`. Depleted filter in `EventLog.tsx` is now OFF by default.
  - Harness: `--seeds` survey and single-run table print mean traits; a "founders:" line precedes them.
  - Tests: `tests/traits.test.ts` (bounds, strength 0, determinism, replay with commands, costs, selection on 6 seeds), `src/sim/traits.test.ts`, `src/ui/traitMath.test.ts`, trait cases in `src/sim/stats.test.ts`; `tests/survival.test.ts` birth test updated for `birthCost`.
  - Docs: `CLAUDE.md`, `doc/GAME_DESIGN.md` (rules, milestone table, changelog), `../docs/ideas/garden-of-eden.md` changelog.
- **Active Decisions / Constraints:**
  - `birthCost` is new: it changes the old "child share is a pure transfer" rule. It is what stops `reproThreshold` pinning to its floor. Every state hash changed (mutation draws, new energy rules); hashes are only compared, never pinned, so no test constants moved.
  - Metabolism also scales speed (`1 + 2 x (m - 1)`); at `metabolismSpeed` 1 travel cost per cell is flat and metabolism evolved to its floor, so keep it above 1.
  - `reproThreshold` upper bound is 90 (bots stop eating at 90, so a higher value could never be reached).
  - Founders and placed bots keep default traits. A command is applied between ticks and recorded as `{tick, cmd}`. Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
  - Retune with `npm run sim -- --seeds a,b,c,d --ticks 60000`; check final mean traits are not all at their bounds.
- **Open Questions for the user:** (1) Depletions still fill the sim's 500-event buffer (the UI now hides them by default), so older births, deaths and commands still scroll out; give depletions their own buffer or stop logging them? (2) Over 60,000 ticks `reproThreshold` falls from 80 to about 59-66 on every seed, metabolism and sense radius stay near their founder values, caution drifts down slightly. Is that the trait story wanted? (3) Eden swings (about 23 to 75 bots, about 2x) still await a feel check.
- **Exact Next Step:** The user looks at the app in a visible browser window (the built-in pane was hidden, so timers, screenshots and smooth motion were only partly checked), then decides the open questions above. Nothing else is queued.
