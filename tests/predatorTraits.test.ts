import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { applyCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { movePredators, predatorLife } from '../src/sim/predators.ts'
import {
  DEFAULT_PREDATOR_TRAITS,
  PREDATOR_TRAIT_NAMES,
  checkPredatorTraits,
  inheritPredatorTraits,
  predatorDrain,
  predatorTrait,
  predatorTraitStats,
  startTraits,
  traitsOn,
} from '../src/sim/predatorTraits.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { createRng, nextFloat } from '../src/sim/rng.ts'
import { step } from '../src/sim/step.ts'
import type { Preset, Rules, World, WorldNode } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'
import { noCone, noPredatorTraits, withEcology, withPredatorTraits } from './variants.ts'

// Heritable predator traits (H1 mechanics, on in Eden since H2): the pins that prove the world with them off is untouched, the keys and defaults, inheritance and its
// draws, the effect of each trait in a crafted single-predator world, the drain price, the checks and determinism.

const pt = rules.tuning.predator
const eco = pt.ecology
const BIG = { width: 200, height: 200 }

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', width: 60, height: 60, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

const predatorsOf = (world: World): WorldNode[] => world.nodes.filter((node) => node.kind === 'predator')

function lifeTick(world: World, r: Rules): void {
  world.tick += 1
  predatorLife(world, r)
}

function ready(node: WorldNode): void {
  const life = node.hunt!.life!
  life.kidsKills = eco.killsPerCub
  life.age = eco.adultAge
  life.energy = eco.cubCost + eco.huntBelow
}

describe('traits off equals before H1', () => {
  it('Eden seed a with a placed and a removed predator hashes as it did before H1, with the same predator stream', () => {
    const off = noPredatorTraits(rules)
    const world = createWorld('a', edenPreset, off)
    for (let i = 0; i < 5000; i += 1) {
      if (world.tick === 1000) expect(applyCommand(world, off, { type: 'placeNode', kind: 'predator', x: 40.5, y: 30.5 }).ok).toBe(true)
      if (world.tick === 3000) expect(applyCommand(world, off, { type: 'removeNode', id: predatorsOf(world).slice(-1)[0]!.id }).ok).toBe(true)
      step(world, off)
    }
    // Recorded on the untouched tree (before H1) with the same script and the shipped rules (traits off, as they were until H2).
    expect(stateHash(world)).toBe('d97a4c85e3ca126c')
    expect(world.rng.predator).toEqual({ a: 4040596244, b: 1153508164, c: 935765933, d: 1357574499 })
    expect(predatorsOf(world).every((node) => node.hunt !== null && !('traits' in node.hunt) && !('generation' in node.hunt))).toBe(true)
  })

  it('Eden seed b at 20,000 ticks hashes as it did before H1', () => {
    const off = noPredatorTraits(rules)
    const world = createWorld('b', edenPreset, off)
    for (let i = 0; i < 20000; i += 1) step(world, off)
    expect(stateHash(world)).toBe('002b6a896d393fad')
  })

  it('ships on with the H2 numbers, within the checks, and speed max is the fastest bot flee speed', () => {
    expect(pt.traits.enabled).toBe(true)
    expect(pt.traits.mutation).toEqual({ rate: 0.5, strength: 0.2 })
    expect(pt.traits.price).toEqual({ sense: 0.15, speed: 0.3, stamina: 0.06 })
    expect(pt.traits.bounds).toEqual({ sense: { min: 0.75, max: 1.5 }, speed: { min: 0.8, max: 1.2 }, stamina: { min: 0.5, max: 2 } })
    expect(() => checkPredatorTraits(pt.traits)).not.toThrow()
    expect(pt.speed * pt.traits.bounds.speed.max).toBeCloseTo(rules.tuning.bot.speed * rules.tuning.mutation.bounds.sprint.max, 9)
  })

  it('Eden as shipped differs from noPredatorTraits: the predators carry traits and the hash moves', () => {
    const off = noPredatorTraits(rules)
    const on = createWorld('a', edenPreset, rules)
    const plain = createWorld('a', edenPreset, off)
    expect(predatorsOf(on).every((n) => 'traits' in n.hunt! && 'generation' in n.hunt!)).toBe(true)
    expect(predatorsOf(plain).every((n) => !('traits' in n.hunt!))).toBe(true)
    expect(stateHash(on)).not.toBe(stateHash(plain))
    for (let i = 0; i < 3000; i += 1) {
      step(on, rules)
      step(plain, off)
    }
    expect(stateHash(on)).not.toBe(stateHash(plain))
  })
})

describe('who has traits', () => {
  const on = withPredatorTraits(rules)

  it('founders, placed and arriving predators start at 1 with generation 0 and keys after life', () => {
    const r = withPredatorTraits(withEcology(rules, { drain: 0, recolonizeTicks: 5 }))
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 10, y: 30 }] }), r)
    expect(applyCommand(world, r, { type: 'placeNode', kind: 'predator', x: 40, y: 40 }).ok).toBe(true)
    for (const node of predatorsOf(world)) {
      expect(node.hunt!.traits).toEqual({ sense: 1, speed: 1, stamina: 1 })
      expect(node.hunt!.generation).toBe(0)
      expect(Object.keys(node.hunt!).slice(-3)).toEqual(['life', 'traits', 'generation'])
    }
    // Take every predator away; the dens stay and newcomers arrive after recolonizeTicks.
    world.nodes = world.nodes.filter((n) => n.kind !== 'predator')
    for (let i = 0; i < 20; i += 1) lifeTick(world, r)
    const arrived = predatorsOf(world)
    expect(arrived.length).toBeGreaterThan(0)
    for (const node of arrived) {
      expect(node.hunt!.life!.origin).toBe('arrived')
      expect(node.hunt!.traits).toEqual({ sense: 1, speed: 1, stamina: 1 })
      expect(node.hunt!.generation).toBe(0)
      expect(Object.keys(node.hunt!).slice(-3)).toEqual(['life', 'traits', 'generation'])
    }
  })

  it('the keys exist only when traits and ecology are both on', () => {
    for (const r of [noPredatorTraits(rules), withEcology(rules)]) {
      const world = createWorld('a', edenPreset, r)
      expect(predatorsOf(world).every((n) => !('traits' in n.hunt!) && !('generation' in n.hunt!))).toBe(true)
    }
    const world = createWorld('a', edenPreset, on)
    expect(predatorsOf(world).every((n) => 'traits' in n.hunt! && 'generation' in n.hunt!)).toBe(true)
    expect(predatorsOf(createWorld('a', edenPreset, rules)).every((n) => 'traits' in n.hunt!)).toBe(true)
    // Traits on with ecology off: nothing (no life to hang them on).
    const noEco: Rules = { ...on, tuning: { ...on.tuning, predator: { ...on.tuning.predator, ecology: { ...eco, enabled: false } } } }
    const fixed = createWorld('a', edenPreset, noEco)
    expect(predatorsOf(fixed).every((n) => !('traits' in n.hunt!))).toBe(true)
    expect(traitsOn(fixed, noEco.tuning)).toBe(false)
  })
})

