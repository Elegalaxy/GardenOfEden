# Project Handoff State

- **Last Updated By:** Claude (lead, bulk click clusters around the clicked cell)
- **Current Goal:** M0 to M19 are built, committed and pushed (M19: bulk placing and a heat hue per layer). Nothing is planned after it (GAME_DESIGN section 9 "Later").
- **Recent Changes:**
  - M19 (`ddcaf95`): `commands{reqId, cmds}` batch message (`simHost.ts`, `MAX_BATCH` 500, placeNode/placeBot only, one frame + one result + one heat snapshot), `store.ts` `dispatchBatch` / `setPlaceCount`, `bulk.ts`, `Toolbar.tsx` `PlaceCount` (1 / 10 / 50 / 200 beside the notice), heat hue per layer in `heatRender.ts` (amber traffic, pink births, orange deaths) and `HeatLegend.tsx`.
  - Uncommitted follow-up: a bulk click now clusters around the clicked cell. `bulk.ts` `clusterPoints` (disc around the cell, area about `count * cellsEach` cells with `BOT_CELLS_EACH` 2.5 and `NODE_CELLS_EACH` 9, grows until it holds enough cells, clipped to the map); `bulkCommands(..., around?)`; `store.ts` `clickMap` passes the clicked cell centre; tests in `bulk.test.ts`. `spreadPoints` (whole map) stays for calls without a position.
  - Sim, content and persist untouched since M18 (`SIM_VERSION` 4).
- **Active Decisions / Constraints:**
  - The Place row sits beside the notice, not the hint, so text widths stay as before.
  - The event scenes in `tests/events.test.ts` are knife-edge: re-run tuning, events and traits tests after any tuning change. Inbreeding `energyLoss` is 0 for that reason.
  - Never import `rpg/` or `trading-sim/`.
  - Commit and push after each stage (user's standing rule).
- **Open Questions for the user:** heat hues (deaths orange is the closest to the red danger zones); mate choice that avoids relatives; energy penalty at 0; the "recent" heat window; eden feel check; Firefox and Safari untried.
- **Exact Next Step:** commit and push the cluster change, then check the deployed site and play a few minutes on Eden and Blank.
