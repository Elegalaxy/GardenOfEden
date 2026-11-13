import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { applyCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { step } from '../src/sim/step.ts'
import { TRAIT_NAMES, meanTraits } from '../src/sim/traits.ts'
import type { Preset, Rules, TraitName, World } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'

// Trait inheritance (M6) with the real rules and the eden preset: children
// inherit with a bounded mutation, the result is deterministic, and the
// tradeoffs in tuning.ts mean no trait is simply best at the extreme.

function withMutation(over: Partial<Rules['tuning']['mutation']>): Rules {
  return { ...rules, tuning: { ...rules.tuning, mutation: { ...rules.tuning.mutation, ...over } } }
}

function run(seed: string, ticks: number, r: Rules = rules): World {
  const world = createWorld(seed, edenPreset, r)
  for (let i = 0; i < ticks; i += 1) step(world, r)
  return world
}

const nursery: Preset = {
  id: 'nursery',
  label: 'One parent in a shelter',
  width: 40,
  height: 40,
  nodes: [{ kind: 'shelter', x: 20, y: 20 }],
  scatter: [],
  // A female and a male (founders alternate), so the shelter holds a breeding pair.
  bots: [
    { x: 20, y: 20 },
    { x: 20, y: 20 },
  ],
  scatterBots: 0,
}

/** One tick with a ready pair in the shelter: the world then holds the mother (0), the father (1) and the child (2). */
function birthFrom(r: Rules, seed: string): World {
  const world = createWorld(seed, nursery, r)
  for (const parent of world.bots) {
    parent.energy = 90
    parent.age = r.tuning.bot.adultAge + 100
  }
  step(world, r)
  return world
}

describe('inheritance', { timeout: 60_000 }, () => {
  it('gives a child exactly its parent traits when the mutation strength is 0', () => {
    const none = withMutation({ strength: 0 })
    for (const seed of ['a', 'b', 'c']) {
      const world = birthFrom(none, seed)
      expect(world.bots).toHaveLength(3)
      expect(world.bots[2]!.traits).toEqual(world.bots[0]!.traits)
      expect(world.bots[2]!.traits).toEqual(rules.tuning.traits)
    }
  })

  it('changes at least one trait of some children when mutation is on', () => {
    const different = ['a', 'b', 'c', 'd', 'e', 'f'].filter((seed) => {
      const world = birthFrom(rules, seed)
      return JSON.stringify(world.bots[2]!.traits) !== JSON.stringify(world.bots[0]!.traits)
    })
    expect(different.length).toBeGreaterThanOrEqual(5)
  })

  it('keeps every trait of every bot inside the bounds, even with extreme mutation', () => {
    const wild = withMutation({ rate: 1, strength: 0.9 })
    const { bounds } = rules.tuning.mutation
    for (const seed of ['a', 'b']) {
      const world = createWorld(seed, edenPreset, wild)
      for (let i = 0; i < 4000; i += 1) {
        step(world, wild)
        if (i % 400 === 0) {
          for (const bot of world.bots) {
            for (const name of TRAIT_NAMES) {
              expect(bot.traits[name]).toBeGreaterThanOrEqual(bounds[name].min)
              expect(bot.traits[name]).toBeLessThanOrEqual(bounds[name].max)
            }
          }
        }
      }
      expect(world.totalBirths).toBeGreaterThan(50)
      expect(world.bots.some((bot) => bot.generation > 0)).toBe(true)
    }
  })

  it('keeps founders and player-placed bots on the default traits', () => {
    const world = createWorld('a', edenPreset, rules)
    for (const bot of world.bots) expect(bot.traits).toEqual(rules.tuning.traits)
    applyCommand(world, rules, { type: 'placeBot', x: 10.5, y: 10.5 })
    expect(world.bots.at(-1)!.traits).toEqual(rules.tuning.traits)
  })

  it('is deterministic: same seed gives the same hash and the same trait means', () => {
    const first = run('det-traits', 3000)
    const second = run('det-traits', 3000)
    expect(first.totalBirths).toBeGreaterThan(20)
    expect(stateHash(second)).toBe(stateHash(first))
    expect(meanTraits(second.bots)).toEqual(meanTraits(first.bots))
    // And mutation really happened: the population is no longer all founders.
    const founders = rules.tuning.traits
    expect(first.bots.some((bot) => TRAIT_NAMES.some((name) => bot.traits[name] !== founders[name]))).toBe(true)
  })

  it('records the population mean of each trait in the stats samples', () => {
    const world = run('a', 1500)
    const last = world.samples.at(-1)!
    expect(last.traits).toEqual(meanTraits(world.bots))
    expect(world.samples[0]!.traits).toEqual(rules.tuning.traits)
    const empty = createWorld('a', { ...edenPreset, scatterBots: 0 }, rules)
    expect(empty.samples[0]!.traits).toBeNull()
  })

  it('replays a run with commands to the same hash with mutation on', () => {
    const live = createWorld('a', edenPreset, rules)
    const script = [
      { tick: 300, cmd: { type: 'placeBot', x: 10.5, y: 10.5 } },
      { tick: 700, cmd: { type: 'placeNode', kind: 'shelter', x: 30.5, y: 20.5 } },
      { tick: 1200, cmd: { type: 'placeNode', kind: 'danger', x: 50.5, y: 12.5 } },
    ] as const
    for (const { tick, cmd } of script) {
      while (live.tick < tick) step(live, rules)
      expect(applyCommand(live, rules, cmd).ok).toBe(true)
    }
    while (live.tick < 2500) step(live, rules)
    expect(live.totalBirths).toBeGreaterThan(5)
    expect(stateHash(replayWorld('a', edenPreset, rules, live.commands, live.tick))).toBe(stateHash(live))
  })
})

describe('what a trait costs', () => {
  const lone: Preset = { ...nursery, nodes: [] }

  it('charges a wider sense radius more energy per tick, and a narrower one less', () => {
    const lost = (senseRadius: number): number => {
      const world = createWorld('cost', lone, rules)
      world.bots[0]!.traits.senseRadius = senseRadius
      const before = world.bots[0]!.energy
      step(world, rules)
      return before - world.bots[0]!.energy
    }
    const { baseDrain, moveDrain, senseDrain } = rules.tuning.bot
    const base = rules.tuning.traits.senseRadius
    expect(lost(base)).toBeCloseTo(baseDrain + moveDrain, 12)
    expect(lost(base + 6)).toBeCloseTo(baseDrain + moveDrain + 6 * senseDrain, 12)
    expect(lost(base - 3)).toBeCloseTo(baseDrain + moveDrain - 3 * senseDrain, 12)
  })

  it('charges a higher metabolism more energy per tick', () => {
    const lost = (metabolism: number): number => {
      const world = createWorld('cost', lone, rules)
      world.bots[0]!.traits.metabolism = metabolism
      const before = world.bots[0]!.energy
      step(world, rules)
      return before - world.bots[0]!.energy
    }
    expect(lost(1.5)).toBeCloseTo(lost(1) * 1.5, 12)
    expect(lost(0.8)).toBeCloseTo(lost(1) * 0.8, 12)
  })

  it('makes a higher-metabolism bot walk faster', () => {
    const walked = (metabolism: number): number => {
      const world = createWorld('cost', lone, rules)
      const bot = world.bots[0]!
      bot.traits.metabolism = metabolism
      bot.energy = 100
      const { x, y } = bot
      step(world, rules)
      return Math.hypot(bot.x - x, bot.y - y)
    }
    expect(walked(1)).toBeCloseTo(rules.tuning.bot.speed, 9)
    expect(walked(1.3)).toBeGreaterThan(walked(1))
    expect(walked(0.8)).toBeLessThan(walked(1))
  })

  it('lets a wide reproduction threshold range exist: a child still gets energy at the lowest bound', () => {
    const { reproThreshold } = rules.tuning.mutation.bounds
    const share = rules.tuning.bot.childEnergyShare
    const parentLeft = reproThreshold.min * (1 - share) - rules.tuning.bot.birthCost
    expect(parentLeft).toBeGreaterThan(0.1 * rules.tuning.bot.maxEnergy)
  })
})

// Selection: in the real eden food supply, mutation off so each lineage keeps its
// own traits, bots with a trait set to an extreme leave fewer descendants than
// bots with a moderate one. These are the tradeoffs from tuning.ts at work.
describe('selection', () => {
  const noMutation = withMutation({ strength: 0 })
  const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f']

  function lineages(seed: string, trait: TraitName, even: number, odd: number): { even: number; odd: number } {
    const world = createWorld(seed, edenPreset, noMutation)
    // Founders alternate female, male, so give both values to both sexes: a pair of bots shares a value.
    world.bots.forEach((bot, index) => {
      bot.traits[trait] = Math.floor(index / 2) % 2 === 0 ? even : odd
    })
    for (let i = 0; i < 4000; i += 1) step(world, noMutation)
    return {
      even: world.bots.filter((bot) => bot.traits[trait] === even).length,
      odd: world.bots.filter((bot) => bot.traits[trait] === odd).length,
    }
  }

  it.each([
    ['metabolism', 0.9, 1.6],
    ['senseRadius', 6, 12],
  ] as const)('a moderate %s (%f) out-breeds an extreme one (%f) on every seed', { timeout: 120_000 }, (trait, moderate, extreme) => {
    for (const seed of SEEDS) {
      const result = lineages(seed, trait, moderate, extreme)
      expect(result.even, `${trait} seed ${seed}: ${JSON.stringify(result)}`).toBeGreaterThan(result.odd)
    }
  })
})
