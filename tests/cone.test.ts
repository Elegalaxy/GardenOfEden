import { describe, expect, it } from 'vitest'

import { edenPreset, rules as shippedRules } from '../src/content/index.ts'
import { stateHash } from '../src/sim/hash.ts'
import { checkPerception, coneFactor, perceive, remember } from '../src/sim/perception.ts'
import { movePredators } from '../src/sim/predators.ts'
import { nextFloat } from '../src/sim/rng.ts'
import { step } from '../src/sim/step.ts'
import type { Preset, Rules, World, WorldNode } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'
import { noCone, staticPredators, withCone } from './variants.ts'

// Directional sensing (V1): the vision cone for bots and predators. On in Eden since V2 (p1 numbers); `noCone` switches it off, `withCone` sets numbers. The tiny-scene tests use the V1 numbers explicitly so they pin the mechanics, not the tuning. Perception and
// predator tests build tiny worlds and call `perceive` / `remember` / `movePredators` directly with the tick set by hand.

const PI = Math.PI
// Recorded on the untouched pre-V1 code: Eden, seed 'a', 5,000 ticks, shipped rules.
const PRE_V1_HASH = 'e9b82aa4ca6110de'

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', width: 80, height: 80, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

function hashAfter(r: Rules, ticks: number): string {
  const world = createWorld('a', edenPreset, r)
  for (let i = 0; i < ticks; i += 1) step(world, r)
  return stateHash(world)
}

const base = noCone(staticPredators(shippedRules))
const cone = withCone(base, { botFront: 1, botRear: 0.4, predatorFront: 1, predatorRear: 0.5, trackTicks: 10 }) // reach behind 2.4 at sense radius 6, predator 1 / 0.5

/** A world with one bot at (30, 30) heading 0, sense radius 6, plus the given nodes (radius forced to 0 so reach = distance). */
function setup(r: Rules, nodes: Preset['nodes']): World {
  const world = createWorld('a', scene({ nodes, bots: [{ x: 30, y: 30 }] }), r)
  for (const node of world.nodes) node.radius = 0
  world.bots[0]!.heading = 0
  world.bots[0]!.traits.senseRadius = 6
  return world
}

const idsOf = (nodes: WorldNode[]): number[] => nodes.map((node) => node.id)

describe('cone off, and neutral cone', () => {
  it('with the cone off the hash is the pre-V1 one', () => {
    expect(hashAfter(noCone(shippedRules), 5000)).toBe(PRE_V1_HASH)
  })

  it('ships on with the V2 numbers', () => {
    expect(shippedRules.tuning.perception.cone).toEqual({
      enabled: true,
      botFront: 1,
      botRear: 0.7,
      predatorFront: 1,
      predatorRear: 0.35,
      trackTicks: 10,
    })
  })

  it('Eden as shipped differs from noCone', () => {
    expect(hashAfter(shippedRules, 1500)).not.toBe(hashAfter(noCone(shippedRules), 1500))
  })

  it('front = rear = 1 gives the same hash as off', () => {
    const neutral = withCone(shippedRules, { botFront: 1, botRear: 1, predatorFront: 1, predatorRear: 1 })
    expect(hashAfter(neutral, 1500)).toBe(hashAfter(noCone(shippedRules), 1500))
  })
})

describe('coneFactor', () => {
  it('runs from front (c = 1) through the mean (c = 0) to rear (c = -1)', () => {
    expect(coneFactor(1, 1, 0.4)).toBe(1)
    expect(coneFactor(0, 1, 0.4)).toBeCloseTo(0.7, 12)
    expect(coneFactor(-1, 1, 0.4)).toBe(0.4)
    expect(coneFactor(0.3, 1, 1)).toBe(1)
  })
})

