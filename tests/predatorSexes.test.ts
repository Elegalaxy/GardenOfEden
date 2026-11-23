import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { applyCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { predatorLife } from '../src/sim/predators.ts'
import { checkPredatorSexes, findMate, lastOfSex, predatorAutoSex, predatorSexCounts, sexesOn } from '../src/sim/predatorSexes.ts'
import { createRng, nextFloat } from '../src/sim/rng.ts'
import { step } from '../src/sim/step.ts'
import type { Preset, Rules, RngStream, Sex, World, WorldNode } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'
import { noPredatorSexes, withEcology, withPredatorSexes, withPredatorTraits, withPrey } from './variants.ts'

// Predator sexes (PS1, mechanics, off in Eden): the pins that prove a world with the rule off is untouched, who gets which sex, who may breed with whom, the lone
// fallback, the leave guard, crossover draws and generation, key order, the checks and the placed-predator sex.

const pt = rules.tuning.predator
const eco = pt.ecology
const sx = pt.sexes
const BIG: Pick<Preset, 'width' | 'height'> = { width: 200, height: 200 }

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', ...BIG, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

const predatorsOf = (world: World): WorldNode[] => world.nodes.filter((node) => node.kind === 'predator')
const sexOf = (node: WorldNode): Sex | undefined => node.hunt?.sex

function lifeTick(world: World, r: Rules): void {
  world.tick += 1
  predatorLife(world, r)
}

/** Make a predator an adult with enough kills and energy for a cub (drain is 0 in these scenes, so it stays so). */
function ready(node: WorldNode, kills = sx.killsPerCub): void {
  const life = node.hunt!.life!
  life.kidsKills = kills
  life.age = eco.adultAge
  life.energy = eco.cubCost + eco.huntBelow
}

function adult(node: WorldNode): void {
  node.hunt!.life!.age = eco.adultAge
}

/** How many draws a stream has taken from its seed's start (up to a cap); -1 if more. */
function draws(seed: string, stream: RngStream): number {
  const reference = createRng(seed).predator
  for (let k = 0; k < 200; k += 1) {
    if (JSON.stringify(reference) === JSON.stringify(stream)) return k
    nextFloat(reference)
  }
  return -1
}

const base = withEcology(rules, { drain: 0 })
const on = withPredatorSexes(base)
const pair = (): Preset => scene({ nodes: [{ kind: 'predator', x: 100, y: 100 }, { kind: 'predator', x: 105, y: 100 }] })

describe('sexes off equals before PS1', () => {
  const runA = (r: Rules): World => {
    const world = createWorld('a', edenPreset, r)
    for (let i = 0; i < 5000; i += 1) {
      if (world.tick === 1000) expect(applyCommand(world, r, { type: 'placeNode', kind: 'predator', x: 40.5, y: 30.5 }).ok).toBe(true)
      if (world.tick === 3000) expect(applyCommand(world, r, { type: 'removeNode', id: predatorsOf(world).slice(-1)[0]!.id }).ok).toBe(true)
      step(world, r)
    }
    return world
  }
  const runB = (r: Rules): World => {
    const world = createWorld('b', edenPreset, r)
    for (let i = 0; i < 20000; i += 1) step(world, r)
    return world
  }

  for (const [name, r] of [['shipped rules', rules], ['noPredatorSexes', noPredatorSexes(rules)]] as const) {
    it(`Eden seed a with a placed and a removed predator hashes as before PS1 (${name})`, () => {
      const world = runA(r)
      // Recorded on the untouched tree (before PS1) with the shipped rules.
      expect(stateHash(world)).toBe('3b28b72779e42c51')
      expect(world.rng.predator).toEqual({ a: 3601039151, b: 1593024896, c: 1034893919, d: 1357583488 })
    })

    it(`Eden seed b at 20,000 ticks hashes as before PS1 (${name})`, () => {
      const world = runB(r)
      expect(stateHash(world)).toBe('a44d483eff987840')
      expect(world.rng.predator).toEqual({ a: 1664120539, b: 560783549, c: 2628320706, d: 2899233424 })
    })
  }

  it('has no sex, no ecology.sexes and no fatherId anywhere, and a placed sex is ignored', () => {
    const world = createWorld('a', edenPreset, rules)
    expect(applyCommand(world, rules, { type: 'placeNode', kind: 'predator', x: 40.5, y: 30.5, sex: 'male' }).ok).toBe(true)
    for (let i = 0; i < 300; i += 1) step(world, rules)
    expect(world.ecology).toBeDefined()
    expect('sexes' in world.ecology!).toBe(false)
    for (const node of predatorsOf(world)) {
      expect('sex' in node.hunt!).toBe(false)
      expect('fatherId' in node.hunt!.life!).toBe(false)
    }
    expect(sexesOn(world, rules.tuning)).toBe(false)
  })

  it('ships off with the first-guess numbers, within the checks', () => {
    expect(sx).toEqual({ enabled: false, mateRange: 120, loneAfter: 3000, killsPerCub: 3, crossover: true })
    expect(() => checkPredatorSexes(sx)).not.toThrow()
    expect(Object.keys(pt).slice(-1)).toEqual(['sexes'])
  })
})

describe('who gets which sex', () => {
  it('Eden founders are female, male, female, male, female and the keys come after generation', () => {
    const world = createWorld('a', edenPreset, withPredatorSexes(rules))
    expect(predatorsOf(world).map(sexOf)).toEqual(['female', 'male', 'female', 'male', 'female'])
    for (const node of predatorsOf(world)) expect(Object.keys(node.hunt!).slice(-3)).toEqual(['traits', 'generation', 'sex'])
    expect(world.ecology!.sexes).toEqual({ oneSexSince: null, mated: 0, alone: 0 })
    expect(Object.keys(world.ecology!).slice(-1)).toEqual(['sexes'])
  })

  it('the key is absent when ecology is off or the world was made without the rule', () => {
    const withSexes = withPredatorSexes(rules)
    const fixed: Rules = { ...withSexes, tuning: { ...withSexes.tuning, predator: { ...withSexes.tuning.predator, ecology: { ...eco, enabled: false } } } }
    for (const node of predatorsOf(createWorld('a', edenPreset, fixed))) expect('sex' in node.hunt!).toBe(false)
    // A world made with the rule off ignores the rule being switched on afterwards.
    const old = createWorld('a', edenPreset, noPredatorSexes(rules))
    expect(sexesOn(old, on.tuning)).toBe(false)
  })

  it('predatorAutoSex picks the sex there are fewer of and a tie gives female', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 50, y: 50 }, { kind: 'predator', x: 150, y: 50 }, { kind: 'predator', x: 50, y: 150 }] }), on)
    const [a, b, c] = predatorsOf(world)
    expect([a, b, c].map((n) => sexOf(n!))).toEqual(['female', 'male', 'female'])
    expect(predatorAutoSex(world.nodes)).toBe('male')
    expect(predatorAutoSex([])).toBe('female')
    expect(predatorSexCounts(world.nodes)).toEqual({ females: 2, males: 1 })
    expect(predatorSexCounts(world.nodes.filter((n) => n !== a))).toEqual({ females: 1, males: 1 })
  })

  it('an arrival brings the missing sex', () => {
    const r = withPredatorSexes(withEcology(rules, { drain: 0, recolonizeTicks: 5 }))
    const world = createWorld('a', pair(), r)
    const male = predatorsOf(world)[1]!
    world.nodes = world.nodes.filter((n) => n !== male)
    for (let i = 0; i < 20; i += 1) lifeTick(world, r)
    const arrived = predatorsOf(world).filter((n) => n.hunt!.life!.origin === 'arrived')
    expect(arrived).toHaveLength(1)
    expect(sexOf(arrived[0]!)).toBe('male')
    expect(Object.keys(arrived[0]!.hunt!).slice(-1)).toEqual(['sex'])
  })

  it('a placed predator takes the chosen sex or the missing one, and the command records sex last', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }] }), on)
    expect(applyCommand(world, on, { type: 'placeNode', kind: 'predator', x: 60, y: 60 }).ok).toBe(true)
    expect(applyCommand(world, on, { type: 'placeNode', kind: 'predator', x: 100, y: 100, sex: 'female' }).ok).toBe(true)
    expect(applyCommand(world, on, { type: 'placeNode', kind: 'predator', x: 140, y: 140, sex: 'female' }).ok).toBe(true)
    expect(predatorsOf(world).map(sexOf)).toEqual(['female', 'male', 'female', 'female'])
    expect(Object.keys(world.commands.at(-1)!.cmd)).toEqual(['type', 'kind', 'x', 'y', 'sex'])
    expect(Object.keys(world.commands[0]!.cmd)).toEqual(['type', 'kind', 'x', 'y'])
  })
})

