import { describe, expect, it } from 'vitest'

import { rules } from '../src/content/index.ts'
import { stateHash } from '../src/sim/hash.ts'
import { exposureAt } from '../src/sim/nodes.ts'
import { step } from '../src/sim/step.ts'
import type { Preset, Rules, World } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'

// The full survival loop (M3): danger, shelter, reproduction, age. These need
// the real numbers from src/content, so they live here and not next to src/sim.

function scene(over: Partial<Preset>): Preset {
  return {
    id: 'test',
    label: 'Test scene',
    width: 40,
    height: 40,
    nodes: [],
    scatter: [],
    bots: [],
    scatterBots: 0,
    ...over,
  }
}

function withCap(cap: number): Rules {
  return { ...rules, tuning: { ...rules.tuning, population: { cap } } }
}

function ready(world: World, energy = 90): void {
  for (const bot of world.bots) {
    bot.energy = energy
    bot.age = rules.tuning.bot.adultAge + 100
    bot.cooldown = 0
  }
}

describe('danger', () => {
  const danger = rules.nodeDefs.danger
  const zone = scene({ nodes: [{ kind: 'danger', x: 20, y: 20 }] })

  it('keeps a wandering bot outside a danger it remembers', () => {
    const margin = rules.tuning.brain.avoidMargin
    for (const seed of ['a', 'b', 'c']) {
      const world = createWorld(seed, { ...zone, bots: [{ x: 13, y: 20 }] }, rules)
      world.bots[0].heading = 0 // straight at the danger
      let closest = Infinity
      for (let i = 0; i < 400; i += 1) {
        world.bots[0].energy = 100 // keep it from starving or seeking food
        step(world, rules)
        const bot = world.bots[0]
        closest = Math.min(closest, Math.hypot(bot.x - 20, bot.y - 20))
      }
      expect(closest).toBeGreaterThanOrEqual(danger.radius + margin - 1e-9)
    }
  })

  it('makes a bot inside a danger flee out of it', () => {
    const world = createWorld('a', { ...zone, bots: [{ x: 21, y: 20 }] }, rules)
    world.bots[0].energy = 100
    step(world, rules)
    expect(world.bots[0].intent.kind).toBe('flee')
    let ticks = 0
    while (exposureAt(world, world.bots[0].x, world.bots[0].y).damage > 0 && ticks < 50) {
      world.bots[0].energy = 100
      step(world, rules)
      ticks += 1
    }
    expect(exposureAt(world, world.bots[0].x, world.bots[0].y).damage).toBe(0)
    expect(world.bots[0].health).toBeLessThan(rules.tuning.bot.maxHealth)
    expect(world.bots[0].health).toBeGreaterThan(0)
  })

  it('kills a bot with too little health and logs the cause and place', () => {
    const world = createWorld('a', { ...zone, bots: [{ x: 20, y: 20 }] }, rules)
    world.bots[0].health = 1
    step(world, rules)
    expect(world.bots).toHaveLength(0)
    expect(world.deathsByCause.danger).toBe(1)
    const death = world.log.find((event) => event.type === 'death')
    expect(death).toMatchObject({ cause: 'danger' })
    expect(Math.abs((death?.x ?? 0) - 20)).toBeLessThanOrEqual(rules.tuning.bot.speed + 1e-9)
  })
})

describe('shelter', () => {
  const shelterScene = scene({ nodes: [{ kind: 'shelter', x: 20, y: 20 }], bots: [{ x: 20, y: 20 }] })

  it('heals a hurt bot and slows its energy loss', () => {
    const inside = createWorld('a', shelterScene, rules)
    const outside = createWorld('a', scene({ bots: [{ x: 20, y: 20 }] }), rules)
    for (const world of [inside, outside]) {
      world.bots[0].health = 40
      world.bots[0].energy = 70
    }
    for (let i = 0; i < 20; i += 1) {
      step(inside, rules)
      step(outside, rules)
    }
    expect(inside.bots[0].health).toBeGreaterThan(outside.bots[0].health)
    expect(inside.bots[0].energy).toBeGreaterThan(outside.bots[0].energy)
  })
})

