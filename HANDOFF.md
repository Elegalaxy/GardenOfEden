# Project Handoff State

- **Last Updated By:** Claude (implementer)
- **Current Goal:** Garden of Eden MVP plus M6 to M9 and the UI layout polish are built and pushed. Two small UI-only fixes were just made and await the lead's verify, commit and push. No sim change: `src/sim`, `src/content` and every state hash are untouched (the 3-seed survey is byte-identical before and after).
- **Recent Changes (UI-only fixes):**
  - Death wording: `labels.ts` gained `CAUSE_SENTENCE` and `causeSentence(cause)` (Died of hunger / thirst / old age, Killed by danger / plague / a meteor). `Inspector.tsx` (gone notice) and `EventLog.tsx` (death rows, now "Died of hunger (bot #4) at x, y") use it; `CAUSE_LABEL` (noun, "Starved") stays for the death-causes table. Tests in `labels.test.ts`.
  - Event log keeps commands: `logMerge.ts` (new, pure) `mergeLog(log, commands)` rebuilds the commands the sim's 500-event ring dropped from `world.commands` and puts them before the ring. Dedupe is by order (every accepted command adds one log event and one `commands` entry, and the ring drops oldest first, so the ring holds the newest M of N commands). `EventLog.tsx` uses it for rows, filter counts, and the empty state; footer text updated. Tests in `logMerge.test.ts` (including a real run with `logCap` 6).
  - Docs: `doc/GAME_DESIGN.md` (section 7 item 1, open question reworded, changelog).
- **Active Decisions / Constraints:**
  - Rebuilt (old) command rows have no id for placed nodes, bots or craters, and a rebuilt removal has no kind or position, so they show less text and are not selectable. Births, deaths and world-event ends are still limited to the newest 500.
  - If the log's command events and `world.commands` ever stop matching one to one (a new command path that skips either), `mergeLog` would mis-count; keep them paired.
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** Is losing old deaths and births from the log acceptable? Eden preset feel check still stands.
- **Exact Next Step:** The lead verifies (`npm test`, lint, typecheck, build), commits and pushes, and checks the Event log in a visible browser window (not done here: the Browser pane was not open). After that, pick the next stage with the user.
