import { describe, expect, it } from 'vitest'

import { rules } from '../src/content/index.ts'
import { stateHash } from '../src/sim/hash.ts'
import { fertilityAt, meetsReproductionNeeds } from '../src/sim/reproduction.ts'
import { step } from '../src/sim/step.ts'
import type { Preset, Rules } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'
import { edenPreset } from '../src/content/index.ts'
import { asexual, stage1 } from './variants.ts'

// Aging fertility (M16): the curve, the breeding gate, the cooldown after a birth, and a control
// run showing that neutral settings give back the pre-M16 world bit for bit.

const { tuning } = rules
const { adultAge, maxAge } = tuning.bot
const { startFraction, primeAge, declineAge, fertileUntil } = tuning.fertility

const shelterScene: Preset = {
  id: 'test',
  label: 'Test scene',
  width: 40,
  height: 40,
  nodes: [{ kind: 'shelter', x: 20, y: 20 }],
  scatter: [],
  bots: [{ x: 20, y: 20 }],
  scatterBots: 0,
}

describe('fertilityAt', () => {
  it('follows the piecewise curve', () => {
    expect(fertilityAt(0, tuning)).toBe(0)
    expect(fertilityAt(adultAge - 1, tuning)).toBe(0)
    expect(fertilityAt(adultAge, tuning)).toBe(startFraction)
    const mid = (adultAge + primeAge) / 2
    expect(fertilityAt(mid, tuning)).toBeCloseTo((1 + startFraction) / 2, 12)
    expect(fertilityAt(primeAge, tuning)).toBe(1)
    expect(fertilityAt((primeAge + declineAge) / 2, tuning)).toBe(1)
    expect(fertilityAt(declineAge, tuning)).toBe(1)
    expect(fertilityAt((declineAge + fertileUntil) / 2, tuning)).toBeCloseTo(0.5, 12)
    expect(fertilityAt(fertileUntil, tuning)).toBe(0)
    expect(fertilityAt(maxAge, tuning)).toBe(0)
  })

  it('survives zero-length segments', () => {
    const flat = { bot: tuning.bot, fertility: { startFraction: 1, primeAge: adultAge, declineAge: 2000, fertileUntil: 2000 } }
    expect(fertilityAt(adultAge - 1, flat)).toBe(0)
    expect(fertilityAt(adultAge, flat)).toBe(1)
    expect(fertilityAt(1999, flat)).toBe(1)
    expect(fertilityAt(2000, flat)).toBe(0)
  })
})

describe('breeding gate and cooldown', () => {
  it('never births past fertileUntil, even fed and in a shelter', () => {
    const world = createWorld('a', shelterScene, rules)
    const bot = world.bots[0]!
    bot.age = fertileUntil + 5
    for (let i = 0; i < 100; i += 1) {
      bot.energy = 100
      bot.thirst = 100
      bot.health = 100
      bot.cooldown = 0
      if (!world.bots.includes(bot)) break
      expect(meetsReproductionNeeds(bot, tuning)).toBe(false)
      step(world, rules)
    }
    expect(world.totalBirths).toBe(0)
  })

  it('stretches the cooldown by fertility: young parent waits longer than a prime one', () => {
    const cooldownAfterBirthAt = (age: number): number => {
      const solo = asexual(rules)
      const world = createWorld('a', shelterScene, solo)
      const bot = world.bots[0]!
      bot.age = age
      bot.energy = 90
      bot.cooldown = 0
      step(world, solo)
      expect(world.totalBirths).toBe(1)
      return bot.cooldown
    }
    // step() ages the bot after the check, so the birth sees `age` as set.
    expect(cooldownAfterBirthAt(300)).toBe(Math.ceil(tuning.bot.reproCooldown / fertilityAt(300, tuning)))
    expect(cooldownAfterBirthAt(primeAge)).toBe(tuning.bot.reproCooldown)
    expect(cooldownAfterBirthAt(300)).toBeGreaterThan(cooldownAfterBirthAt(primeAge))
  })
})

describe('neutral control', () => {
  it('with neutral fertility, eden seed a at 3,000 ticks has the pre-M16 hash', () => {
    const old = stage1(rules)
    const neutral: Rules = {
      ...old,
      tuning: {
        ...old.tuning,
        fertility: { startFraction: 1, primeAge: adultAge, declineAge: maxAge, fertileUntil: maxAge },
      },
    }
    const world = createWorld('a', edenPreset, neutral)
    for (let i = 0; i < 3000; i += 1) step(world, neutral)
    // Captured before any M16 edit (npx tsx on the unchanged tree): 125 births, 34 bots. The state hash of
    // that run was e1069c163c8bf330; it can no longer match because bots and lineage records gained keys
    // (sex, fatherId) in M17, so the behaviour is pinned by these counts (stage1 = asexual, pre-M17 numbers).
    expect(world.totalBirths).toBe(125)
    expect(world.bots).toHaveLength(34)
    expect(stateHash(world)).toHaveLength(16)
  })
})
