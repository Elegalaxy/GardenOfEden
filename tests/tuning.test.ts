import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { surveySeed } from '../src/harness/survey.ts'

// The eden preset must stay interesting: across ten seeds and 20,000 ticks the
// population never dies out, never runs away toward the cap, and visibly rises
// and falls. The numbers behind this are in src/content/tuning.ts and
// presets.ts. Each seed takes a few seconds, so they run side by side.
// `npm run sim -- --seeds a,b,c,d,e,f,g,h,i,j --ticks 20000` prints the same table.

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
const TICKS = 20_000
const WARMUP = 1000
const MIN_ALIVE = 5
const MAX_ALIVE = 250
const MIN_SWING = 1.3 // max / min population after the warmup

describe('eden preset survives 20,000 ticks', () => {
  it.concurrent.each(SEEDS)('seed %s', { timeout: 180_000 }, (seed) => {
    const result = surveySeed(seed, edenPreset, rules, TICKS, WARMUP)
    expect(result.final).toBeGreaterThanOrEqual(MIN_ALIVE)
    expect(result.min).toBeGreaterThanOrEqual(MIN_ALIVE)
    expect(result.max).toBeLessThanOrEqual(MAX_ALIVE)
    expect(result.max).toBeLessThan(rules.tuning.population.cap)
    expect(result.max / result.min).toBeGreaterThanOrEqual(MIN_SWING)
    expect(result.births).toBeGreaterThan(100)
  })
})
