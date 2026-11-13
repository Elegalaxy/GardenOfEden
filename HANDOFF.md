# Project Handoff State

- **Last Updated By:** Claude (implementer, Stage 1 aging fertility, M16)
- **Current Goal:** Aging and sexes work, approved plan at the scratchpad `PLAN_AGING_SEX.md`. Stage 0 (sim version in saves) is committed. Stage 1 (aging fertility, asexual model kept) is built and verified but NOT committed: the lead reviews, commits and pushes. Next are Stage 2a (sexes), 2b (two-parent tree), 2c (inbreeding penalty); not started.
- **Recent Changes (Stage 1):**
  - `src/sim/types.ts`: `Tuning.fertility { startFraction, primeAge, declineAge, fertileUntil }`; `bot.adultAge` comment fixed.
  - `src/content/tuning.ts`: `fertility` block, values 0.5 / 600 / 1800 / 2600 (the plan defaults; no retune needed). `src/content/version.ts`: `SIM_VERSION` 2.
  - `src/sim/reproduction.ts`: pure `fertilityAt(age, tuning)`; `meetsReproductionNeeds` uses fertility > 0; `conceive` sets cooldown `ceil(reproCooldown / fertility)`. Newborn cooldown stays a full `reproCooldown`. `step.ts`, `brain.ts`: comments only.
  - Harness: survey/CLI column `pAge` (`meanParentAge`, `parentAgeCell` in `survey.ts`).
  - UI: `labels.ts` `fertilityLabel` + `FERTILITY_PHASE_LABEL`; Inspector rows Fertility, "Ready to breed in", Age child/adult/elder.
  - Tests: new `tests/fertility.test.ts` (curve, gate, cooldown, neutral-control hash e1069c163c8bf330 for eden seed a at 3,000 ticks), `labels.test.ts`, `tests/survival.test.ts`.
  - Docs: GAME_DESIGN (status, section 6 item 3a, M16 row, section 10, changelog with survey numbers), CLAUDE.md Sim flow, idea brief changelog.
- **Active Decisions / Constraints:**
  - Survey totals (a..j, 20k ticks): births 7,910 -> 7,202 (-9%); pop range 21/75 -> 23/77. `pAge` 1,031 -> 956 (cooldown effect is swamped by the end-of-life cutoff).
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** unchanged from M15; plus whether the fertility numbers (200/600/1800/2600, 50% start) feel right.
- **Exact Next Step:** the lead reviews the diff, commits and pushes Stage 1, then starts Stage 2a (sex in the sim) per the plan.
