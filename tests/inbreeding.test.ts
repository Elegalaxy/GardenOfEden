import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { stateHash } from '../src/sim/hash.ts'
import { addRecord, relatedness } from '../src/sim/lineage.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { step } from '../src/sim/step.ts'
import type { Bot, Preset, Rules, Sex, World } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'
import { stage1 } from './variants.ts'

// Inbreeding (M18): the score from lineage records (parent-child and full siblings 1, half siblings
// 0.5, everyone else 0), and what a child of close relatives gets (less health and energy, a shorter
// lifespan). One-tick scenes use rules with speed 0 so nobody walks.

const { tuning } = rules

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', width: 40, height: 40, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

/** Rules where bots stand still, mutation off, with a chosen inbreeding block. */
function still(inbreeding: Partial<Rules['tuning']['inbreeding']> = {}): Rules {
  return {
    ...rules,
    tuning: {
      ...tuning,
      bot: { ...tuning.bot, speed: 0 },
      mutation: { ...tuning.mutation, strength: 0 },
      inbreeding: { lifespanLoss: 0.2, energyLoss: 0.3, healthLoss: 0.2, ...inbreeding },
    },
  }
}

const traits = tuning.traits

/** A world with only hand-made lineage records: add(id, mother, father, sex). */
function lineageWorld(records: [number, number | null, number | null, Sex][]): World {
  const world = createWorld('t', scene({}), rules)
  for (const [id, mother, father, sex] of records) addRecord(world, id, mother, father, sex, 0, traits)
  return world
}

describe('relatedness', () => {
  // 1 and 2 are founders; 3 and 4 are their children; 5 is a child of 1 and a stranger 6; 7 is a founder.
  const world = lineageWorld([
    [1, null, null, 'female'],
    [2, null, null, 'male'],
    [3, 1, 2, 'female'],
    [4, 1, 2, 'male'],
    [6, null, null, 'male'],
    [5, 1, 6, 'female'],
    [7, null, null, 'male'],
  ])

  it('scores parent and child 1, in both directions', () => {
    expect(relatedness(world, 1, 4)).toBe(1) // mother and son
    expect(relatedness(world, 3, 2)).toBe(1) // daughter and father
  })

  it('scores full siblings 1', () => {
    expect(relatedness(world, 3, 4)).toBe(1)
  })

  it('scores half siblings 0.5, whether they share the mother or the father', () => {
    expect(relatedness(world, 5, 4)).toBe(0.5) // share mother 1
    const other = lineageWorld([
      [1, null, null, 'female'],
      [2, null, null, 'male'],
      [8, null, null, 'female'],
      [3, 1, 2, 'female'],
      [9, 8, 2, 'male'],
    ])
    expect(relatedness(other, 3, 9)).toBe(0.5) // share father 2
  })

  it('scores strangers and founders 0, and a null parent never matches another null', () => {
    expect(relatedness(world, 1, 2)).toBe(0)
    expect(relatedness(world, 1, 7)).toBe(0)
    expect(relatedness(world, 5, 7)).toBe(0)
  })

  it('scores cousins 0 (only the parents are compared)', () => {
    const cousins = lineageWorld([
      [1, null, null, 'female'],
      [2, null, null, 'male'],
      [3, 1, 2, 'female'],
      [4, 1, 2, 'male'],
      [5, null, null, 'male'],
      [6, null, null, 'female'],
      [7, 3, 5, 'female'], // child of 3
      [8, 6, 4, 'male'], // child of 4: 7 and 8 are cousins
    ])
    expect(relatedness(cousins, 7, 8)).toBe(0)
  })

  it('counts a missing ancestor as unrelated, but still sees the ids stored in the mates own records', () => {
    const pruned = lineageWorld([
      [3, 1, 2, 'female'], // records 1 and 2 are not kept
      [4, 1, 2, 'male'],
      [5, 1, 9, 'female'],
    ])
    expect(relatedness(pruned, 3, 4)).toBe(1) // same two parent ids
    expect(relatedness(pruned, 5, 4)).toBe(0.5)
    expect(relatedness(pruned, 3, 77)).toBe(0) // a mate with no record
  })
})

