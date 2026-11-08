# Garden of Eden Living Game Design

Status: Active design. Milestones M0 (scaffold), M1 (headless sim core), M2 (canvas and loop), M3 (full survival loop), M4 (player tools) and M5 (observability) are built; the MVP is complete. Trait inheritance (M6) and saves are not started.  
Working title: Garden of Eden  
Portfolio brief: [docs/ideas/garden-of-eden.md](../../docs/ideas/garden-of-eden.md). Keep that brief aligned when this document's concept or status changes. The full idea index is [docs/ideas/README.md](../../docs/ideas/README.md).

## How to read this document

Every rule carries a status tag. Do not treat a rule as decided unless it says `[CONFIRMED]`.

- `[CONFIRMED]` The user decided or approved this. Changing it needs a new user decision.
- `[PROVISIONAL]` A default that is built or planned but not settled. Numbers in particular are tuning hypotheses, not balance claims. They live in `src/content/tuning.ts` and `src/content/nodeDefs.ts`.
- `[LATER]` Decided to exist, but not in the milestone being built.
- `[OPEN]` No default yet.

## 1. High Concept

A god-style observation simulation. The player sets an environment, places bot entities, and watches what the society does.

1. `[CONFIRMED]` The map is made of purposeful nodes. The starting purposes are resource, danger, and shelter.
2. `[CONFIRMED]` Bots act on their own. They explore, use resources, and avoid danger. The player does not steer a bot.
3. `[CONFIRMED]` Bot goals are survival and expansion. Expansion happens because bots reproduce by themselves.
4. `[CONFIRMED]` The player observes, inserts nodes, and inserts bots, then sees how those changes affect the society.
5. `[CONFIRMED]` There is no score, win state, or player-versus-bot contest. The simulation is the product.

## 2. Design Pillars

- The environment is a set of purposeful nodes `[CONFIRMED]`.
- Bots act without direct control `[CONFIRMED]`.
- Bots survive and reproduce `[CONFIRMED]`.
- The player studies cause and effect `[CONFIRMED]`. Anything the player does must be traceable to a visible change in the society.
- Runs are deterministic `[CONFIRMED]`. Same seed plus same commands gives the same world, so an intervention can be compared against a control run.

## 3. Map and Time

1. `[CONFIRMED]` The map is a grid, about 96 x 64 cells. Positions are continuous inside it; nodes and bots have real-valued x and y.
2. `[CONFIRMED]` One run is one shared society on one map.
3. `[CONFIRMED]` Time advances in fixed ticks. Bots act in id order inside a tick, so the order is deterministic.
4. `[PROVISIONAL]` Tick order for one bot: perceive, memory, decide, act, metabolise, death check. After the bot loop: new children are added, nodes regrow, a stats sample is taken every N ticks, and events go to the log.

## 4. Environment Nodes

All nodes share one data shape (`WorldNode`). A node's `kind` decides which fields matter.

1. `[CONFIRMED]` **Resource**: bots eat it to gain energy. It depletes as it is eaten and regrows by a fixed amount per tick, never above its capacity. Built in M1.
2. `[CONFIRMED]` **Danger**: damages the health of any bot inside its radius, every tick. Bots remember it and avoid it. Built in M3.
3. `[CONFIRMED]` **Shelter**: heals bots inside it and slows their energy loss. It is the only place a bot can reproduce. Built in M3.
4. `[PROVISIONAL]` Radii, capacity, regrowth, damage, heal and energy-loss multiplier per kind (`src/content/nodeDefs.ts`).
5. `[PROVISIONAL]` Bots steer around a remembered danger (radius plus a 0.75 cell margin) with greedy turning, no path search. A bot inside a danger flees. A bot below 20% energy that is seeking food ignores avoidance and may walk into danger for food ("groves" in the eden preset put food inside danger zones). This is why danger deaths are rare but real.
6. `[OPEN]` Further node purposes (water, disease, trade, ruin). None are named yet. Record them here when decided.

## 5. Bots

1. `[CONFIRMED]` Bots interact with each other only through shared nodes. There is no fighting, trading, or direct contact between bots.
2. `[CONFIRMED]` A bot senses nodes within a sense radius, and keeps a small memory of what it saw. `[PROVISIONAL]` Memory holds about 8 entries; the oldest sighting is forgotten first. A remembered-empty resource is rechecked after a delay.
3. `[CONFIRMED]` Intent is one of wander, seek food, flee, rest, reproduce. All five are built (M3). `[PROVISIONAL]` The bot picks the intent with the highest utility score (`brain.ts`; weights in `tuning.ts` `brain`). Starvation can out-score fleeing, which is what makes a starving bot take risks.
4. `[PROVISIONAL]` A bot starts looking for food below 60% energy and eats until about 90%. Eating takes a fixed amount per tick from the node.
5. `[PROVISIONAL]` Energy drains every tick, more on a tick the bot moves, scaled by its `metabolism` trait. A bot at 0 energy dies of starvation.
6. `[CONFIRMED]` Every bot carries `traits` (sense radius, caution, reproduction threshold, metabolism) from the first milestone.
7. `[LATER]` Offspring inherit traits with small mutations (M6). Until then all bots use the default traits.