describe('who breeds', () => {
  it('a ready female with an adult male in range bears a cub; the father pays nothing and the keys stay in order', () => {
    const world = createWorld('a', pair(), on)
    const [mother, father] = predatorsOf(world) as [WorldNode, WorldNode]
    ready(mother)
    adult(father)
    father.hunt!.life!.kidsKills = 7
    const fatherEnergy = father.hunt!.life!.energy
    lifeTick(world, on)
    const cubs = predatorsOf(world).filter((n) => n.hunt!.life!.origin === 'cub')
    expect(cubs).toHaveLength(1)
    const cub = cubs[0]!
    expect(cub.hunt!.life!.parentId).toBe(mother.id)
    expect(cub.hunt!.life!.fatherId).toBe(father.id)
    expect(Object.keys(cub.hunt!.life!).slice(-1)).toEqual(['fatherId'])
    expect(sexOf(cub)).toBe('female') // one female, one male: a tie gives female
    expect(Object.keys(cub.hunt!).slice(-1)).toEqual(['sex'])
    expect(mother.hunt!.life!.kidsKills).toBe(0)
    expect(mother.hunt!.life!.energy).toBe(eco.huntBelow)
    expect(father.hunt!.life!.energy).toBe(fatherEnergy)
    expect(father.hunt!.life!.kidsKills).toBe(7)
    expect(world.ecology!.sexes).toEqual({ oneSexSince: null, mated: 1, alone: 0 })
    expect(world.ecology!.stats.births).toBe(1)
  })

  it('a ready male never bears while a female lives', () => {
    const world = createWorld('a', pair(), on)
    const [female, male] = predatorsOf(world) as [WorldNode, WorldNode]
    adult(female)
    ready(male)
    lifeTick(world, on)
    expect(predatorsOf(world)).toHaveLength(2)
    expect(draws('a', world.rng.predator)).toBe(0)
  })

  it('no cub and no draws when the male is out of range or still a cub, and each predator takes one draw a tick', () => {
    const far = withPredatorSexes(base, { mateRange: 3 })
    const world = createWorld('a', pair(), far)
    ready(predatorsOf(world)[0]!)
    adult(predatorsOf(world)[1]!)
    lifeTick(world, far)
    expect(predatorsOf(world)).toHaveLength(2)
    expect(draws('a', world.rng.predator)).toBe(0)

    const young = createWorld('a', pair(), on)
    ready(predatorsOf(young)[0]!)
    lifeTick(young, on) // the male is age 1: a cub
    expect(predatorsOf(young)).toHaveLength(2)
    expect(draws('a', young.rng.predator)).toBe(0)

    // Through the whole step: one movement draw per predator per tick and nothing else.
    const run = createWorld('a', pair(), far)
    for (let i = 0; i < 20; i += 1) {
      ready(predatorsOf(run)[0]!)
      adult(predatorsOf(run)[1]!)
      step(run, far)
    }
    expect(predatorsOf(run)).toHaveLength(2)
    expect(draws('a', run.rng.predator)).toBe(40)
  })

  it('findMate takes the nearest adult male, ties to the lowest id', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 100, y: 100 }, { kind: 'predator', x: 110, y: 100 }, { kind: 'predator', x: 100, y: 110 }, { kind: 'predator', x: 130, y: 100 }] }), on)
    const [female, m1, f2, m2] = predatorsOf(world) as [WorldNode, WorldNode, WorldNode, WorldNode]
    expect([female, m1, f2, m2].map(sexOf)).toEqual(['female', 'male', 'female', 'male'])
    expect(findMate(world.nodes, female, on.tuning)).toBeNull() // both males are cubs
    adult(m2)
    expect(findMate(world.nodes, female, on.tuning)).toBe(m2)
    adult(m1)
    expect(findMate(world.nodes, female, on.tuning)).toBe(m1)
    adult(f2) // a female is never a mate
    expect(findMate(world.nodes, female, on.tuning)).toBe(m1)
    expect(findMate(world.nodes, female, withPredatorSexes(base, { mateRange: 5 }).tuning)).toBeNull()
  })

  it('uses sexes.killsPerCub, not ecology.killsPerCub', () => {
    const r = withPredatorSexes(withEcology(rules, { drain: 0, killsPerCub: 6 }), { killsPerCub: 2 })
    const world = createWorld('a', pair(), r)
    ready(predatorsOf(world)[0]!, 2)
    adult(predatorsOf(world)[1]!)
    lifeTick(world, r)
    expect(predatorsOf(world)).toHaveLength(3)
  })
})

