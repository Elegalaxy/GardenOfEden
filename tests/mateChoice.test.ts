import { describe, expect, it } from 'vitest'

import { edenPreset, rules as shippedRules } from '../src/content/index.ts'
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
const PRE_G1_HASH_A_5000 = 'cd4e9e5c7ac79f8f'
/** Eden seed b at 20,000 ticks, same origin. */
const PRE_G1_HASH_B_20000 = 'f49fe34b3f6a615f'
const PRE_G1_RNG_A_5000 = {
  world: { a: 4041835896, b: 1899320074, c: 4088289150, d: 3567969942 },
  ai: { a: 2926588574, b: 3513409781, c: 3424040611, d: 2412768845 },
  birth: { a: 718180524, b: 1865918892, c: 3554419986, d: 1463748394 },
  gene: { a: 35390755, b: 4240459312, c: 348044899, d: 3659276840 },
  predator: { a: 77205907, b: 4049053377, c: 2398440535, d: 1357584770 },
}
const PRE_G1_RNG_B_20000 = {
  world: { a: 1846205129, b: 4169043728, c: 2857540989, d: 3500638510 },
  ai: { a: 2047296717, b: 4185308583, c: 3584611433, d: 1384268924 },
  birth: { a: 3220379027, b: 3263758896, c: 1101571585, d: 3188241382 },
  gene: { a: 4083626834, b: 718183317, c: 337725763, d: 4005967769 },
  predator: { a: 2235276326, b: 1873852087, c: 3347887013, d: 2899231927 },
}

// The unit tests start from the rules with mate choice off (on in Eden since G2) and switch it on where they test it.
const rules = noMateChoice(shippedRules)
const on = withMateChoice(rules, { avoidAt: 0.5, lastResort: true }) // the G1 defaults; G2 ships lastResort false
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

describe('switched on in Eden (G2)', () => {
  it('ships on with avoidAt 0.5 and no last resort, and Eden as shipped differs from noMateChoice', () => {
    expect(shippedRules.tuning.mateChoice).toEqual({ enabled: true, avoidAt: 0.5, lastResort: false })
    const shipped = createWorld('a', edenPreset, shippedRules)
    const off = createWorld('a', edenPreset, noMateChoice(shippedRules))
    while (shipped.tick < 3000) step(shipped, shippedRules)
    while (off.tick < 3000) step(off, noMateChoice(shippedRules))
    expect(stateHash(shipped)).not.toBe(stateHash(off))
    expect(shipped.totalBirths).toBeGreaterThan(50)
    expect(shipped.inbredBirths).toBe(0)
    expect(off.inbredBirths).toBeGreaterThan(0)
  }, 60_000)
})