describe('inheritance', () => {
  const quick = withPredatorTraits(withEcology(rules, { drain: 0, homeTries: 200 }), { mutation: { rate: 1, strength: 0.1 } })

  function breeder(r: Rules): World {
    const world = createWorld('a', scene({ ...BIG, nodes: [{ kind: 'predator', x: 100, y: 100 }] }), r)
    ready(predatorsOf(world)[0]!)
    return world
  }

  it('a cub is one generation on, within bounds, and a grandcub two', () => {
    const world = breeder(quick)
    const parent = predatorsOf(world)[0]!
    parent.hunt!.traits = { sense: 1.4, speed: 1.1, stamina: 0.6 }
    lifeTick(world, quick)
    const cub = predatorsOf(world)[1]!
    expect(cub.hunt!.generation).toBe(1)
    expect(Object.keys(cub.hunt!).slice(-3)).toEqual(['life', 'traits', 'generation'])
    for (const name of PREDATOR_TRAIT_NAMES) {
      const { min, max } = pt.traits.bounds[name]
      expect(cub.hunt!.traits![name]).toBeGreaterThanOrEqual(min)
      expect(cub.hunt!.traits![name]).toBeLessThanOrEqual(max)
      expect(Math.abs(cub.hunt!.traits![name] / parent.hunt!.traits![name] - 1)).toBeLessThanOrEqual(0.1 + 1e-12)
    }
    ready(cub)
    cub.hunt!.homeX = 20
    cub.hunt!.homeY = 20
    lifeTick(world, quick)
    expect(predatorsOf(world).some((n) => n.hunt!.generation === 2)).toBe(true)
  })

  it('with strength 0 a cub copies its parent exactly', () => {
    const still = withPredatorTraits(withEcology(rules, { drain: 0, homeTries: 200 }), { mutation: { rate: 1, strength: 0 } })
    const world = breeder(still)
    predatorsOf(world)[0]!.hunt!.traits = { sense: 1.3, speed: 0.9, stamina: 1.7 }
    lifeTick(world, still)
    expect(predatorsOf(world)[1]!.hunt!.traits).toEqual({ sense: 1.3, speed: 0.9, stamina: 1.7 })
  })

  it('a cub takes 2 x tries + 6 predator draws on success, and 2 x tries on failure', () => {
    // Open map: the first territory try is valid, so one try and six trait draws.
    const world = breeder(quick)
    const reference = structuredClone(world.rng.predator)
    lifeTick(world, quick)
    expect(predatorsOf(world)).toHaveLength(2)
    for (let i = 0; i < 2 * 1 + 6; i += 1) nextFloat(reference)
    expect(world.rng.predator).toEqual(reference)

    // No valid spot on a small map: every try, no trait draws, no cub.
    const small = createWorld('a', scene({ width: 30, height: 30, nodes: [{ kind: 'predator', x: 15, y: 15 }] }), quick)
    ready(predatorsOf(small)[0]!)
    const ref2 = structuredClone(small.rng.predator)
    lifeTick(small, quick)
    for (let i = 0; i < 2 * quick.tuning.predator.ecology.homeTries; i += 1) nextFloat(ref2)
    expect(predatorsOf(small)).toHaveLength(1)
    expect(small.rng.predator).toEqual(ref2)
  })

  it('inheritPredatorTraits applies the formula and clamps to the bounds', () => {
    const stream = createRng('x').predator
    const copy = structuredClone(stream)
    const parent = { sense: 1.5, speed: 1.2, stamina: 0.5 }
    const child = inheritPredatorTraits(parent, { ...pt.traits, mutation: { rate: 1, strength: 0.5 } }, stream)
    for (const name of PREDATOR_TRAIT_NAMES) {
      nextFloat(copy)
      const amount = nextFloat(copy)
      const { min, max } = pt.traits.bounds[name]
      expect(child[name]).toBe(Math.min(max, Math.max(min, parent[name] * (1 + (2 * amount - 1) * 0.5))))
    }
    expect(stream).toEqual(copy)
  })
})