describe('bot cone', () => {
  it('senses a node ahead, not the mirror node behind, and a close node behind', () => {
    const world = setup(cone, [
      { kind: 'resource', x: 34, y: 30 }, // 4 ahead
      { kind: 'resource', x: 26, y: 30 }, // 4 behind: reach 4 > 2.4
      { kind: 'resource', x: 27.6, y: 30 }, // 2.4 behind: inside the near field
    ])
    const [ahead, behind, near] = world.nodes
    const sensed = idsOf(perceive(world, world.bots[0]!, cone.tuning))
    expect(sensed).toContain(ahead!.id)
    expect(sensed).not.toContain(behind!.id)
    expect(sensed).toContain(near!.id)
  })

  it('with the cone off the same scene senses everything within the radius', () => {
    const world = setup(base, [{ kind: 'resource', x: 34, y: 30 }, { kind: 'resource', x: 26, y: 30 }])
    expect(perceive(world, world.bots[0]!, base.tuning)).toHaveLength(2)
    expect(perceive(world, world.bots[0]!)).toHaveLength(2)
  })
})

describe('tracking a predator', () => {
  it('keeps sensing a self-seen predator after the bot turns round, and follows it', () => {
    const world = setup(cone, [{ kind: 'predator', x: 35, y: 30 }])
    const bot = world.bots[0]!
    const hunter = world.nodes[0]!
    world.tick = 100
    remember(world, bot, perceive(world, bot, cone.tuning), cone.tuning, new Set([hunter.id]))
    expect(bot.memory).toHaveLength(1)
    bot.heading = PI
    for (let i = 1; i <= 3; i += 1) {
      world.tick += 1
      hunter.x = 35 + i * 0.3
      const sensed = perceive(world, bot, cone.tuning)
      expect(idsOf(sensed)).toEqual([hunter.id])
      remember(world, bot, sensed, cone.tuning, new Set([hunter.id]))
      expect(bot.memory[0]!.x).toBe(hunter.x)
      expect(bot.memory[0]!.seenTick).toBe(world.tick)
    }
  })

  it('stops refreshing beyond the front reach, and the sighting drops only after memoryTicks', () => {
    const world = setup(cone, [{ kind: 'predator', x: 35, y: 30 }])
    const bot = world.bots[0]!
    const hunter = world.nodes[0]!
    const live = new Set([hunter.id])
    world.tick = 100
    remember(world, bot, perceive(world, bot, cone.tuning), cone.tuning, live)
    bot.heading = PI
    hunter.x = 40 // 10 cells away, beyond 6
    world.tick += 1
    expect(perceive(world, bot, cone.tuning)).toHaveLength(0)
    remember(world, bot, [], cone.tuning, live)
    expect(bot.memory).toHaveLength(1)
    expect(bot.memory[0]!.x).toBe(35)
    expect(bot.memory[0]!.seenTick).toBe(100)
    world.tick = 100 + cone.tuning.predator.memoryTicks
    remember(world, bot, [], cone.tuning, live)
    expect(bot.memory).toHaveLength(1)
    world.tick += 1
    remember(world, bot, [], cone.tuning, live)
    expect(bot.memory).toHaveLength(0)
  })

  it('does not track a sighting that is older than trackTicks', () => {
    const world = setup(cone, [{ kind: 'predator', x: 35, y: 30 }])
    const bot = world.bots[0]!
    const hunter = world.nodes[0]!
    world.tick = 100
    remember(world, bot, perceive(world, bot, cone.tuning), cone.tuning, new Set([hunter.id]))
    bot.heading = PI
    world.tick = 100 + cone.tuning.perception.cone.trackTicks + 1
    expect(perceive(world, bot, cone.tuning)).toHaveLength(0)
  })

  it('a family-learned sighting does not start tracking', () => {
    const world = setup(cone, [{ kind: 'predator', x: 35, y: 30 }])
    const bot = world.bots[0]!
    const hunter = world.nodes[0]!
    world.tick = 100
    bot.heading = PI
    bot.memory.push({ nodeId: hunter.id, kind: 'predator', x: 35, y: 30, radius: 0, seenTick: 99, amount: 0, learnedFrom: 7 })
    expect(perceive(world, bot, cone.tuning)).toHaveLength(0)
    bot.memory[0]!.learnedFrom = null
    expect(idsOf(perceive(world, bot, cone.tuning))).toEqual([hunter.id])
  })
})

