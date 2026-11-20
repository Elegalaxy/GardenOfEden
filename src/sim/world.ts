// World creation and small read helpers. A new world is built from a seed, a
// preset (the starting scene) and the rules (numbers from src/content). Fixed
// items are placed first, then scattered ones, so a preset's layout does not
// depend on how many things are scattered after it. Every founder gets a lineage record. Founders
// alternate female, male, ... in creation order (preset bots first, then scattered ones). With predator ecology on (E1) the
// preset's predators get a life and a den after every node is placed (no draws). With poison on (T1) the last scattered food nodes are toxic (poison.ts).

import { goldenHue } from './genes.ts'
import { addRecord } from './lineage.ts'
import { checkPerception } from './perception.ts'
import { addDen, checkEcology, checkPredatorHarm, checkPrey, startLife } from './predators.ts'
import { checkMateChoice } from './kin.ts'
import { checkCulture } from './culture.ts'
import { checkDisease } from './disease.ts'
import { checkPoison, markToxic } from './poison.ts'
import { checkPredatorTraits, DEFAULT_PREDATOR_TRAITS, startTraits, traitsOn } from './predatorTraits.ts'
import { createRng, nextFloat } from './rng.ts'
import { checkTerrain } from './terrain.ts'
import { meanTraits } from './traits.ts'
import type { Bot, NodeDef, NodeKind, Preset, Rules, Sample, Sex, SimEvent, Tuning, World, WorldNode } from './types.ts'