describe('reproduction', () => {
  const shelterScene = scene({ nodes: [{ kind: 'shelter', x: 20, y: 20 }], bots: [{ x: 20, y: 20 }] })

  it('births a child in a shelter and moves the right share of energy', () => {
    const world = createWorld('a', shelterScene, rules)
    ready(world, 90)
    const parent = world.bots[0]
    step(world, rules)
    expect(world.bots).toHaveLength(2)
    const child = world.bots[1]
    const { childEnergyShare, reproCooldown } = rules.tuning.bot
    const pooled = parent.energy + child.energy
    expect(child.energy / pooled).toBeCloseTo(childEnergyShare, 10)
    expect(parent.energy / pooled).toBeCloseTo(1 - childEnergyShare, 10)
    expect(pooled).toBeLessThan(90) // only the tick's metabolism was lost
    expect(pooled).toBeGreaterThan(89)
    expect(child).toMatchObject({ parentId: parent.id, generation: 1, age: 0 })
    expect(child.id).toBeGreaterThan(parent.id)
    expect(child.traits).toEqual(parent.traits)
    expect(child.traits).not.toBe(parent.traits)
    expect(parent.cooldown).toBe(reproCooldown)
    expect(world.totalBirths).toBe(1)
    expect(world.log.some((event) => event.type === 'birth' && event.botId === child.id)).toBe(true)
  })

  it('waits for the cooldown before reproducing again', () => {
    const world = createWorld('a', shelterScene, rules)
    ready(world, 100)
    step(world, rules)
    expect(world.totalBirths).toBe(1)
    for (let i = 0; i < rules.tuning.bot.reproCooldown - 2; i += 1) {
      world.bots[0].energy = 100
      step(world, rules)
    }
    expect(world.totalBirths).toBe(1)
  })

  it('never births a child outside a shelter', () => {
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }] }), rules)
    for (let i = 0; i < 300; i += 1) {
      ready(world, 100)
      step(world, rules)
    }
    expect(world.totalBirths).toBe(0)
    expect(world.bots).toHaveLength(1)
  })

  it('does not let a young bot reproduce', () => {
    const world = createWorld('a', shelterScene, rules)
    ready(world, 100)
    world.bots[0].age = 0
    step(world, rules)
    expect(world.totalBirths).toBe(0)
  })

  it('respects the population cap', () => {
    const capped = withCap(5)
    const crowd = scene({
      nodes: [{ kind: 'shelter', x: 20, y: 20 }],
      bots: [
        { x: 20, y: 20 },
        { x: 20.5, y: 20 },
        { x: 20, y: 20.5 },
        { x: 19.5, y: 20 },
      ],
    })
    const world = createWorld('a', crowd, capped)
    ready(world, 100)
    step(world, capped)
    expect(world.bots).toHaveLength(5)
    expect(world.totalBirths).toBe(1)
    for (let i = 0; i < 400; i += 1) {
      ready(world, 100)
      step(world, capped)
      expect(world.bots.length).toBeLessThanOrEqual(5)
    }
  })
})

describe('age', () => {
  it('kills a bot at its maximum age and logs the cause', () => {
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }] }), rules)
    world.bots[0].age = rules.tuning.bot.maxAge - 1
    step(world, rules)
    expect(world.bots).toHaveLength(0)
    expect(world.deathsByCause.age).toBe(1)
    expect(world.log.find((event) => event.type === 'death')).toMatchObject({ cause: 'age' })
  })

  it('does not kill a bot one tick earlier', () => {
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }] }), rules)
    world.bots[0].age = rules.tuning.bot.maxAge - 2
    step(world, rules)
    expect(world.bots).toHaveLength(1)
  })
})

describe('determinism with births', () => {
  it('gives the same hash for the same seed and survives a JSON copy', () => {
    const preset = scene({
      nodes: [
        { kind: 'shelter', x: 20, y: 20 },
        { kind: 'resource', x: 10, y: 10 },
        { kind: 'danger', x: 30, y: 30 },
      ],
      bots: [{ x: 20, y: 20 }],
      scatterBots: 8,
    })
    const run = (): World => {
      const world = createWorld('det', preset, rules)
      ready(world, 90)
      for (let i = 0; i < 1500; i += 1) step(world, rules)
      return world
    }
    const first = run()
    expect(first.totalBirths).toBeGreaterThan(0)
    expect(stateHash(run())).toBe(stateHash(first))
    const copy = JSON.parse(JSON.stringify(first)) as World
    for (let i = 0; i < 200; i += 1) {
      step(first, rules)
      step(copy, rules)
    }
    expect(stateHash(copy)).toBe(stateHash(first))
  })
})
