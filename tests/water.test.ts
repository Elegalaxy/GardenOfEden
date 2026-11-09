import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { applyCommand, checkCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { meetsReproductionNeeds } from '../src/sim/reproduction.ts'
import { step } from '../src/sim/step.ts'
import type { Command, Preset, World } from '../src/sim/types.ts'
import { createWorld, totalDeaths } from '../src/sim/world.ts'

// Water and thirst (M7b). These need the real numbers from src/content, so
// they live here and not next to src/sim.

const { bot: botRules } = rules.tuning

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', width: 40, height: 40, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

/** One bot in the middle of an empty map. */
const lone = scene({ bots: [{ x: 20, y: 20 }] })

/** Keeps the bots from starving, so only thirst can end the test. */
function stepFed(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    for (const bot of world.bots) bot.energy = botRules.maxEnergy
    step(world, rules)
  }
}

describe('thirst', () => {
  it('starts full for founders, placed bots and newborns', () => {
    const world = createWorld('a', edenPreset, rules)
    expect(world.bots.every((bot) => bot.thirst === botRules.maxThirst)).toBe(true)

    const empty = createWorld('a', scene({}), rules)
    expect(applyCommand(empty, rules, { type: 'placeBot', x: 5.5, y: 5.5 }).ok).toBe(true)
    expect(empty.bots[0]?.thirst).toBe(botRules.maxThirst)

    // The newborns of the first birth tick are full (they have not had a tick of their own yet).
    const born = createWorld('a', edenPreset, rules)
    while (born.totalBirths === 0 && born.tick < 3000) step(born, rules)
    expect(born.totalBirths).toBeGreaterThan(0)
    const children = born.bots.filter((bot) => bot.parentId !== null)
    expect(children.length).toBeGreaterThan(0)
    for (const child of children) expect(child.thirst).toBe(botRules.maxThirst)
  })

  it('drains by thirstDrain per tick', () => {
    const world = createWorld('a', lone, rules)
    stepFed(world, 10)
    expect(world.bots[0]?.thirst).toBe(botRules.maxThirst - 10 * botRules.thirstDrain)
  })

  it('drains faster for a hotter metabolism, and no slower for a cooler one', () => {
    const lost = (metabolism: number): number => {
      const world = createWorld('a', lone, rules)
      world.bots[0]!.traits.metabolism = metabolism
      stepFed(world, 1)
      return botRules.maxThirst - world.bots[0]!.thirst
    }
    const power = botRules.thirstMetabolismPower
    expect(lost(1)).toBe(botRules.thirstDrain)
    expect(lost(1.5)).toBeCloseTo(botRules.thirstDrain * 1.5 ** power, 12)
    expect(lost(0.8)).toBe(botRules.thirstDrain)
    expect(lost(1.5)).toBeGreaterThan(lost(1) * 1.5)
  })

  it('kills a lone bot without water on the expected tick, as a thirst death', () => {
    const expected = Math.ceil(botRules.maxThirst / botRules.thirstDrain)
    expect(expected).toBe(400)
    const world = createWorld('a', lone, rules)
    stepFed(world, expected - 1)
    expect(world.bots).toHaveLength(1)
    expect(world.deathsByCause.thirst).toBe(0)

    stepFed(world, 1)
    expect(world.tick).toBe(expected)
    expect(world.bots).toHaveLength(0)
    expect(world.deathsByCause).toMatchObject({ thirst: 1, starve: 0, danger: 0, age: 0 })
    expect(totalDeaths(world)).toBe(1)
    expect(world.log.find((event) => event.type === 'death')).toMatchObject({ tick: expected, cause: 'thirst' })
  })

  it('leaves a ruin like any other death', () => {
    const world = createWorld('a', lone, rules)
    stepFed(world, 400)
    expect(world.nodes.filter((node) => node.kind === 'ruin')).toHaveLength(1)
  })

  it('does not stop a bot reproducing', () => {
    const world = createWorld('a', lone, rules)
    const bot = world.bots[0]!
    bot.energy = 90
    bot.age = botRules.adultAge + 1
    bot.thirst = 1
    expect(meetsReproductionNeeds(bot, rules.tuning)).toBe(true)
  })
})

