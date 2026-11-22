import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { applyCommand } from '../src/sim/commands.ts'
import { sickDamage, spreadDisease, startOutbreak } from '../src/sim/disease.ts'
import { stateHash } from '../src/sim/hash.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { anchor, catchThreshold, checkResistance, inheritResist, sickDrainFor, sickLength } from '../src/sim/resistance.ts'
import { createRng, deriveStream, nextFloat } from '../src/sim/rng.ts'
import { step } from '../src/sim/step.ts'
import type { Command, Preset, Rules, World } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'
import { noDiseaseResistance, withDiseaseResistance } from './variants.ts'

// Heritable disease resistance (R1): mechanics, switched off in the shipped numbers. These need the real rules, so they live here.

/** Eden seed a at 5,000 ticks and seed b at 20,000, measured on main before any R1 change (no outbreak is ever started). */
const PIN_A_5000 = '731f770400f210aa'
const PIN_A_RNG = {
  world: { a: 3688263227, b: 3154447763, c: 1166763587, d: 3567969820 },
  ai: { a: 3770057721, b: 97827464, c: 51461658, d: 2412737640 },
  birth: { a: 380217656, b: 2732393019, c: 2193901339, d: 1463745650 },
  gene: { a: 3850647471, b: 3358185439, c: 2081543315, d: 3659276644 },
  predator: { a: 2349682960, b: 3235739550, c: 3616504036, d: 1357575783 },
}
const PIN_B_20000 = 'be462fac79aff2af'
const PIN_B_RNG = {
  world: { a: 2108544604, b: 724006586, c: 3541576535, d: 3500638388 },
  ai: { a: 1188429527, b: 703103133, c: 1122700521, d: 1383984525 },
  birth: { a: 125994490, b: 546493350, c: 1333955491, d: 3188211926 },
  gene: { a: 1092691059, b: 4225256307, c: 113804040, d: 4005965665 },
  predator: { a: 3978175041, b: 1841855835, c: 2416030862, d: 2899171380 },
}
/** Eden seed a: step to 400, outbreak at the first bot, step to 1,500; measured on main before any R1 change (resistance off). */
const PIN_OUTBREAK_1500 = '92439d0da054fb07'

const on = withDiseaseResistance(rules)
const t = on.tuning.resistance

