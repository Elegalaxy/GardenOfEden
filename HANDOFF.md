# Project Handoff State

- **Last Updated By:** Claude (implementer)
- **Current Goal:** Garden of Eden milestones M0 to M3 are built (scaffold, headless core, canvas and loop, full survival loop). Next is M4 (player commands), not started.
- **Recent Changes (M2, canvas and loop):**
  - `src/ui/store.ts` (useSyncExternalStore: World, speed, pause, `advance`), `loop.ts` (+ `loop.test.ts`: 10 ticks/s at 1x times speed, max 200 ticks and 250 ms per frame), `render.ts`, `WorldCanvas.tsx`, `SpeedControls.tsx`, `Readout.tsx`, `styles.css`, `App.tsx`.
  - Nodes are circles with letters R/D/S (danger dashed); resource ring = amount left; bots blend `px,py` to `x,y` by tick progress; dpr and resize handled.
- **Recent Changes (M3, survival loop):**
  - `step.ts` split into `perception.ts`, `brain.ts`, `movement.ts`, `nodes.ts`, `metabolism.ts`, `reproduction.ts` (+ `perception.test.ts`, `nodes.test.ts`). `pushEvent` moved to `world.ts`. `MemoryEntry` gained `radius`.
  - `Tuning` gained bot fields (maxAge, adultAge, reproCooldown, childEnergyShare, healthRegen, spawnSpread), `brain` and `population` sections. Eden preset now has 3 danger+food groves, 4 scattered danger, 7 shelter. Danger damage is 3.
  - Harness: CLI prints births and deaths by cause; `--seeds a,b,c` survey mode (`src/harness/survey.ts`).
  - Tests: `tests/survival.test.ts` (danger, shelter, reproduction, cap, age, determinism), `tests/tuning.test.ts` (seeds a..j x 20,000 ticks, about 30 s).
- **Active Decisions / Constraints:**
  - `step(world, rules)` mutates in place; sim gets numbers through `Rules`. Never import `rpg/` or `trading-sim/`. Do not commit or push unless the user asks.
  - Tick order: bots in id order (perceive, memory, decide, act, metabolise, death, reproduction check), then remove dead, spawn children, regrow, sample.
  - Starving bots (<20% energy, seeking) ignore danger avoidance; this is the only source of danger deaths besides founders spawning inside a zone.
  - Eden survival (seeds a..j, 20,000 ticks): final 45-56, min 21-37, max 55-65, never extinct. Changing tuning, RNG draw order or tick order changes every hash; rerun `tests/tuning.test.ts`.
  - Browser check was done only in the hidden built-in pane (rAF throttled), so real frame rate and the 64x feel are unverified.
- **Exact Next Step:** M4 per the plan: player commands (place node, remove node, place bot) recorded in `World.commands` with replay, plus click handling on the canvas. Before it, the user may want to judge the eden feel in a real browser (`npm run dev`) and the swing size (about 2x).
