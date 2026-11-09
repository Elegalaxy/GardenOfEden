# Garden of Eden Living Game Design

Status: Active design. Milestones M0 (scaffold), M1 (headless sim core), M2 (canvas and loop), M3 (full survival loop), M4 (player tools), M5 (observability), M6 (trait inheritance with mutation), M7a (ruin node) and M7b (water node and thirst) are built; the MVP is complete. Saves are not started.  
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

1. `[CONFIRMED]` The map is made of purposeful nodes. The starting purposes are resource, danger, and shelter; ruin (M7a) and water (M7b) were added later (section 4).
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
4. `[PROVISIONAL]` Tick order for one bot: perceive, memory, decide, act, metabolise, death check. After the bot loop, in this order: dead bots are removed, new children are added, each dead bot leaves a ruin (in id order), resources regrow, ruins decay and the emptied ones are removed, and a stats sample is taken every N ticks. Births, deaths and player commands go to the event log.

## 4. Environment Nodes

All nodes share one data shape (`WorldNode`). A node's `kind` decides which fields matter.

1. `[CONFIRMED]` **Resource**: bots eat it to gain energy. It depletes as it is eaten and regrows by a fixed amount per tick, never above its capacity. Built in M1.
2. `[CONFIRMED]` **Danger**: damages the health of any bot inside its radius, every tick. Bots remember it and avoid it. Built in M3.
3. `[CONFIRMED]` **Shelter**: heals bots inside it and slows their energy loss. It is the only place a bot can reproduce. Built in M3.
4. `[PROVISIONAL]` Radii, capacity, regrowth, damage, heal and energy-loss multiplier per kind (`src/content/nodeDefs.ts`).
5. `[PROVISIONAL]` Bots steer around a remembered danger (radius plus a 0.75 cell margin) with greedy turning, no path search. A bot inside a danger flees. A bot below 20% energy that is seeking food ignores avoidance and may walk into danger for food ("groves" in the eden preset put food inside danger zones). This is why danger deaths are rare but real.
6. `[PROVISIONAL]` **Ruin** (M7a, built): when a bot dies, from any cause, it leaves a small temporary food node at the place of death. It closes the loop (the dead feed the living) and leaves a visible trace where bots starve or die in danger.
   - Amount: 24 food units (`ruin.baseAmount`) plus half of the bot's remaining energy counted in food units (`ruin.energyShare` 0.5, energy / `energyPerUnit`). A bot that starved has none left and leaves 24; one that died of old age at 90 energy leaves 46. Because the base is a fixed gift, ruins add some food to the world, which is why the numbers were re-checked (see Open Questions).
   - Bots treat a ruin as food, using the same seek-and-eat path as a resource (same hunger rule, same danger avoidance; a desperate bot may walk into danger for it). Two differences: a ruin never regrows, so a remembered ruin that held less than one bite is not retried later, and an emptied ruin is removed.
   - Decay: a ruin loses 0.05 units per tick (`nodeDefs.ruin.decay`), so an untouched 24-unit ruin lasts about 480 ticks. It is removed when it reaches 0, whether eaten or decayed. A bot heading for a removed ruin finds the node missing and wanders; memory drops removed nodes, as for any removed node.
   - Merging: a death within 2 cells of an existing ruin (`ruin.mergeRadius`) adds to it instead of making a new one, up to the ruin's capacity of 60 (`nodeDefs.ruin.capacity`; the excess is lost). At 60 ruins (`ruin.maxCount`) a death adds to the nearest ruin however far away. This count is separate from the player's `maxNodes` cap: ruins are not counted against it and never stop the player placing a node.
   - Ruins are made by the sim only. The player cannot place one (not in the toolbar, and a `placeNode` command with kind `ruin` is refused), but can inspect a ruin and remove it with the Remove tool (a recorded `removeNode` command, replay-safe).
   - Ruin creation uses no random draws and is not logged (one event per death would flood the log). Resource depletion is not logged any more either (see section 7).
