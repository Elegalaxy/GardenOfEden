# Project Handoff State

- **Last Updated By:** Claude (implementer)
- **Current Goal:** Garden of Eden MVP plus M6 to M9 are built (traits, ruins, water, world events, save/load). The UI layout polish stage is done and awaiting the lead's verify, commit and push. No sim change: `src/sim`, `src/content` and every state hash are untouched (the 3-seed survey is byte-identical).
- **Recent Changes (UI layout polish, all in `src/ui` plus docs):**
  - `RunMenu.tsx` (new): header "Run & save" disclosure holding `RunPanel` (seed form, `onStarted` closes the menu) and `SavePanel` (no longer a full-width panel). Floating over the page, closed by default, Esc / outside click / button close it, forced open while a load runs, results shown as a toast when shut (success fades after 6 s, warn/error stay until dismissed).
  - `App.tsx` / `panels.css` / `styles.css`: `.workspace` is a named-area grid (phone: map, status, speed, tools, stats, panels; 901px: main + 360px side; 1100px: tool rail left of the map). Stats strip is one slim row. Map width is capped by `--map-chrome` so it fits the screen height; phone map is edge to edge. Legend moved into its own panel area; `EmptyWorld` is now a chip over the map (`WorldCanvas` takes children).
  - `Toolbar.tsx`: split into `Toolbar` (buttons, keys) and `ToolStatus` (hint + notice, under the map, reserved height) so switching tools or placing never moves anything.
  - Map event banners are one-line chips (effect text hidden below 560px via a container query); `render.ts` plague label shrinks via `fitLabel`/`chordWidth` (`labels.ts`) or hides on a tiny zone.
  - `chartMath.ts`: `xAxisTicks` and `tickLabel` choose x-axis ticks from the plot width (tests in `chartMath.test.ts`); `PopulationChart.tsx` uses them. Trait mini charts have no x labels.
  - Docs: `CLAUDE.md` (UI layout rules), `doc/GAME_DESIGN.md` (section 7 item 5, changelog), `../docs/ideas/garden-of-eden.md` changelog.
- **Active Decisions / Constraints:**
  - `--map-chrome` (per breakpoint in `panels.css`) must be updated if rows above or below the map change. Map frame uses `box-shadow`, not a border (the canvas must fill the measured box).
  - Everything that changes while playing must reserve its height or float (hint, notice, toast, menu, chips, empty note). Buttons stay at 44px or more on every layout; nothing was shrunk.
  - Hint text for Esc is hidden only on `(max-width: 640px) and (pointer: coarse)`; the keys still work.
  - Sticky map was considered and left out (the first screen already holds map, controls, tools). Layout max-width is still 1280px.
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** Tile detail lines (for example "+1,234 in ruins") truncate with an ellipsis (full text in the tooltip) once numbers get large in the one-row stats strip. Eden preset feel check and the older log question still stand.
- **Exact Next Step:** The lead verifies (`npm test`, lint, typecheck, build), commits and pushes the UI polish, then re-checks the deployed site at 1280x800 and on a phone. After that, pick the next stage with the user.
