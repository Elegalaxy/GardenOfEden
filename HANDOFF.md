# Project Handoff State

- **Last Updated By:** Claude (implementer), M10 stage. Nothing committed or pushed by the implementer.
- **Current Goal:** Garden of Eden M0 to M10 are built (MVP, water, world events, save/load, UI polish, family knowledge sharing). M11 (lineage) is next and not started; the user has not asked for it yet.
- **Recent Changes (M10, family knowledge sharing):**
  - `src/sim/family.ts` (new): `inheritMemory`, `mergeMemory`, `shareFamilyKnowledge`. New step phase after `expireEvents`, before the stats sample (`step.ts`). `perception.ts`: `trimMemory` split out of `remember`; `remember` sets `learnedFrom: null`. `reproduction.ts`: `Conception.memory`; the child copies it via `inheritMemory` when `family.inherit`.
  - `types.ts`: `MemoryEntry.learnedFrom`, `World.familyLearned`, `Tuning.family`. `tuning.ts`: `family { inherit true, shareRadius 3, shareEvery 10, shareKinds resource/water/shelter/danger }`. `world.ts`: `familyLearned: 0`.
  - Harness: survey/CLI `learned` column and `--no-family` flag (`withoutFamily` in `survey.ts`).
  - UI: `Inspector.tsx` (memory row "n / 10 nodes · k from family", Family section: parent, living children), `render.ts` (dotted lines from a selected bot to its living parent and children).
  - Tests: `tests/family.test.ts`, `trimMemory`/`learnedFrom` tests in `src/sim/perception.test.ts`; World literal in `nodes.test.ts` updated.
  - Docs: `CLAUDE.md`, `doc/GAME_DESIGN.md` (5.1 and 5.2 rewritten as `[CONFIRMED]` with the family exception, new item 10, milestone table, open question, changelog), `../docs/ideas/garden-of-eden.md`.
- **Active Decisions / Constraints:**
  - Sharing is parent-child only (siblings and grandparents hear it by relay); no player goals; no random draws; ruins are never shared. A copy keeps the original `seenTick` and `amount`, and is dropped by the normal 8+2 trim if it is the oldest.
  - With `--no-family` (`inherit:false`, `shareRadius:0`) seeds a..j match the pre-M10 numbers exactly at 20k and 60k ticks; only the state hash changed. Old saves load with the existing hash-mismatch warning (accepted; no sim version added).
  - With sharing on: thirst deaths about -60%, births -7 to -9%, population 19..76 (20k) and 19..97 (60k), swing >= 1.5 on every seed. No retuning needed; `tests/tuning.test.ts` unchanged.
  - Retune order if a run gets too stable: raise `shareEvery`, shrink `shareRadius`, drop `resource` from `shareKinds`, inherit only.
  - A command is applied between ticks and recorded as `{tick, cmd}`; never import `rpg/` or `trading-sim/`; do not commit or push unless the user asks.
- **Open Questions for the user:** Is the family effect (fewer thirst deaths, mostly invisible on the map) what you want, and is the dotted family line plus inspector rows enough, or should M11 add a lineage view? Eden numbers (about 20 to 97 bots, swings about 2x) still await a feel check in a visible browser window (the built-in pane was small and the dotted lines were only checked at a phone-sized map).
- **Exact Next Step:** The lead verifies the diff, runs the tests and commits and pushes M10. Then, only if the user asks, plan M11 (lineage).