7. `[PROVISIONAL]` **Water** (M7b, built): a permanent spring and the source of the second need, thirst (section 5, item 9).
   - A bot standing within a water node's radius (2 cells, `nodeDefs.water`) drinks `bot.drinkRate` (5) thirst per tick. The spring is never used up and has no amount: `amount` and `capacity` stay 0, and nothing is subtracted when a bot drinks, so any number of bots can drink at once. This is the simplest deterministic choice: no accounting, no regrowth, no ordering effects between bots.
   - Water is a normal player node: the Add water tool (key 3) places it (a recorded `placeNode` command, same 1-cell gap rule as other kinds, replay-safe) and the Remove tool takes it away. The map draws it as a droplet with the letter W in cyan, over a faint disc that shows where a bot can drink; the legend, toolbar badge, hover ghost, inspector (drink rate, "never runs dry", bots inside) and chart markers (W) all carry the letter and shape, never colour alone.
   - Eden has six springs: four fixed at (14,44), (82,14), (36,54) and (78,48), plus two scattered by the seed. (78,48) is 6 cells from the south-east grove's centre, so its zone touches that danger zone's edge. The scattered two land near food or shelter on some seeds and nowhere in particular on others; "some near food, some near shelter" holds by chance, not by placement.
8. `[OPEN]` Further node purposes (disease, trade). Record them here when decided.

## 5. Bots

1. `[CONFIRMED]` Bots interact with each other only through shared nodes. There is no fighting, trading, or direct contact between bots.
2. `[CONFIRMED]` A bot senses nodes within a sense radius, and keeps a small memory of what it saw. `[PROVISIONAL]` Memory holds about 8 entries, plus 2 extra slots used only by water (`memory.cap` 8, `memory.waterCap` 2); within each group the oldest sighting is forgotten first. Water has its own slots because springs are few and permanent while food, ruins and shelters crowd the memory and churn: with one shared cap a thirsty bot kept forgetting where it last drank. A remembered-empty resource is rechecked after a delay.
3. `[CONFIRMED]` Intent is one of wander, seek food, seek water, flee, rest, reproduce. All six are built (M3, M7b). `[PROVISIONAL]` The bot picks the intent with the highest utility score (`brain.ts`; weights in `tuning.ts` `brain`). Starvation can out-score fleeing, which is what makes a starving bot take risks.
4. `[PROVISIONAL]` A bot starts looking for food below 60% energy and eats until about 90%. Eating takes a fixed amount per tick from the node.
5. `[PROVISIONAL]` Energy drains every tick, more on a tick the bot moves, scaled by its `metabolism` trait. A bot at 0 energy dies of starvation.
6. `[CONFIRMED]` Every bot carries `traits` (sense radius, caution, reproduction threshold, metabolism) from the first milestone.
7. `[PROVISIONAL]` Offspring inherit traits with small mutations (M6, built). Each trait of a newborn changes with chance `mutation.rate` (0.5) by a random factor within +-`mutation.strength` (10%), then is clamped into per-trait bounds (sense radius 3 to 12, caution 0.05 to 1.5, reproduction threshold 55 to 90, metabolism 0.7 to 1.6). All of it is seeded (the `birth` stream, eight extra draws per child), so runs stay deterministic. Founders and player-placed bots keep the default traits. Strength 0 makes children copy the parent.
8. `[PROVISIONAL]` Every trait has a cost, so selection finds a balance instead of pushing to a limit. Sense radius: each cell above the default 6 costs 0.02 energy per tick (a smaller radius saves it). Caution: a more cautious bot flees danger instead of seeking food near it. Reproduction threshold: a low threshold breeds early, but the parent also burns 20 energy per birth (`birthCost`) on top of the 40% it hands over, so breeding on a thin reserve is risky; the upper bound is 90 because a bot stops eating at 90. Metabolism: scales energy loss and also walking speed (speed is `1 + 2 x (metabolism - 1)` times the base), so a slow bot saves energy but takes much longer to reach food. Since M7b a hotter metabolism also dries the bot out faster (item 9: thirst drain times `max(1, metabolism)` cubed). These are tuning hypotheses (`senseDrain`, `metabolismSpeed`, `birthCost`, `mutation` in `tuning.ts`).

