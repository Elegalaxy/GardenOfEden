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
//
// Directional sensing (V1, `Tuning.perception.cone`, on in Eden since V2; with it off `nearestPrey` runs as before): the predator then sees
// along `hunt.heading` with a cone (`nearestPreyCone`: reach range * coneFactor(cos, predatorFront, predatorRear)) and keeps a lock:
// the bot it is already chasing (`hunt.targetId`) stays a candidate while within range * predatorFront in any direction. The nearest
// candidate outside the shelters wins as before; chase counter, give-up and the one draw per tick are unchanged.
//
// Predator ecology (E1, `Tuning.predator.ecology`, on in Eden since E2; with it off none of this runs, no key is added to the
// world and no draw is taken). A predator then has `hunt.life` (energy, age, kills since its last cub). Energy falls by `drain`
// each tick and a kill adds `killEnergy` (up to `maxEnergy`); a predator below `huntBelow` hunts, a fed one skips its target
// (it still takes its one wander draw) and walks home, and `exposureAt` lets only a hungry predator bite. At 0 energy it starves,
// at `maxAge` it dies of age (`predatorLife`, once per tick after the world events expire; the node is removed, a log event is
// written and bots forget it as they do any missing node). A predator that has made `killsPerCub` kills, is an adult and keeps
// `huntBelow` energy after paying `cubCost` breeds alone: it looks up to `homeTries` times for a free territory (two `predator`
// draws a try: an angle and a distance around its own home, valid when inside the map margin, outside every shelter and at least
// `homeSpacing` from every other home) and, if one is found, a cub appears at the parent with that home. No spot means nothing
// changes. Every starting or placed predator marks a den; a den with no predator homed within `denRadius` for `recolonizeTicks`
// is taken by a newcomer from the nearest map edge (no draw). Cubs never make dens. Draws: one per predator per tick, plus two
// per territory try when a cub is attempted.

import { atan2, cos, hypot, sin } from './exactMath.ts'
import { coneFactor } from './perception.ts'
import { nextFloat } from './rng.ts'
import type { Bot, PredatorEventKind, PredatorOrigin, Rules, Tuning, World, WorldNode } from './types.ts'
import { makeNode, pushEvent } from './world.ts'

/** Throws when the ecology numbers cannot work: every number above 0 (`drain` may be 0) `huntBelow` at most `maxEnergy`, and `cubCost + huntBelow` at most `maxEnergy - drain`. */
export function checkEcology(ecology: Tuning['predator']['ecology']): void {
  const { enabled: _enabled, drain, ...positive } = ecology
  if (!(Number.isFinite(drain) && drain >= 0)) throw new RangeError(`predator.ecology.drain must be a number from 0, received ${drain}`)
  for (const [name, value] of Object.entries(positive)) {
    if (!(Number.isFinite(value) && value > 0)) throw new RangeError(`predator.ecology.${name} must be a number above 0, received ${value}`)
  }
  if (ecology.huntBelow > ecology.maxEnergy) {
    throw new RangeError(`predator.ecology.huntBelow (${ecology.huntBelow}) must not exceed maxEnergy (${ecology.maxEnergy})`)
  }
  // A kill tops energy up to at most maxEnergy and predatorLife takes `drain` off before the cub check, so a cub needs
  // cubCost + huntBelow <= maxEnergy - drain; with anything larger no predator could ever breed.
  if (ecology.cubCost + ecology.huntBelow > ecology.maxEnergy - drain) {
    throw new RangeError(
      `predator.ecology.cubCost (${ecology.cubCost}) + huntBelow (${ecology.huntBelow}) must not exceed maxEnergy (${ecology.maxEnergy}) minus drain (${drain}), or no predator could ever breed`,
    )
  }
}

/** Give a predator node its ecology life (energy `cubEnergy`, age 0). Call only with ecology on. */
export function startLife(world: Pick<World, 'tick'>, node: WorldNode, tuning: Pick<Tuning, 'predator'>, origin: PredatorOrigin, parentId: number | null): void {
  if (node.hunt === null) return
  node.hunt.life = { energy: tuning.predator.ecology.cubEnergy, age: 0, born: world.tick, origin, parentId, kidsKills: 0 }
}