describe('the penalty at birth', () => {
  /** A ready female and male in a shelter; `related` makes the male the female's father. */
  function pair(r: Rules, related: boolean): World {
    const world = createWorld(
      'a',
      scene({ nodes: [{ kind: 'shelter', x: 20, y: 20 }], bots: [{ x: 19, y: 20 }, { x: 21, y: 20 }] }),
      r,
    )
    world.bots.forEach((bot, index) => {
      bot.sex = index === 0 ? 'female' : 'male'
      bot.energy = 90
      bot.age = tuning.bot.adultAge + 100
      bot.cooldown = 0
    })
    const [mother, father] = world.bots as [Bot, Bot]
    world.lineage[0]!.sex = 'female'
    world.lineage[1]!.sex = 'male'
    if (related) {
      mother.fatherId = father.id
      world.lineage[0]!.fatherId = father.id
    }
    return world
  }

  function onlyChild(world: World): Bot {
    const born = world.bots.filter((bot) => bot.age === 0)
    expect(born).toHaveLength(1)
    return born[0]!
  }

  it('leaves the child of strangers untouched', () => {
    const r = still()
    const world = pair(r, false)
    step(world, r)
    const child = onlyChild(world)
    expect(child).toMatchObject({ inbreeding: 0, lifespan: tuning.bot.maxAge, health: tuning.bot.maxHealth })
    expect(world.inbredBirths).toBe(0)
    expect(world.lineage.find((record) => record.id === child.id)?.inbreeding).toBe(0)
  })

  it('cuts health, energy and lifespan of a father-daughter child by the loss fractions', () => {
    const r = still()
    const control = pair(r, false)
    step(control, r)
    const world = pair(r, true)
    step(world, r)
    const child = onlyChild(world)
    expect(child.inbreeding).toBe(1)
    expect(child.lifespan).toBe(Math.round(tuning.bot.maxAge * (1 - 0.2)))
    expect(child.health).toBeCloseTo(tuning.bot.maxHealth * (1 - 0.2), 9)
    expect(child.energy).toBeCloseTo(onlyChild(control).energy * (1 - 0.3), 9)
    expect(world.inbredBirths).toBe(1)
    expect(world.lineage.find((record) => record.id === child.id)?.inbreeding).toBe(1)
  })

  it('scales the cut by the score (half siblings: half the cut)', () => {
    const r = still()
    const world = pair(r, false)
    const [mother, father] = world.bots as [Bot, Bot]
    // Same mother id (the record's parentId), different fathers: half siblings.
    mother.parentId = 500
    father.parentId = 500
    world.lineage[0]!.parentId = 500
    world.lineage[1]!.parentId = 500
    step(world, r)
    const child = onlyChild(world)
    expect(child.inbreeding).toBe(0.5)
    expect(child.lifespan).toBe(Math.round(tuning.bot.maxAge * (1 - 0.1)))
    expect(child.health).toBeCloseTo(tuning.bot.maxHealth * (1 - 0.1), 9)
  })

  it('applies no cut when every loss is 0', () => {
    const r = still({ lifespanLoss: 0, energyLoss: 0, healthLoss: 0 })
    const world = pair(r, true)
    step(world, r)
    const child = onlyChild(world)
    expect(child).toMatchObject({ inbreeding: 1, lifespan: tuning.bot.maxAge, health: tuning.bot.maxHealth })
  })
})

describe('lifespan', () => {
  it('ends a bot at its own lifespan, not at maxAge', () => {
    const r = still()
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }] }), r)
    const bot = world.bots[0]!
    bot.energy = 100
    bot.lifespan = 500
    bot.age = 499
    step(world, r)
    expect(world.bots).toHaveLength(0)
    expect(world.deathsByCause.age).toBe(1)
  })

  it('gives every bot a lifespan of maxAge when the penalty never applies (founders, placed bots)', () => {
    const world = createWorld('a', edenPreset, rules)
    expect(world.bots.every((bot) => bot.lifespan === tuning.bot.maxAge && bot.inbreeding === 0)).toBe(true)
  })
})

describe('whole runs', () => {
  it('sees some inbred births on eden, and replays to the same hash', () => {
    const live = createWorld('a', edenPreset, rules)
    for (let i = 0; i < 3000; i += 1) step(live, rules)
    expect(live.inbredBirths).toBeGreaterThan(0)
    expect(live.inbredBirths).toBeLessThan(live.totalBirths)
    for (const bot of live.bots) {
      const record = live.lineage.find((r) => r.id === bot.id)
      expect(record?.inbreeding).toBe(bot.inbreeding)
      expect(bot.lifespan).toBe(Math.round(tuning.bot.maxAge * (1 - tuning.inbreeding.lifespanLoss * bot.inbreeding)))
    }
    expect(stateHash(replayWorld('a', edenPreset, rules, live.commands, live.tick))).toBe(stateHash(live))
  })

  it('has no inbreeding at all with sexes off (no fathers)', () => {
    const asexual: Rules = { ...rules, tuning: { ...tuning, sex: { ...tuning.sex, enabled: false } } }
    const world = createWorld('a', edenPreset, asexual)
    for (let i = 0; i < 3000; i += 1) step(world, asexual)
    expect(world.totalBirths).toBeGreaterThan(50)
    expect(world.inbredBirths).toBe(0)
    expect(world.bots.every((bot) => bot.inbreeding === 0 && bot.lifespan === tuning.bot.maxAge)).toBe(true)
  })

  it('matches the stage-1 control rules when the penalty is off (same run as the sexes-off build)', () => {
    // stage1 is the asexual, pre-M17 rules; the penalty must not touch it.
    const a = createWorld('a', edenPreset, stage1(rules))
    for (let i = 0; i < 1000; i += 1) step(a, stage1(rules))
    expect(a.inbredBirths).toBe(0)
  })
})