9. `[PROVISIONAL]` **Thirst** (M7b, built): every bot has a thirst level from 0 to `bot.maxThirst` (100). It starts full for founders, player-placed bots and newborns alike (water, unlike energy, is not handed down from the parent). It falls by `bot.thirstDrain` (0.25) per tick, times `max(1, metabolism)` to the power `bot.thirstMetabolismPower` (3), so a founder goes from full to dead in exactly 400 ticks without water; a cooler bot (metabolism under 1) pays the same 0.25, and a hot one pays much more. Shelter does not slow it. Standing at a spring refills `drinkRate` (5) per tick. At 0 the bot dies of thirst.
   - The power of 3 is a tuning finding, not a design claim. Speed is `1 + 2 x (metabolism - 1)` times the base, so a hot bot is cheaper per cell walked and finds the few springs sooner. With thirst scaled by metabolism x 1 (or not at all), metabolism 1.6 out-bred 0.9 in `tests/traits.test.ts` once water existed, which broke the M6 rule that every trait has a cost. At 3 a hot bot's thirst (x4.1 at 1.6, x1.5 at 1.15) cancels that. The "only above 1" part is also a finding: scaling a cool bot's thirst down as well (power 1.5 to 3 over the whole range) pinned the population mean metabolism at the 0.7 lower bound over 60,000 ticks. With the floor it settles around 0.8 to 1.05.
   - A bot looks for water below 50% thirst (`thirstyBelow`) and keeps drinking until the pull of the spring (`thirstWeight` 1.25 times the missing thirst fraction) falls under the wander score, which is about 88% thirst, the same way eating stops near 88% energy. That is the same shape and weight as hunger, so a bot that is both hungry and thirsty goes for whichever need is lower. Ties go flee, food, water, rest, reproduce, wander.
   - Spring versus danger: a bot ignores a remembered spring that sits inside a remembered danger (plus the 0.75 cell margin) unless it is desperate, meaning thirst below 20% (`brain.desperateBelow`, shared with hunger). A desperate water seeker also ignores danger avoidance on the way, the same bargain as food in a grove. With a spring touching a danger zone, a cautious bot detours or drinks elsewhere and a parched one takes the risk.
   - A bot that has never seen a spring simply wanders; sense radius and speed decide how soon it finds one. Reproduction does not depend on thirst (it stays shelter plus energy, adult age and cooldown).

## 6. Reproduction and Death

1. `[CONFIRMED]` A bot reproduces alone. No partner is needed.
2. `[CONFIRMED]` Conditions: energy at or above the bot's reproduction threshold, adult, cooldown finished, and standing in a shelter. Built in M3.
3. `[PROVISIONAL]` The child takes 40% of the parent's energy (a transfer, not new energy), and the parent burns a further 20 energy (`birthCost`, lost, M6). A cooldown follows for parent and child. A hard cap of 2000 bots keeps the sim safe; births stop at the cap. The child inherits the parent's traits with a small mutation (section 5, item 7).
4. `[CONFIRMED]` Causes of death: starve, danger, age; `[PROVISIONAL]` thirst was added as a fourth (M7b). All four are built, checked in the order danger, thirst, starve, age. When more than one is true on the same tick the first in that order is the recorded cause: danger first because it is done to the bot, then the two needs (thirst before starve, the faster killer), then age. A death event records the cause and the place. A thirst death leaves a ruin like any other death.

## 7. Society and Events

