# Project Handoff State

- **Last Updated By:** Claude (implementer, M19 bulk placing and heat hue per layer)
- **Current Goal:** M0 to M19 are built. Nothing is planned after it (GAME_DESIGN section 9 "Later"). Not committed or pushed: the lead verifies and commits.
- **Recent Changes (M19, UI and worker only; no sim, content or persist change, SIM_VERSION still 4):**
  - Bulk placing: `protocol.ts` messages `commands{reqId, cmds}` and `commandsResult{reqId, results[]}`; `simHost.ts` `case 'commands'` (`MAX_BATCH` 500, only placeNode/placeBot, refused during a load, one frame + one result + one heat snapshot, `observeWorld` once; commands recorded by `applyCommand` as usual).
  - `store.ts`: `dispatchBatch(cmds, noun)`, `setPlaceCount`, snapshot `placeCount`; `clickMap` sends a batch of random distinct cell centres when the count is above 1. New `bulk.ts` (`PLACE_COUNTS` 1/10/50/200, `spreadPoints`, `bulkCommands`, `batchNotice`), `tools.ts` `placesThings`.
  - `Toolbar.tsx` `PlaceCount` beside the notice in `ToolStatus` (44px buttons, hidden by `visibility` for other tools); `panels.css` `.tool-notice-row`, `.place-*`.
  - Heat hue: `heatRender.ts` `HEAT_RGB` per layer (traffic amber 255,168,40; births pink 255,128,190; deaths orange 255,92,56), `heatBinColor(layer, bin)`, `heatHue(layer)`; `HeatLegend.tsx` swatches and a readout marker use the hue.
  - Tests: new `bulk.test.ts`, `simHostBatch.test.ts` (same hash, commands and heat as one by one); `store.test.ts` dispatchBatch block; `heatRender.test.ts` updated.
  - Docs: CLAUDE.md, GAME_DESIGN (status, section 8 items 7 and 8, M19 row, open question resolved, changelog), idea brief changelog.
- **Active Decisions / Constraints:**
  - The Place row sits beside the notice (not the hint) so text widths stay as before; the tool-status block grew about 3 px (about 48 px on a phone where the row wraps).
  - Survey `--seeds a,b,c --ticks 20000 --warmup 1000` identical before and after. 1,000-bot batch about 30 ms (200 single commands took 1.7 s).
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** hue choice (amber / pink / orange) after a look on the real map; should a bulk click also place where the player clicked (a cluster) instead of spreading over the whole map; energy penalty at 0 and mate choice (M18); "recent" window.
- **Exact Next Step:** the lead reviews the diff, commits and pushes (user's standing rule).
