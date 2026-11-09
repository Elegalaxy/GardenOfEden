# Project Handoff State

- **Last Updated By:** Claude (implementer)
- **Current Goal:** Garden of Eden M0 to M8 are built (MVP, traits, ruins, water, world events). M8 is built and verified but NOT committed or pushed (the lead does that). No milestone after M8 is planned.
- **Recent Changes (M8, world events):**
  - Sim: `src/sim/worldEvents.ts` (new: `checkEvent`, `startEvent`, meteor `strike`, `expireEvents`, `activeEntries`), `commands.ts` (`triggerEvent`), `step.ts` (`expireEvents` after `decayRuins`), `nodes.ts` (`Exposure.plague`, `regrowthMultiplier`), `metabolism.ts` (plague damage; `deathCause(bot, exposure, tuning)`), `world.ts`, `types.ts` (`World.events`, `WorldNode.expires`, causes `plague` and `meteor`, `Tuning.events`, log type `event`).
  - Content: `tuning.events` (drought x0.35 for 1500, bounty x3 for 1000, plague 0.8/tick radius 14 for 800, meteor radius 6 damage 200, crater radius 3 damage 2 for 600, caps 3 timed and 6 craters).
  - UI: `EventsPanel.tsx` + `eventInfo.ts` (cards, keys D B P M, in-progress list), `tools.ts` (`EVENT_TOOLS`), `store.ts`, `WorldCanvas.tsx` (banners, ghost radius), `render.ts` (plague hatch, crater, impact ring), `PopulationChart.tsx` + `chartMath.ts` (`eventBands`, markers H F P M), `EventLog.tsx` (World filter), `DeathCauses.tsx`, `Inspector.tsx`, `labels.ts`, CSS.
  - Harness: `src/harness/script.ts` (`--event drought@3000`, `plague@6000:48,32`, repeatable), `survey.ts`, `cli.ts` (plague and meteor columns).
  - Tests: `tests/events.test.ts` (effects, refusals, replay, scripted survival a..e), `tests/script.test.ts`, `src/ui/eventInfo.test.ts`, plus additions to nodes, tools, labels, chartMath, store tests.
  - Docs: `CLAUDE.md`, `doc/GAME_DESIGN.md` (section 7 item 3, milestone M8, changelog, open questions), `../docs/ideas/garden-of-eden.md` changelog.
- **Active Decisions / Constraints:**
  - Events are commands applied between ticks, recorded, replay-safe, no RNG draws. Event-free runs behave exactly as before (same survey numbers a..j); only the state hash changed (new fields).
  - Bots do not perceive a plague (deliberate, documented). A meteor kills at command time with cause `meteor`; its crater is a `danger` node with `expires`, avoided through the normal danger paths.
  - Death cause when health runs out: `plague` if plague damage that tick was larger than danger damage, else `danger`.
  - Effect sizes (tick 3000, 1500-tick window, aimed at the busiest spot): drought -45%, bounty +85%, plague -23%, meteor -5% (about 3 bots). Drought lowest value on any seed 10.
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** Are the event sizes right (the meteor is a small local strike)? Should bots perceive plagues? Should a drought and a bounty exclude each other (today they multiply)? Plus the older ones: eden swings about 2x; trait costs; whether the M5 observer UI is enough.
- **Exact Next Step:** The lead reviews and commits M8. Then the user decides what comes next (further events, saves in `src/persist`, or retuning). The built-in browser pane was used for the M8 check; frame timing and smooth bot motion were still not judged by eye.