1. `[CONFIRMED]` The sim keeps a stats sample every N ticks (population, running births and deaths, total food, and from M6 the population mean of each trait) and an event log of births, deaths and player commands (a ring buffer of about 500). `[PROVISIONAL]` Resource depletions are no longer logged (M7a): they filled the buffer within a few hundred ticks and pushed births, deaths and commands out of it. The chart's command markers still come from `World.commands`, which keeps every command.
2. `[CONFIRMED]` Player actions are commands (place node, remove node, place bot) recorded with their tick, so a run can be replayed. Built in M4. `[PROVISIONAL]` A command is applied between two ticks (after tick T, before T+1) and recorded as `{tick: T, cmd}`; a refused command is not recorded. A placed node uses its kind's defaults and may not sit within 1 cell of a node of the same kind (different kinds may overlap, like the preset groves); the map holds at most 400 nodes; a placed bot uses the default traits and a heading from the `world` stream, so placing never shifts the `ai` draws. The UI snaps placements to cell centres. Removing a bot is not a command.
3. `[OPEN]` A catalogue of societal events (drought, plague, and so on) and what they change.
4. `[PROVISIONAL]` The observer UI (M5): KPI strip (tick, population with change arrow, births and deaths per minute, food), a population and food chart with a marker per player command, deaths by cause, a filterable event log whose entries select the bot or node in the inspector, and an inspector. A "minute" is 600 ticks (`tuning.stats.minuteTicks`), which is one minute at 1x speed. `[OPEN]` Whether this is enough for cause and effect (see Open Questions). `[PROVISIONAL]` The event log has Birth, Death and Command filters (all on). `[PROVISIONAL]` Food is shown as resource food: the KPI Food tile and the chart's food line count resources only, and the tile's detail line shows the food sitting in ruins separately (for example "+84 in ruins"), never added in. The map draws a ruin as a diamond with the letter U in violet (a resource is a circle, R), with a legend entry and an inspector view (amount, decay per tick, time left if untouched). `[PROVISIONAL]` Trait panels (M6): a "Traits over time" section with one small line chart per trait (current mean, drift since the first sample with a sign and arrow, the founders' value as a faint dotted line; distinct line style and end marker per trait), a "Population traits" table (mean, min, max, with a bar showing the spread inside the trait's allowed range), and the inspector shows how far the selected bot is from the population mean (+/-). `[PROVISIONAL]` Water in the UI (M7b): the toolbar has seven tools with keys 1 to 7 in button order (Inspect 1, Add resource 2, Add water 3, Add danger 4, Add shelter 5, Add bot 6, Remove 7; Esc returns to Inspect), the bot inspector has a Thirst bar with a "low" flag under 20% (like Energy), memory shows "n / 10 nodes", and Deaths by cause has a Thirst row (cyan bar). The event log says "died: thirst" and the inspector "Died of thirst".

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
| M6 | Trait inheritance with mutation, trait costs, trait charts and summary, trait means in the survey | built |
| M7a | Ruin node: dead bots leave decaying food; depleted events dropped from the log; ruin share of intake in the survey | built |
| M7b | Water node and thirst: seek-water intent, water memory slots, fourth death cause, Add water tool, droplet shape | built |
| Later | Saves (`src/persist`), further node purposes, societal events | not started |

`[PROVISIONAL]` M2 and M3 here follow the plan as handed to the implementer (canvas and loop, then survival loop); the earlier table in this document listed commands as M2 and reproduction and danger as M3 and M4, so commands moved later. M4 and M5 follow the plan as handed to the implementer.

## 10. Open Questions