describe('lone fallback', () => {
  const r = withPredatorSexes(base, { loneAfter: 50 })

  it('a lone predator breeds at exactly loneAfter ticks of one sex and the cub is the missing sex', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 100, y: 100 }] }), r)
    const mother = predatorsOf(world)[0]!
    let bornAt = 0
    for (let i = 0; i < 60 && bornAt === 0; i += 1) {
      ready(mother)
      lifeTick(world, r)
      if (predatorsOf(world).length > 1) bornAt = world.tick
    }
    // The first tick of one sex is tick 1, so the wait of 50 ends at tick 51.
    expect(bornAt).toBe(51)
    const cub = predatorsOf(world)[1]!
    expect(sexOf(cub)).toBe('male')
    expect('fatherId' in cub.hunt!.life!).toBe(false)
    expect(cub.hunt!.life!.parentId).toBe(mother.id)
    expect(world.ecology!.sexes).toEqual({ oneSexSince: 1, mated: 0, alone: 1 })
    lifeTick(world, r)
    expect(world.ecology!.sexes!.oneSexSince).toBeNull() // both sexes now
  })

  it('a lone male breeds too, and the cub is female', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 100, y: 100 }] }), r)
    const only = predatorsOf(world)[0]!
    only.hunt!.sex = 'male'
    for (let i = 0; i < 60; i += 1) {
      ready(only)
      lifeTick(world, r)
    }
    expect(predatorsOf(world).map(sexOf)).toEqual(['male', 'female'])
  })

  it('the timer clears when nobody is alive', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 100, y: 100 }] }), r)
    lifeTick(world, r)
    expect(world.ecology!.sexes!.oneSexSince).toBe(1)
    world.nodes = world.nodes.filter((n) => n.kind !== 'predator')
    lifeTick(world, r)
    expect(world.ecology!.sexes!.oneSexSince).toBeNull()
  })
})