describe('effects', () => {
  const base = noCone(withPredatorTraits(withEcology(rules, { drain: 0 })))
  const sceneWith = (botDx: number): Preset => scene({ nodes: [{ kind: 'predator', x: 30, y: 30 }], bots: [{ x: 30 + botDx, y: 30 }] })
  const tick = (world: World, r: Rules): void => {
    world.tick += 1
    movePredators(world, r)
  }

  it('sense 1.5 targets a bot at 11 cells that sense 1 ignores (all-round and cone)', () => {
    for (const r of [base, withPredatorTraits(withEcology(rules, { drain: 0 }))]) {
      const plain = createWorld('a', sceneWith(11), r)
      predatorsOf(plain)[0]!.hunt!.heading = 0
      tick(plain, r)
      expect(predatorsOf(plain)[0]!.hunt!.targetId).toBeNull()
      const keen = createWorld('a', sceneWith(11), r)
      const node = predatorsOf(keen)[0]!
      node.hunt!.heading = 0
      node.hunt!.traits!.sense = 1.5
      tick(keen, r)
      expect(node.hunt!.targetId).toBe(keen.bots[0]!.id)
    }
  })

  it('speed 1.2 moves 1.08 per chase step and per wander step', () => {
    const world = createWorld('a', sceneWith(7), base)
    const node = predatorsOf(world)[0]!
    node.hunt!.traits!.speed = 1.2
    tick(world, base)
    expect(node.x - 30).toBeCloseTo(0.9 * 1.2, 9)
    const lone = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 30, y: 30 }] }), base)
    const walker = predatorsOf(lone)[0]!
    walker.hunt!.traits!.speed = 1.2
    tick(lone, base)
    expect(Math.hypot(walker.x - 30, walker.y - 30)).toBeCloseTo(1.08, 9)
  })

  it('stamina 0.5 gives up a chase at tick 20, not 40', () => {
    const world = createWorld('a', sceneWith(7.9), base)
    const node = predatorsOf(world)[0]!
    node.hunt!.traits!.stamina = 0.5
    for (let i = 1; i < 20; i += 1) tick(world, base)
    expect(node.hunt!.chase).toBe(19)
    tick(world, base)
    expect(world.tick).toBe(20)
    expect(node.hunt!.restUntil).toBe(20 + pt.giveUpRest)
    expect(node.hunt!.chase).toBe(0)
    // With stamina 1 the same chase is still going at tick 20.
    const normal = createWorld('a', sceneWith(7.9), base)
    for (let i = 0; i < 20; i += 1) tick(normal, base)
    expect(predatorsOf(normal)[0]!.hunt!.chase).toBe(20)
  })

  it('predatorDrain is ecology.drain itself without traits and drain x (1 + sum price x (trait - 1)) with them', () => {
    expect(predatorDrain({}, rules.tuning)).toBe(eco.drain)
    expect(predatorDrain(null, rules.tuning)).toBe(eco.drain)
    const priced = { ...rules.tuning, predator: { ...pt, traits: { ...pt.traits, price: { sense: 0.1, speed: 0.1, stamina: 0.1 } } } }
    expect(predatorDrain({ traits: { sense: 1.5, speed: 1, stamina: 1 } }, priced)).toBeCloseTo(0.02 * 1.05, 12)
    expect(predatorDrain({ traits: { sense: 1, speed: 1, stamina: 1 } }, priced)).toBe(0.02)
    expect(predatorDrain({ traits: { sense: 0.8, speed: 1.2, stamina: 1 } }, priced)).toBeCloseTo(0.02, 12)
    expect(predatorTrait({}, 'sense')).toBe(1)
    expect(predatorTrait(null, 'speed')).toBe(1)
  })

  it('predatorLife drains by predatorDrain', () => {
    const r = withPredatorTraits(withEcology(rules, { drain: 0.02 }), { price: { sense: 0.1, speed: 0.1, stamina: 0.1 } })
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 30, y: 30 }] }), r)
    const node = predatorsOf(world)[0]!
    node.hunt!.traits!.sense = 1.5
    const before = node.hunt!.life!.energy
    lifeTick(world, r)
    expect(before - node.hunt!.life!.energy).toBeCloseTo(0.02 * 1.05, 12)
  })
})

