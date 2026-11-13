# Project Handoff State

- **Last Updated By:** Claude (implementer, stage 2b: two-parent family tree and display)
- **Current Goal:** Aging and sexes work (plan `PLAN_AGING_SEX.md` in the session scratchpad). Stage 0 (sim version in saves), stage 1 (M16 aging fertility) and stage 2a (M17 two sexes) are committed. Stage 2b (this change) is built and tested, not committed. Next is stage 2c (inbreeding penalty). Not committed or pushed: the lead verifies and commits.
- **Recent Changes (stage 2b, no sim change, no SIM_VERSION bump):**
  - `src/sim/lineage.ts`: `childIndex` lists a child under mother and father; `familyView` adds `father` and `fatherMissing`, keeps `ancestors` as the mother line, descendants are a DAG (each record once, `seen` set, exact counts via a visited set; sibling ranking weights may double count, ranking only); `founderLines` roots are records with no kept parent, per-root DFS, lines may overlap.
  - `src/ui/familyMath.ts`: `parentsText` ("mother #m, father #f"), `rowLabel` includes it, `flattenTree` skips a repeated id (unique keys).
  - `src/ui/FamilyPanel.tsx`: Mother, Father and Sex rows in record details; chain titled "Mother's line" with a "father #x" focus button per chip; founder note says lines overlap. `panels.css`: `.fam-chain-item`, `.fam-father-button`, `.trait-sexes*`.
  - `src/ui/render.ts`: dotted family lines also join the living father. `TraitSummary.tsx`: "Females / Males 21 / 19" line first ("none alive" when empty).
  - Tests: `tests/lineage.test.ts` (new two-parent block; long-run overlap assertion is now >=), `src/ui/familyMath.test.ts`.
  - Docs: GAME_DESIGN section 5 item 11, section 8 item 6, changelog; CLAUDE.md FamilyPanel and TraitSummary.
  - Survey rows (seeds a, b, c, 20000 ticks, warmup 1000) identical before and after. Layout measured at 1280x800, 1440x900, 1024x768, 768x1024, 375x812 and 290px: no horizontal overflow, chips 44px tall.
- **Active Decisions / Constraints:**
  - A child of two kept parents appears under the first parent reached (higher living weight, then lower id).
  - Mother and Father rows are in the collapsed "Record details", not the always-visible header (keeps the fixed panel height).
  - Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
- **Open Questions for the user:** unchanged (heat ramp, "recent" window, eden preset feel check).
- **Exact Next Step:** the lead reviews the diff, commits and pushes stage 2b, then starts stage 2c (inbreeding, SIM_VERSION -> 4).