describe('leave guard', () => {
  const r = withPredatorSexes(withPrey(withEcology(rules, { drain: 0 }), { minCount: 0, leaveAfter: 1, perPredator: 1000 }, { drain: 0 }))
  const trio = (): Preset => scene({ nodes: [{ kind: 'predator', x: 50, y: 50 }, { kind: 'predator', x: 100, y: 100 }, { kind: 'predator', x: 150, y: 150 }] })

  it('the only male stays even with the lowest energy', () => {
    const world = createWorld('a', trio(), r)
    expect(world.ecology!.prey).toBeDefined()
    const [f1, male, f2] = predatorsOf(world) as [WorldNode, WorldNode, WorldNode]
    male.hunt!.life!.energy = 1
    f1.hunt!.life!.energy = 100
    f2.hunt!.life!.energy = 50
    lifeTick(world, r)
    lifeTick(world, r)
    expect(predatorsOf(world)).toContain(male)
    expect(predatorsOf(world)).not.toContain(f2) // the lower-energy female left
    expect(world.ecology!.prey!.left).toBe(1)
  })

  it('with only one of each sex somebody still leaves, the lowest energy as before', () => {
    const world = createWorld('a', pair(), r)
    const [female, male] = predatorsOf(world) as [WorldNode, WorldNode]
    male.hunt!.life!.energy = 1
    female.hunt!.life!.energy = 100
    lifeTick(world, r)
    lifeTick(world, r)
    expect(predatorsOf(world)).toEqual([female])
  })

  it('lastOfSex is true only for the sole predator of its sex', () => {
    const world = createWorld('a', trio(), r)
    const [f1, male, f2] = predatorsOf(world) as [WorldNode, WorldNode, WorldNode]
    expect(lastOfSex(world.nodes, male)).toBe(true)
    expect(lastOfSex(world.nodes, f1)).toBe(false)
    expect(lastOfSex(world.nodes, f2)).toBe(false)
  })
})

