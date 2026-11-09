# Project Handoff State

- **Last Updated By:** Claude (implementer), M7b
- **Current Goal:** Garden of Eden M0 to M7b are built (MVP, traits, ruins, water and thirst). Nothing is committed from M7b yet: the lead verifies, commits and pushes. Saves (`src/persist`) and societal events are not started.
- **Recent Changes (M7b, water and thirst):**
  - Sim: `NodeKind` `water` (permanent spring, amount 0), `Bot.thirst`, `IntentKind` `seekWater`, `DeathCause` `thirst` (order danger, thirst, starve, age). `brain.ts` (seekWater utility), `perception.ts` (`chooseWater`, water memory slots `memory.waterCap`), `movement.ts`, `nodes.ts` (`drink`), `metabolism.ts` (thirst drain), `world.ts`, `reproduction.ts` (newborns start full).
  - Content: `tuning.ts` (thirst numbers, `thirstMetabolismPower` 3), `nodeDefs.ts`, `presets.ts` (eden: 34 scattered food nodes, 12 shelters, 4 fixed + 4 scattered springs).
  - UI: tools renumbered to keys 1-7 (water is 3), droplet shape with W, legend, Inspector thirst bar and water info, DeathCauses thirst row, labels. Harness prints a `thirst` column.
  - Tests: `tests/water.test.ts`, `src/ui/{tools,labels}.test.ts`, additions to `perception.test.ts` and `store.test.ts`; `survival.test.ts` now tops up thirst in the danger-avoidance test.
  - Docs: `CLAUDE.md`, `doc/GAME_DESIGN.md`, `../docs/ideas/garden-of-eden.md` changelog.
- **Active Decisions / Constraints:**
  - Thirst drain = 0.25 x `max(1, metabolism)^3` per tick. Plain `x metabolism` let metabolism 1.6 out-breed 0.9 (tests/traits.test.ts failed); also scaling cool bots down pinned the mean at the 0.7 bound over 60,000 ticks. Do not loosen without re-running both.
  - Water has its own 2 memory slots on top of the 8. A spring in a remembered danger is skipped unless thirst is under 20%.
  - Tuning (20,000 ticks, seeds a..j): 10 to 53 bots, thirst 10 to 29% of deaths. 60,000 ticks: 10 to 61, never extinct, metabolism means 0.79 to 1.03.
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** Populations were retuned after water (more food, shelters and springs in eden): swings still about 2x. Is that the feel? Are the trait stories fine (metabolism near 1, reproduction threshold falls to about 60)? Four of the eight springs are scattered, so "near food or shelter" is by chance. Pre-existing wording quirk: the inspector says "Died of starved".
- **Exact Next Step:** Look at the MVP plus water in a visible browser window (the built-in pane was hidden: the loop did not advance in it, so smooth motion and the running frame loop were not judged by eye; the sim was driven with Step instead). Then decide the next milestone (saves, or a first societal event).
