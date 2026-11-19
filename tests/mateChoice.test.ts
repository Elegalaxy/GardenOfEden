import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { stateHash } from '../src/sim/hash.ts'
import { avoidsKin, checkMateChoice, kinship } from '../src/sim/kin.ts'
import { relatedness } from '../src/sim/lineage.ts'
import { buildMateIndex, nearestMate } from '../src/sim/mating.ts'
import { pairMates } from '../src/sim/reproduction.ts'
import { step } from '../src/sim/step.ts'
import type { Bot, Rules, Sex } from '../src/sim/types.ts'
import { createWorld, makeBot } from '../src/sim/world.ts'
import { noMateChoice, withMateChoice } from './variants.ts'

// Mate choice (G1): kin scoring, the male's search, the pairing order, and the zero-change guarantee while
// it is off. These need the real rules, so they live here.

/** Eden seed a at 5,000 ticks, taken from main before any G1 change (mate choice is off, so it must not move). */
const PRE_G1_HASH_A_5000 = 'bf108e00ab1fdc98'
/** Eden seed b at 20,000 ticks, same origin. */
const PRE_G1_HASH_B_20000 = '34829c673e410693'
const PRE_G1_RNG_A_5000 = {
  world: { a: 3688263227, b: 3154447763, c: 1166763587, d: 3567969820 },
  ai: { a: 2744722571, b: 210680577, c: 2613904024, d: 2412749370 },
  birth: { a: 1975823846, b: 2078956634, c: 1864447484, d: 1463747106 },
  gene: { a: 462374627, b: 1990044236, c: 1759150371, d: 3659276748 },
  predator: { a: 2965271616, b: 3807059815, c: 2377451616, d: 1357575811 },
}
const PRE_G1_RNG_B_20000 = {
  world: { a: 2108544604, b: 724006586, c: 3541576535, d: 3500638388 },
  ai: { a: 1617823784, b: 3861126275, c: 1492951682, d: 1383984856 },
  birth: { a: 1253031795, b: 2514815994, c: 3402312044, d: 3188214866 },
  gene: { a: 3196473882, b: 199176989, c: 758345062, d: 4005965875 },
  predator: { a: 1831911369, b: 62834866, c: 4158602971, d: 2899175820 },
}

const on = withMateChoice(rules)
const onStrict = withMateChoice(rules, { lastResort: false })

/** A ready bot (fed, grown, off cooldown) with chosen id, sex, parents and place. */
function ready(id: number, sex: Sex, x: number, mother: number | null = null, father: number | null = null): Bot {
  const bot = makeBot(id, x, 10, 0, rules, sex)
  bot.parentId = mother
  bot.fatherId = father
  bot.energy = 100
  bot.age = rules.tuning.fertility.primeAge
  return bot
}

describe('kinship', () => {
  const dummy = (id: number, mother: number | null, father: number | null) => ({ id, parentId: mother, fatherId: father })

  it('scores parent and child, siblings and strangers', () => {
    expect(kinship(dummy(5, 1, 2), dummy(1, null, null))).toBe(1) // child and mother
    expect(kinship(dummy(2, null, null), dummy(5, 1, 2))).toBe(1) // father and child
    expect(kinship(dummy(5, 1, 2), dummy(6, 1, 2))).toBe(1) // full siblings
    expect(kinship(dummy(5, 1, 2), dummy(6, 1, 3))).toBe(0.5) // half siblings, same mother
    expect(kinship(dummy(5, 1, 2), dummy(6, 4, 2))).toBe(0.5) // half siblings, same father
    expect(kinship(dummy(5, 1, 2), dummy(6, 3, 4))).toBe(0)
    expect(kinship(dummy(1, null, null), dummy(2, null, null))).toBe(0) // founders
    expect(kinship(dummy(7, null, null), dummy(8, null, null))).toBe(0) // placed bots: null parents match nothing
  })

  it('avoidsKin respects the switch and avoidAt', () => {
    const a = dummy(5, 1, 2)
    const half = dummy(6, 1, 3)
    expect(avoidsKin(a, half, rules.tuning)).toBe(false)
    expect(avoidsKin(a, half, on.tuning)).toBe(true)
    expect(avoidsKin(a, half, withMateChoice(rules, { avoidAt: 1 }).tuning)).toBe(false)
  })

  it('equals lineage relatedness for every pair of living bots in Eden seed a at 5,000 ticks', () => {
    const world = createWorld('a', edenPreset, rules)
    while (world.tick < 5000) step(world, rules)
    expect(world.bots.length).toBeGreaterThan(20)
    for (const a of world.bots) {
      for (const b of world.bots) {
        if (a.id === b.id) continue
        expect(kinship(a, b)).toBe(relatedness(world, a.id, b.id))
      }
    }
  })
})

