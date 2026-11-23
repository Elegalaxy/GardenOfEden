import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { applyCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { checkPrey, predatorLife, predatorLimit } from '../src/sim/predators.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { createRng } from '../src/sim/rng.ts'
import { step } from '../src/sim/step.ts'
import type { Preset, Rules, World, WorldNode } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'
import { bestLag, pearson } from '../src/harness/survey.ts'
import { noMateChoice, noPreyRule, withEcology, withPrey } from './variants.ts'

// Prey rule (P1, off): the predator limit, gated cubs and arrivals, leaving, and determinism. Most tests call `predatorLife`
// directly with the tick set by hand, in worlds with no bots (so the limit is `minCount`).

const pt = rules.tuning.predator
const eco = pt.ecology

// Hash of Eden seed 'a' after 5,000 ticks on the shipped rules, taken on the tree before P1 existed.
const PRE_P1_HASH = 'ef146d118fc8cf30'

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', width: 200, height: 200, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

const predatorsOf = (world: World): WorldNode[] => world.nodes.filter((node) => node.kind === 'predator')
const lifeOf = (node: WorldNode) => node.hunt!.life!

function lifeTick(world: World, r: Rules): void {
  world.tick += 1
  predatorLife(world, r)
}

function threePredators(r: Rules): World {
  return createWorld('a', scene({ nodes: [{ kind: 'predator', x: 40, y: 40 }, { kind: 'predator', x: 100, y: 100 }, { kind: 'predator', x: 160, y: 160 }] }), r)
}

describe('prey rule off equals before P1', () => {
  it('ships on with the P2 numbers', () => {
    expect(pt.prey).toEqual({ enabled: true, perPredator: 16, minCount: 1, leaveAfter: 500 })
    expect(eco.killsPerCub).toBe(3)
    expect(() => checkPrey(pt.prey, pt.maxCount)).not.toThrow()
  })

  it('Eden as shipped differs from noPreyRule, and only the shipped world has a prey key', () => {
    const on = createWorld('b', edenPreset, rules)
    const off = noPreyRule(rules)
    const other = createWorld('b', edenPreset, off)
    expect('prey' in on.ecology!).toBe(true)
    expect('prey' in other.ecology!).toBe(false)
    for (let i = 0; i < 1500; i += 1) {
      step(on, rules)
      step(other, off)
    }
    expect(stateHash(on)).not.toBe(stateHash(other))
  })

  it('Eden seed a at 5,000 ticks hashes as it did before P1, with no prey key', () => {
    // P2 switched the prey rule on and lowered killsPerCub from 6 to 3: put both back (withEcology forces the prey rule off).
    const before = noMateChoice(withEcology(rules, { killsPerCub: 6 }))
    const world = createWorld('a', edenPreset, before)
    for (let i = 0; i < 5000; i += 1) step(world, before)
    expect(stateHash(world)).toBe(PRE_P1_HASH)
    expect('ecology' in world).toBe(true)
    expect('prey' in world.ecology!).toBe(false)
    expect(Object.keys(world.ecology!)).toEqual(['dens', 'stats'])
  })

  it('prey on without ecology adds nothing', () => {
    const noEco = { ...rules, tuning: { ...rules.tuning, predator: { ...pt, ecology: { ...eco, enabled: false }, prey: { ...pt.prey, enabled: true } } } }
    const world = createWorld('a', edenPreset, noEco)
    expect('ecology' in world).toBe(false)
  })

  it('a world made with the rule has prey as the last ecology key', () => {
    const world = createWorld('a', edenPreset, withPrey(rules))
    expect(Object.keys(world.ecology!)).toEqual(['dens', 'stats', 'prey'])
    expect(world.ecology!.prey).toEqual({ overSince: null, left: 0 })
  })
})

describe('predatorLimit', () => {
  const on = withPrey(rules, { perPredator: 10, minCount: 1 }).tuning
  it('is maxCount with the rule or ecology off', () => {
    expect(predatorLimit(0, noPreyRule(rules).tuning)).toBe(pt.maxCount)
    expect(predatorLimit(0, noPreyRule(withPrey(rules)).tuning)).toBe(pt.maxCount)
    const noEco = { predator: { ...on.predator, ecology: { ...on.predator.ecology, enabled: false } } }
    expect(predatorLimit(0, noEco)).toBe(pt.maxCount)
  })
  it('floors bots / perPredator and clamps to minCount and maxCount', () => {
    expect(predatorLimit(0, on)).toBe(1)
    expect(predatorLimit(9, on)).toBe(1)
    expect(predatorLimit(10, on)).toBe(1)
    expect(predatorLimit(29, on)).toBe(2)
    expect(predatorLimit(30, on)).toBe(3)
    expect(predatorLimit(10_000, on)).toBe(pt.maxCount)
    expect(predatorLimit(0, withPrey(rules, { minCount: 0 }).tuning)).toBe(0)
    expect(predatorLimit(0, withPrey(rules, { minCount: 4 }).tuning)).toBe(4)
  })
})

describe('checkPrey', () => {
  const ok = { enabled: true, perPredator: 12, minCount: 1, leaveAfter: 500 }
  it('accepts the shipped numbers and the edges', () => {
    expect(() => checkPrey(ok, 8)).not.toThrow()
    expect(() => checkPrey({ ...ok, minCount: 0, leaveAfter: 1 }, 8)).not.toThrow()
    expect(() => checkPrey({ ...ok, minCount: 8 }, 8)).not.toThrow()
  })
  it('names the setting it refuses', () => {
    expect(() => checkPrey({ ...ok, perPredator: 0 }, 8)).toThrow(/predator\.prey\.perPredator/)
    expect(() => checkPrey({ ...ok, perPredator: Number.NaN }, 8)).toThrow(/perPredator/)
    expect(() => checkPrey({ ...ok, minCount: -1 }, 8)).toThrow(/predator\.prey\.minCount/)
    expect(() => checkPrey({ ...ok, minCount: 9 }, 8)).toThrow(/minCount/)
    expect(() => checkPrey({ ...ok, minCount: 1.5 }, 8)).toThrow(/minCount/)
    expect(() => checkPrey({ ...ok, leaveAfter: 0 }, 8)).toThrow(/predator\.prey\.leaveAfter/)
    expect(() => checkPrey({ ...ok, leaveAfter: 2.5 }, 8)).toThrow(/leaveAfter/)
  })
  it('createWorld refuses bad numbers only when both rules are on', () => {
    expect(() => createWorld('a', edenPreset, withPrey(rules, { perPredator: 0 }))).toThrow(RangeError)
    const bad = { ...rules, tuning: { ...rules.tuning, predator: { ...pt, prey: { ...pt.prey, enabled: false, perPredator: 0 } } } }
    expect(() => createWorld('a', edenPreset, bad)).not.toThrow()
  })
})

describe('gating', () => {
  it('a gated cub takes zero draws', () => {
    const r = withPrey(rules, { minCount: 0, leaveAfter: 1_000_000 }, { drain: 0, homeTries: 50 })
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 100, y: 100 }] }), r)
    const life = lifeOf(predatorsOf(world)[0]!)
    life.kidsKills = eco.killsPerCub
    life.age = eco.adultAge
    life.energy = eco.cubCost + eco.huntBelow
    lifeTick(world, r)
    expect(predatorsOf(world)).toHaveLength(1)
    expect(world.rng.predator).toEqual(createRng('a').predator)
    // The same scene with the limit lifted does take draws and breeds.
    const free = withPrey(rules, { minCount: 5, leaveAfter: 1_000_000 }, { drain: 0, homeTries: 50 })
    const w2 = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 100, y: 100 }] }), free)
    const l2 = lifeOf(predatorsOf(w2)[0]!)
    l2.kidsKills = eco.killsPerCub
    l2.age = eco.adultAge
    l2.energy = eco.cubCost + eco.huntBelow
    lifeTick(w2, free)
    expect(predatorsOf(w2)).toHaveLength(2)
    expect(w2.rng.predator).not.toEqual(createRng('a').predator)
  })

  it('a newcomer waits while the count is at the limit', () => {
    const gated = withPrey(rules, { minCount: 1, leaveAfter: 1_000_000 }, { drain: 0, recolonizeTicks: 5 })
    const open = withPrey(rules, { minCount: 2, leaveAfter: 1_000_000 }, { drain: 0, recolonizeTicks: 5 })
    for (const [r, arrives] of [[gated, false], [open, true]] as const) {
      const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 40, y: 40 }, { kind: 'predator', x: 160, y: 160 }] }), r)
      world.nodes = world.nodes.filter((node) => !(node.kind === 'predator' && node.x === 160))
      for (let i = 0; i < 30; i += 1) lifeTick(world, r)
      expect(predatorsOf(world)).toHaveLength(arrives ? 2 : 1)
    }
  })
})