- Which extra node purposes are needed beyond water (for example disease, trade)?
- Which societal events exist, and what do they change?
- Is the M5 observer UI enough for cause and effect? Depletions are no longer logged, so the 500-event buffer holds births, deaths and commands only. It still turns over (a few thousand ticks at eden's rates), so an old player command can leave the log while its chart marker stays. Is that enough, or should commands get their own buffer?
- Is there any player goal beyond observation and intervention?
- Numbers: the eden preset (40 bots, 28 food nodes plus 3 groves, 4 danger, 7 shelter, 6 springs) with ruins and thirst on holds 10 to 53 bots across seeds a..j over 20,000 ticks (10 to 61 over 60,000, never extinct). Ruins supply about 5 to 9% of the food eaten over 20,000 ticks and 7 to 10% over 60,000. Thirst deaths are 10 to 29% of all deaths per seed over 20,000 ticks and 8 to 22% over 60,000 (starvation is still 55 to 80%), and danger deaths stay rare (0 to 11 per 20,000 ticks, 0 to 58 per 60,000). Water cut the population against the pre-water numbers (27 to 76 and 27 to 89), mostly at the top end. Is that the feel the user wants (swings are about 2x, and the founders still all die of age together near tick 3000)? Also still open: ruins make a danger zone slightly more tempting for a desperate bot.
- Traits (M6, re-checked after M7b): over 60,000 ticks the reproduction threshold falls from 80 to about 57 to 63 on every seed (breeding early pays), metabolism stays near its founder value (means 0.79 to 1.03), sense radius wanders (4.3 to 6.8), and caution varies a lot between seeds (0.26 to 0.82). Water made a plain `metabolism x thirst` cost too weak (a fast bot found springs sooner than it burned energy), and a cost that also rewarded slow bots pinned them to the lower bound, hence `max(1, metabolism)` cubed (item 9 of section 5). Are those the trait stories the user wants to watch, or should the costs be tuned to keep more variety? Sense radius is not rewarded more strongly by water: a radius of 12 still loses to 6 in the selection test.

## 11. Changelog

- 2026-11-09: M7b built. New node kind `water` (a permanent spring, no amount; the player can place it with the Add water tool, key 3, and remove it; droplet shape with a W) and a second need, thirst (`Bot.thirst`, 0 to 100). Thirst drains 0.25 per tick times `max(1, metabolism)` cubed, refills 5 per tick at a spring, and at 0 the bot dies of a fourth cause, `thirst` (cause order danger, thirst, starve, age). New intent `seekWater` scored like `seekFood`, water kept in its own two memory slots on top of the 8, a spring inside a remembered danger is skipped unless the bot is desperate (thirst under 20%). Founders, placed bots and newborns start with full thirst; reproduction does not depend on thirst. Eden got six springs (one touching a danger zone). Tools renumbered: keys 1 to 7 (Inspect 1, resource 2, water 3, danger 4, shelter 5, bot 6, remove 7). The extra state and draws change every state hash, as expected. Tuning finding: thirst scaled by plain metabolism let a fast metabolism out-breed a moderate one (the M6 selection test failed), and a cost that also helped slow bots pinned the mean at the lower bound over 60,000 ticks; `max(1, metabolism)` to the power 3 fixes both. `tests/survival.test.ts` now tops up thirst in the danger-avoidance test (that lone bot would otherwise die of thirst at tick 400).
- 2026-11-09: M7a built. Every death leaves a ruin (small decaying food node, no RNG, no log event, shared seek and eat path, nearby deaths merge, own count cap separate from the player's node cap); the player cannot place ruins but can remove them. `depleted` events are no longer logged (the fix for the crowded event buffer), so the Depleted filter is gone. New `World.eaten` totals (food eaten from resources and from ruins) feed a `ruin%` column in the survey and CLI. `NodeKind` gained `ruin`, `WorldNode` and `NodeDef` gained `decay`, `Tuning` gained `ruin`. The new tick phases and the extra food change every state hash, as expected. M7 split into M7a (ruin, built) and M7b (water, not started).
- 2026-11-09: M6 built. Children inherit traits with a seeded, bounded mutation (`mutation` in `tuning.ts`). Tradeoffs added so no trait is best at an extreme: `senseDrain` (sight costs energy), `metabolismSpeed` (metabolism also scales walking speed), `birthCost` (the parent burns 20 energy per birth; this changes the old "transfer, not new energy" birth rule). Samples carry the population mean of each trait; new "Traits over time" and "Population traits" panels, inspector shows the difference from the population mean, survey and CLI print mean traits. The mutation draws (eight per child on the `birth` stream) and the new energy rules change every state hash, as expected. The Depleted event filter now starts off.
- 2026-11-08: M4 and M5 built (MVP complete). Player commands with replay, toolbar (keys 1-6, Esc), inspector, hover ghost; stats strip, population and food chart with command markers, death causes, event log, reset with seed. Commands moved from `[LATER]` to built.
- 2026-11-08: M2 and M3 built. Canvas view and loop, then danger, shelter, reproduction, age death and a tuned eden preset (survives 20,000 ticks on seeds a..j). Rules above moved from `[LATER]` to built.
- 2026-11-08: M0 and M1 built. The user approved the full plan defaults (grid map, bots interact only through nodes, reproduce alone in shelter, traits from M1, stack as `trading-sim`). Status changed from `concept` to `active`.
