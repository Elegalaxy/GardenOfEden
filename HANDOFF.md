# Project Handoff State

- **Last Updated By:** Claude (implementer, Stage 2a: two sexes with mate seeking, M17)
- **Current Goal:** M0 to M17 are built. Stage 2a of PLAN_AGING_SEX.md is done (SIM_VERSION 3); Stage 2b (two-parent family tree view) and 2c (inbreeding penalty, SIM_VERSION 4) are NOT started. Not committed or pushed: the lead verifies and commits.
- **Recent Changes (M17):**
  - Sim: `Bot.fatherId`/`sex`, `LineageRecord.fatherId`/`sex`, `Tuning.sex` (enabled, femaleChance, mateRange 4, maleCost 0, maleCooldown 50; no `balance`, sex is a plain coin flip), `brain.seekMateScore`. New `src/sim/mating.ts`: per-tick grid of ready females, `nearestMate`, `findBotById`. A ready male that senses a ready female within his sense radius gets the `seekMate` intent (target = bot id) and walks to her; bots never perceive each other otherwise. `pairMates` (after the bot loop): female must stand in a shelter, male within mateRange of her, matched nearest-pair-first. Crossover, father memory merge/exchange, two-parent lineage pruning. Sex off = old in-loop path.
  - Retune: eatRate 10, reproCooldown 100, birthCost 10, founders reproThreshold 65, maleCooldown 50. Tried and rejected: eatRate 8, mateRange 6/8, reproCooldown 150, birthCost 15 (see GAME_DESIGN changelog).
  - Harness: `--asexual`, survey column `fem`. UI: botColumns stride 11 (fatherId, sex; intent code 6 = seekMate), Inspector Sex/Mother/Father and a link to the sought female, Add bot hint with next sex. Layout of the hint and Inspector checked at 1280x800, 1024x768, 768x1024, 375x812, 290x700: no shift, no overflow.
  - Tests: tests/sex.test.ts (incl. mate search), tests/variants.ts (`asexual`, `stage1`), updates elsewhere; store.test.ts waits longer for a child.
- **Active Decisions / Constraints:**
  - Eden outcomes are chaotic: nearby settings flip single seeds under the drought/plague scripts. Re-run `tests/tuning.test.ts` and `tests/events.test.ts` after any tuning change.
  - Asexual control: `stage1(rules)` + eden seeds a/b at 5,000 ticks gives 214/48 and 223/57 as before M17.
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** eatRate 10 (was 5) is the price of two sexes; fine? Should females search too, or should the mate sense radius be larger than the food one? Females must stand in a shelter, males need not: keep?
- **Exact Next Step:** the lead reviews the diff, commits and pushes (note: `.claude/launch.json` was created for the browser check and should not be committed), then decide on Stage 2b.