describe('traits from both parents', () => {
  const still = { mutation: { rate: 0, strength: 0 } }
  const rx = (crossover: boolean): Rules => withPredatorSexes(withPredatorTraits(base, still), { crossover })

  function breed(r: Rules, seed = 'a'): { world: World; mother: WorldNode; father: WorldNode; cub: WorldNode } {
    const world = createWorld(seed, pair(), r)
    const [mother, father] = predatorsOf(world) as [WorldNode, WorldNode]
    mother.hunt!.traits = { sense: 1.2, speed: 1.1, stamina: 0.8 }
    mother.hunt!.generation = 2
    father.hunt!.traits = { sense: 0.9, speed: 0.9, stamina: 1.5 }
    father.hunt!.generation = 5
    ready(mother)
    adult(father)
    lifeTick(world, r)
    const cub = predatorsOf(world).find((n) => n.hunt!.life!.origin === 'cub')!
    return { world, mother, father, cub }
  }

  it('crossover takes 9 draws, mother-only 6, and each trait comes from one parent', () => {
    const a = breed(rx(true))
    const b = breed(rx(false))
    const usedOn = draws('a', a.world.rng.predator)
    const usedOff = draws('a', b.world.rng.predator)
    expect(usedOn - usedOff).toBe(3)
    expect(usedOff).toBeGreaterThanOrEqual(8) // at least one territory try (2) plus 6
    expect((usedOff - 6) % 2).toBe(0)
    expect(b.cub.hunt!.traits).toEqual(b.mother.hunt!.traits)
    for (const name of ['sense', 'speed', 'stamina'] as const) {
      expect([a.mother.hunt!.traits![name], a.father.hunt!.traits![name]]).toContain(a.cub.hunt!.traits![name])
    }
  })

  it('generation is the higher parent plus one, with or without crossover', () => {
    expect(breed(rx(true)).cub.hunt!.generation).toBe(6)
    expect(breed(rx(false)).cub.hunt!.generation).toBe(6)
  })

  it('both parents are drawn from across seeds (the pick is not always the mother)', () => {
    const fromFather = new Set<boolean>()
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) fromFather.add(breed(rx(true), seed).cub.hunt!.traits!.sense === 0.9)
    expect(fromFather.size).toBe(2)
  })
})

describe('key order and checks', () => {
  it('ecology.sexes is the last key, after prey too', () => {
    const r = withPredatorSexes(withPrey(base))
    const world = createWorld('a', pair(), r)
    expect(Object.keys(world.ecology!)).toEqual(['dens', 'stats', 'prey', 'sexes'])
    expect(Object.keys(createWorld('a', pair(), on).ecology!)).toEqual(['dens', 'stats', 'sexes'])
  })

  it('checkPredatorSexes names the bad number, and createWorld runs it even with the rule off', () => {
    const bad = (over: Partial<typeof sx>): (() => void) => () => checkPredatorSexes({ ...sx, ...over })
    expect(bad({ mateRange: 0 })).toThrow(/mateRange/)
    expect(bad({ mateRange: Number.NaN })).toThrow(/mateRange/)
    expect(bad({ loneAfter: 0 })).toThrow(/loneAfter/)
    expect(bad({ loneAfter: 2.5 })).toThrow(/loneAfter/)
    expect(bad({ killsPerCub: 0 })).toThrow(/killsPerCub/)
    expect(bad({ enabled: 1 as unknown as boolean })).toThrow(/enabled/)
    expect(bad({ crossover: 'yes' as unknown as boolean })).toThrow(/crossover/)
    expect(bad({})).not.toThrow()
    const broken: Rules = { ...rules, tuning: { ...rules.tuning, predator: { ...pt, sexes: { ...sx, mateRange: -1 } } } }
    expect(() => createWorld('a', edenPreset, broken)).toThrow(RangeError)
  })
})

describe('a run with sexes on', () => {
  it('a placed sex survives replay to the same hash', () => {
    const r = withPredatorSexes(rules)
    const live = createWorld('a', edenPreset, r)
    while (live.tick < 100) step(live, r)
    expect(applyCommand(live, r, { type: 'placeNode', kind: 'predator', x: 40.5, y: 30.5, sex: 'male' }).ok).toBe(true)
    while (live.tick < 1500) step(live, r)
    const copy = createWorld('a', edenPreset, r)
    while (copy.tick < 100) step(copy, r)
    for (const recorded of live.commands) expect(applyCommand(copy, r, recorded.cmd).ok).toBe(true)
    while (copy.tick < 1500) step(copy, r)
    expect(stateHash(copy)).toBe(stateHash(live))
    expect(predatorSexCounts(live.nodes).males).toBeGreaterThan(0)
  })
})