describe('checks', () => {
  const t = pt.traits
  it('checkPredatorTraits refuses bad numbers, and createWorld throws even with traits off', () => {
    const bad = (over: Partial<typeof t>): void => expect(() => checkPredatorTraits({ ...t, ...over })).toThrow(RangeError)
    bad({ mutation: { rate: 1.1, strength: 0.1 } })
    bad({ mutation: { rate: -0.1, strength: 0.1 } })
    bad({ mutation: { rate: 0.5, strength: 1 } })
    bad({ mutation: { rate: 0.5, strength: -0.1 } })
    bad({ mutation: { rate: Number.NaN, strength: 0.1 } })
    bad({ bounds: { ...t.bounds, speed: { min: 0, max: 1.2 } } })
    bad({ bounds: { ...t.bounds, speed: { min: 1.1, max: 1.2 } } })
    bad({ bounds: { ...t.bounds, sense: { min: 0.75, max: 0.9 } } })
    bad({ bounds: { ...t.bounds, stamina: { min: 0.5, max: Infinity } } })
    bad({ price: { ...t.price, speed: -0.1 } })
    bad({ price: { ...t.price, sense: Number.NaN } })
    const broken: Rules = { ...rules, tuning: { ...rules.tuning, predator: { ...pt, traits: { ...t, price: { ...t.price, stamina: -1 } } } } }
    expect(() => createWorld('a', edenPreset, broken)).toThrow(RangeError)
  })
})

describe('determinism and summary', () => {
  it('same seed gives the same hash with traits on, and a replay equals the live run', () => {
    const on = withPredatorTraits(rules, { mutation: { rate: 1, strength: 0.3 } })
    const run = (): World => {
      const world = createWorld('a', edenPreset, on)
      for (let i = 0; i < 3000; i += 1) {
        if (world.tick === 500) applyCommand(world, on, { type: 'placeNode', kind: 'predator', x: 40.5, y: 30.5 })
        step(world, on)
      }
      return world
    }
    const live = run()
    expect(stateHash(run())).toBe(stateHash(live))
    expect(stateHash(replayWorld('a', edenPreset, on, live.commands, live.tick))).toBe(stateHash(live))
    expect(stateHash(live)).not.toBe(stateHash(createWorld('a', edenPreset, noPredatorTraits(rules))))
  })

  it('predatorTraitStats summarises the predators that have traits, in array order, and is null with none', () => {
    const make = (kind: WorldNode['kind'], traits: { sense: number; speed: number; stamina: number } | null, generation: number): Pick<WorldNode, 'kind' | 'hunt'> => {
      const hunt = { px: 0, py: 0, heading: 0, homeX: 0, homeY: 0, targetId: null, chase: 0, restUntil: 0, kills: 0 } as NonNullable<WorldNode['hunt']>
      if (traits !== null) startTraits(hunt, traits, generation)
      return { kind, hunt }
    }
    expect(predatorTraitStats([])).toBeNull()
    expect(predatorTraitStats([make('predator', null, 0), make('shelter', DEFAULT_PREDATOR_TRAITS, 0)])).toBeNull()
    const summary = predatorTraitStats([
      make('predator', { sense: 1, speed: 1, stamina: 1 }, 0),
      make('predator', { sense: 1.5, speed: 0.8, stamina: 2 }, 3),
      make('predator', null, 0),
    ])!
    expect(summary.count).toBe(2)
    expect(summary.maxGeneration).toBe(3)
    expect(summary.stats.sense).toEqual({ mean: 1.25, min: 1, max: 1.5 })
    expect(summary.stats.speed.min).toBe(0.8)
    expect(summary.stats.stamina.mean).toBe(1.5)
  })
})