/** Mark a den at (x, y) unless one is already within `denRadius`. A world without ecology has none. */
export function addDen(world: Pick<World, 'ecology'>, x: number, y: number, tuning: Pick<Tuning, 'predator'>): void {
  const { ecology } = world
  if (ecology === undefined) return
  for (const den of ecology.dens) {
    if (hypot(den.x - x, den.y - y) <= tuning.predator.ecology.denRadius) return
  }
  ecology.dens.push({ x, y, vacantSince: null })
}

/** True when a predator may hunt and bite: ecology off, no life yet, or energy below `huntBelow`. */
export function isHungry(hunt: NonNullable<WorldNode['hunt']>, tuning: Pick<Tuning, 'predator'>): boolean {
  const ecology = tuning.predator.ecology
  return !ecology.enabled || hunt.life === undefined || hunt.life.energy < ecology.huntBelow
}

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

/**
 * Cone version of `nearestPrey` (V1): a bot is a candidate when within range * coneFactor of the heading (hx, hy), or, if it is the
 * locked target (`lockId`), within range * front in any direction. Nearest wins, ties to the lowest id; shelters protect as before.
 */
function nearestPreyCone(
  bots: readonly Bot[],
  shelters: readonly WorldNode[],
  x: number,
  y: number,
  range: number,
  hx: number,
  hy: number,
  front: number,
  rear: number,
  lockId: number | null,
): Bot | null {
  let best: Bot | null = null
  let bestDistance = Infinity
  for (const bot of bots) {
    const dx = bot.x - x
    const dy = bot.y - y
    const d = hypot(dx, dy)
    if (d >= bestDistance) continue
    let limit: number
    if (bot.id === lockId) {
      limit = range * front
    } else {
      if (d > range * front) continue
      limit = range * coneFactor(d > 0 ? (dx * hx + dy * hy) / d : 1, front, rear)
    }
    if (d > limit) continue
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
  const cone = rules.tuning.perception.cone
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

    let prey: Bot | null = null
    if (isHungry(hunt, rules.tuning)) {
      prey = cone.enabled
        ? nearestPreyCone(
            world.bots, shelters, node.x, node.y, predator.senseRadius,
            cos(hunt.heading), sin(hunt.heading), cone.predatorFront, cone.predatorRear, hunt.targetId,
          )
        : nearestPrey(world.bots, shelters, node.x, node.y, predator.senseRadius)
    }
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
  const life = hunt.life
  if (life !== undefined) {
    life.energy = Math.min(tuning.predator.ecology.maxEnergy, life.energy + tuning.predator.ecology.killEnergy)
    life.kidsKills += 1
  }
}

function logPredator(world: World, tuning: Tuning, node: WorldNode, kind: PredatorEventKind): void {
  pushEvent(world, tuning, { tick: world.tick, type: 'predator', nodeId: node.id, predatorEvent: kind, x: node.x, y: node.y })
}

/** True when a living predator is homed within `radius` of (x, y). */
function homedNear(nodes: readonly WorldNode[], x: number, y: number, radius: number): boolean {
  for (const node of nodes) {
    const hunt = node.hunt
    if (node.kind === 'predator' && hunt !== null && hypot(hunt.homeX - x, hunt.homeY - y) <= radius) return true
  }
  return false
}

/** The point on the map edge nearest to (x, y); a tie goes left, right, top, bottom. */
function nearestEdgePoint(world: Pick<World, 'width' | 'height'>, x: number, y: number): { x: number; y: number } {
  const best = Math.min(x, world.width - x, y, world.height - y)
  if (x === best) return { x: 0, y }
  if (world.width - x === best) return { x: world.width, y }
  if (y === best) return { x, y: 0 }
  return { x, y: world.height }
}

/**
 * Predator ecology for one tick (E1), after the world events expire: ageing and starvation, cubs, then dens. Does nothing
 * with ecology off or in a world made without it. Predators are visited in id order and every list is built in a fixed order.
 */
export function predatorLife(world: World, rules: Rules): void {
  const { tuning } = rules
  const eco = tuning.predator.ecology
  const ecology = world.ecology
  if (!eco.enabled || ecology === undefined) return

  const gone = new Set<number>()
  for (const node of world.nodes) {
    const life = node.hunt?.life
    if (node.kind !== 'predator' || life === undefined) continue
    life.age += 1
    life.energy -= eco.drain
    if (life.energy <= 0) {
      gone.add(node.id)
      ecology.stats.starved += 1
      logPredator(world, tuning, node, 'starved')
    } else if (life.age >= eco.maxAge) {
      gone.add(node.id)
      ecology.stats.aged += 1
      logPredator(world, tuning, node, 'aged')
    }
  }
  if (gone.size > 0) world.nodes = world.nodes.filter((node) => !gone.has(node.id))

  // Cubs: each adult predator that has earned one looks for free territory around its own home.
  const shelters = world.nodes.filter((node) => node.kind === 'shelter')
  const parents = world.nodes.filter((node) => node.kind === 'predator' && node.hunt?.life !== undefined)
  const homes: { x: number; y: number }[] = []
  let count = 0
  for (const node of world.nodes) {
    if (node.kind !== 'predator' || node.hunt === null) continue
    count += 1
    homes.push({ x: node.hunt.homeX, y: node.hunt.homeY })
  }
  const cubs: WorldNode[] = []
  for (const parent of parents) {
    const hunt = parent.hunt
    const life = hunt?.life
    if (hunt === null || life === undefined) continue
    if (life.kidsKills < eco.killsPerCub || life.age < eco.adultAge || life.energy < eco.cubCost + eco.huntBelow) continue
    if (count + cubs.length >= tuning.predator.maxCount) continue
    for (let attempt = 0; attempt < eco.homeTries; attempt += 1) {
      const angle = 2 * Math.PI * nextFloat(world.rng.predator)
      const distance = eco.homeSpacing * (1 + nextFloat(world.rng.predator))
      const x = hunt.homeX + cos(angle) * distance
      const y = hunt.homeY + sin(angle) * distance
      if (x < eco.homeMargin || y < eco.homeMargin || x > world.width - eco.homeMargin || y > world.height - eco.homeMargin) continue
      if (insideShelter(shelters, x, y)) continue
      if (homes.some((home) => hypot(home.x - x, home.y - y) < eco.homeSpacing)) continue
      const cub = makeNode(0, 'predator', parent.x, parent.y, rules.nodeDefs.predator)
      if (cub.hunt !== null) {
        cub.hunt.homeX = x
        cub.hunt.homeY = y
      }
      startLife(world, cub, tuning, 'cub', parent.id)
      cubs.push(cub)
      homes.push({ x, y })
      life.energy -= eco.cubCost
      life.kidsKills = 0
      break
    }
  }
  for (const cub of cubs) {
    cub.id = world.nextId
    world.nextId += 1
    world.nodes.push(cub)
    ecology.stats.births += 1
    logPredator(world, tuning, cub, 'born')
  }
  count += cubs.length

  // Dens: an empty one is taken by a newcomer from the nearest map edge after `recolonizeTicks`.
  for (const den of ecology.dens) {
    if (homedNear(world.nodes, den.x, den.y, eco.denRadius)) {
      den.vacantSince = null
      continue
    }
    if (den.vacantSince === null) {
      den.vacantSince = world.tick
      continue
    }
    if (world.tick - den.vacantSince < eco.recolonizeTicks || count >= tuning.predator.maxCount) continue
    const edge = nearestEdgePoint(world, den.x, den.y)
    const newcomer = makeNode(world.nextId, 'predator', edge.x, edge.y, rules.nodeDefs.predator)
    world.nextId += 1
    if (newcomer.hunt !== null) {
      newcomer.hunt.homeX = den.x
      newcomer.hunt.homeY = den.y
    }
    startLife(world, newcomer, tuning, 'arrived', null)
    world.nodes.push(newcomer)
    count += 1
    den.vacantSince = null
    ecology.stats.arrivals += 1
    logPredator(world, tuning, newcomer, 'arrived')
  }
}