const TWO_PI = Math.PI * 2

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite number > 0, received ${describeValue(value)}`)
  }
}

function assertInside(preset: Preset, x: number, y: number, label: string): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > preset.width || y > preset.height) {
    throw new Error(
      `${label} must be inside the ${preset.width}x${preset.height} map, received x=${describeValue(x)} y=${describeValue(y)}`,
    )
  }
}

/** A node from its kind's numbers. A resource starts full; other kinds (water included) carry no amount. */
export function makeNode(id: number, kind: NodeKind, x: number, y: number, def: NodeDef): WorldNode {
  return {
    id,
    kind,
    x,
    y,
    radius: def.radius,
    amount: kind === 'resource' ? def.capacity : 0,
    capacity: def.capacity,
    regen: def.regen,
    damage: def.damage,
    heal: def.heal,
    drainMult: def.drainMult,
    decay: def.decay,
    expires: 0,
    hunt:
      kind === 'predator'
        ? { px: x, py: y, heading: 0, homeX: x, homeY: y, targetId: null, chase: 0, restUntil: 0, kills: 0 }
        : null,
  }
}

/** The sex there are fewer of among these bots; a tie gives female. No random draw. */
export function autoSex(bots: readonly Pick<Bot, 'sex'>[]): Sex {
  let females = 0
  for (const bot of bots) {
    if (bot.sex === 'female') females += 1
  }
  return females <= bots.length - females ? 'female' : 'male'
}

/** A bot with the default traits, full health and thirst, and an empty memory. */
export function makeBot(id: number, x: number, y: number, heading: number, rules: Rules, sex: Sex = 'female', hue = 0): Bot {
  const { bot, traits } = rules.tuning
  return {
    id,
    x,
    y,
    px: x,
    py: y,
    energy: bot.startEnergy,
    health: bot.maxHealth,
    thirst: bot.maxThirst,
    age: 0,
    cooldown: 0,
    generation: 0,
    parentId: null,
    fatherId: null,
    sex,
    inbreeding: 0,
    lifespan: Math.round(bot.maxAge * traits.longevity),
    hue,
    traits: { ...traits },
    memory: [],
    intent: { kind: 'wander', targetId: null },
    heading,
  }
}

/** Sum of every resource node's current amount. */
export function totalFood(world: Pick<World, 'nodes'>): number {
  let total = 0
  for (const node of world.nodes) {
    if (node.kind === 'resource') total += node.amount
  }
  return total
}

/** Sum of every ruin's current amount (kept apart from `totalFood`, which counts resources only). */
export function totalRuinFood(world: Pick<World, 'nodes'>): number {
  let total = 0
  for (const node of world.nodes) {
    if (node.kind === 'ruin') total += node.amount
  }
  return total
}

/** Nodes the player counts against `player.maxNodes`: everything except ruins, meteor craters and predators (those have their own cap, `predator.maxCount`). */
export function placedNodeCount(world: Pick<World, 'nodes'>): number {
  let count = 0
  for (const node of world.nodes) {
    if (node.kind !== 'ruin' && node.kind !== 'predator' && node.expires === 0) count += 1
  }
  return count
}

/** Append to the event log, keeping only the newest `logCap` events. */
export function pushEvent(world: World, tuning: Tuning, event: SimEvent): void {
  world.log.push(event)
  if (world.log.length > tuning.logCap) world.log.splice(0, world.log.length - tuning.logCap)
}

export function totalDeaths(world: Pick<World, 'deathsByCause'>): number {
  const d = world.deathsByCause
  return d.starve + d.thirst + d.danger + d.plague + d.meteor + d.predator + d.age + (d.poison ?? 0) + (d.disease ?? 0)
}

/** One stats row for the world as it stands now. */
/** What `takeSample` reads: a World, or the main thread's copy of one (bots without their memory). */
export type Sampleable = Pick<World, 'tick' | 'nodes' | 'totalBirths' | 'deathsByCause'> & {
  ecology?: unknown
  bots: readonly Pick<Bot, 'traits'>[]
}

export function takeSample(world: Sampleable): Sample {
  const sample: Sample = {
    tick: world.tick,
    pop: world.bots.length,
    births: world.totalBirths,
    deaths: totalDeaths(world),
    food: totalFood(world),
    traits: meanTraits(world.bots),
  }
  // Only a world with predator ecology (E1) counts its predators; the key is absent otherwise, so hashes are unchanged.
  if (world.ecology !== undefined) sample.predators = world.nodes.filter((node) => node.kind === 'predator').length
  return sample
}

export function createWorld(seed: string, preset: Preset, rules: Rules): World {
  assertPositive(preset.width, 'preset width')
  assertPositive(preset.height, 'preset height')
  if (rules.tuning.predator.ecology.enabled) checkEcology(rules.tuning.predator.ecology)
  if (rules.tuning.predator.ecology.enabled && rules.tuning.predator.prey.enabled) checkPrey(rules.tuning.predator.prey, rules.tuning.predator.maxCount)
  checkPredatorTraits(rules.tuning.predator.traits)
  checkPredatorHarm(rules.tuning.events.predatorHarm)
  if (rules.tuning.perception.cone.enabled) checkPerception(rules.tuning.perception.cone)
  checkPoison(rules.tuning.poison)
  checkDisease(rules.tuning.disease)
  checkCulture(rules.tuning.culture)
  checkTerrain(rules.tuning.terrain)
  checkMateChoice(rules.tuning.mateChoice)

  const world: World = {
    seed,
    tick: 0,
    width: preset.width,
    height: preset.height,
    nextId: 1,
    nodes: [],
    bots: [],
    rng: createRng(seed),
    samples: [],
    log: [],
    commands: [],
    deathsByCause: { starve: 0, thirst: 0, danger: 0, plague: 0, meteor: 0, predator: 0, age: 0 },
    eaten: { resource: 0, ruin: 0 },
    totalBirths: 0,
    events: [],
    familyLearned: 0,
    inbredBirths: 0,
    lineage: [],
    lineagePruned: 0,
  }
  const stream = world.rng.world
  // Toxic food (T1): world-made keys are added after the object literal so they stay last; absent with poison off.
  const poisonOn = rules.tuning.poison.enabled
  if (poisonOn) {
    world.eaten.toxic = 0
    world.deathsByCause.poison = 0
  }
  // Culture (C1): the counter exists only with culture on, added after the literal so the key stays last.
  if (rules.tuning.culture.enabled) world.culture = { taught: 0 }
  const scatteredFood: WorldNode[] = []

  for (const spec of preset.nodes) {
    assertInside(preset, spec.x, spec.y, `preset node (${spec.kind})`)
    world.nodes.push(makeNode(world.nextId, spec.kind, spec.x, spec.y, rules.nodeDefs[spec.kind]))
    world.nextId += 1
  }
  for (const group of preset.scatter) {
    const def = rules.nodeDefs[group.kind]
    for (let i = 0; i < group.count; i += 1) {
      // Keep the whole node on the map.
      const x = def.radius + nextFloat(stream) * Math.max(0, preset.width - 2 * def.radius)
      const y = def.radius + nextFloat(stream) * Math.max(0, preset.height - 2 * def.radius)
      const node = makeNode(world.nextId, group.kind, x, y, def)
      world.nodes.push(node)
      if (poisonOn && group.kind === 'resource') scatteredFood.push(node)
      world.nextId += 1
    }
  }
  if (poisonOn) markToxic(scatteredFood, rules.tuning)

  // Founders alternate female, male, ... in creation order (no random draw).
  let founderIndex = 0
  for (const spec of preset.bots) {
    assertInside(preset, spec.x, spec.y, 'preset bot')
    const heading = nextFloat(stream) * TWO_PI
    const bot = makeBot(world.nextId, spec.x, spec.y, heading, rules, founderIndex % 2 === 0 ? 'female' : 'male', goldenHue(founderIndex))
    founderIndex += 1
    world.bots.push(bot)
    addRecord(world, bot.id, null, null, bot.sex, bot.generation, bot.traits, bot.hue)
    world.nextId += 1
  }
  for (let i = 0; i < preset.scatterBots; i += 1) {
    const x = nextFloat(stream) * preset.width
    const y = nextFloat(stream) * preset.height
    const heading = nextFloat(stream) * TWO_PI
    const bot = makeBot(world.nextId, x, y, heading, rules, founderIndex % 2 === 0 ? 'female' : 'male', goldenHue(founderIndex))
    founderIndex += 1
    world.bots.push(bot)
    addRecord(world, bot.id, null, null, bot.sex, bot.generation, bot.traits, bot.hue)
    world.nextId += 1
  }

  // Rough ground (R1): made last of all nodes, so every other id and draw is the same with terrain on or off. No draws.
  if (rules.tuning.terrain.enabled) {
    for (const spec of preset.terrain ?? []) {
      assertInside(preset, spec.x, spec.y, 'preset terrain')
      world.nodes.push(makeNode(world.nextId, 'rough', spec.x, spec.y, { ...rules.nodeDefs.rough, radius: spec.radius }))
      world.nextId += 1
    }
  }

  // Predator ecology (E1): every preset predator gets a life and marks a den. No draws.
  if (rules.tuning.predator.ecology.enabled) {
    world.ecology = { dens: [], stats: { births: 0, arrivals: 0, starved: 0, aged: 0, removed: 0 } }
    if (rules.tuning.predator.prey.enabled) world.ecology.prey = { overSince: null, left: 0 }
    for (const node of world.nodes) {
      if (node.kind !== 'predator') continue
      startLife(world, node, rules.tuning, 'founder', null)
      if (traitsOn(world, rules.tuning)) startTraits(node.hunt, DEFAULT_PREDATOR_TRAITS, 0)
      addDen(world, node.x, node.y, rules.tuning)
    }
  }

  world.samples.push(takeSample(world))
  return world
}