describe('leaving', () => {
  const r = withPrey(rules, { minCount: 1, leaveAfter: 10 }, { drain: 0 })

  it('fires exactly leaveAfter ticks after the count first went over, lowest energy first, ties lowest id', () => {
    const world = threePredators(r)
    const [a, b, c] = predatorsOf(world)
    lifeOf(a!).energy = 30
    lifeOf(b!).energy = 20
    lifeOf(c!).energy = 20
    for (let i = 0; i < 10; i += 1) lifeTick(world, r)
    expect(predatorsOf(world)).toHaveLength(3)
    expect(world.ecology!.prey).toEqual({ overSince: 1, left: 0 })
    lifeTick(world, r)
    expect(predatorsOf(world).map((node) => node.id)).toEqual([a!.id, c!.id])
    expect(world.ecology!.prey).toEqual({ overSince: 11, left: 1 })
    const left = world.log.filter((event) => event.type === 'predator' && event.predatorEvent === 'left')
    expect(left).toHaveLength(1)
    expect(left[0]).toMatchObject({ nodeId: b!.id, tick: 11 })
    // The next one leaves another leaveAfter ticks later: a (energy 30) stays, c goes, then the minCount of 1 holds.
    for (let i = 0; i < 9; i += 1) lifeTick(world, r)
    expect(predatorsOf(world)).toHaveLength(2)
    lifeTick(world, r)
    expect(predatorsOf(world).map((node) => node.id)).toEqual([a!.id])
    expect(world.ecology!.prey!.left).toBe(2)
    for (let i = 0; i < 50; i += 1) lifeTick(world, r)
    expect(predatorsOf(world)).toHaveLength(1)
    expect(world.ecology!.prey).toEqual({ overSince: null, left: 2 })
  })

  it('never takes a placed predator, and nobody leaves if only placed ones are over', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 40, y: 40 }] }), r)
    expect(applyCommand(world, r, { type: 'placeNode', kind: 'predator', x: 100, y: 100 }).ok).toBe(true)
    expect(applyCommand(world, r, { type: 'placeNode', kind: 'predator', x: 150, y: 150 }).ok).toBe(true)
    const [founder, p1, p2] = predatorsOf(world)
    lifeOf(founder!).energy = 90
    lifeOf(p1!).energy = 1
    lifeOf(p2!).energy = 2
    for (let i = 0; i < 11; i += 1) lifeTick(world, r)
    expect(predatorsOf(world).map((node) => node.id)).toEqual([p1!.id, p2!.id])
    for (let i = 0; i < 100; i += 1) lifeTick(world, r)
    expect(predatorsOf(world)).toHaveLength(2)
    expect(world.ecology!.prey!.left).toBe(1)
  })

  it('resets the timer when the count is back under the limit', () => {
    const world = threePredators(r)
    for (let i = 0; i < 8; i += 1) lifeTick(world, r)
    expect(world.ecology!.prey!.overSince).toBe(1)
    const roomy = withPrey(rules, { minCount: 3, leaveAfter: 10 }, { drain: 0 })
    lifeTick(world, roomy)
    expect(world.ecology!.prey!.overSince).toBeNull()
    for (let i = 0; i < 5; i += 1) lifeTick(world, r)
    expect(world.ecology!.prey!.overSince).toBe(world.tick - 4)
    expect(predatorsOf(world)).toHaveLength(3)
  })

  it('does nothing with the rule switched off after creation', () => {
    const world = threePredators(r)
    const off = noPreyRule(r)
    for (let i = 0; i < 50; i += 1) lifeTick(world, off)
    expect(predatorsOf(world)).toHaveLength(3)
  })
})

