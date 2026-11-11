# Project Handoff State

- **Last Updated By:** Claude (implementer, cross-engine hash fix)
- **Current Goal:** M0 to M15 are built. The Node vs Chrome state hash difference is fixed (same run, same hash in both). Nothing is planned after it (see GAME_DESIGN section 9 "Later"). Not committed or pushed: the lead verifies and commits.
- **Recent Changes (cross-engine determinism):**
  - Root cause: `Math.cos`, `sin`, `atan2` and `log` are not bit-exact between V8 builds (Node 24 / V8 13.6 vs Chrome 156). First divergence at tick 1: bot 101's x differed in the last bit (3.036558786856637 in Chrome, 3.0365587868566366 in Node). `Math.hypot` and `Math.pow(x, 3)` happened to agree but are not guaranteed.
  - New `src/sim/exactMath.ts` (`sin`, `cos`, `atan`, `atan2`, `log`, `exp`, `pow`, `hypot`; only + - * / and sqrt, about 1e-15 accurate). Swapped in at `commands.ts`, `metabolism.ts`, `movement.ts`, `nodes.ts`, `perception.ts`, `reproduction.ts`, `rng.ts` (Box-Muller), `ruins.ts`, `worldEvents.ts`.
  - Guard: `tests/architecture.test.ts` bans the inexact `Math.*` functions and `**` in non-test `src/sim` files (fixture tests added). `tests/exactMath.test.ts` checks accuracy against `Math` and pins golden bit patterns.
  - Docs: `CLAUDE.md` (Conventions rule), `doc/GAME_DESIGN.md` (section 10 resolved, changelog), idea brief changelog.
- **Active Decisions / Constraints:**
  - Sim math must be bit-exact: use `exactMath.ts`, never the banned `Math` functions or `**`. Changing `exactMath.ts` changes every hash.
  - All hashes changed once. Old saves load with the "different version" warning. Survey tables (seeds a..j, 20,000 and 60,000 ticks) are identical before and after, so tuning is unchanged.
  - `JSON.stringify` of floats is safe across engines (ECMAScript fixes the shortest round-trip string).
  - Verified Node = Chrome at 1,000 / 5,000 / 20,000 / 60,000 ticks (seed a) and 20,000 (seeds b, j, zz-7); a CLI save loads in the browser with a matching hash. Firefox and Safari not tested.
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** one neutral ramp or a hue per layer for heatmaps; is the "recent" window right (half-life about 658 ticks); the heat legend is just under the fold at 1280x800. Eden preset feel check. Noticed, not changed: restarting writes the new empty run over the autosave (the documented M9 design).
- **Exact Next Step:** the lead reviews the diff, commits and pushes, then checks the deployed site loads a CLI-made save without the version warning.
