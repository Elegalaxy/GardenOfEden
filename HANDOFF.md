# Project Handoff State

- **Last Updated By:** Claude (implementer), M11 stage; the lead verifies, commits and pushes.
- **Current Goal:** Garden of Eden M0 to M11 built. M11 (lineage records) is done in the working tree and not committed. Next stages are not started (M12 tuning, worker, tree view UI, heatmaps).
- **Recent Changes (M11, lineage records):**
  - New `src/sim/lineage.ts`: `addRecord`, `recordDeath`, `findRecord` (binary search), `pruneLineage`, pure queries `familyView` and `founderLines`.
  - `types.ts`: `LineageRecord`, `World.lineage`, `World.lineagePruned`, `Tuning.lineage`. `tuning.ts`: `lineage { maxRecords 3000, pruneTo 2400 }`.
  - Hooks: `world.ts` createWorld (founders), `commands.ts` placeBot, `reproduction.ts` spawnChildren (parent `children` +1), `step.ts` and `worldEvents.ts` (recordDeath beside each `deathsByCause` increment), `step.ts` (pruneLineage after spawnChildren).
  - Survey and CLI got `lineage` and `pruned` columns. World literals in `nodes.test.ts` and `perception.test.ts` got the two fields.
  - Tests: `tests/lineage.test.ts`. Docs: `CLAUDE.md`, `doc/GAME_DESIGN.md` (item 11, tick order, M11 row, open question, changelog), idea doc changelog.
- **Active Decisions / Constraints:**
  - Lineage is bookkeeping: no RNG, nothing reads it back. Seeds a..j reproduce the post-M10 survey tables exactly at 20,000 and 60,000 ticks (only the hash changes). `src/persist` and saves are unchanged.
  - Pruning (only when over 3,000): mark records with a living descendant, drop extinct branches (earliest death, then lowest id) down to 2,400, then the oldest dead ancestors; a living bot's record is never dropped. An orphan (parent record gone) is valid.
  - `familyView`/`founderLines` descendant counts cover kept records only and exclude the record itself. Siblings are shown with the most living members first.
  - Cost at 60,000 ticks: state JSON about 410 KB to about 1 MB, `stateHash` about 15 ms to about 45 ms.
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** Is 3,000 records (pruned to 2,400) right? About half the seeds prune within 60,000 ticks. `depleted` events fill the 500-event log (older question); eden preset feel check still pending.
- **Exact Next Step:** Lead verifies and commits M11. Then the later stages: tree view UI over `familyView`/`founderLines` (needs a design pass), M12 tuning, the worker (moves hashing off the main thread), heatmaps.
