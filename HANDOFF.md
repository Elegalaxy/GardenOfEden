# Project Handoff State

- **Last Updated By:** Claude (implementer, stage 0 of the aging/sexes plan: simulation version in saves)
- **Current Goal:** M0 to M15 are built. Working through the approved plan (scratchpad `PLAN_AGING_SEX.md`: aging fertility, two sexes, inbreeding penalty), one stage at a time. Stage 0 is done; next is Stage 1. Not committed or pushed: the lead verifies and commits.
- **Recent Changes (stage 0):**
  - New `src/content/version.ts` (`SIM_VERSION = 1`, header says when to bump), re-exported from `src/content/index.ts`.
  - `src/persist/save.ts`: `SAVE_VERSION` 2, `Save.sim` after `presetId` (key order version, seed, presetId, sim, tick, hash, commands), `MAX_SIM_VERSION` 1,000,000, `sim` validated as an integer 1..max, `upgradeSave` turns a version 1 save into version 2 with `sim: 1`, `makeSave(run, presetId, hash, sim)`.
  - `src/ui/simHost.ts` and `SavePanel.tsx` pass `SIM_VERSION`; `src/ui/store.ts` has `mismatchWarning(saveSim, current)` (older / newer wording with both rules versions, else the old `MISMATCH_WARNING`) and keeps `sim` on the pending load.
  - Tests: `src/persist/save.test.ts` (v1 upgrade, v2 round trip, bad sim), `src/ui/loadRun.test.ts` (newer / older wording), save fixtures in autosave, share, simHost, simHostHeat and `tests/save.test.ts` gained `sim`.
  - Docs: GAME_DESIGN section 8 item 4, section 10 (two questions resolved), changelog; CLAUDE.md persist paragraph.
  - `src/sim` untouched; no hash changed.
- **Active Decisions / Constraints:**
  - SIM_VERSION stays 1 here; planned bumps: stage 1 -> 2, stage 2a -> 3, stage 2c -> 4 (stage 2b none).
  - Persist still imports no content; the ui passes the number.
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** unchanged (heat ramp, "recent" window, legend position at 1280x800, eden feel check).
- **Exact Next Step:** the lead reviews the diff, commits and pushes stage 0, then Stage 1 (aging fertility): first capture the 10-seed survey and the eden seed a hash at 3,000 ticks before any edit.
