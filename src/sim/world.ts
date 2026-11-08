// World creation and small read helpers. A new world is built from a seed, a
// preset (the starting scene) and the rules (numbers from src/content). Fixed
// items are placed first, then scattered ones, so a preset's layout does not
// depend on how many things are scattered after it.

import { createRng, nextFloat } from './rng.ts'
import type { Bot, NodeDef, NodeKind, Preset, Rules, Sample, SimEvent, Tuning, World, WorldNode } from './types.ts'

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

/** A node from its kind's numbers. A resource starts full; other kinds carry no amount. */
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
  }
}

/** A bot with the default traits and an empty memory. */
export function makeBot(id: number, x: number, y: number, heading: number, rules: Rules): Bot {
  const { bot, traits } = rules.tuning
  return {
    id,
    x,
    y,
    px: x,
    py: y,
    energy: bot.startEnergy,
    health: bot.maxHealth,
    age: 0,
    cooldown: 0,
    generation: 0,
    parentId: null,
    traits: { ...traits },
    memory: [],
    intent: { kind: 'wander', targetId: null },
    heading,
  }
}

/** Sum of every resource node's current amount. */
export function totalFood(world: World): number {
  let total = 0
  for (const node of world.nodes) {
    if (node.kind === 'resource') total += node.amount
  }
  return total
}

/** Append to the event log, keeping only the newest `logCap` events. */
export function pushEvent(world: World, tuning: Tuning, event: SimEvent): void {
  world.log.push(event)
  if (world.log.length > tuning.logCap) world.log.splice(0, world.log.length - tuning.logCap)
}

export function totalDeaths(world: World): number {
  return world.deathsByCause.starve + world.deathsByCause.danger + world.deathsByCause.age
}

/** One stats row for the world as it stands now. */
export function takeSample(world: World): Sample {
  return {
    tick: world.tick,
    pop: world.bots.length,
    births: world.totalBirths,
    deaths: totalDeaths(world),
    food: totalFood(world),
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
    deathsByCause: { starve: 0, danger: 0, age: 0 },
    totalBirths: 0,
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

  for (const spec of preset.bots) {
    assertInside(preset, spec.x, spec.y, 'preset bot')
    const heading = nextFloat(stream) * TWO_PI
    world.bots.push(makeBot(world.nextId, spec.x, spec.y, heading, rules))
    world.nextId += 1
  }
  for (let i = 0; i < preset.scatterBots; i += 1) {
    const x = nextFloat(stream) * preset.width
    const y = nextFloat(stream) * preset.height
    const heading = nextFloat(stream) * TWO_PI
    world.bots.push(makeBot(world.nextId, x, y, heading, rules))
    world.nextId += 1
  }

  world.samples.push(takeSample(world))
  return world
}