function scene(over: Partial<Preset> = {}): Preset {
  return { id: 'test', label: 'Test scene', width: 60, height: 60, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

function world(active: Rules, spots: [number, number][], seed = 'a'): World {
  return createWorld(seed, scene({ bots: spots.map(([x, y]) => ({ x, y })) }), active)
}

const OUTBREAK = (x: number, y: number): Command => ({ type: 'triggerEvent', event: 'outbreak', x, y })

describe('pins with resistance on and no outbreak', () => {
  it('leaves Eden seed a at 5,000 ticks bit-identical', () => {
    const w = createWorld('a', edenPreset, on)
    while (w.tick < 5000) step(w, on)
    expect(stateHash(w)).toBe(PIN_A_5000)
    expect(w.rng).toEqual(PIN_A_RNG)
    expect(w.resistance).toBeUndefined()
    expect(w.bots.some((b) => 'resist' in b)).toBe(false)
  })

  it('leaves Eden seed b at 20,000 ticks bit-identical', { timeout: 600_000 }, () => {
    const w = createWorld('b', edenPreset, on)
    while (w.tick < 20000) step(w, on)
    expect(stateHash(w)).toBe(PIN_B_20000)
    expect(w.rng).toEqual(PIN_B_RNG)
  })

  it('ships off', () => {
    expect(rules.tuning.resistance.enabled).toBe(false)
  })
})

describe('an outbreak with resistance off', () => {
  it('hashes as it did on main and creates no resistance state', { timeout: 120_000 }, () => {
    for (const active of [rules, noDiseaseResistance(rules)]) {
      const w = createWorld('a', edenPreset, active)
      while (w.tick < 400) step(w, active)
      const at = w.bots[0]!
      expect(applyCommand(w, active, OUTBREAK(at.x, at.y)).ok).toBe(true)
      while (w.tick < 1500) step(w, active)
      expect(stateHash(w)).toBe(PIN_OUTBREAK_1500)
      expect(w.resistance).toBeUndefined()
      expect(w.bots.some((b) => 'resist' in b)).toBe(false)
    }
  })
})

describe('activation', () => {
  it('gives every living bot a resist in the founder range, deterministically, without touching world.rng', () => {
    const spots: [number, number][] = [[10, 10], [20, 10], [30, 10], [40, 10], [50, 10], [10, 40]]
    const a = world(on, spots)
    const b = world(on, spots)
    const rngBefore = JSON.parse(JSON.stringify(a.rng)) as unknown
    startOutbreak(a, 10, 10, on.tuning)
    startOutbreak(b, 10, 10, on.tuning)
    expect(a.rng).toEqual(rngBefore)
    expect(a.bots.every((bot) => bot.resist !== undefined && bot.resist >= t.founderMin && bot.resist <= t.founderMax)).toBe(true)
    expect(new Set(a.bots.map((bot) => bot.resist)).size).toBeGreaterThan(1)
    const mean = a.bots.reduce((sum, bot) => sum + bot.resist!, 0) / a.bots.length
    expect(a.resistance!.founderMean).toBe(mean)
    expect(a.resistance!.activatedTick).toBe(0)
    expect(b.resistance!.founderMean).toBe(a.resistance!.founderMean)
    expect(stateHash(a)).toBe(stateHash(b))
    // The stream is derived from the seed and the tick, and is not a named stream.
    expect(Object.keys(a.rng)).not.toContain('resist')
    const expected = deriveStream('a', 'resist:0')
    expect(a.bots[0]!.resist).toBe(t.founderMin + nextFloat(expected) * (t.founderMax - t.founderMin))
  })

  it('happens only at the first outbreak, and not with the rule off', () => {
    const w = world(on, [[10, 10], [50, 50]])
    startOutbreak(w, 10, 10, on.tuning)
    const first = { ...w.resistance! }
    const resists = w.bots.map((b) => b.resist)
    w.tick = 50
    startOutbreak(w, 50, 50, on.tuning)
    expect(w.resistance!.activatedTick).toBe(first.activatedTick)
    expect(w.bots.map((b) => b.resist)).toEqual(resists)
    const off = world(rules, [[10, 10]])
    startOutbreak(off, 10, 10, rules.tuning)
    expect(off.resistance).toBeUndefined()
  })

  it('a bot placed afterwards starts at 1, with no draw', () => {
    const w = world(on, [[10, 10]])
    startOutbreak(w, 10, 10, on.tuning)
    const stream = { ...w.resistance!.stream }
    expect(applyCommand(w, on, { type: 'placeBot', x: 20, y: 20 }).ok).toBe(true)
    expect(w.bots.at(-1)!.resist).toBe(1)
    expect(w.resistance!.stream).toEqual(stream)
  })
})

describe('inheritance', () => {
  it('stays within the bounds and takes 3 draws for a sexual child and 2 for an asexual one', () => {
    const stream = deriveStream('x', 'test')
    for (let i = 0; i < 500; i += 1) {
      const sexual = i % 2 === 0
      const mirror = { ...stream }
      const value = inheritResist(1.9, sexual ? 1.1 : null, { ...t, mutation: { rate: 1, strength: 0.9 } }, stream)
      expect(value).toBeGreaterThanOrEqual(t.min)
      expect(value).toBeLessThanOrEqual(t.max)
      for (let k = 0; k < (sexual ? 3 : 2); k += 1) nextFloat(mirror)
      expect(stream).toEqual(mirror)
    }
  })

  it('copies a parent exactly with strength 0, picking the mother below 0.5', () => {
    const flat = { ...t, mutation: { rate: 1, strength: 0 } }
    const stream = deriveStream('x', 'pick')
    const mirror = { ...stream }
    const pick = nextFloat(mirror)
    expect(inheritResist(1.2, 1.7, flat, stream)).toBe(pick < 0.5 ? 1.2 : 1.7)
  })

  it('newborns of an Eden world with an outbreak carry resist, and the named streams are unchanged', { timeout: 120_000 }, () => {
    const w = createWorld('a', edenPreset, on)
    while (w.tick < 400) step(w, on)
    const at = w.bots[0]!
    applyCommand(w, on, OUTBREAK(at.x, at.y))
    const founders = new Set(w.bots.map((b) => b.id))
    while (w.tick < 1500) step(w, on)
    const born = w.bots.filter((b) => !founders.has(b.id))
    expect(born.length).toBeGreaterThan(0)
    expect(born.every((b) => b.resist !== undefined && b.resist >= t.min && b.resist <= t.max)).toBe(true)
    expect(Object.keys(createRng('a'))).toEqual(Object.keys(w.rng))
  })
})

describe('effects', () => {
  const rule = withDiseaseResistance(rules, { catchWeight: 1, sickWeight: 0.5 })
  const disease = { ...rule.tuning.disease, catchAfter: 5, sickTicks: 200, outbreakRadius: 0.5, contactRadius: 3 }
  const tuning = { ...rule.tuning, disease }
  const active: Rules = { ...rule, tuning }

  it('a higher resist needs a bigger dose to fall sick', () => {
    const w = world(active, [[10, 10], [11, 10], [10, 11]])
    startOutbreak(w, 50, 50, tuning) // nobody in reach: only activates
    w.bots[1]!.resist = 1
    w.bots[2]!.resist = 2
    startOutbreak(w, 10, 10, tuning) // bot 0 falls sick
    const fell: Record<number, number> = {}
    for (let i = 0; i < 20; i += 1) {
      w.tick += 1
      spreadDisease(w, tuning)
      for (const bot of w.bots) if (bot.illness?.stage === 'sick' && fell[bot.id] === undefined) fell[bot.id] = w.tick
    }
    expect(fell[w.bots[1]!.id]).toBe(5) // dose 5 >= 5 x (1 + 0)
    expect(fell[w.bots[2]!.id]).toBe(10) // dose 10 >= 5 x (1 + 1)
  })

  it('a higher resist is sick for fewer ticks', () => {
    const w = world(active, [[10, 10], [30, 30]])
    startOutbreak(w, 50, 50, tuning)
    w.bots[0]!.resist = 1
    w.bots[1]!.resist = 2
    startOutbreak(w, 10, 10, tuning)
    startOutbreak(w, 30, 30, tuning)
    expect(w.bots[0]!.illness!.until).toBe(w.tick + 200)
    expect(w.bots[1]!.illness!.until).toBe(w.tick + Math.round(200 / 1.5))
  })

  it('upkeep costs energy per point above 1, only for a bot that has resist', () => {
    const costly = withDiseaseResistance(rules, { upkeep: 0.1 })
    const w = world(costly, [[30, 30], [30, 30]])
    startOutbreak(w, 50, 50, costly.tuning)
    w.bots[0]!.resist = 1.5
    delete w.bots[1]!.resist
    const e0 = w.bots[0]!.energy
    const e1 = w.bots[1]!.energy
    step(w, costly)
    expect(e0 - w.bots[0]!.energy - (e1 - w.bots[1]!.energy)).toBeCloseTo(0.05, 9)
  })
})

describe('catchThreshold', () => {
  it('rounds to the nearest whole dose (.5 up), at least 1, and leaves a bot with no resist at the plain number', () => {
    const half = { ...t, catchWeight: 0.5 }
    expect(catchThreshold({}, half, 5)).toBe(5)
    expect(catchThreshold({ resist: 1 }, half, 5)).toBe(5)
    expect(catchThreshold({ resist: 1.19 }, half, 5)).toBe(5) // 5.475
    expect(catchThreshold({ resist: 1.2 }, half, 5)).toBe(6) // 5.5 rounds up
    expect(catchThreshold({ resist: 2 }, half, 5)).toBe(8) // 7.5 rounds up
    expect(catchThreshold({ resist: 2 }, { ...t, catchWeight: 1 }, 5)).toBe(10)
    expect(catchThreshold({ resist: 1.5 }, { ...t, catchWeight: 0 }, 5)).toBe(5)
    expect(catchThreshold({ resist: 1 }, half, 1)).toBe(1)
    // deterministic: the same inputs give the same answer
    expect(catchThreshold({ resist: 1.37 }, half, 5)).toBe(catchThreshold({ resist: 1.37 }, half, 5))
  })
})

describe('damage and the centred anchor (R3)', () => {
  const centred = { ...t, centred: true, catchWeight: 0.3, sickWeight: 0.3, damageWeight: 0.3, founderMax: 1.4 }
  it('divides the sickness damage by the factor; no resist or damageWeight 0 gives the plain drain', () => {
    expect(sickDrainFor({}, { ...t, damageWeight: 0.5 }, 1, 0.7)).toBe(0.7)
    expect(sickDrainFor({ resist: 1.8 }, { ...t, damageWeight: 0 }, 1, 0.7)).toBe(0.7)
    expect(sickDrainFor({ resist: 1.4 }, { ...t, damageWeight: 0.5 }, 1, 0.7)).toBeCloseTo(0.7 / 1.2, 12)
    expect(sickDrainFor({ resist: 1.4 }, { ...t, damageWeight: 1 }, 1.4, 0.7)).toBe(0.7)
    expect(sickDrainFor({ resist: 1.2 }, { ...t, damageWeight: 1 }, 1.4, 0.7)).toBeGreaterThan(0.7)
  })

  it('sickDamage uses it only with a resistance world and a resist key', () => {
    const w = world({ ...on, tuning: { ...on.tuning, resistance: { ...t, damageWeight: 1 } } }, [[10, 10]])
    const tun = { ...on.tuning, resistance: { ...t, damageWeight: 1 } }
    startOutbreak(w, 10, 10, tun)
    const bot = w.bots[0]!
    bot.resist = 2
    expect(sickDamage(bot, tun, w.resistance)).toBe(tun.disease.sickDrain / 2)
    expect(sickDamage(bot, tun, undefined)).toBe(tun.disease.sickDrain)
    delete bot.resist
    expect(sickDamage(bot, tun, w.resistance)).toBe(tun.disease.sickDrain)
    expect(sickDamage({ resist: 2 }, tun, w.resistance)).toBe(0)
  })

  it('anchor is 1 uncentred and the founders mean centred', () => {
    expect(anchor({ centred: false }, { stream: deriveStream('a', 'x'), founderMean: 1.15, activatedTick: 0 })).toBe(1)
    expect(anchor({ centred: true }, { stream: deriveStream('a', 'x'), founderMean: 1.15, activatedTick: 0 })).toBe(1.15)
    expect(anchor({ centred: true }, undefined)).toBe(1)
  })

  it('a bot at the founders mean gets exactly the plain dose, length and drain; one below is worse off, one above better', () => {
    const mean = 1.2
    expect(catchThreshold({ resist: mean }, centred, 5, mean)).toBe(5)
    expect(sickLength({ resist: mean }, centred, 200, mean)).toBe(200)
    expect(sickDrainFor({ resist: mean }, centred, mean, 0.7)).toBe(0.7)
    expect(catchThreshold({ resist: 1 }, { ...centred, catchWeight: 0.5 }, 20, mean)).toBe(18)
    expect(sickLength({ resist: 1 }, centred, 200, mean)).toBeGreaterThan(200)
    expect(sickDrainFor({ resist: 1 }, centred, mean, 0.7)).toBeGreaterThan(0.7)
    expect(sickDrainFor({ resist: 1.4 }, centred, mean, 0.7)).toBeLessThan(0.7)
  })

  it('a centred world gives a founder at the mean the plain sickness length', () => {
    const active = withDiseaseResistance(rules, { centred: true, catchWeight: 0, sickWeight: 0.4, damageWeight: 0.4, founderMax: 1.2 })
    const w = world(active, [[10, 10], [20, 20]])
    startOutbreak(w, 50, 50, active.tuning)
    w.bots[0]!.resist = w.resistance!.founderMean
    w.bots[1]!.resist = w.resistance!.founderMean + 0.1
    startOutbreak(w, 10, 10, { ...active.tuning, disease: { ...active.tuning.disease, outbreakRadius: 30 } })
    expect(w.bots[0]!.illness!.until).toBe(w.tick + active.tuning.disease.sickTicks)
    expect(w.bots[1]!.illness!.until).toBeLessThan(w.tick + active.tuning.disease.sickTicks)
  })

  it('checkResistance rejects centred weights that could make a factor reach 0.5, and a non-boolean centred or bad damageWeight', () => {
    expect(() => checkResistance({ ...t, centred: true, founderMax: 1.4, catchWeight: 0, sickWeight: 0.5, damageWeight: 1 })).not.toThrow()
    expect(() => checkResistance({ ...t, centred: true, founderMax: 1.6, catchWeight: 0, sickWeight: 0, damageWeight: 1 })).toThrow(RangeError)
    expect(() => checkResistance({ ...t, centred: true, founderMax: 1.5, damageWeight: 1 })).toThrow(RangeError)
    expect(() => checkResistance({ ...t, centred: false, founderMax: 1.6, damageWeight: 1 })).not.toThrow()
    expect(() => checkResistance({ ...t, centred: 1 as unknown as boolean })).toThrow(RangeError)
    expect(() => checkResistance({ ...t, damageWeight: 1.5 })).toThrow(RangeError)
    expect(() => checkResistance({ ...t, damageWeight: -0.1 })).toThrow(RangeError)
  })
})

describe('replay and copy', () => {
  it('replays an outbreak with births to the same hash, and a JSON copy steps the same', { timeout: 120_000 }, () => {
    const live = createWorld('a', edenPreset, on)
    while (live.tick < 400) step(live, on)
    const at = live.bots[0]!
    expect(applyCommand(live, on, OUTBREAK(at.x, at.y)).ok).toBe(true)
    while (live.tick < 1200) step(live, on)
    const copy = JSON.parse(JSON.stringify(live)) as World
    while (live.tick < 1600) step(live, on)
    while (copy.tick < 1600) step(copy, on)
    expect(stateHash(copy)).toBe(stateHash(live))
    expect(live.bots.some((b) => b.resist !== undefined && b.id > 100)).toBe(true)
    const replay = replayWorld('a', edenPreset, on, live.commands, 1600)
    expect(stateHash(replay)).toBe(stateHash(live))
  })
})

describe('checkResistance', () => {
  it('accepts the shipped numbers and rejects bad ones', () => {
    expect(() => checkResistance(t)).not.toThrow()
    const bad: Partial<typeof t>[] = [
      { enabled: 1 as unknown as boolean },
      { min: 0.9 },
      { founderMin: 0.9, min: 0.9 },
      { founderMin: 1.5 },
      { founderMax: 2.5 },
      { max: 1.2 },
      { max: Infinity },
      { founderMin: NaN },
      { catchWeight: 1.1 },
      { sickWeight: -0.1 },
      { upkeep: -1 },
      { upkeep: Infinity },
      { mutation: { rate: 1.5, strength: 0.1 } },
      { mutation: { rate: 0.1, strength: 1 } },
      { mutation: { rate: 0.1, strength: -0.1 } },
    ]
    for (const over of bad) expect(() => checkResistance({ ...t, ...over }), JSON.stringify(over)).toThrow(RangeError)
    expect(() => createWorld('a', edenPreset, { ...rules, tuning: { ...rules.tuning, resistance: { ...t, min: 0.5 } } })).toThrow(RangeError)
  })
})
