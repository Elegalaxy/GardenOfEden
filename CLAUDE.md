@HANDOFF.md

# CLAUDE.md

Guidance for Claude Code in this repository. Machine-wide rules (agent routing, the UI/UX guide, worktrees) live in `~/.claude/CLAUDE.md` and are not repeated here.

## Workflow

- **Worktrees:** follow the machine-wide worktree rule. Never edit the shared main checkout for implementation work.
- **Commit and push each finished stage:** when a stage, plan part or main function is finished (typecheck, tests and lint pass), run `git fetch origin`, rebase onto `origin/main`, commit, and push to `origin/main` before starting the next one. One commit per finished piece. Never force-push. Tell implementers this rule in every brief.
- **Handoff (shared with Cursor):** read `HANDOFF.md` before starting work; Cursor may have changed things. Overwrite it only after a milestone or when the user says "handoff": under 50 lines, with Last Updated By, Current Goal, Recent Changes and files touched, Active Decisions / Constraints, and Exact Next Step. Replace, do not append.

## Docs are the source of truth

- `doc/GAME_DESIGN.md`: rules and numbers. Rules carry `[CONFIRMED]` / `[PROVISIONAL]` / `[LATER]` / `[OPEN]` tags. Don't change a `[CONFIRMED]` rule without a user decision. Retune logs are in its changelog.
- `doc/ARCHITECTURE.md`: module walkthroughs and milestone notes (worker and frame format, sim flow and tick order, predators, seasons, mate choice, toxic food, heatmaps, bloodline gene, inbreeding, persist and ui details). **Read the relevant section before changing a system.** When a milestone changes a system, update its section there, not here.
- Portfolio brief: `../docs/ideas/garden-of-eden.md`. Keep it and `../docs/ideas/README.md` aligned when the concept or status changes.

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
npm run sim -- --seeds a,b,c --ticks 20000 [--warmup 1000]           # per-seed survey: final/min/max population, births, deaths by cause, lineage records kept / pruned
npm run sim -- --seeds a,b,c --ticks 20000 --no-family               # same, with parent-child knowledge sharing off (A/B); the column `learned` counts shared memory entries
npm run sim -- --seeds a,b,c --ticks 20000 --asexual                 # same, with the two sexes off (a bot breeds alone); the last survey column `fem` is the females alive at the end
npm run sim -- --seeds a,b,c --ticks 20000 --no-seasons                # same, with seasonal regrowth off (S2 switched seasons on in Eden; this is the pre-season control)
npm run sim -- --seeds a,b,c --ticks 20000 --no-cone                   # same, with directional sensing off (V1; the cone is on in Eden since V2, so this gives the pre-V2 all-round world)
npm run sim -- --seeds a,b,c --ticks 20000 --set seasons.enabled=true --set seasons.amplitude=0.4   # harness-only override of any existing tuning number or boolean (repeatable; an unknown path or wrong kind is an error), so sweeps need no edit to tuning.ts
npm run sim -- --seeds a,b,c --ticks 20000 --static-predators        # predator ecology off (fixed predators; ecology is on by default since E2); the last survey columns are preds pMin pMax pBorn pArr pStarve pAged huntGap idle (ecology counters and the mean ticks between one predator's kills, and that minus digestTicks)
npm run sim -- --seeds a,b,c --ticks 20000 --no-terrain                  # R1 rough ground off (it is off in Eden; turn it on with `--set terrain.enabled=true`, `--set terrain.botSpeedMult=0.7`); the last survey columns are rgh% pRgh% (share of bot-ticks and predator-ticks after the warmup that began on rough ground; a dash with terrain off)
npm run sim -- --seeds a,b,c --ticks 20000 --set poison.enabled=true      # toxic food on (T1, off in Eden; `--no-poison` forces it off); the last survey columns are pois tox toxK (poison deaths, food units eaten from toxic nodes, % of living bots that remember a toxic node; a dash with poison off)
npm run sim -- --seeds a,b,c --ticks 20000 --no-prey                     # P1 prey rule off (it is on in Eden since P2; the pre-P2 world also had killsPerCub 6, so add --set predator.ecology.killsPerCub=6); the last survey columns are pCorr pCorrL pLag pLeft (correlation of predator count with bot count at lag 0 and at the best lag of 0/500/1000/1500/2000/3000 ticks, that lag, and predators that left the map)
npm run sim -- --seeds a,b,c --ticks 20000 --predator-traits             # H1 heritable predator traits on (they are on in Eden since H2, so this is the default; --set predator.traits.enabled=false gives the pre-H2 world); the last survey columns are pSense pSpeed pStam pGen (mean sense, speed and stamina of the predators alive at the end, and the highest generation seen; a dash with the rule off)
npm run sim -- --seed a --ticks 9000 --event drought@3000 --event plague@6000:48,32   # scripted world events, repeatable, also with --seeds (bounty@4000, meteor@5000:30,20)
```

## Architecture

A deterministic, seeded, god-style observation sim: bots wander a grid map, eat, drink, avoid predators and craters, shelter and reproduce on their own; the player watches and places nodes and bots. React 19 + Vite + TypeScript, Vitest, Canvas 2D for the map (`src/ui/render.ts`), SVG for the charts. The sim runs in a Web Worker (`src/ui/simHost.ts`, see ARCHITECTURE "Worker"). The code is split into five layers under `src/`, and **`tests/architecture.test.ts` enforces the import rules** by scanning every source file (a file outside a layer also fails):

- `src/sim`: pure game rules. May import only other `src/sim` files (tests may also import `vitest`). Banned in non-test files: `Math.random`, `Date`, `performance.now`, `console`, browser storage, `process`, DOM globals/`fetch`, React, `node:*`. All randomness goes through the seeded named streams in `rng.ts` (`world`, `ai`, `birth`, `gene`, `predator`; each later one was added at the end, so the earlier ones give the same sequences as before; `predator` is M21a, user-approved, and takes no draws while the world has no predator). Because sim files cannot import content, tests that need the real rules or presets live in `tests/`.
- `src/content`: data: `tuning.ts` (every behaviour number), `nodeDefs.ts`, `presets.ts`, assembled into `rules` in `index.ts`. May import sim types; no UI, persist, harness, or I/O.
- `src/harness`: Node CLI (`cli.ts`). Must not import `ui` or `persist`.
- `src/persist`: versioned saves, share links and autosave. May import only sim types (not content), not ui/harness. Command key order inside a save must match the sim's (commands are part of the hashed state).
- `src/ui`: React components plus the worker plumbing. Must not import `harness`. Panels and render/geometry helpers take a `ViewWorld`, never a `World`.
- `src/main.tsx` is the app entry (not a layer). Nothing may import from the sibling `rpg/` or `trading-sim/` projects.

**Layout rules (keep them when touching the UI):** `.workspace` in `panels.css` is a grid with named areas per breakpoint (phone: map, status, speed, tools, stats, panels; 901px: main column plus a 360px side column; 1100px: tools become a rail left of the map). The map must fit the first screen at 1280x800 with the controls and tools: `.map-frame` is capped by `--map-chrome` (the height of everything else, set per layout), so adjust that number if you add or remove rows above or below the map. The side column (`.area-side`) spans every grid row and has `contain: size` so a tall side column (selected bot's inspector, family tree, log) spills below instead of stretching the rows and pushing the map down; keep that if you add side panels. Anything that appears or changes while playing (hint, notice, toast, menu, event chips, the empty-world note) must not change the height of anything in flow: reserve its space or float it over the page. The map frame uses `box-shadow`, not a border, so the canvas fills the box it was measured from. Chart x ticks come from `xAxisTicks` (`chartMath.ts`), never a fixed count. Keep every button at least 44px tall. Verify layout changes by measuring (`getBoundingClientRect`) at 1280x800, 1440x900, 1024x768, 768x1024, 375x812 and about 290px wide, including before/after switching tools and placing things.

## Conventions

- Same seed + same commands give the same `stateHash`. Changing RNG draw order or the tick order changes every hash; treat that as a deliberate change and bump `SIM_VERSION` (`src/content/version.ts`) when hashes change.
- Every number that changes behaviour belongs in `src/content/tuning.ts` or `nodeDefs.ts`, not in `src/sim`.
- Unit tests sit next to source as `*.test.ts` (tests that need the real rules or presets live in `tests/`). Files open with a short header comment explaining the module's rules; keep that style.
- New world keys added behind a switch are absent (never null or undefined) when the switch is off, and go last in their object, so old hashes hold.
- Re-run `tests/tuning.test.ts`, the events and traits tests after any tuning change; the event scenes are knife-edge.

## Project-specific rules

**Sim math must be bit-exact across engines.** Only + - * /, `Math.sqrt`, floor, ceil, round, trunc, abs, min, max, sign, fround and imul are specified to give the same bits everywhere; `Math.sin/cos/tan/atan/atan2/exp/log/pow/hypot/cbrt` and `**` are not (Node and Chrome differed from tick 1, so the same run hashed differently). Inside `src/sim` use `exactMath.ts` (`sin`, `cos`, `atan`, `atan2`, `log`, `exp`, `pow`, `hypot`, built from the exact operations only); `tests/architecture.test.ts` bans the others in non-test sim files. Changing `exactMath.ts` changes every hash (`tests/exactMath.test.ts` pins golden bits). `JSON.stringify` of numbers is safe: ECMAScript specifies the shortest round-trip string, so `stateHash` agrees across engines.
