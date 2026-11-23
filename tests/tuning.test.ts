import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { surveySeed } from '../src/harness/survey.ts'
import type { SeedSurvey } from '../src/harness/survey.ts'

// The eden preset must stay interesting: across ten seeds and 20,000 ticks the
// population never dies out, never runs away toward the cap, and visibly rises
// and falls. The numbers behind this are in src/content/tuning.ts and
// presets.ts. Each seed takes a few seconds, so they run side by side.
// `npm run sim -- --seeds a,b,c,d,e,f,g,h,i,j --ticks 20000` prints the same table.
// Since E2 the predators have an ecology too: no predator-free stretch longer than a re-colonising wait, no
// time spent at the predator cap for more than half the run, and across seeds predators move, breed and take a
// modest share of the deaths. The ten surveys are computed once and shared by every check.

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
const TICKS = 20_000
const WARMUP = 1000
const MIN_ALIVE = 5
const MAX_ALIVE = 250
const MIN_SWING = 1.3 // max / min population after the warmup

const surveys = new Map<string, Promise<SeedSurvey>>()
function survey(seed: string): Promise<SeedSurvey> {
  let result = surveys.get(seed)
  if (result === undefined) {
    result = Promise.resolve().then(() => surveySeed(seed, edenPreset, rules, TICKS, WARMUP))
    surveys.set(seed, result)
  }
  return result
}

describe('eden preset survives 20,000 ticks', () => {
  it.concurrent.each(SEEDS)('seed %s', { timeout: 600_000 }, async (seed) => {
    const result = await survey(seed)
    expect(result.final).toBeGreaterThanOrEqual(MIN_ALIVE)
    expect(result.min).toBeGreaterThanOrEqual(MIN_ALIVE)
    expect(result.max).toBeLessThanOrEqual(MAX_ALIVE)
    expect(result.max).toBeLessThan(rules.tuning.population.cap)
    expect(result.max / result.min).toBeGreaterThanOrEqual(MIN_SWING)
    expect(result.births).toBeGreaterThan(100)
  })

  it.concurrent.each(SEEDS)('predators of seed %s are never gone long and are not at the cap most of the time', { timeout: 600_000 }, async (seed) => {
    const result = await survey(seed)
    expect(result.predZeroRun).toBeLessThanOrEqual(rules.tuning.predator.ecology.recolonizeTicks + 300)
    expect(result.predCapTicks).toBeLessThanOrEqual(0.5 * (TICKS - WARMUP))
  })
})

describe('eden predators over ten seeds', () => {
  it('move, breed and take a modest share of the deaths', { timeout: 600_000 }, async () => {
    const rows = await Promise.all(SEEDS.map((seed) => survey(seed)))
    expect(rows.filter((r) => r.predMax - r.predMin >= 2).length).toBeGreaterThanOrEqual(8)
    expect(rows.filter((r) => r.predBorn > 0).length).toBeGreaterThanOrEqual(8)
    const predatorDeaths = rows.reduce((sum, r) => sum + r.deaths.predator, 0)
    const deaths = rows.reduce((sum, r) => sum + Object.values(r.deaths).reduce((a, b) => a + b, 0), 0)
    expect(predatorDeaths / deaths).toBeGreaterThanOrEqual(0.03)
    expect(predatorDeaths / deaths).toBeLessThanOrEqual(0.15)
  })

  // P2: with the prey rule on the predator count follows the bot count. The pre-P2 world (rule off) had a median best-lag
  // correlation of about -0.05 and one seed of ten at 0.3 or more; the bar is a median of 0.5 and at least 7 of 10 seeds at 0.3.
  it('track the bots: the predator count follows the bot count', { timeout: 600_000 }, async () => {
    const rows = await Promise.all(SEEDS.map((seed) => survey(seed)))
    const corr = rows.map((r) => r.predCorrBest)
    expect(corr.every((c) => c !== null)).toBe(true)
    const sorted = (corr as number[]).sort((a, b) => a - b)
    const median = (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
    expect(median).toBeGreaterThanOrEqual(0.5)
    expect(sorted.filter((c) => c >= 0.3).length).toBeGreaterThanOrEqual(7)
  })

  // G2: mate choice is on. The measured baseline (mate choice off, eden a..j, 20,000 ticks) had a median of 18.4% inbred births; the bar is a third of that.
  it('breed mostly outside the family: median inbred births at most a third of the 18.4% baseline', { timeout: 600_000 }, async () => {
    const rows = await Promise.all(SEEDS.map((seed) => survey(seed)))
    const shares = rows.map((r) => (100 * r.inbred) / r.births).sort((a, b) => a - b)
    const median = (shares[shares.length / 2 - 1]! + shares[shares.length / 2]!) / 2
    expect(median).toBeLessThanOrEqual(18.4 / 3)
  })

  // H2: predator traits are on. They must be inherited (a cub generation is reached), must move off the founders' 1 on some seeds, and no mean may
  // sit against a bound after 20,000 ticks (within 5% of the bound range). The 60,000-tick version of the bound check was run in the H2 sweep, not here.
  it('inherit their traits: cubs carry a generation, the means move, and none sits at a bound', { timeout: 600_000 }, async () => {
    const rows = await Promise.all(SEEDS.map((seed) => survey(seed)))
    expect(rows.every((r) => r.predMaxGen !== null)).toBe(true)
    expect(rows.filter((r) => r.predMaxGen! >= 2).length).toBeGreaterThanOrEqual(8)
    const bounds = rules.tuning.predator.traits.bounds
    const names = ['sense', 'speed', 'stamina'] as const
    let moved = 0
    for (const r of rows) {
      if (r.predTraits === null) continue
      let drifted = false
      for (const name of names) {
        const { min, max } = bounds[name]
        const mean = r.predTraits[name]
        expect(mean, `seed ${r.seed} ${name}`).toBeGreaterThan(min + 0.05 * (max - min))
        expect(mean, `seed ${r.seed} ${name}`).toBeLessThan(max - 0.05 * (max - min))
        if (Math.abs(mean - 1) >= 0.02) drifted = true
      }
      if (drifted) moved += 1
    }
    expect(moved).toBeGreaterThanOrEqual(5)
  })
})