describe('drinking', () => {
  // The spring's edge is 6 cells from the bot, which is exactly the default sense radius.
  const spring = scene({ nodes: [{ kind: 'water', x: 24, y: 20 }], bots: [{ x: 16, y: 20 }] })

  it('sends a thirsty bot that sees water to drink, and keeps it alive', () => {
    const world = createWorld('a', spring, rules)
    world.bots[0]!.thirst = 20
    world.bots[0]!.heading = 0
    stepFed(world, 1)
    expect(world.bots[0]?.intent.kind).toBe('seekWater')

    stepFed(world, 120)
    expect(world.bots).toHaveLength(1)
    expect(world.bots[0]!.thirst).toBeGreaterThan(botRules.thirstyBelow * botRules.maxThirst)
    expect(world.deathsByCause.thirst).toBe(0)
  })

  it('is the difference: the same bot with no spring dies of thirst on the expected tick', () => {
    const dry = scene({ bots: [{ x: 16, y: 20 }] })
    const world = createWorld('a', dry, rules)
    world.bots[0]!.thirst = 20
    const expected = Math.ceil(20 / botRules.thirstDrain)
    stepFed(world, expected)
    expect(world.tick).toBe(expected)
    expect(world.deathsByCause.thirst).toBe(1)
  })

  it('refills at the spring by drinkRate per tick, and stops asking for water once nearly full', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'water', x: 20, y: 20 }], bots: [{ x: 20, y: 20 }] }), rules)
    world.bots[0]!.thirst = 40
    stepFed(world, 1)
    expect(world.bots[0]?.thirst).toBe(40 + botRules.drinkRate - botRules.thirstDrain)
    stepFed(world, 30)
    const bot = world.bots[0]!
    // A bot stops drinking when the pull of the spring falls below the wander score (as with eating).
    const stopsAt = 1 - rules.tuning.brain.wanderScore / rules.tuning.brain.thirstWeight
    expect(bot.thirst).toBeGreaterThanOrEqual((stopsAt - 0.05) * botRules.maxThirst)
    expect(bot.thirst).toBeLessThanOrEqual(botRules.maxThirst)
    expect(bot.intent.kind).not.toBe('seekWater')
  })

  it('never uses the spring up', () => {
    const crowd = scene({
      nodes: [{ kind: 'water', x: 20, y: 20 }],
      bots: Array.from({ length: 8 }, (_, i) => ({ x: 18 + i * 0.5, y: 20 })),
    })
    const world = createWorld('a', crowd, rules)
    for (const bot of world.bots) bot.thirst = 10
    const before = JSON.stringify(world.nodes[0])
    stepFed(world, 300)
    expect(JSON.stringify(world.nodes.find((node) => node.kind === 'water'))).toBe(before)
    expect(world.nodes.find((node) => node.kind === 'water')).toMatchObject({ amount: 0, capacity: 0 })
  })

  it('keeps a remembered spring when food crowds the rest of the memory', () => {
    const nodes: Preset['nodes'] = [{ kind: 'water', x: 20, y: 20 }]
    for (let i = 0; i < 12; i += 1) nodes.push({ kind: 'resource', x: 14 + (i % 6) * 2.4, y: 15 + Math.floor(i / 6) * 10 })
    const world = createWorld('a', scene({ nodes, bots: [{ x: 20, y: 20 }] }), rules)
    world.bots[0]!.traits.senseRadius = 12
    step(world, rules)
    const memory = world.bots[0]!.memory
    expect(memory.length).toBeGreaterThan(rules.tuning.memory.cap)
    expect(memory.filter((entry) => entry.kind === 'water')).toHaveLength(1)
    expect(memory.filter((entry) => entry.kind !== 'water').length).toBeLessThanOrEqual(rules.tuning.memory.cap)
  })
})