describe('predator cone', () => {
  // Predator at (30, 30) heading 0, sense radius 8: ahead reach 8, behind 4.
  function hunt(r: Rules, bots: Preset['bots']): { world: World; hunter: WorldNode } {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 30, y: 30 }], bots }), r)
    const hunter = world.nodes[0]!
    hunter.hunt!.heading = 0
    return { world, hunter }
  }
  const tickOnce = (world: World, r: Rules): void => {
    world.tick += 1
    movePredators(world, r)
  }

  it('ignores a bot 6 cells behind, targets the same bot in front, and a bot 3 behind (near field)', () => {
    const behind = hunt(cone, [{ x: 24, y: 30 }])
    tickOnce(behind.world, cone)
    expect(behind.hunter.hunt!.targetId).toBeNull()
    const front = hunt(cone, [{ x: 36, y: 30 }])
    tickOnce(front.world, cone)
    expect(front.hunter.hunt!.targetId).toBe(front.world.bots[0]!.id)
    const near = hunt(cone, [{ x: 27, y: 30 }])
    tickOnce(near.world, cone)
    expect(near.hunter.hunt!.targetId).toBe(near.world.bots[0]!.id)
  })

  it('with the cone off a bot 6 behind is targeted', () => {
    const off = hunt(base, [{ x: 24, y: 30 }])
    tickOnce(off.world, base)
    expect(off.hunter.hunt!.targetId).toBe(off.world.bots[0]!.id)
  })

  it('keeps chasing a locked target that circles behind within the sense radius', () => {
    const { world, hunter } = hunt(cone, [{ x: 23, y: 30 }]) // 7 behind
    hunter.hunt!.targetId = world.bots[0]!.id
    tickOnce(world, cone)
    expect(hunter.hunt!.targetId).toBe(world.bots[0]!.id)
    // Without the lock the same bot is not seen.
    const free = hunt(cone, [{ x: 23, y: 30 }])
    tickOnce(free.world, cone)
    expect(free.hunter.hunt!.targetId).toBeNull()
  })

  it('still takes exactly one predator draw per tick', () => {
    const { world } = hunt(cone, [{ x: 36, y: 30 }, { x: 22, y: 30 }])
    const reference = structuredClone(world.rng.predator)
    for (let i = 0; i < 5; i += 1) {
      tickOnce(world, cone)
      nextFloat(reference)
      expect(world.rng.predator).toEqual(reference)
    }
  })
})

describe('checkPerception', () => {
  const ok = shippedRules.tuning.perception.cone
  it('accepts the shipped numbers and refuses bad ones', () => {
    expect(() => checkPerception(ok)).not.toThrow()
    expect(() => checkPerception({ ...ok, botRear: 1.2 })).toThrow(RangeError) // rear above front
    expect(() => checkPerception({ ...ok, botRear: -0.1 })).toThrow(RangeError)
    expect(() => checkPerception({ ...ok, predatorFront: 0, predatorRear: 0 })).toThrow(RangeError)
    expect(() => checkPerception({ ...ok, predatorRear: 2 })).toThrow(RangeError)
    expect(() => checkPerception({ ...ok, botFront: Infinity })).toThrow(RangeError)
    expect(() => checkPerception({ ...ok, botRear: NaN })).toThrow(RangeError)
    expect(() => checkPerception({ ...ok, trackTicks: 1.5 })).toThrow(RangeError)
    expect(() => checkPerception({ ...ok, trackTicks: -1 })).toThrow(RangeError)
    expect(() => checkPerception({ ...ok, trackTicks: 0 })).not.toThrow()
  })

  it('createWorld refuses an enabled cone with bad numbers', () => {
    expect(() => createWorld('a', scene({}), withCone(base, { botRear: 5 }))).toThrow(RangeError)
  })
})
