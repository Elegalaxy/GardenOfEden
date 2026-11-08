# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@HANDOFF.md

## Commands

```bash
npm run dev                 # Vite dev server
npm run build               # tsc -b && vite build
npm run typecheck           # tsc -b (three projects: app, node, harness)
npm run lint                # oxlint
npm test                    # vitest run (all tests)
npx vitest run tests/sim.test.ts               # one test file
npx vitest run -t "some test name"             # one test by name
npm run sim -- --seed a --ticks 5000 [--preset eden] [--every 500]   # headless run: tick, population, births, deaths by cause, food
npm run sim -- --seeds a,b,c --ticks 20000 [--warmup 1000]           # per-seed survey: final/min/max population, births, deaths by cause
```

The design source of truth is `doc/GAME_DESIGN.md` (rules carry `[CONFIRMED]` / `[PROVISIONAL]` / `[LATER]` / `[OPEN]` tags; don't change a `[CONFIRMED]` rule without a user decision). The portfolio brief is `../docs/ideas/garden-of-eden.md`; keep it and `../docs/ideas/README.md` aligned when the concept or status changes.

## Architecture

A deterministic, seeded, god-style observation sim: bots wander a grid map, eat resource nodes and ruins, avoid danger, shelter, and reproduce on their own; the player watches and places nodes and bots. React 19 + Vite + TypeScript, Vitest, Canvas 2D for the map (`src/ui/render.ts`), SVG for the chart. Milestones M0-M6 and M7a (ruins) are built (the MVP, trait inheritance, and food left by the dead); M7b (water) is not started. The code is split into five layers under `src/`, and **`tests/architecture.test.ts` enforces the import rules** by scanning every source file (a file outside a layer also fails). When adding code, respect:

- `src/sim` — pure game rules. May import only other `src/sim` files (tests may also import `vitest`). Banned in non-test files: `Math.random`, `Date`, `performance.now`, `console`, browser storage, `process`, DOM globals/`fetch`, React, `node:*`. All randomness goes through the seeded named streams in `rng.ts` (`world`, `ai`, `birth`). Because sim files cannot import content, tests that need the real rules or presets live in `tests/`.
- `src/content` — data: `tuning.ts` (every behaviour number), `nodeDefs.ts`, `presets.ts`, assembled into `rules` in `index.ts`. May import sim types; no UI, persist, harness, or I/O.
- `src/harness` — Node CLI (`cli.ts`). Must not import `ui` or `persist`.
- `src/persist` — saves (empty until a later milestone). May import only sim types (not content), not ui/harness.
- `src/ui` — React components. Must not import `harness`. `store.ts` is the session (world, speed, tool, selection, `dispatch(cmd)`, `clickMap`, `resetWorld`); `geometry.ts` (pixels/cells, picking), `tools.ts`, `labels.ts`, `chartMath.ts` and `traitMath.ts` are pure helpers (most with tests); the panels are `Toolbar`, `Inspector`, `StatsStrip`, `PopulationChart`, `TraitChart`, `TraitSummary`, `DeathCauses`, `EventLog` (Depleted filter off by default), `RunPanel`, around `WorldCanvas` (draws via `render.ts`). Styles: `styles.css` (base) and `panels.css`.
- `src/main.tsx` is the app entry (not a layer). Nothing may import from the sibling `rpg/` or `trading-sim/` projects.

### Sim flow

`createWorld(seed, preset, rules)` builds a `World` (plain JSON). `step(world, rules)` advances one tick in place; `rules = { tuning, nodeDefs }` comes from `src/content`. Player commands (`commands.ts`: `applyCommand`, `checkCommand`) change the world between ticks and are recorded in `world.commands` with their tick; `replay.ts` rebuilds a run from seed + commands (same `stateHash` as the live run). `stats.ts` reads the samples (window changes, per-minute rates, trait drift; a minute is `tuning.stats.minuteTicks` ticks). Per tick, bots act in id order: perceive -> memory -> decide -> act -> metabolise -> death check, then a reproduction check for survivors. After the loop, in this order: dead bots are removed, children are spawned (`birth` stream), each dead bot leaves a ruin, resources regrow, ruins decay (emptied ones are removed), then a stats `Sample` is taken every `stats.sampleEvery` ticks. `step.ts` only orchestrates; the phases live in `perception.ts` (sense + memory), `brain.ts` (utility scores: flee, seekFood, rest, reproduce, wander), `movement.ts` (greedy steering around remembered danger), `nodes.ts` (eat, regrow, danger/shelter exposure), `ruins.ts` (leave, merge and decay ruins), `metabolism.ts` (drain, damage, heal, age, death cause) and `reproduction.ts`; `traits.ts` holds trait mutation, mean/min/max and the trait name order. Bots never read each other; they interact only through shared nodes. `stateHash` (`hash.ts`) is the determinism check: same seed and same commands must give the same hash. `tests/tuning.test.ts` runs the eden preset for 20,000 ticks over seeds a..j (about 30 s) and checks the population never dies out, never explodes, and swings; re-run it after any tuning change. Children inherit traits with a seeded mutation (`tuning.mutation`: rate, strength, per-trait bounds; eight `birth` draws per child, after the three for placement). Each trait has a cost in `tuning.ts` (`senseDrain`, `metabolismSpeed`, `birthCost`); retune with `npm run sim -- --seeds ... --ticks 60000`, which prints final mean traits, and check traits do not all pin to their bounds. `tests/traits.test.ts` has the inheritance, cost and selection tests. Ruins (M7a): a node kind `ruin` (amount, `decay` per tick, removed at 0) made by the sim on every death; numbers in `tuning.ruin` and `nodeDefs.ruin`. Bots seek and eat them through the resource path (`isFood` in `perception.ts`, `eat` in `nodes.ts`); a ruin never regrows, so it is not retried once remembered empty. They use no RNG, are not logged, and do not count toward `player.maxNodes` (`placedNodeCount`); the player cannot place one (`checkCommand` refuses kind `ruin`) but can remove one. `world.eaten` totals food eaten per source, and the survey and CLI print `ruin%`. Resource depletions are not logged (the log holds births, deaths and commands). `tests/ruins.test.ts` covers ruins; any new code that switches on `NodeKind` must handle `ruin` (`exposureAt` and `regrow` must skip it).

### Conventions

Unit tests sit next to source as `*.test.ts`. Files open with a short header comment explaining the module's rules; keep that style. Every number that changes behaviour belongs in `src/content/tuning.ts` or `nodeDefs.ts`, not in `src/sim`. Changing RNG draw order or the tick order changes every hash; treat that as a deliberate change.

## Handoff

Before edits, read `HANDOFF.md`. After completing a milestone, or when the user says "handoff", overwrite it in place (under 50 lines) with Last Updated By, Current Goal, Recent Changes and files touched, Active Decisions / Constraints, and Exact Next Step. Do not append.
