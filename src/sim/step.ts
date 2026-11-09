// One tick of the world. Bots act in id order, and each bot goes through the
// same phases: perceive -> memory -> decide -> act -> metabolise -> death check
// (then, if it lived, a reproduction check). Bots never read each other, with one
// exception: a parent and its own child share what they remember (family.ts, M10).
// Otherwise they only share nodes, so the order matters only when two bots reach
// the same food in one tick (the lower id eats first).
//
// After the loop, in this order: dead bots are removed, children are added, the lineage store is
// pruned if it holds more than `lineage.maxRecords` records (lineage.ts), each dead bot leaves a ruin (in id order), resources regrow, ruins decay and
// the emptied ones are removed, world events and meteor craters whose time is up are
// removed (logging each), then family knowledge is shared (a living parent and child close
// together swap memory on every `family.shareEvery`-th tick), then a stats row is recorded every
// `stats.sampleEvery` ticks. A plague hurts inside the bot loop (metabolise); a drought or
// bounty acts in the regrow phase; both are still in force on their last tick. A ruin made this tick is already decaying by its
// end, and a ruin eaten empty this tick is gone before the next one; a bot
// that was heading for it simply finds the node missing and wanders.
//
// The phases live in perception.ts, brain.ts, movement.ts, metabolism.ts,
// reproduction.ts, ruins.ts, nodes.ts, worldEvents.ts, family.ts and lineage.ts. `step` changes the world it is
// given. Random draws: the `ai` stream (one per wandering bot per tick) and
// the `birth` stream (eleven per child). Ruins, family sharing and lineage records draw nothing.

import { decide } from './brain.ts'
import { shareFamilyKnowledge } from './family.ts'
import { pruneLineage, recordDeath } from './lineage.ts'
import { deathCause, metabolise } from './metabolism.ts'
import { act } from './movement.ts'
import { exposureAt, regrow } from './nodes.ts'
import { perceive, remember } from './perception.ts'
import { conceive, spawnChildren } from './reproduction.ts'
import type { Conception } from './reproduction.ts'
import { decayRuins, leaveRuin } from './ruins.ts'
import type { Bot, Rules, World, WorldNode } from './types.ts'
import { pushEvent, takeSample } from './world.ts'
import { expireEvents } from './worldEvents.ts'

export function step(world: World, rules: Rules): void {
  const { tuning } = rules
  world.tick += 1

  const live = new Set<number>()
  const nodesById = new Map<number, WorldNode>()
  for (const node of world.nodes) {
    live.add(node.id)
    nodesById.set(node.id, node)
  }

  const dead = new Set<number>()
  const fallen: Bot[] = []
  const conceptions: Conception[] = []
  for (const bot of world.bots) {
    const sensed = perceive(world, bot)
    remember(world, bot, sensed, tuning, live)
    decide(world, bot, tuning)
    const moved = act(world, bot, rules, nodesById)
    const exposure = exposureAt(world, bot.x, bot.y)
    metabolise(bot, moved, exposure, tuning)
    const cause = deathCause(bot, exposure, tuning)
    if (cause !== null) {
      dead.add(bot.id)
      fallen.push(bot)
      world.deathsByCause[cause] += 1
      recordDeath(world, bot.id, cause)
      pushEvent(world, tuning, { tick: world.tick, type: 'death', botId: bot.id, cause, x: bot.x, y: bot.y })
      continue
    }
    // Count the bots that will be alive after this loop, so the cap is never passed.
    const hasRoom = world.bots.length - dead.size + conceptions.length < tuning.population.cap
    const conception = conceive(bot, exposure.shelterId !== null, hasRoom, tuning)
    if (conception !== null) conceptions.push(conception)
  }
  if (dead.size > 0) world.bots = world.bots.filter((bot) => !dead.has(bot.id))
  spawnChildren(world, conceptions, tuning)
  pruneLineage(world, tuning)
  for (const bot of fallen) leaveRuin(world, bot, rules)

  regrow(world)
  decayRuins(world, tuning)
  expireEvents(world, tuning)
  shareFamilyKnowledge(world, tuning)

  if (world.tick % tuning.stats.sampleEvery === 0) {
    world.samples.push(takeSample(world))
    if (world.samples.length > tuning.stats.maxSamples) {
      world.samples.splice(0, world.samples.length - tuning.stats.maxSamples)
    }
  }
}
