# Project Handoff State

- **Last Updated By:** Claude (implementer, M9)
- **Current Goal:** Garden of Eden M0 to M9 are built (MVP plus trait inheritance, ruins, water and thirst, world events, save and load). M9 is implemented and verified but not committed (the lead commits and pushes).
- **Recent Changes (M9, save and load):**
  - `src/persist/save.ts` (+ test): versioned save `{version, seed, presetId, tick, hash, commands}`, `encodeSave`, `decodeSave` / `validateSave` (strict, typed `SaveError`, never throws), `makeSave`, `saveFileName`. `share.ts` (+ test): base64url link in `#run=`, cap 12,000 chars. `autosave.ts` (+ test): read/write/clear through an injected storage.
  - `src/ui/replayJob.ts`: replay in slices (same result as `replayWorld`). `store.ts`: `presetId`, `runId`, `saveNotice`, `load` progress in the snapshot; `exportSave`, `startLoad` (promise; swaps the world in only when complete, paused, hash check with warning), `cancelLoad`, `reportSave`. While loading, `advance`, `dispatch`, tools and `resetWorld` are blocked.
  - `src/ui/SavePanel.tsx` (save file, load file with confirm if the run has commands, copy link with manual-copy fallback, resume and clear autosave, progress and cancel), `autosave.ts` (throttled writer), `shareLink.ts` (loads `#run=` at start and on `hashchange`, then strips the fragment), `download.ts`; `App.tsx`, `RunPanel.tsx` (restart disabled while loading), `panels.css`.
  - Tests: `tests/save.test.ts` (replay hash equals live run with events and placements, chunked equals one-shot, link roundtrip, kind lists match content), `src/ui/loadRun.test.ts` (load success, hash warning, failure keeps old run, cancel, blocked while loading).
  - Docs: `doc/GAME_DESIGN.md` (section 8 item 4 save format, M9 row, changelog, open question), `CLAUDE.md`, `../docs/ideas/garden-of-eden.md`.
- **Active Decisions / Constraints:**
  - A save is seed + preset + commands + tick + hash; no sim code changed, so no run hash changed. A bigger `version` is refused; add an `upgradeSave` step when the format changes. Command key order is part of the hash, so the decoder rebuilds commands in the sim's order.
  - Share links are capped (12,000 chars, about 150 commands); longer runs use the file. A link loads without confirmation; file and resume loads confirm only when the current run has commands.
  - Autosave only runs for a run with a command or one started on purpose (restart or load), so opening the page never overwrites the last real run. Clear suspends autosave until the run changes.
  - Replay speed is about 4,000 ticks per second; a 60,000-tick load takes about 15 s with a cancel button.
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** Compressed share links (async `CompressionStream`)? Keep pause or speed in a save? Simulation version in a save so the hash warning can say which side is newer? Earlier: `depleted` events no longer logged (done in M7a); eden numbers still await a feel check.
- **Exact Next Step:** The lead verifies and commits M9. The frame loop and the live autosave throttle were not seen running (the built-in browser pane does not fire animation frames), so open the app in a visible browser, play a minute, reload and try Resume last run. Then pick the next milestone with the user.
