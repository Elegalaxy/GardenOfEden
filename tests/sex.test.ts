import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { applyCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { fertilityAt } from '../src/sim/reproduction.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { step } from '../src/sim/step.ts'
import type { Bot, Preset, Rules, Sex, World } from '../src/sim/types.ts'
import { autoSex, createWorld } from '../src/sim/world.ts'
import { stage1 } from './variants.ts'

// Two sexes (M17): founders alternate, children get a sex, and a birth needs a ready female and a ready
// male in shelters within mateRange. The one-tick scenes use rules with speed 0, so nobody walks and
// the distances in the scene are the distances at the pairing.

const { tuning } = rules

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', width: 40, height: 40, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

const shelterAt20 = { kind: 'shelter', x: 20, y: 20 } as const

/** Rules where bots stand still, with optional changes to the sex block and the population cap. */
function still(sex: Partial<Rules['tuning']['sex']> = {}, cap = tuning.population.cap): Rules {
  return {
    ...rules,
    tuning: {
      ...tuning,
      bot: { ...tuning.bot, speed: 0 },
      population: { ...tuning.population, cap },
      mutation: { ...tuning.mutation, strength: 0 },
      sex: { ...tuning.sex, ...sex },
    },
  }
}

/** A world with bots at the given spots and sexes, all fed, adult and ready. */
function pairScene(r: Rules, spots: { x: number; y: number; sex: Sex; energy?: number }[]): World {
  const world = createWorld('a', scene({ nodes: [shelterAt20], bots: spots.map(({ x, y }) => ({ x, y })) }), r)
  world.bots.forEach((bot, index) => {
    const spot = spots[index]!
    bot.sex = spot.sex
    bot.energy = spot.energy ?? 90
    bot.age = tuning.bot.adultAge + 100
    bot.cooldown = 0
  })
  return world
}

function births(world: World): Bot[] {
  return world.bots.filter((bot) => bot.parentId !== null)
}

describe('founders and sex of newborns', () => {
  it('starts the eden preset with 20 females and 20 males, alternating by id', () => {
    const world = createWorld('a', edenPreset, rules)
    expect(world.bots).toHaveLength(40)
    expect(world.bots.filter((bot) => bot.sex === 'female')).toHaveLength(20)
    world.bots.forEach((bot, index) => expect(bot.sex).toBe(index % 2 === 0 ? 'female' : 'male'))
    expect(world.lineage.map((record) => record.sex)).toEqual(world.bots.map((bot) => bot.sex))
  })

  it('gives newborns both sexes in about equal numbers', () => {
    const world = createWorld('a', edenPreset, rules)
    for (let i = 0; i < 5000; i += 1) step(world, rules)
    const born = world.lineage.filter((record) => record.born > 0)
    expect(born.length).toBeGreaterThan(200)
    const females = born.filter((record) => record.sex === 'female').length / born.length
    expect(females).toBeGreaterThan(0.4)
    expect(females).toBeLessThan(0.6)
  })

  it('autoSex picks the rarer sex, female on a tie', () => {
    expect(autoSex([])).toBe('female')
    expect(autoSex([{ sex: 'female' }])).toBe('male')
    expect(autoSex([{ sex: 'female' }, { sex: 'male' }])).toBe('female')
    expect(autoSex([{ sex: 'male' }, { sex: 'male' }, { sex: 'female' }])).toBe('female')
  })

  it('makes placed bots alternate female, male, female, male', () => {
    const world = createWorld('a', scene({}), rules)
    for (let i = 0; i < 4; i += 1) expect(applyCommand(world, rules, { type: 'placeBot', x: 5 + i, y: 5 }).ok).toBe(true)
    expect(world.bots.map((bot) => bot.sex)).toEqual(['female', 'male', 'female', 'male'])
    expect(world.lineage.map((record) => record.sex)).toEqual(['female', 'male', 'female', 'male'])
  })
})

describe('pairing', () => {
  it('never births from a lone female or a lone male in a shelter', () => {
    for (const sex of ['female', 'male'] as const) {
      const r = still()
      const world = pairScene(r, [{ x: 20, y: 20, sex }])
      for (let i = 0; i < 60; i += 1) {
        world.bots[0]!.energy = 100
        world.bots[0]!.cooldown = 0
        step(world, r)
      }
      expect(world.totalBirths).toBe(0)
    }
  })

  it('never births from two females or two males', () => {
    for (const sex of ['female', 'male'] as const) {
      const r = still()
      const world = pairScene(r, [{ x: 19, y: 20, sex }, { x: 21, y: 20, sex }])
      step(world, r)
      expect(world.totalBirths).toBe(0)
    }
  })

  it('gives a female and a male in a shelter one child, with the formulas for energy and cooldown', () => {
    const r = still()
    const world = pairScene(r, [{ x: 19, y: 20, sex: 'female' }, { x: 21, y: 20, sex: 'male' }])
    const [mother, father] = world.bots as [Bot, Bot]
    step(world, r)
    expect(world.totalBirths).toBe(1)
    const child = births(world)[0]!
    expect(child).toMatchObject({ parentId: mother.id, fatherId: father.id, generation: 1, age: 0 })
    expect(world.log.some((event) => event.type === 'birth' && event.botId === child.id)).toBe(true)
    // Both parents lost the same drain in the tick, so they had the same energy when they paired.
    const before = child.energy / tuning.bot.childEnergyShare
    expect(mother.energy).toBeCloseTo(before - child.energy - tuning.bot.birthCost, 9)
    expect(father.energy).toBeCloseTo(before - tuning.sex.maleCost, 9)
    expect(mother.cooldown).toBe(Math.ceil(tuning.bot.reproCooldown / fertilityAt(mother.age, tuning)))
    expect(father.cooldown).toBe(Math.ceil(tuning.sex.maleCooldown / fertilityAt(father.age, tuning)))
    // Both parents' lineage records count the child.
    expect(world.lineage.find((record) => record.id === mother.id)?.children).toBe(1)
    expect(world.lineage.find((record) => record.id === father.id)?.children).toBe(1)
    expect(world.lineage.find((record) => record.id === child.id)).toMatchObject({ parentId: mother.id, fatherId: father.id, sex: child.sex })
  })

  it('lets only the nearer female breed when two females share one male', () => {
    const r = still()
    const world = pairScene(r, [
      { x: 18, y: 20, sex: 'female' },
      { x: 21, y: 20, sex: 'female' },
      { x: 22, y: 20, sex: 'male' },
    ])
    step(world, r)
    expect(world.totalBirths).toBe(1)
    expect(births(world)[0]).toMatchObject({ parentId: world.bots[1]!.id, fatherId: world.bots[2]!.id })
  })

  it('breaks a distance tie in favour of the lower id', () => {
    const r = still()
    const world = pairScene(r, [
      { x: 19, y: 20, sex: 'female' },
      { x: 21, y: 20, sex: 'female' },
      { x: 20, y: 20, sex: 'male' },
    ])
    step(world, r)
    expect(births(world)[0]?.parentId).toBe(world.bots[0]!.id)
  })

  it('takes the nearer male for one female', () => {
    const r = still()
    const world = pairScene(r, [
      { x: 19, y: 20, sex: 'male' },
      { x: 22, y: 20, sex: 'male' },
      { x: 21, y: 20, sex: 'female' },
    ])
    step(world, r)
    expect(births(world)[0]?.fatherId).toBe(world.bots[1]!.id)
  })

  it('needs the male inside mateRange and above his threshold', () => {
    const far = still({ mateRange: 1 })
    const apart = pairScene(far, [{ x: 18, y: 20, sex: 'female' }, { x: 22, y: 20, sex: 'male' }])
    step(apart, far)
    expect(apart.totalBirths).toBe(0)

    const r = still()
    const weak = pairScene(r, [{ x: 18, y: 20, sex: 'female' }, { x: 22, y: 20, sex: 'male', energy: 50 }])
    step(weak, r)
    expect(weak.totalBirths).toBe(0)

    const unfed = pairScene(r, [{ x: 18, y: 20, sex: 'female', energy: 50 }, { x: 22, y: 20, sex: 'male' }])
    step(unfed, r)
    expect(unfed.totalBirths).toBe(0)
  })

  it('needs both parents in a shelter', () => {
    const r = still()
    const world = pairScene(r, [{ x: 19, y: 20, sex: 'female' }, { x: 21, y: 20, sex: 'male' }])
    world.nodes = []
    step(world, r)
    expect(world.totalBirths).toBe(0)
  })

  it('stops at the population cap, leaving the other pair unpaired', () => {
    const r = still({}, 5)
    const world = pairScene(r, [
      { x: 18, y: 20, sex: 'female' },
      { x: 19, y: 20, sex: 'male' },
      { x: 21, y: 20, sex: 'female' },
      { x: 22, y: 20, sex: 'male' },
    ])
    step(world, r)
    expect(world.bots).toHaveLength(5)
    expect(world.totalBirths).toBe(1)
    step(world, r)
    expect(world.bots.length).toBeLessThanOrEqual(5)
  })

  it('gives each child, with mutation off, each trait of its mother or its father', () => {
    const r = still()
    const seen = new Set<string>()
    for (let n = 0; n < 12; n += 1) {
      const world = createWorld(`t${n}`, scene({ nodes: [shelterAt20], bots: [{ x: 19, y: 20 }, { x: 21, y: 20 }] }), r)
      world.bots.forEach((bot) => {
        bot.energy = 90
        bot.age = tuning.bot.adultAge + 100
      })
      const [mother, father] = world.bots as [Bot, Bot]
      mother.traits = { senseRadius: 5, caution: 0.2, reproThreshold: 60, metabolism: 0.8 }
      father.traits = { senseRadius: 7, caution: 0.8, reproThreshold: 70, metabolism: 1.2 }
      step(world, r)
      const child = births(world)[0]!
      for (const name of ['senseRadius', 'caution', 'reproThreshold', 'metabolism'] as const) {
        expect([mother.traits[name], father.traits[name]]).toContain(child.traits[name])
        seen.add(`${name}:${child.traits[name] === mother.traits[name] ? 'm' : 'f'}`)
      }
    }
    // Over twelve births every trait came from both sides at least once.
    expect(seen.size).toBe(8)
  })

  it('stays deterministic: a run with placed bots replays to the same hash', () => {
    const live = createWorld('a', edenPreset, rules)
    const script = [
      { tick: 300, x: 30, y: 20 },
      { tick: 600, x: 60, y: 40 },
      { tick: 900, x: 10, y: 50 },
    ]
    for (const { tick, x, y } of script) {
      while (live.tick < tick) step(live, rules)
      expect(applyCommand(live, rules, { type: 'placeBot', x, y }).ok).toBe(true)
    }
    while (live.tick < 2000) step(live, rules)
    expect(live.totalBirths).toBeGreaterThan(5)
    expect(stateHash(replayWorld('a', edenPreset, rules, live.commands, live.tick))).toBe(stateHash(live))
  })
})

describe('finding a mate', () => {
  /** A female waiting in a shelter and a male at the given spot, both ready; bots may walk (default speed). */
  function seekScene(maleX: number, maleY: number, senseRadius = 6): World {
    const world = createWorld('a', scene({ nodes: [shelterAt20], bots: [{ x: 20, y: 20 }, { x: maleX, y: maleY }] }), rules)
    world.bots.forEach((bot) => {
      bot.energy = 90
      bot.age = tuning.bot.adultAge + 100
      bot.traits.senseRadius = senseRadius
    })
    world.bots[1]!.sex = 'male'
    return world
  }

  it('lets a ready male sense a ready female within his sense radius and walk toward her', () => {
    const world = seekScene(25, 20)
    const male = world.bots[1]!
    const before = Math.abs(male.x - 20)
    step(world, rules)
    expect(male.intent).toEqual({ kind: 'seekMate', targetId: world.bots[0]!.id })
    expect(Math.abs(male.x - 20)).toBeLessThan(before)
  })

  it('does not see a female beyond his sense radius, and a female never seeks', () => {
    const far = seekScene(30, 20)
    step(far, rules)
    expect(far.bots[1]!.intent.kind).not.toBe('seekMate')
    const near = seekScene(24, 20)
    near.bots[0]!.sex = 'male'
    near.bots[1]!.sex = 'female'
    step(near, rules)
    expect(near.bots[1]!.intent.kind).not.toBe('seekMate') // the female
    expect(near.bots[0]!.intent.kind).toBe('seekMate') // the male now at the shelter walks to her
  })

  it('does not seek a female that is not ready, or when the male is not ready himself', () => {
    const unready = seekScene(24, 20)
    unready.bots[0]!.cooldown = 50
    step(unready, rules)
    expect(unready.bots[1]!.intent.kind).not.toBe('seekMate')
    const tired = seekScene(24, 20)
    tired.bots[1]!.energy = 50
    step(tired, rules)
    expect(tired.bots[1]!.intent.kind).not.toBe('seekMate')
  })

  it('brings a male from outside the shelter to the female, and they pair within a few ticks', () => {
    const world = seekScene(25, 20)
    for (let i = 0; i < 12 && world.totalBirths === 0; i += 1) {
      for (const bot of world.bots) bot.energy = Math.max(bot.energy, 90)
      step(world, rules)
    }
    expect(world.totalBirths).toBe(1)
    expect(world.bots[2]).toMatchObject({ parentId: world.bots[0]!.id, fatherId: world.bots[1]!.id })
  })

  it('gives the same hash twice (the search draws nothing and visits bots in id order)', () => {
    const run = (): string => {
      const world = createWorld('a', edenPreset, rules)
      for (let i = 0; i < 1500; i += 1) step(world, rules)
      return stateHash(world)
    }
    expect(run()).toBe(run())
  })
})

describe('asexual control', () => {
  // Captured before any M17 edit (the Stage 1 tree): eden at 5,000 ticks. With sexes off and the pre-M17
  // numbers (`stage1`) the world must behave exactly as it did.
  const expected = {
    a: { births: 214, bots: 48, deaths: { starve: 184, thirst: 9, danger: 0, plague: 0, meteor: 0, age: 13 } },
    b: { births: 223, bots: 57, deaths: { starve: 186, thirst: 3, danger: 0, plague: 0, meteor: 0, age: 17 } },
  }

  it.each(['a', 'b'] as const)('reproduces the pre-M17 numbers on seed %s', { timeout: 60_000 }, (seed) => {
    const old = stage1(rules)
    const world = createWorld(seed, edenPreset, old)
    for (let i = 0; i < 5000; i += 1) step(world, old)
    expect(world.totalBirths).toBe(expected[seed].births)
    expect(world.bots).toHaveLength(expected[seed].bots)
    expect(world.deathsByCause).toEqual(expected[seed].deaths)
    expect(world.bots.every((bot) => bot.fatherId === null)).toBe(true)
  })
})
