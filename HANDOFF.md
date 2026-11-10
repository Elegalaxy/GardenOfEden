# Project Handoff State

- **Last Updated By:** Claude (implementer, M15)
- **Current Goal:** M0 to M15 are built. M15 added heatmap overlays (traffic, births, deaths; all time or recent). Nothing is planned after it (see GAME_DESIGN section 9 "Later"). Not committed or pushed: the lead verifies and commits.
- **Recent Changes (M15, heatmaps):**
  - New in `src/ui`: `heat.ts` (pure: `HeatGrid`, `createHeat`, `observeWorld`, `snapshotHeat`, `heatBin`, `legendBins`, `nextHeatLayer`, `isHeatKey`), `heatRender.ts` (offscreen canvas, ramp, `drawHeat`, `drawHeatCursor`), `HeatLegend.tsx` (controls, legend, hover readout, key H), `typing.ts` (shared `isTypingTarget`, moved out of `Toolbar.tsx`). Tests: `heat.test.ts`, `simHostHeat.test.ts`, `heatRender.test.ts`, `storeHeat.test.ts`.
  - Changed: `simHost.ts` (owns the grid, observes after steps, commands and in the load's replay; answers `heat`), `replayJob.ts` (optional `onTick` hook), `protocol.ts` (`heat{layer, range}` typed, new `heatSnapshot` message), `store.ts` (`heatLayer`, `heatRange`, `heat` in the snapshot, `setHeatLayer`, `setHeatRange`, `cycleHeatLayer`, `setHoverCell`, `useHoverCell`), `render.ts`, `WorldCanvas.tsx`, `App.tsx`, `panels.css` (grid area `heat`), `simHost.test.ts` (old "heat reserved" test removed).
  - `src/sim`, `src/content`, `src/persist` and `tests/` untouched; survey rows (seeds a,b,c, 20000 ticks) identical before and after.
  - Docs: `CLAUDE.md` (Heatmaps section, panels, protocol), `doc/GAME_DESIGN.md` (section 8 item 7, M15 row, open question, changelog), idea brief changelog.
- **Active Decisions / Constraints:**
  - Heat is outside the World, always accumulated, never hashed or saved; a load rebuilds it by replay (bit-identical, tested). `heatSnapshot` is its own message (not in the frame), sent only while a layer is on, at most about 4 Hz while running, always when paused and after commands, resets and loads.
  - The heat panel is its own grid area under the map's status line; its body reserves height per breakpoint in `panels.css`. Map rect is unchanged at every size measured (1440x900, 1280x800, 1100x800, 1024x768, 768x1024, 375x812, 290 wide). If the legend text changes, re-measure.
  - Display constants (decay 0.9 per 100 ticks, 5 bins, ramp alphas) live in `heat.ts` / `heatRender.ts`, not `tuning.ts`.
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** one neutral ramp or a hue per layer; is the "recent" window right (half-life about 658 ticks); the legend is just under the fold at 1280x800 (layer buttons visible, key H works anywhere). Existing: cross-engine hash difference for 60,000-tick saves (GAME_DESIGN section 10); eden preset feel check. Noticed, not changed: restarting writes the new empty run over the autosave (the documented M9 design).
- **Exact Next Step:** the lead reviews the M15 diff, commits and pushes, then checks the deployed site (worker URL under `/GardenOfEden/`) with a heat layer on.
