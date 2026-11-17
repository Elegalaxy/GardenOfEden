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
  it.concurrent.each(SEEDS)('seed %s', { timeout: 180_000 }, async (seed) => {
    const result = await survey(seed)
    expect(result.final).toBeGreaterThanOrEqual(MIN_ALIVE)
    expect(result.min).toBeGreaterThanOrEqual(MIN_ALIVE)
    expect(result.max).toBeLessThanOrEqual(MAX_ALIVE)
    expect(result.max).toBeLessThan(rules.tuning.population.cap)
    expect(result.max / result.min).toBeGreaterThanOrEqual(MIN_SWING)
    expect(result.births).toBeGreaterThan(100)
  })

  it.concurrent.each(SEEDS)('predators of seed %s are never gone long and are not at the cap most of the time', { timeout: 180_000 }, async (seed) => {
    const result = await survey(seed)
    expect(result.predZeroRun).toBeLessThanOrEqual(rules.tuning.predator.ecology.recolonizeTicks + 300)
    expect(result.predCapTicks).toBeLessThanOrEqual(0.5 * (TICKS - WARMUP))
  })
})

describe('eden predators over ten seeds', () => {
  it('move, breed and take a modest share of the deaths', { timeout: 180_000 }, async () => {
    const rows = await Promise.all(SEEDS.map((seed) => survey(seed)))
    expect(rows.filter((r) => r.predMax - r.predMin >= 2).length).toBeGreaterThanOrEqual(8)
    expect(rows.filter((r) => r.predBorn > 0).length).toBeGreaterThanOrEqual(8)
    const predatorDeaths = rows.reduce((sum, r) => sum + r.deaths.predator, 0)
    const deaths = rows.reduce((sum, r) => sum + Object.values(r.deaths).reduce((a, b) => a + b, 0), 0)
    expect(predatorDeaths / deaths).toBeGreaterThanOrEqual(0.03)
    expect(predatorDeaths / deaths).toBeLessThanOrEqual(0.15)
  })
})
