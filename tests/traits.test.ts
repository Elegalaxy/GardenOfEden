import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { applyCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { metabolise } from '../src/sim/metabolism.ts'
import { knownDangers, chooseFood, remember } from '../src/sim/perception.ts'
import { fertilityAt, meetsReproductionNeeds } from '../src/sim/reproduction.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { step } from '../src/sim/step.ts'
import { TRAIT_NAMES, meanTraits } from '../src/sim/traits.ts'
import type { MemoryEntry, Preset, Rules, TraitName, World } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'
import { noCone, noSeasons, staticPredators } from './variants.ts'

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
      { tick: 1200, cmd: { type: 'placeNode', kind: 'predator', x: 50.5, y: 12.5 } },
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
// bots with a moderate one. These are the tradeoffs from tuning.ts at work. The race runs without seasons (S2): it
// tests what a trait costs, and a 4,000-tick race should not hang on which season the founders start in.
describe('selection', () => {
  // No seasons and fixed predators: the race tests what a trait costs, not how the predator population moves (E2).
  const noMutation = noCone(noSeasons(staticPredators(withMutation({ strength: 0 })))) // and all-round sensing (V2): the race tests trait costs, not what a cone hides
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

// The four M22 traits (sprint, longevity, hardiness, wariness): each is inherited and clamped, does what it says,
// and has a price. Numbers come from the real tuning, so a retune that breaks a mechanic shows up here.
describe('the four M22 traits', () => {
  const NEW = ['sprint', 'longevity', 'hardiness', 'wariness'] as const
  const { tuning } = rules
  const lone: Preset = { ...nursery, nodes: [] }
  const arena: Preset = {
    id: 'arena',
    label: 'One predator, one bot',
    width: 80,
    height: 80,
    nodes: [{ kind: 'predator', x: 40, y: 40 }],
    scatter: [],
    bots: [{ x: 40, y: 43 }],
    scatterBots: 0,
  }

  /** Energy a lone bot loses in one tick with the given trait values. */
  function lost(traits: Partial<Record<(typeof NEW)[number], number>>): number {
    const world = createWorld('cost', lone, rules)
    Object.assign(world.bots[0]!.traits, traits)
    const before = world.bots[0]!.energy
    step(world, rules)
    return before - world.bots[0]!.energy
  }

  it('start at 1, inside their bounds, for founders', () => {
    for (const name of NEW) {
      expect(tuning.traits[name]).toBe(1)
      expect(tuning.mutation.bounds[name].min).toBeLessThan(1)
      expect(tuning.mutation.bounds[name].max).toBeGreaterThan(1)
    }
    expect(TRAIT_NAMES.slice(-4)).toEqual([...NEW])
  })

  it('are inherited from the mother or the father and never leave their bounds', () => {
    const none = withMutation({ strength: 0 })
    const seen: Record<string, Set<number>> = { sprint: new Set(), hardiness: new Set(), wariness: new Set(), longevity: new Set() }
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const world = createWorld(seed, nursery, none)
      const [mother, father] = world.bots as [World['bots'][number], World['bots'][number]]
      mother.traits = { ...mother.traits, sprint: 1.1, longevity: 1.1, hardiness: 1.1, wariness: 1.1 }
      father.traits = { ...father.traits, sprint: 1.3, longevity: 1.3, hardiness: 1.3, wariness: 1.3 }
      for (const parent of world.bots) {
        parent.energy = 90
        parent.age = 800
      }
      step(world, none)
      const child = world.bots[2]!
      for (const name of NEW) {
        expect([1.1, 1.3]).toContain(child.traits[name])
        seen[name]!.add(child.traits[name])
      }
    }
    // Over six births both parents' values got through for at least one trait.
    expect(NEW.some((name) => seen[name]!.size === 2)).toBe(true)

    // Out-of-range values (a mutation could push this far) are clamped at birth.
    const wild = withMutation({ strength: 0 })
    const world = createWorld('a', nursery, wild)
    for (const parent of world.bots) {
      parent.traits = { ...parent.traits, sprint: 9, hardiness: 9, wariness: -3 }
      parent.energy = 90
      parent.age = 800
    }
    step(world, wild)
    const { bounds } = wild.tuning.mutation
    expect(world.bots[2]!.traits).toMatchObject({ sprint: bounds.sprint.max, hardiness: bounds.hardiness.max, wariness: bounds.wariness.min })
  })

  describe('sprint', () => {
    function fleeStep(sprint: number): { moved: number; lostEnergy: number; kind: string } {
      const world = createWorld('s', arena, rules)
      world.nodes[0]!.hunt!.restUntil = 1e9 // a resting predator: seen and feared, never biting
      const bot = world.bots[0]!
      bot.traits.sprint = sprint
      bot.energy = 100
      const { x, y } = bot
      step(world, rules)
      return { moved: Math.hypot(bot.x - x, bot.y - y), lostEnergy: 100 - bot.energy, kind: bot.intent.kind }
    }

    it('speeds only a fleeing bot', () => {
      const normal = fleeStep(1)
      const fast = fleeStep(1.5)
      expect(normal.kind).toBe('flee')
      expect(fast.kind).toBe('flee')
      expect(normal.moved).toBeCloseTo(tuning.bot.speed, 9)
      expect(fast.moved).toBeCloseTo(tuning.bot.speed * 1.5, 9)

      // Walking about with nobody to flee from: the same step at any sprint.
      const wanderStep = (sprint: number): number => {
        const world = createWorld('s', lone, rules)
        const bot = world.bots[0]!
        bot.traits.sprint = sprint
        const { x, y } = bot
        step(world, rules)
        return Math.hypot(bot.x - x, bot.y - y)
      }
      expect(wanderStep(1.8)).toBe(wanderStep(1))
    })

    it('charges upkeep every tick, and a flee step costs moveDrain times sprint', () => {
      const { baseDrain, moveDrain, sprintUpkeep } = tuning.bot
      expect(sprintUpkeep).toBeGreaterThan(0)
      expect(lost({ sprint: 1.5 }) - lost({ sprint: 1 })).toBeCloseTo(sprintUpkeep * 0.5, 12)
      expect(lost({ sprint: 0.8 }) - lost({ sprint: 1 })).toBeCloseTo(-sprintUpkeep * 0.2, 12)
      const fled = fleeStep(1.5)
      expect(fled.lostEnergy).toBeCloseTo(baseDrain + sprintUpkeep * 0.5 + moveDrain * 1.5, 12)
    })
  })

  describe('longevity', () => {
    it('stretches every age threshold of the fertility curve', () => {
      const { adultAge } = tuning.bot
      const { primeAge, declineAge, fertileUntil, startFraction } = tuning.fertility
      expect(fertilityAt(adultAge, tuning, 1.2)).toBe(0)
      expect(fertilityAt(adultAge * 1.2, tuning, 1.2)).toBe(startFraction)
      expect(fertilityAt(primeAge * 1.2, tuning, 1.2)).toBe(1)
      expect(fertilityAt(declineAge * 1.2, tuning, 1.2)).toBe(1)
      expect(fertilityAt(fertileUntil, tuning, 1.2)).toBeGreaterThan(0)
      expect(fertilityAt(fertileUntil * 1.2, tuning, 1.2)).toBe(0)
      // A short-lived bot (0.8) is fertile earlier and stops earlier.
      expect(fertilityAt(adultAge * 0.8, tuning, 0.8)).toBe(startFraction)
      expect(fertilityAt(fertileUntil * 0.8, tuning, 0.8)).toBe(0)
      // The scale defaults to 1.
      expect(fertilityAt(900, tuning)).toBe(fertilityAt(900, tuning, 1))
    })

    it('gates breeding by the scaled curve and gives founders their lifespan', () => {
      const world = createWorld('a', nursery, rules)
      const bot = world.bots[0]!
      bot.energy = 100
      bot.cooldown = 0
      bot.traits.longevity = 1.2
      bot.age = tuning.bot.adultAge + 10 // adult for longevity 1, still a child at 1.2
      expect(meetsReproductionNeeds(bot, tuning)).toBe(false)
      bot.traits.longevity = 1
      expect(meetsReproductionNeeds(bot, tuning)).toBe(true)
      expect(world.bots.every((b) => b.lifespan === tuning.bot.maxAge)).toBe(true)
    })

    it('multiplies the energy drain by its price', () => {
      const { longevityDrain } = tuning.bot
      expect(lost({ longevity: 1.2 })).toBeCloseTo(lost({ longevity: 1 }) * (1 + longevityDrain * 0.2), 12)
    })
  })

  describe('hardiness', () => {
    const quiet = { damage: 0, plague: 0, predator: 0, predatorId: null, heal: 0, drainMult: 1, shelterId: null }

    it('divides danger, plague and predator damage', () => {
      const healthLost = (hardiness: number, over: Partial<typeof quiet>): number => {
        const world = createWorld('h', lone, rules)
        const bot = world.bots[0]!
        bot.health = 60
        bot.traits.hardiness = hardiness
        metabolise(bot, false, { ...quiet, ...over }, tuning)
        return 60 + tuning.bot.healthRegen - bot.health
      }
      for (const over of [{ damage: 3 }, { plague: 0.8 }, { predator: 35 }, { damage: 3, plague: 0.8, predator: 35 }]) {
        expect(healthLost(2, over)).toBeCloseTo(healthLost(1, over) / 2, 12)
        expect(healthLost(0.8, over)).toBeCloseTo(healthLost(1, over) / 0.8, 12)
      }
    })

    it('divides a meteor strike too', () => {
      const struck = (hardiness: number): number => {
        const world = createWorld('h', { ...lone, bots: [{ x: 20, y: 20 }] }, rules)
        world.bots[0]!.traits.hardiness = hardiness
        expect(applyCommand(world, rules, { type: 'triggerEvent', event: 'meteor', x: 24, y: 20 }).ok).toBe(true)
        return 100 - world.bots[0]!.health
      }
      expect(struck(1)).toBeCloseTo(tuning.events.meteor.damage * (1 - 4 / tuning.events.meteor.radius), 9)
      expect(struck(2)).toBeCloseTo(struck(1) / 2, 9)
    })

    it('multiplies the energy drain by its price', () => {
      const { hardinessDrain } = tuning.bot
      expect(hardinessDrain).toBeGreaterThan(0)
      expect(lost({ hardiness: 1.5 })).toBeCloseTo(lost({ hardiness: 1 }) * (1 + hardinessDrain * 0.5), 12)
    })
  })

  describe('wariness', () => {
    const sighting = (over: Partial<MemoryEntry> = {}): MemoryEntry => ({
      nodeId: 7,
      kind: 'predator',
      x: 10,
      y: 10,
      radius: rules.nodeDefs.predator.radius,
      seenTick: 0,
      amount: 0,
      learnedFrom: null,
      ...over,
    })

    it('widens the predator threat radius (a copy: memory is untouched) and not a crater', () => {
      const world = createWorld('w', lone, rules)
      const bot = world.bots[0]!
      bot.memory = [sighting(), sighting({ nodeId: 8, kind: 'danger', radius: 3 })]
      bot.traits.wariness = 1.5
      const [predator, crater] = knownDangers(bot) as [MemoryEntry, MemoryEntry]
      expect(predator.radius).toBe(rules.nodeDefs.predator.radius * 1.5)
      expect(crater.radius).toBe(3)
      expect(bot.memory[0]!.radius).toBe(rules.nodeDefs.predator.radius)
    })

    it('puts food that sits near a haunt off limits sooner', () => {
      const world = createWorld('w', lone, rules)
      const bot = world.bots[0]!
      bot.x = 10
      bot.y = 30
      // Food 5.5 cells from the predator's last seen spot: outside radius 4 + margin 0.75, inside 1.5 times the radius.
      const food: MemoryEntry = { nodeId: 9, kind: 'resource', x: 10, y: 15.5, radius: 2, seenTick: 0, amount: 100, learnedFrom: null }
      bot.memory = [sighting(), food]
      bot.traits.wariness = 1
      expect(chooseFood(world, bot, tuning, false)?.nodeId).toBe(9)
      bot.traits.wariness = 1.5
      expect(chooseFood(world, bot, tuning, false)).toBeNull()
    })

    it('keeps a predator sighting wariness times as long', () => {
      const world = createWorld('w', lone, rules)
      const bot = world.bots[0]!
      world.tick = tuning.predator.memoryTicks + 100
      const kept = (wariness: number): boolean => {
        bot.traits.wariness = wariness
        bot.memory = [sighting()]
        remember(world, bot, [], tuning, new Set([7]))
        return bot.memory.length === 1
      }
      expect(kept(1)).toBe(false)
      expect(kept(1.5)).toBe(true)
      expect(kept(0.5)).toBe(false)
    })
  })

  describe('selection', () => {
    // A stalking predator that never digests (digestTicks 1) in open ground, bots standing in a ring around it:
    // a bot that can match its speed lives, one that cannot is caught.
    const hunted: Rules = staticPredators({ ...rules, tuning: { ...tuning, predator: { ...tuning.predator, digestTicks: 1 }, mutation: { ...tuning.mutation, strength: 0 } } })
    const field: Preset = {
      id: 'field',
      label: 'One hunter, a ring of bots',
      width: 120,
      height: 120,
      nodes: [{ kind: 'predator', x: 60, y: 60 }],
      scatter: [],
      bots: Array.from({ length: 24 }, (_, i) => ({ x: 60 + 7 * Math.cos((i * 2 * Math.PI) / 24), y: 60 + 7 * Math.sin((i * 2 * Math.PI) / 24) })),
      scatterBots: 0,
    }

    it('lets a sprinting bot (1.5) outlive a slow one (0.9) when a predator is hunting', () => {
      let fast = 0
      let slow = 0
      for (const seed of ['a', 'b', 'c', 'd']) {
        const world = createWorld(seed, field, hunted)
        world.bots.forEach((bot, i) => {
          bot.traits.sprint = i % 2 === 0 ? 1.5 : 0.9
          bot.energy = 100
        })
        for (let i = 0; i < 60; i += 1) step(world, hunted)
        fast += world.bots.filter((bot) => bot.traits.sprint === 1.5).length
        slow += world.bots.filter((bot) => bot.traits.sprint === 0.9).length
      }
      expect(fast).toBeGreaterThan(slow)
    })

    it('lets a plain bot (1.0) beat a sprinter (1.8) when there is no predator', () => {
      const noMutation = withMutation({ strength: 0 })
      const calm: Preset = { ...edenPreset, nodes: edenPreset.nodes.filter((node) => node.kind !== 'predator') }
      let plain = 0
      let sprinter = 0
      for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
        const world = createWorld(seed, calm, noMutation)
        world.bots.forEach((bot, index) => {
          bot.traits.sprint = Math.floor(index / 2) % 2 === 0 ? 1 : 1.8
        })
        for (let i = 0; i < 4000; i += 1) step(world, noMutation)
        plain += world.bots.filter((bot) => bot.traits.sprint === 1).length
        sprinter += world.bots.filter((bot) => bot.traits.sprint === 1.8).length
      }
      expect(plain).toBeGreaterThan(sprinter)
    })
  })
})
