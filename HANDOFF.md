# Project Handoff State

- **Last Updated By:** Claude (implementer, compressed share links)
- **Current Goal:** M0 to M15 are built, plus the cross-engine hash fix, typed-array frames and now compressed share links. Nothing is planned after it (see GAME_DESIGN section 9 "Later"). Not committed or pushed: the lead verifies and commits.
- **Recent Changes (compressed share links):**
  - New `src/persist/deflate.ts` (`deflateBytes`, `inflateBytes(bytes, maxBytes)`, `deflateSupported`): raw deflate through `CompressionStream` / `DecompressionStream`, never throws, stops unpacking past a byte limit (zip-bomb guard). No imports; persist has no banned globals, so `tests/architecture.test.ts` is unchanged.
  - `src/persist/share.ts` rewritten: `#run2=<base64url of deflate-raw of the save JSON>` (new, written whenever shorter than plain) and `#run=<plain base64url>` (old, still read). `encodeShare`, `decodeShare(payload, format)` and `readShareFragment` are async; `parseShareFragment` is the sync marker check; `encodeShareLegacy` writes the old form. Caps: link 64,000 characters (`SHARE_MAX_CHARS`), plain 12,000 (`SHARE_MAX_CHARS_PLAIN`), unpacked 1,000,000 bytes, read limit 256,000 characters.
  - `src/ui/shareLink.ts` (async `loadFromLocation`, fragment stripped before unpacking), `SavePanel.tsx` (share fit is async state, last answer kept so nothing flickers; Copy share link awaits the encode).
  - Tests: `src/persist/share.test.ts` (rewritten), `src/ui/shareLink.test.ts` (new, stand-in `window`, hashchange), `tests/save.test.ts` (async link test).
  - Docs: CLAUDE.md, GAME_DESIGN (section 8 item 4, open question, changelog), idea brief changelog.
  - `src/sim`, `src/content` untouched; survey rows (seeds a,b,c, 20000 ticks, warmup 1000) identical before and after.
- **Active Decisions / Constraints:**
  - Measured link lengths: 0 commands 122 (plain 130), 5 commands 244 (522), 150 commands 1,950 (13,264), 1,000 commands 10,627 (87,379), 5,000 commands 50,642 (420,923). Cap of 64,000 stays under Safari (about 80,000) and older Firefox (65,536) address-bar limits.
  - Compact command encoding was not done: deflate already gives about 8x and command key order is part of the hash.
  - Link-level errors reuse save error codes (`not-json`, `too-large`); no new code.
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** unchanged from M15 (one neutral heat ramp or a hue per layer; "recent" window; legend just under the fold at 1280x800; eden preset feel check). Saves: should a save carry a simulation version.
- **Exact Next Step:** the lead reviews the diff, commits and pushes, then checks a compressed link on the deployed site (and in Safari/Firefox, which were not tried).