describe('determinism with the rule on', () => {
  it('a live Eden run with commands replays to the same hash', () => {
    const r = withPrey(rules, { perPredator: 200, leaveAfter: 200 })
    const live = createWorld('a', edenPreset, r)
    for (let i = 0; i < 3000; i += 1) {
      if (live.tick === 400) expect(applyCommand(live, r, { type: 'placeNode', kind: 'predator', x: 30.5, y: 30.5 }).ok).toBe(true)
      if (live.tick === 900) expect(applyCommand(live, r, { type: 'placeBot', x: 20.5, y: 20.5 }).ok).toBe(true)
      step(live, r)
    }
    expect(live.ecology!.prey!.left).toBeGreaterThanOrEqual(1)
    expect(stateHash(replayWorld('a', edenPreset, r, live.commands, live.tick))).toBe(stateHash(live))
    // The placed predator is still there.
    expect(predatorsOf(live).some((node) => node.hunt?.life?.origin === 'placed')).toBe(true)
  })
})

describe('pearson and bestLag', () => {
  it('pearson on simple series', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12)
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12)
    expect(pearson([1, 2, 3, 4], [3, 3, 3, 3])).toBeNull()
    expect(pearson([5, 5, 5], [1, 2, 3])).toBeNull()
    expect(pearson([1], [1])).toBeNull()
    expect(pearson([], [])).toBeNull()
    const mixed = pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])!
    expect(mixed).toBeGreaterThan(0.7)
    expect(mixed).toBeLessThan(1)
  })

  it('bestLag finds a predator series that trails the bots by two samples', () => {
    const bots = [1, 5, 2, 8, 3, 9, 4, 7, 2, 6]
    const pred = [0, 0, ...bots.slice(0, bots.length - 2)]
    const best = bestLag(pred, bots, [0, 1, 2, 3])!
    expect(best.lag).toBe(2)
    expect(best.corr).toBeCloseTo(1, 12)
    expect(bestLag([1, 1, 1], [1, 2, 3], [0, 1])).toBeNull()
    expect(bestLag(pred, bots, [99])).toBeNull()
  })
})
