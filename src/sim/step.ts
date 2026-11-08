// One tick of the world. Bots act in id order, and each bot goes through the
// same phases: perceive -> memory -> decide -> act -> metabolise -> death check
// (then, if it lived, a reproduction check). Bots never read each other; they
// only share nodes, so the order matters only when two bots reach the same
// food in one tick (the lower id eats first).
//
// After the loop: dead bots are removed, children are added, nodes regrow,
// then a stats row is recorded every `stats.sampleEvery` ticks.
//
// The phases live in perception.ts, brain.ts, movement.ts, metabolism.ts,
// reproduction.ts and nodes.ts. `step` changes the world it is given. Random
// draws: the `ai` stream (one per wandering bot per tick) and the `birth`
// stream (three per child).

import { decide } from './brain.ts'
import { deathCause, metabolise } from './metabolism.ts'
import { act } from './movement.ts'
import { exposureAt, regrow } from './nodes.ts'
import { perceive, remember } from './perception.ts'
import { conceive, spawnChildren } from './reproduction.ts'
import type { Conception } from './reproduction.ts'
import type { Rules, World, WorldNode } from './types.ts'
import { pushEvent, takeSample } from './world.ts'

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
  const conceptions: Conception[] = []
  for (const bot of world.bots) {
    const sensed = perceive(world, bot)
    remember(world, bot, sensed, tuning, live)
    decide(world, bot, tuning)
    const moved = act(world, bot, rules, nodesById)
    const exposure = exposureAt(world, bot.x, bot.y)
    metabolise(bot, moved, exposure, tuning)
    const cause = deathCause(bot, tuning)
    if (cause !== null) {
      dead.add(bot.id)
      world.deathsByCause[cause] += 1
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

  regrow(world)

  if (world.tick % tuning.stats.sampleEvery === 0) {
    world.samples.push(takeSample(world))
    if (world.samples.length > tuning.stats.maxSamples) {
      world.samples.splice(0, world.samples.length - tuning.stats.maxSamples)
    }
  }
}
