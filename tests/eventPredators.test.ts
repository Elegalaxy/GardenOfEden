import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { applyCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { checkPredatorHarm, predatorLife } from '../src/sim/predators.ts'
import { step } from '../src/sim/step.ts'
import type { Preset, Rules, World, WorldNode } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'
import { formatSurvey, surveySeed } from '../src/harness/survey.ts'
import { noPredatorHarm, staticPredators, withEcology, withPredatorHarm } from './variants.ts'

// Events hurt predators (EP1, off in the shipped numbers): a meteor kills the predators in its core, a plague drains their energy.

/** Eden seed a, plague on the first den at tick 1000, meteor on it at tick 1500, to tick 3000, taken from UNMODIFIED code before EP1. */
const PRE_EP1_HASH = 'cc06cb95f6a22c7d'
const PRE_EP1_RNG =
  '{"world":{"a":3688263227,"b":3154447763,"c":1166763587,"d":3567969820},"ai":{"a":1253416535,"b":328513030,"c":3889496964,"d":2412688508},"birth":{"a":3626714101,"b":1287960309,"c":2169393930,"d":1463742682},"gene":{"a":74850136,"b":2885107963,"c":1864739671,"d":3659276432},"predator":{"a":3033782908,"b":4051452684,"c":1619399037,"d":1357567091}}'

const harm = withPredatorHarm(withEcology(rules))
const h = harm.tuning.events.predatorHarm

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', width: 60, height: 60, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

const predatorsOf = (world: World): WorldNode[] => world.nodes.filter((node) => node.kind === 'predator')
const energyOf = (node: WorldNode) => node.hunt!.life!.energy

function lifeTick(world: World, r: Rules): void {
  world.tick += 1
  predatorLife(world, r)
}

function trigger(world: World, r: Rules, event: 'plague' | 'meteor', x: number, y: number): void {
  const result = applyCommand(world, r, { type: 'triggerEvent', event, x, y })
  expect(result.ok, JSON.stringify(result)).toBe(true)
}

describe('shipped numbers', () => {
  it('ship on (EP2), and the checker accepts them', () => {
    expect(rules.tuning.events.predatorHarm).toEqual({ enabled: true, meteorKillFraction: 0.5, plagueDrain: 0.4 })
    expect(() => checkPredatorHarm(rules.tuning.events.predatorHarm)).not.toThrow()
  })

  it('refuses numbers that cannot work', () => {
    const ok = rules.tuning.events.predatorHarm
    expect(() => checkPredatorHarm({ ...ok, meteorKillFraction: 0 })).toThrow(/meteorKillFraction/)
    expect(() => checkPredatorHarm({ ...ok, meteorKillFraction: 1.5 })).toThrow(/meteorKillFraction/)
    expect(() => checkPredatorHarm({ ...ok, meteorKillFraction: Number.NaN })).toThrow(/meteorKillFraction/)
    expect(() => checkPredatorHarm({ ...ok, plagueDrain: -0.1 })).toThrow(/plagueDrain/)
    expect(() => checkPredatorHarm({ ...ok, enabled: 1 as unknown as boolean })).toThrow(/enabled/)
    expect(() => checkPredatorHarm({ ...ok, meteorKillFraction: 1, plagueDrain: 0 })).not.toThrow()
    // createWorld runs the checker even with the rule off
    const bad = { ...rules, tuning: { ...rules.tuning, events: { ...rules.tuning.events, predatorHarm: { ...ok, plagueDrain: -1 } } } }
    expect(() => createWorld('a', scene({}), bad)).toThrow(/plagueDrain/)
  })
})

describe('meteor', () => {
  const core = rules.tuning.events.meteor.radius * h.meteorKillFraction

  function meteorWorld(): World {
    return createWorld('a', scene({ nodes: [{ kind: 'predator', x: 28, y: 20 }, { kind: 'predator', x: 34, y: 20 }] }), harm)
  }

  it('kills predators inside the core and spares the ones outside', () => {
    const world = meteorWorld()
    const [near, far] = predatorsOf(world) as [WorldNode, WorldNode]
    expect(34 - 28).toBeGreaterThan(core)
    trigger(world, harm, 'meteor', 28 + core - 0.5, 20)
    expect(predatorsOf(world).map((node) => node.id)).toEqual([far.id])
    expect(world.ecology!.stats.eventDeaths).toBe(1)
    expect(world.log.find((event) => event.type === 'predator')).toMatchObject({ predatorEvent: 'struck', nodeId: near.id, tick: 0 })
  })

  it('spares a predator beyond the fraction but inside the meteor radius', () => {
    const world = meteorWorld()
    trigger(world, harm, 'meteor', 28 - core - 1, 20) // 4 cells from the near one: inside radius 6, outside the core of 3
    expect(predatorsOf(world)).toHaveLength(2)
    expect(world.ecology!.stats.eventDeaths).toBeUndefined()
  })

  it('takes placed predators too, and the den empties with the last predator homed there', () => {
    const world = meteorWorld()
    expect(applyCommand(world, harm, { type: 'placeNode', kind: 'predator', x: 29, y: 21 }).ok).toBe(true)
    expect(predatorsOf(world)).toHaveLength(3)
    expect(world.ecology!.dens).toHaveLength(2)
    const doomed = predatorsOf(world).slice(0, 1).concat(predatorsOf(world).slice(2)).map((node) => node.id)
    trigger(world, harm, 'meteor', 28, 20)
    expect(predatorsOf(world)).toHaveLength(1)
    expect(world.ecology!.dens).toEqual([{ x: 34, y: 20, vacantSince: null }])
    expect(world.ecology!.stats.eventDeaths).toBe(2)
    const struck = world.log.filter((event) => event.predatorEvent === 'struck').map((event) => event.nodeId)
    expect(struck).toEqual(doomed)
  })

  it('does nothing with the rule off, or to a static predator', () => {
    for (const r of [noPredatorHarm(withEcology(rules)), staticPredators(withPredatorHarm(rules))]) {
      const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 28, y: 20 }] }), r)
      trigger(world, r, 'meteor', 28, 20)
      expect(predatorsOf(world)).toHaveLength(1)
      expect(world.ecology?.stats.eventDeaths).toBeUndefined()
    }
  })
})

