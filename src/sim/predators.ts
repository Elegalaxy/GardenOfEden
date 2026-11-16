// Predators (M21a): node kind `predator`, a hunter that walks the map. Its state is `WorldNode.hunt`.
//
// `movePredators` runs once per tick, right after the tick counter goes up and before any bot acts, so
// bots see and flee from where the predator stands this tick. Predators act in id order. Each takes
// exactly ONE draw from the `predator` stream per tick, a wander turn, whatever it is doing (resting,
// chasing or wandering), so the draw count never depends on where bots are. A world with no predator
// takes no draws at all.
//
// A predator that is resting (`tick <= restUntil`) stays put. Otherwise it picks the nearest living bot
// outside every shelter's radius whose centre is within `predator.senseRadius` of it (a tie goes to the
// lower bot id) and walks at `predator.speed` straight toward it. Each tick of chasing adds to `chase`;
// at `chaseTicks` it gives up: it rests `giveUpRest` ticks, forgets the target and starts over. With no
// target it wanders (the drawn turn), steered back toward its home spot when it is farther than
// `homeRange` from it. A predator never enters a shelter's radius: a step that would end inside one is
// replaced by the nearest heading (turned by 1, -1, 2, -2, ... `steerStep` radians) that does not, and if
// there is none it stands still. A step that moves away from the centre of a shelter it already stands in
// is allowed, so a predator placed inside one can leave. The map edge stops a step and turns it around.
//
// A bite is dealt in nodes.ts (`exposureAt`) and a kill is credited here (`creditKill`): the predator
// rests `digestTicks`, drops its target and counts the kill. The dead bot leaves a normal ruin.
// Numbers come only from `Tuning.predator`, the bot turn rate and the node's own radius and damage.

import { atan2, cos, hypot, sin } from './exactMath.ts'
import { nextFloat } from './rng.ts'
import type { Bot, Rules, Tuning, World, WorldNode } from './types.ts'

/** True when a point is inside a shelter's radius (the edge counts as inside, as in `exposureAt`). */
export function insideShelter(shelters: readonly WorldNode[], x: number, y: number): boolean {
  for (const shelter of shelters) {
    if (hypot(x - shelter.x, y - shelter.y) <= shelter.radius) return true
  }
  return false
}

/** A step is allowed if it ends outside every shelter, or moves away from the centre of one it is in. */
function isOpen(shelters: readonly WorldNode[], fromX: number, fromY: number, x: number, y: number): boolean {
  for (const shelter of shelters) {
    const after = hypot(x - shelter.x, y - shelter.y)
    if (after > shelter.radius) continue
    if (after > hypot(fromX - shelter.x, fromY - shelter.y)) continue
    return false
  }
  return true
}

/** Nearest bot outside every shelter within `range` of (x, y); ties go to the lowest id (bots are in id order). */
function nearestPrey(bots: readonly Bot[], shelters: readonly WorldNode[], x: number, y: number, range: number): Bot | null {
  let best: Bot | null = null
  let bestDistance = Infinity
  for (const bot of bots) {
    const d = hypot(bot.x - x, bot.y - y)
    if (d > range || d >= bestDistance) continue
    if (insideShelter(shelters, bot.x, bot.y)) continue
    best = bot
    bestDistance = d
  }
  return best
}

/** Try `heading`, then headings turned by 1, -1, 2, -2, ... steps up to a half turn; take the first that is open and moves. */
function stepPredator(
  world: World,
  node: WorldNode,
  hunt: NonNullable<WorldNode['hunt']>,
  shelters: readonly WorldNode[],
  heading: number,
  length: number,
  steerStep: number,
): void {
  const tries = Math.ceil(Math.PI / steerStep)
  for (let i = 0; i <= 2 * tries; i += 1) {
    const turn = Math.ceil(i / 2) * steerStep * (i % 2 === 1 ? 1 : -1)
    const candidate = heading + turn
    const rawX = node.x + cos(candidate) * length
    const rawY = node.y + sin(candidate) * length
    const x = Math.min(world.width, Math.max(0, rawX))
    const y = Math.min(world.height, Math.max(0, rawY))
    if (x === node.x && y === node.y) continue
    if (!isOpen(shelters, node.x, node.y, x, y)) continue
    node.x = x
    node.y = y
    hunt.heading = x !== rawX || y !== rawY ? candidate + Math.PI : candidate
    return
  }
}

export function movePredators(world: World, rules: Rules): void {
  const { predator, bot: botTuning } = rules.tuning
  let shelters: WorldNode[] | null = null
  for (const node of world.nodes) {
    const hunt = node.hunt
    if (node.kind !== 'predator' || hunt === null) continue
    // The one draw this predator takes per tick, whatever it does.
    const turn = (nextFloat(world.rng.predator) * 2 - 1) * botTuning.turnRate
    hunt.px = node.x
    hunt.py = node.y
    if (world.tick <= hunt.restUntil) continue
    if (shelters === null) shelters = world.nodes.filter((other) => other.kind === 'shelter')

    const prey = nearestPrey(world.bots, shelters, node.x, node.y, predator.senseRadius)
    if (prey === null) {
      hunt.targetId = null
      hunt.chase = 0
      let heading = hunt.heading + turn
      if (hypot(node.x - hunt.homeX, node.y - hunt.homeY) > predator.homeRange) {
        heading = atan2(hunt.homeY - node.y, hunt.homeX - node.x)
      }
      stepPredator(world, node, hunt, shelters, heading, predator.speed, predator.steerStep)
      continue
    }
    hunt.targetId = prey.id
    hunt.chase += 1
    if (hunt.chase >= predator.chaseTicks) {
      // Gives up: rest, forget the target, start over after the rest.
      hunt.restUntil = world.tick + predator.giveUpRest
      hunt.targetId = null
      hunt.chase = 0
      continue
    }
    const heading = atan2(prey.y - node.y, prey.x - node.x)
    const length = Math.min(predator.speed, hypot(prey.x - node.x, prey.y - node.y))
    stepPredator(world, node, hunt, shelters, heading, length, predator.steerStep)
  }
}

/** A predator killed a bot on `tick`: count it and rest `digestTicks` (later ticks see the rest). */
export function creditKill(world: World, predatorId: number, tick: number, tuning: Tuning): void {
  const node = world.nodes.find((candidate) => candidate.id === predatorId)
  const hunt = node?.hunt
  if (hunt === undefined || hunt === null) return
  hunt.kills += 1
  hunt.restUntil = tick + tuning.predator.digestTicks
  hunt.targetId = null
  hunt.chase = 0
}
