# Project Handoff State

- **Last Updated By:** Claude (implementer, typed-array frames)
- **Current Goal:** M0 to M15 plus the cross-engine fix are built. This stage made the per-frame bot data cheap for large populations (typed-array frames). Nothing is planned after it. Not committed or pushed: the lead verifies and commits.
- **Recent Changes (typed-array frames):**
  - New `src/ui/botColumns.ts` (`packBots`, `unpackBots`, `packedBuffers`, `INTENT_KINDS`, strides) and `botColumns.test.ts` (round trip, -1 null codes, large ids, empty, 2,000 bots, transfer, inline client).
  - `protocol.ts`: `PackedBots`, `FastData.bots` is now `PackedBots`, `transferListOf(msg)`. `simHost.ts`: `buildFrame` packs (old `viewBot` removed). `viewWorld.ts`: `applyFrame` unpacks into fresh `ViewBot[]` each frame, `cloneFrame` helper. `sim.worker.ts` and `simClient.ts` (inline) post/clone with the transfer list. `simHost.test.ts`, `viewWorld.test.ts` adjusted (same intent).
  - Docs: `CLAUDE.md` (Worker section: frame format), `doc/GAME_DESIGN.md` (page's copy, open question, changelog), idea brief changelog.
  - `src/sim`, `src/content`, `src/persist`, panels, render, geometry untouched; survey rows (seeds a,b,c, 20000 ticks, warmup 1000) identical before and after.
- **Active Decisions / Constraints:**
  - Row-major typed arrays, 12 Float64 + 9 Int32 per bot (132 bytes vs about 390 as plain objects). All floats Float64 so means, samples and picks equal the World's. Ints exact below 2^31.
  - The page materialises `ViewBot` objects per frame (0.09 ms Node, 0.25 ms Chrome at 2,000 bots, under the 1 ms bar), so no column-view API was needed. Fresh objects each frame keep identity-based memo semantics.
  - A transferred frame's buffers are detached on the sender: never reuse a frame after posting it.
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** map draw cost at about 1,000+ bots and the per-command slow frame (placing about 1,450 bots one by one took 40 s, same before and after) are untouched; see GAME_DESIGN section 10. Older: heatmap ramp and window, eden preset feel check, share links not touched.
- **Exact Next Step:** the lead reviews the diff, commits and pushes, then checks the deployed site (new worker bundle) at 1x and 64x.