describe('plague', () => {
  const drain = h.plagueDrain

  /** Two predators, one at (20,20), one far away at (50,50). Returns the energy each lost against a plague-free copy after one tick. */
  function lost(plagues: [number, number][]): { inside: number; outside: number } {
    const mk = () => createWorld('a', scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }, { kind: 'predator', x: 50, y: 50 }] }), harm)
    const control = mk()
    const world = mk()
    for (const [x, y] of plagues) trigger(world, harm, 'plague', x, y)
    lifeTick(control, harm)
    lifeTick(world, harm)
    const c = predatorsOf(control)
    const w = predatorsOf(world)
    return { inside: energyOf(c[0]!) - energyOf(w[0]!), outside: energyOf(c[1]!) - energyOf(w[1]!) }
  }

  it('drains energy only inside the disc', () => {
    const { inside, outside } = lost([[20, 20]])
    expect(inside).toBeCloseTo(drain, 10)
    expect(outside).toBe(0)
  })

  it('stacks across two plagues, like bot exposure', () => {
    const { inside } = lost([[20, 20], [22, 20]])
    expect(inside).toBeCloseTo(2 * drain, 10)
  })

  it('logs plagued for a predator the plague finished, starved when no plague was on it', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }, { kind: 'predator', x: 50, y: 50 }] }), harm)
    trigger(world, harm, 'plague', 20, 20)
    // Enough for the ordinary drain but not for the plague drain on top.
    for (const node of predatorsOf(world)) node.hunt!.life!.energy = harm.tuning.predator.ecology.drain + drain / 2
    const ids = predatorsOf(world).map((node) => node.id)
    lifeTick(world, harm)
    expect(predatorsOf(world)).toHaveLength(1)
    const kinds = new Map(world.log.filter((event) => event.type === 'predator').map((event) => [event.nodeId, event.predatorEvent]))
    expect(kinds.get(ids[0]!)).toBe('plagued')
    expect(world.ecology!.stats.eventDeaths).toBe(1)
    expect(world.ecology!.stats.starved).toBe(0)
    // The one outside the disc is fine this tick; with no energy left for the drain it starves, and the log says so.
    predatorsOf(world)[0]!.hunt!.life!.energy = harm.tuning.predator.ecology.drain
    lifeTick(world, harm)
    expect(world.log.at(-1)).toMatchObject({ predatorEvent: 'starved', nodeId: ids[1] })
    expect(world.ecology!.stats.starved).toBe(1)
  })

  it('does nothing with the rule off, or to a static predator', () => {
    const off = noPredatorHarm(withEcology(rules))
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }] }), off)
    trigger(world, off, 'plague', 20, 20)
    lifeTick(world, off)
    expect(energyOf(predatorsOf(world)[0]!)).toBeCloseTo(off.tuning.predator.ecology.cubEnergy - off.tuning.predator.ecology.drain, 10)

    const fixed = staticPredators(withPredatorHarm(rules))
    const still = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }] }), fixed)
    trigger(still, fixed, 'plague', 20, 20)
    const before = JSON.stringify(still.nodes)
    lifeTick(still, fixed)
    expect(JSON.stringify(still.nodes)).toBe(before)
  })
})