describe('nearestMate', () => {
  const male = ready(10, 'male', 10, 1, 2)
  const sister = ready(11, 'female', 11, 1, 2)
  const stranger = ready(12, 'female', 14, 3, 4)

  it('with no choice takes the nearest female, kin or not', () => {
    const index = buildMateIndex([sister, stranger], rules.tuning)
    expect(nearestMate(index, male, 6, null)?.id).toBe(11)
    expect(nearestMate(index, male, 6)?.id).toBe(11)
  })

  it('skips a nearer sister for a farther stranger', () => {
    const index = buildMateIndex([sister, stranger], on.tuning)
    expect(nearestMate(index, male, 6, on.tuning.mateChoice)?.id).toBe(12)
  })

  it('falls back to the sister when she is the only one, and gives null without lastResort', () => {
    const index = buildMateIndex([sister], on.tuning)
    expect(nearestMate(index, male, 6, on.tuning.mateChoice)?.id).toBe(11)
    expect(nearestMate(index, male, 6, onStrict.tuning.mateChoice)).toBeNull()
  })

  it('ignores a stranger beyond the radius and still falls back to kin in range', () => {
    const far = ready(13, 'female', 30, 3, 4)
    const index = buildMateIndex([sister, far], on.tuning)
    expect(nearestMate(index, male, 6, on.tuning.mateChoice)?.id).toBe(11)
  })
})

describe('pairMates', () => {
  it('off: the nearest pair forms even when they are siblings', () => {
    const f = ready(1, 'female', 10, 8, 9)
    const brother = ready(2, 'male', 10.5, 8, 9)
    const stranger = ready(3, 'male', 12, 5, 6)
    const [c] = pairMates([f, brother, stranger], 5, rules.tuning)
    expect(c?.fatherId).toBe(2)
  })

  it('on: an unrelated pair ranks before a nearer kin pair', () => {
    const f = ready(1, 'female', 10, 8, 9)
    const brother = ready(2, 'male', 10.5, 8, 9)
    const stranger = ready(3, 'male', 12, 5, 6)
    const made = pairMates([f, brother, stranger], 5, on.tuning)
    expect(made).toHaveLength(1)
    expect(made[0]?.fatherId).toBe(3)
  })

  it('on: a kin pair forms only as a last resort, never without lastResort', () => {
    const lone = () => [ready(1, 'female', 10, 8, 9), ready(2, 'male', 10.5, 8, 9)]
    expect(pairMates(lone(), 5, on.tuning)).toHaveLength(1)
    expect(pairMates(lone(), 5, onStrict.tuning)).toHaveLength(0)
  })

  it('on: unrelated pairs take both bots before kin pairs can use them', () => {
    // Female 1 is the sister of male 2 and unrelated to male 3; female 4 is unrelated to male 2 (and nearer to 3).
    const f1 = ready(1, 'female', 10, 8, 9)
    const m2 = ready(2, 'male', 10.5, 8, 9)
    const m3 = ready(3, 'male', 13, 5, 6)
    const f4 = ready(4, 'female', 11, 6, 7)
    const made = pairMates([f1, m2, m3, f4], 5, on.tuning)
    const pairs = made.map((c) => `${c.parentId}-${c.fatherId}`).sort()
    expect(pairs).toEqual(['1-3', '4-2'])
  })
})

describe('checkMateChoice', () => {
  it('accepts the shipped numbers and refuses nonsense', () => {
    expect(() => checkMateChoice(rules.tuning.mateChoice)).not.toThrow()
    const base = rules.tuning.mateChoice
    expect(() => checkMateChoice({ ...base, avoidAt: 0 })).toThrow()
    expect(() => checkMateChoice({ ...base, avoidAt: 1.5 })).toThrow()
    expect(() => checkMateChoice({ ...base, avoidAt: Number.NaN })).toThrow()
    expect(() => checkMateChoice({ ...base, enabled: 1 as unknown as boolean })).toThrow()
    expect(() => checkMateChoice({ ...base, lastResort: 'yes' as unknown as boolean })).toThrow()
  })

  it('createWorld runs it even with the rule off', () => {
    const bad: Rules = { ...rules, tuning: { ...rules.tuning, mateChoice: { ...rules.tuning.mateChoice, avoidAt: 2 } } }
    expect(() => createWorld('a', edenPreset, bad)).toThrow()
  })
})

describe('over a run', () => {
  it('on with no last resort, no inbred birth happens', () => {
    const world = createWorld('a', edenPreset, onStrict)
    while (world.tick < 5000) step(world, onStrict)
    expect(world.totalBirths).toBeGreaterThan(50)
    expect(world.inbredBirths).toBe(0)
  })
})

describe('pins with mate choice off', () => {
  it('leaves the shipped Eden runs bit-identical', () => {
    expect(rules.tuning.mateChoice.enabled).toBe(false)
    const a = createWorld('a', edenPreset, rules)
    while (a.tick < 5000) step(a, rules)
    expect(stateHash(a)).toBe(PRE_G1_HASH_A_5000)
    expect(a.rng).toEqual(PRE_G1_RNG_A_5000)
    const off = noMateChoice(rules)
    const b = createWorld('b', edenPreset, off)
    while (b.tick < 20000) step(b, off)
    expect(stateHash(b)).toBe(PRE_G1_HASH_B_20000)
    expect(b.rng).toEqual(PRE_G1_RNG_B_20000)
  }, 120_000)
})
