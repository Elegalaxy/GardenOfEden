# Project Handoff State

- **Last Updated By:** Claude (implementer, M14)
- **Current Goal:** M0 to M14 are built. M14 added the family tree view; heatmaps (M15) are next and not started. Not committed or pushed: the lead verifies and commits.
- **Recent Changes (M14, family tree view):**
  - New in `src/ui`: `FamilyPanel.tsx` (focus card, KPI row, ancestors chain, descendants tree, founder lines table), `familyMath.ts` (pure: wording, flattening, indentation caps, tree keys, focus resolution, latest-only tickets; `familyMath.test.ts`), `familyFocus.ts` (override store: which record the panel shows, `focusRecord`, `revealFamily`, `pinFocusFor`), `useFamilyData.ts` (query hook: on focus change and about every 1 s while running, once per tick change while paused, stale answers dropped, last answer kept).
  - Changed: `App.tsx` (panel in `.side-family`, after the Inspector), `Inspector.tsx` ("Show family tree" for a selected bot, also in the Gone view), `store.ts` (`useStoreValue` selector hook only), `panels.css` (grid area `family` on phones, panel styles, and `.area-side { contain: size; align-self: stretch }`).
  - No file in `src/sim`, `src/content`, `protocol.ts` or `simHost.ts` changed; the survey rows are identical to before.
  - Docs: `CLAUDE.md`, `doc/GAME_DESIGN.md` (section 8 item 6, M14 row, open question, changelog), idea brief changelog.
- **Active Decisions / Constraints:**
  - The panel reads lineage through the worker `query` message (down 8, 400 nodes, 12 children per node); rows are capped at 200, founder lines at 60. A living row selects the bot and keeps the tree where it is; a dead row, a chip or a founder line focuses the panel only (the map selection never points at a dead record from the panel).
  - `.area-side` has `contain: size`: without it the taller side column (inspector 800+ px with a bot selected) stretched the grid rows and moved the map by 36 px at 1280x800.
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** Cross-engine save hashes (Node vs Chrome) still differ for 60,000-tick runs (GAME_DESIGN section 10). Is the family tree too busy on very long runs (see section 10)? Eden preset numbers still await a feel check.
- **Exact Next Step:** The lead verifies and commits M14, then M15 (heatmaps using the reserved `heat` message).