describe('zero change while off', () => {
  it('with the rule off, an Eden run with a plague and a meteor on a den is bit-identical to pre-EP1, and the rng too', () => {
    const off = noPredatorHarm(rules)
    const world = createWorld('a', edenPreset, off)
    while (world.tick < 1000) step(world, off)
    const den = world.ecology!.dens[0]!
    trigger(world, off, 'plague', den.x, den.y)
    while (world.tick < 1500) step(world, off)
    trigger(world, off, 'meteor', den.x, den.y)
    while (world.tick < 3000) step(world, off)
    expect(stateHash(world)).toBe(PRE_EP1_HASH)
    expect(JSON.stringify(world.rng)).toBe(PRE_EP1_RNG)
    expect(world.ecology!.stats.eventDeaths).toBeUndefined()
  })

  it('an event-free run is identical with the rule on and off', () => {
    const off = noPredatorHarm(rules)
    const a = createWorld('a', edenPreset, off)
    const b = createWorld('a', edenPreset, rules)
    while (a.tick < 3000) {
      step(a, off)
      step(b, rules)
    }
    expect(stateHash(b)).toBe(stateHash(a))
    expect(b.ecology!.stats).toEqual(a.ecology!.stats)
  })
})

describe('Eden as shipped (EP2)', () => {
  /** Eden seed a to tick 6000 with a plague on the first den at 3000 and a meteor on a predator at 5000, under the given rules. */
  function scripted(r: Rules): World {
    const world = createWorld('a', edenPreset, r)
    while (world.tick < 3000) step(world, r)
    const den = world.ecology!.dens[0]!
    trigger(world, r, 'plague', den.x, den.y)
    while (world.tick < 5000) step(world, r)
    const target = predatorsOf(world)[0]
    if (target !== undefined) trigger(world, r, 'meteor', target.x, target.y)
    while (world.tick < 6000) step(world, r)
    return world
  }

  it('differs from noPredatorHarm when events are scripted', () => {
    const on = scripted(rules)
    const off = scripted(noPredatorHarm(rules))
    expect(stateHash(on)).not.toBe(stateHash(off))
    expect(on.ecology!.stats.eventDeaths ?? 0).toBeGreaterThan(0)
    expect(off.ecology!.stats.eventDeaths).toBeUndefined()
  })

  it('a meteor aimed at a predator kills it on every seed a to j, and a plague aimed at one never empties the map', () => {
    for (const seed of 'abcdefghij'.split('')) {
      const world = createWorld(seed, edenPreset, rules)
      while (world.tick < 3000) step(world, rules)
      const target = predatorsOf(world)[0]!
      const hit = structuredClone(world)
      trigger(hit, rules, 'meteor', target.x, target.y)
      expect(predatorsOf(hit).some((node) => node.id === target.id), seed).toBe(false)
      expect(hit.ecology!.stats.eventDeaths, seed).toBeGreaterThanOrEqual(1)
      trigger(world, rules, 'plague', target.x, target.y)
      while (world.tick < 3900) step(world, rules)
      expect(predatorsOf(world).length, seed).toBeGreaterThan(0)
    }
  })

  it('an event-free run is bit-identical to noPredatorHarm', () => {
    const off = noPredatorHarm(rules)
    const a = createWorld('b', edenPreset, rules)
    const b = createWorld('b', edenPreset, off)
    while (a.tick < 2000) {
      step(a, rules)
      step(b, off)
    }
    expect(stateHash(a)).toBe(stateHash(b))
  })
})

describe('survey column', () => {
  it('ends with pEvt: a dash with the rule off, a count with it on', () => {
    const off = formatSurvey([surveySeed('a', edenPreset, noPredatorHarm(rules), 300, 100)]).split('\n') as [string, string]
    expect(off[0].trim().split(/\s+/).at(-1)).toBe('pEvt')
    expect(off[1].trim().split(/\s+/).at(-1)).toBe('-')
    const on = formatSurvey([surveySeed('a', edenPreset, rules, 300, 100)]).split('\n') as [string, string]
    expect(on[1].trim().split(/\s+/).at(-1)).toBe('0')
  })
})