describe('water near danger', () => {
  // A spring whose centre is inside a danger zone, 12 cells from the bot.
  const risky = scene({
    nodes: [
      { kind: 'danger', x: 24, y: 20 },
      { kind: 'water', x: 24, y: 20 },
    ],
    bots: [{ x: 12, y: 20 }],
  })

  it('is avoided by a bot that is only a little thirsty', () => {
    const world = createWorld('a', risky, rules)
    world.bots[0]!.traits.senseRadius = 12
    world.bots[0]!.thirst = 40
    stepFed(world, 1)
    expect(world.bots[0]?.intent.kind).not.toBe('seekWater')
  })

  it('is worth the risk to a bot that is desperate', () => {
    const world = createWorld('a', risky, rules)
    world.bots[0]!.traits.senseRadius = 12
    world.bots[0]!.thirst = 10
    stepFed(world, 1)
    expect(world.bots[0]?.intent.kind).toBe('seekWater')
  })
})

describe('eden springs', () => {
  it('has springs, one of them touching a danger zone', () => {
    const world = createWorld('a', edenPreset, rules)
    const springs = world.nodes.filter((node) => node.kind === 'water')
    const dangers = world.nodes.filter((node) => node.kind === 'danger')
    expect(springs.length).toBeGreaterThanOrEqual(4)
    const touching = springs.some((spring) =>
      dangers.some((danger) => Math.hypot(spring.x - danger.x, spring.y - danger.y) <= spring.radius + danger.radius),
    )
    expect(touching).toBe(true)
  })
})

describe('water commands', () => {
  const empty = scene({})

  it('places water with its numbers, refuses a second spring too close, and removes it', () => {
    const world = createWorld('a', empty, rules)
    const placed = applyCommand(world, rules, { type: 'placeNode', kind: 'water', x: 5.5, y: 5.5 })
    expect(placed).toEqual({ ok: true, id: 1 })
    expect(world.nodes[0]).toMatchObject({ kind: 'water', radius: rules.nodeDefs.water.radius, amount: 0, capacity: 0 })
    expect(world.log.at(-1)).toMatchObject({ command: 'placeNode', nodeKind: 'water' })
    expect(checkCommand(world, rules, { type: 'placeNode', kind: 'water', x: 5.5, y: 5.5 })).toMatch(/water/)
    // A different kind may share the spot.
    expect(checkCommand(world, rules, { type: 'placeNode', kind: 'resource', x: 5.5, y: 5.5 })).toBeNull()

    expect(applyCommand(world, rules, { type: 'removeNode', id: 1 }).ok).toBe(true)
    expect(world.nodes).toHaveLength(0)
    expect(world.log.at(-1)).toMatchObject({ command: 'removeNode', nodeKind: 'water' })
  })

  it('replays to the same state hash as the live run', () => {
    const live = createWorld('a', edenPreset, rules)
    const script: { tick: number; cmd: Command | 'removeFirstSpring' }[] = [
      { tick: 100, cmd: { type: 'placeNode', kind: 'water', x: 50.5, y: 10.5 } },
      { tick: 600, cmd: 'removeFirstSpring' },
      { tick: 900, cmd: { type: 'placeNode', kind: 'water', x: 20.5, y: 30.5 } },
    ]
    for (const { tick, cmd } of script) {
      while (live.tick < tick) step(live, rules)
      const resolved: Command =
        cmd === 'removeFirstSpring' ? { type: 'removeNode', id: live.nodes.find((node) => node.kind === 'water')!.id } : cmd
      expect(applyCommand(live, rules, resolved).ok, JSON.stringify(resolved)).toBe(true)
    }
    while (live.tick < 2000) step(live, rules)
    expect(live.commands).toHaveLength(script.length)
    const replayed = replayWorld('a', edenPreset, rules, live.commands, live.tick)
    expect(stateHash(replayed)).toBe(stateHash(live))
  })

  it('is deterministic: same seed, same hash', () => {
    const run = (): string => {
      const world = createWorld('a', edenPreset, rules)
      while (world.tick < 1500) step(world, rules)
      return stateHash(world)
    }
    expect(run()).toBe(run())
  })
})