## 6. Reproduction and Death

1. `[CONFIRMED]` A bot reproduces alone. No partner is needed.
2. `[CONFIRMED]` Conditions: energy at or above the bot's reproduction threshold, adult, cooldown finished, and standing in a shelter. Built in M3.
3. `[PROVISIONAL]` The child takes 40% of the parent's energy (a transfer, not new energy). A cooldown follows for parent and child. A hard cap of 2000 bots keeps the sim safe; births stop at the cap. The child copies the parent's traits exactly until M6.
4. `[CONFIRMED]` Causes of death: starve, danger, age. All three are built (M3), checked in the order danger, starve, age. A death event records the cause and the place.

## 7. Society and Events

1. `[CONFIRMED]` The sim keeps a stats sample every N ticks (population, running births and deaths, total food) and an event log of births, deaths, depletions and player commands (a ring buffer of about 500).
2. `[CONFIRMED]` Player actions are commands (place node, remove node, place bot) recorded with their tick, so a run can be replayed. Built in M4. `[PROVISIONAL]` A command is applied between two ticks (after tick T, before T+1) and recorded as `{tick: T, cmd}`; a refused command is not recorded. A placed node uses its kind's defaults and may not sit within 1 cell of a node of the same kind (different kinds may overlap, like the preset groves); the map holds at most 400 nodes; a placed bot uses the default traits and a heading from the `world` stream, so placing never shifts the `ai` draws. The UI snaps placements to cell centres. Removing a bot is not a command.
3. `[OPEN]` A catalogue of societal events (drought, plague, and so on) and what they change.
4. `[PROVISIONAL]` The observer UI (M5): KPI strip (tick, population with change arrow, births and deaths per minute, food), a population and food chart with a marker per player command, deaths by cause, a filterable event log whose entries select the bot or node in the inspector, and an inspector. A "minute" is 600 ticks (`tuning.stats.minuteTicks`), which is one minute at 1x speed. `[OPEN]` Whether this is enough for cause and effect (see Open Questions).

## 8. Technology

1. `[CONFIRMED]` Vite 8, React 19, TypeScript ~6.0, Vitest 4, oxlint, a `tsx` CLI harness, Canvas 2D for the map, GitHub Pages hosting. Versions match `trading-sim`.
2. `[CONFIRMED]` Layers: `sim`, `content`, `harness`, `persist`, `ui`, with import rules enforced by `tests/architecture.test.ts`. The sim uses no `Math.random` and no `Date`; all randomness comes from the streams `world`, `ai` and `birth`.
3. `[CONFIRMED]` The world is plain JSON, so it can be saved, copied and hashed (`stateHash`).
4. `[LATER]` Save format and versioning (`src/persist`).

## 9. Milestones

| Milestone | Scope | State |
| --- | --- | --- |
| M0 | Scaffold, architecture test, RNG, docs | built |
| M1 | Headless sim core: resource nodes, wander, seek food, eat, starve, CLI | built |
| M2 | Canvas view and frame loop: map, nodes, interpolated bots, pause, step, 1/4/16/64x | built |
| M3 | Full survival loop: danger, shelter, reproduction, three death causes, tuned eden preset | built |
| M4 | Player commands (place node, remove node, place bot) with replay; toolbar, inspector, hover ghost, selection | built |
| M5 | Observability: stats strip, population and food chart with command markers, death causes, event log, reset with seed | built |
| M6 | Trait inheritance with mutation | not started |
| Later | Saves (`src/persist`), further node purposes, societal events | not started |

`[PROVISIONAL]` M2 and M3 here follow the plan as handed to the implementer (canvas and loop, then survival loop); the earlier table in this document listed commands as M2 and reproduction and danger as M3 and M4, so commands moved later. M4 and M5 follow the plan as handed to the implementer.

## 10. Open Questions

- Which extra node purposes are needed?
- Which societal events exist, and what do they change?
- Is the M5 observer UI enough for cause and effect? The event log keeps only the newest 500 events and `depleted` events fill it within a few hundred ticks, so older player commands scroll out of the log (the chart markers keep all of them). Should depletions be filtered out of the log by default, or logged less often?
- Is there any player goal beyond observation and intervention?
- Numbers: the eden preset (40 bots, 28 food nodes plus 3 groves, 4 danger, 7 shelter) holds 20 to 65 bots across seeds a..j over 20,000 ticks. Is that the feel the user wants (swings are about 2x)? The founders all die of age together near tick 3000, which causes the first big dip.

## 11. Changelog

- 2026-11-08: M4 and M5 built (MVP complete). Player commands with replay, toolbar (keys 1-6, Esc), inspector, hover ghost; stats strip, population and food chart with command markers, death causes, event log, reset with seed. Commands moved from `[LATER]` to built.
- 2026-11-08: M2 and M3 built. Canvas view and loop, then danger, shelter, reproduction, age death and a tuned eden preset (survives 20,000 ticks on seeds a..j). Rules above moved from `[LATER]` to built.
- 2026-11-08: M0 and M1 built. The user approved the full plan defaults (grid map, bots interact only through nodes, reproduce alone in shelter, traits from M1, stack as `trading-sim`). Status changed from `concept` to `active`.
