// World creation and small read helpers. A new world is built from a seed, a
// preset (the starting scene) and the rules (numbers from src/content). Fixed
// items are placed first, then scattered ones, so a preset's layout does not
// depend on how many things are scattered after it. Every founder gets a lineage record. Founders
// alternate female, male, ... in creation order (preset bots first, then scattered ones).

import { addRecord } from './lineage.ts'
import { createRng, nextFloat } from './rng.ts'
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
export function makeBot(id: number, x: number, y: number, heading: number, rules: Rules, sex: Sex = 'female'): Bot {
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
    lifespan: bot.maxAge,
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

/** Nodes the player counts against `player.maxNodes`: everything except ruins and meteor craters. */
export function placedNodeCount(world: Pick<World, 'nodes'>): number {
  let count = 0
  for (const node of world.nodes) {
    if (node.kind !== 'ruin' && node.expires === 0) count += 1
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
  return d.starve + d.thirst + d.danger + d.plague + d.meteor + d.age
}

/** One stats row for the world as it stands now. */
/** What `takeSample` reads: a World, or the main thread's copy of one (bots without their memory). */
export type Sampleable = Pick<World, 'tick' | 'nodes' | 'totalBirths' | 'deathsByCause'> & {
  bots: readonly Pick<Bot, 'traits'>[]
}

export function takeSample(world: Sampleable): Sample {
  return {
    tick: world.tick,
    pop: world.bots.length,
    births: world.totalBirths,
    deaths: totalDeaths(world),
    food: totalFood(world),
    traits: meanTraits(world.bots),
  }
}

export function createWorld(seed: string, preset: Preset, rules: Rules): World {
  assertPositive(preset.width, 'preset width')
  assertPositive(preset.height, 'preset height')

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
    deathsByCause: { starve: 0, thirst: 0, danger: 0, plague: 0, meteor: 0, age: 0 },
    eaten: { resource: 0, ruin: 0 },
    totalBirths: 0,
    events: [],
    familyLearned: 0,
    inbredBirths: 0,
    lineage: [],
    lineagePruned: 0,
  }
  const stream = world.rng.world

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
      world.nodes.push(makeNode(world.nextId, group.kind, x, y, def))
      world.nextId += 1
    }
  }

  // Founders alternate female, male, ... in creation order (no random draw).
  let founderIndex = 0
  for (const spec of preset.bots) {
    assertInside(preset, spec.x, spec.y, 'preset bot')
    const heading = nextFloat(stream) * TWO_PI
    const bot = makeBot(world.nextId, spec.x, spec.y, heading, rules, founderIndex % 2 === 0 ? 'female' : 'male')
    founderIndex += 1
    world.bots.push(bot)
    addRecord(world, bot.id, null, null, bot.sex, bot.generation, bot.traits)
    world.nextId += 1
  }
  for (let i = 0; i < preset.scatterBots; i += 1) {
    const x = nextFloat(stream) * preset.width
    const y = nextFloat(stream) * preset.height
    const heading = nextFloat(stream) * TWO_PI
    const bot = makeBot(world.nextId, x, y, heading, rules, founderIndex % 2 === 0 ? 'female' : 'male')
    founderIndex += 1
    world.bots.push(bot)
    addRecord(world, bot.id, null, null, bot.sex, bot.generation, bot.traits)
    world.nextId += 1
  }

  world.samples.push(takeSample(world))
  return world
}
