import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { parseOverride, withOverrides } from '../src/harness/overrides.ts'
import { applyCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { seasonAt } from '../src/sim/seasons.ts'
import { step } from '../src/sim/step.ts'
import type { Preset, Rules, World } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'
import { noSeasons } from './variants.ts'

// Seasons (S1): food regrowth swings with the tick. They are on in Eden since S2; most tests here build their own season numbers
// (period 4000, amplitude 0.3, base 1) so they do not move when Eden is retuned. The scene tests use a resource that never fills up and regrows 1 per tick, so the multiplier
// can be read off the amount exactly.

const { tuning } = rules
const PERIOD = 4000
const AMPLITUDE = 0.3

function withSeasons(over: Partial<Rules['tuning']['seasons']>, base: Rules = rules): Rules {
  return { ...base, tuning: { ...base.tuning, seasons: { enabled: true, period: PERIOD, amplitude: AMPLITUDE, base: 1, ...over } } }
}

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', width: 40, height: 40, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

function slow(season: Rules): Rules {
  return { ...season, nodeDefs: { ...season.nodeDefs, resource: { ...season.nodeDefs.resource, capacity: 1_000_000, regen: 1 } } }
}

function emptyResourceWorld(active: Rules): World {
  const world = createWorld('a', scene({ nodes: [{ kind: 'resource', x: 10, y: 10 }] }), active)
  world.nodes[0].amount = 0
  return world
}

function runTo(world: World, active: Rules, tick: number): void {
  while (world.tick < tick) step(world, active)
}

describe('seasonAt', () => {
  const on = withSeasons({}).tuning

  it('starts spring at the base, peaks in summer, returns to the base in autumn and bottoms out in winter', () => {
    expect(seasonAt(0, on).multiplier).toBe(1)
    expect(seasonAt(PERIOD / 4, on).multiplier).toBe(1 + AMPLITUDE * 1)
    expect(seasonAt(PERIOD / 2, on).multiplier).toBeCloseTo(1, 12)
    expect(seasonAt((3 * PERIOD) / 4, on).multiplier).toBe(1 + AMPLITUDE * -1)
    expect(seasonAt(PERIOD, on).multiplier).toBeCloseTo(seasonAt(0, on).multiplier, 12)
  })

  it('is exactly 1 everywhere when seasons are off', () => {
    const off = noSeasons(rules).tuning
    for (const tick of [0, 1, 999, 1000, 2500, 3000, 123456]) expect(seasonAt(tick, off).multiplier).toBe(1)
  })

  it('names the four quarters and counts down to the next one', () => {
    const at = (tick: number) => {
      const { name, phase, ticksToNext } = seasonAt(tick, on)
      return { name, phase, ticksToNext }
    }
    expect(at(0)).toEqual({ name: 'spring', phase: 0, ticksToNext: 1000 })
    expect(at(999)).toEqual({ name: 'spring', phase: 0.24975, ticksToNext: 1 })
    expect(at(1000)).toEqual({ name: 'summer', phase: 0.25, ticksToNext: 1000 })
    expect(at(2000)).toEqual({ name: 'autumn', phase: 0.5, ticksToNext: 1000 })
    expect(at(3500)).toEqual({ name: 'winter', phase: 0.875, ticksToNext: 500 })
    expect(at(3999)).toMatchObject({ name: 'winter', ticksToNext: 1 })
    expect(at(4000)).toEqual({ name: 'spring', phase: 0, ticksToNext: 1000 })
    expect(at(9500)).toMatchObject({ name: 'summer', ticksToNext: 500 })
    expect(seasonAt(0, noSeasons(rules).tuning)).toMatchObject({ enabled: false, name: 'spring' })
  })

  it('uses the base as the yearly average level', () => {
    const high = withSeasons({ base: 1.05 }).tuning
    expect(seasonAt(0, high).multiplier).toBe(1.05)
    expect(seasonAt(PERIOD / 4, high).multiplier).toBe(1.05 + AMPLITUDE * 1)
  })

  it('refuses a period that is not above 0 and an amplitude outside 0 to 0.5', () => {
    expect(() => seasonAt(1, withSeasons({ period: 0 }).tuning)).toThrow(RangeError)
    expect(() => seasonAt(1, withSeasons({ period: -5 }).tuning)).toThrow(RangeError)
    expect(() => seasonAt(1, withSeasons({ period: Number.NaN }).tuning)).toThrow(RangeError)
    expect(() => seasonAt(1, withSeasons({ amplitude: 0.51 }).tuning)).toThrow(RangeError)
    expect(() => seasonAt(1, withSeasons({ amplitude: -0.1 }).tuning)).toThrow(RangeError)
    expect(() => seasonAt(1, withSeasons({ amplitude: 0.5 }).tuning)).not.toThrow()
    expect(() => seasonAt(1, withSeasons({ enabled: false, period: 0 }).tuning)).toThrow(RangeError)
  })

  it('ships on, with the S2 numbers', () => {
    expect(tuning.seasons).toEqual({ enabled: true, period: 3000, amplitude: 0.4, base: 1.02 })
  })
})

describe('seasonal regrowth', () => {
  it('multiplies regrowth by the season of that tick, summing exactly what seasonAt gives', () => {
    const active = slow(withSeasons({}))
    const world = emptyResourceWorld(active)
    let expected = 0
    for (let tick = 1; tick <= 50; tick += 1) {
      step(world, active)
      expected = Math.min(1_000_000, expected + 1 * (1 * seasonAt(tick, active.tuning).multiplier))
    }
    expect(world.nodes[0].amount).toBe(expected)
    expect(world.nodes[0].amount).toBeGreaterThan(50)
  })

  it('regrows less in winter than in summer', () => {
    const active = slow(withSeasons({}))
    const winter = emptyResourceWorld(active)
    winter.tick = 2990
    step(winter, active)
    const summer = emptyResourceWorld(active)
    summer.tick = 990
    step(summer, active)
    expect(winter.nodes[0].amount).toBeLessThan(1)
    expect(summer.nodes[0].amount).toBeGreaterThan(1)
  })

  it('multiplies with a drought: a drought in winter is 0.35 times the winter low', () => {
    const active = slow(withSeasons({}))
    const world = emptyResourceWorld(active)
    world.tick = 2999
    applyCommand(world, active, { type: 'triggerEvent', event: 'drought' })
    step(world, active)
    expect(world.tick).toBe(3000)
    expect(world.nodes[0].amount).toBe(tuning.events.drought.regrowMult * seasonAt(3000, active.tuning).multiplier)
    expect(world.nodes[0].amount).toBeCloseTo(0.35 * 0.7, 12)
  })

  it('draws no random numbers', () => {
    const active = slow(withSeasons({}))
    const world = emptyResourceWorld(active)
    const before = JSON.stringify(world.rng)
    runTo(world, active, 500)
    expect(JSON.stringify(world.rng)).toBe(before)
  })
})

describe('switched off', () => {
  it('gives the same state hash as seasons on with amplitude 0 (multiplier exactly 1)', () => {
    const off = createWorld('a', edenPreset, noSeasons(rules))
    const flat = createWorld('a', edenPreset, withSeasons({ amplitude: 0 }))
    runTo(off, noSeasons(rules), 1500)
    runTo(flat, withSeasons({ amplitude: 0 }), 1500)
    expect(stateHash(flat)).toBe(stateHash(off))
  })

  it('Eden as shipped has seasons on, so it differs from the explicit off rules (the switch does something)', () => {
    const off = noSeasons(rules)
    const control = createWorld('a', edenPreset, off)
    const seasonal = createWorld('a', edenPreset, rules)
    runTo(control, off, 1500)
    runTo(seasonal, rules, 1500)
    expect(stateHash(seasonal)).not.toBe(stateHash(control))
  })
})

// Waves (S2): with the shipped numbers the population rises through summer and falls through winter. Compared at the
// end of each season (the last quarter of summer against the last quarter of winter), since the population lags the food.
describe('population waves in Eden', () => {
  const SEEDS = ['a', 'b', 'c', 'd', 'e']
  const TICKS = 12_000

  function seasonEnds(seed: string): { summer: number; winter: number } {
    const world = createWorld(seed, edenPreset, rules)
    const period = rules.tuning.seasons.period
    const total = { summer: 0, winter: 0 }
    const count = { summer: 0, winter: 0 }
    while (world.tick < TICKS) {
      step(world, rules)
      const phase = (world.tick - Math.floor(world.tick / period) * period) / period
      if (phase >= 0.4375 && phase < 0.5) {
        total.summer += world.bots.length
        count.summer += 1
      } else if (phase >= 0.9375) {
        total.winter += world.bots.length
        count.winter += 1
      }
    }
    return { summer: total.summer / count.summer, winter: total.winter / count.winter }
  }

  it('has more bots at the end of summer than at the end of winter on at least 4 of 5 seeds', { timeout: 120_000 }, () => {
    const results = SEEDS.map((seed) => ({ seed, ...seasonEnds(seed) }))
    const wins = results.filter((r) => r.summer > r.winter).length
    expect(wins, JSON.stringify(results)).toBeGreaterThanOrEqual(4)
  })
})

describe('replay with seasons on', () => {
  it('replays from seed + recorded commands to the same hash', () => {
    const on = withSeasons({})
    const world = createWorld('a', edenPreset, on)
    runTo(world, on, 600)
    applyCommand(world, on, { type: 'triggerEvent', event: 'drought' })
    runTo(world, on, 1200)
    expect(world.commands).toHaveLength(1)
    expect(stateHash(replayWorld('a', edenPreset, on, world.commands, world.tick))).toBe(stateHash(world))
  })
})

describe('harness --set overrides', () => {
  it('replaces an existing number or boolean in a copy and leaves the original alone', () => {
    const changed = withOverrides(rules, [parseOverride('seasons.amplitude=0.4'), parseOverride('seasons.enabled=true')])
    expect(changed.tuning.seasons).toEqual({ ...tuning.seasons, enabled: true, amplitude: 0.4 })
    expect(changed.tuning.seasons).not.toBe(tuning.seasons)
    expect(tuning.seasons.amplitude).toBe(0.4)
    expect(withOverrides(rules, [parseOverride('seasons.amplitude=0.25')]).tuning.seasons.amplitude).toBe(0.25)
    expect(tuning.seasons.amplitude).toBe(0.4)
    expect(withOverrides(rules, [parseOverride('bot.eatRate=3')]).tuning.bot.eatRate).toBe(3)
  })

  it('rejects unknown paths, wrong kinds, objects and malformed text', () => {
    expect(() => withOverrides(rules, [parseOverride('seasons.nope=1')])).toThrow(/no such tuning setting/)
    expect(() => withOverrides(rules, [parseOverride('nope.deeper=1')])).toThrow(/no such tuning setting/)
    expect(() => withOverrides(rules, [parseOverride('seasons=1')])).toThrow(/only an existing/)
    expect(() => withOverrides(rules, [parseOverride('seasons.enabled=1')])).toThrow(/only an existing/)
    expect(() => withOverrides(rules, [parseOverride('seasons.period=true')])).toThrow(/only an existing/)
    expect(() => parseOverride('seasons.period')).toThrow(/--set must look like/)
    expect(() => parseOverride(undefined)).toThrow(/--set must look like/)
    expect(() => parseOverride('seasons.period=abc')).toThrow(/finite number/)
    expect(() => parseOverride('seasons..period=1')).toThrow(/empty part/)
  })
})
