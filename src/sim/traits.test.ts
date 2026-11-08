import { describe, expect, it } from 'vitest'

import { speedOf } from './metabolism.ts'
import { createRng, nextFloat } from './rng.ts'
import { TRAIT_NAMES, meanTraits, mutateTraits, traitStats } from './traits.ts'
import type { Bot, Traits, Tuning } from './types.ts'

const parent: Traits = { senseRadius: 6, caution: 0.5, reproThreshold: 80, metabolism: 1 }
const bounds: Tuning['mutation']['bounds'] = {
  senseRadius: { min: 3, max: 12 },
  caution: { min: 0.05, max: 1.5 },
  reproThreshold: { min: 55, max: 90 },
  metabolism: { min: 0.7, max: 1.6 },
}

function mutation(rate: number, strength: number): Tuning['mutation'] {
  return { rate, strength, bounds }
}

function botWith(traits: Traits): Bot {
  return { traits } as unknown as Bot
}

describe('mutateTraits', () => {
  it('copies the parent when the strength is 0, and never returns the parent object', () => {
    const stream = createRng('m').birth
    const child = mutateTraits(parent, mutation(1, 0), stream)
    expect(child).toEqual(parent)
    expect(child).not.toBe(parent)
  })

  it('changes nothing when the rate is 0', () => {
    const stream = createRng('m').birth
    expect(mutateTraits(parent, mutation(0, 0.5), stream)).toEqual(parent)
  })

  it('moves each trait by at most the strength, and mutates all four at rate 1', () => {
    const stream = createRng('m').birth
    let changed = 0
    for (let i = 0; i < 200; i += 1) {
      const child = mutateTraits(parent, mutation(1, 0.1), stream)
      for (const name of TRAIT_NAMES) {
        expect(child[name]).toBeGreaterThanOrEqual(parent[name] * 0.9 - 1e-12)
        expect(child[name]).toBeLessThanOrEqual(parent[name] * 1.1 + 1e-12)
        if (child[name] !== parent[name]) changed += 1
      }
    }
    expect(changed).toBeGreaterThan(780) // about 800 of 800
  })

  it('clamps into the bounds even when the parent is outside them', () => {
    const stream = createRng('m').birth
    const wild: Traits = { senseRadius: 40, caution: -3, reproThreshold: 10, metabolism: 9 }
    const child = mutateTraits(wild, mutation(0, 0), stream)
    expect(child).toEqual({ senseRadius: 12, caution: 0.05, reproThreshold: 55, metabolism: 1.6 })
  })

  it('stays inside the bounds over many generations of strong mutation', () => {
    const stream = createRng('m').birth
    let traits = parent
    for (let i = 0; i < 2000; i += 1) {
      traits = mutateTraits(traits, mutation(1, 0.9), stream)
      for (const name of TRAIT_NAMES) {
        expect(traits[name]).toBeGreaterThanOrEqual(bounds[name].min)
        expect(traits[name]).toBeLessThanOrEqual(bounds[name].max)
      }
    }
  })

  it('always draws two numbers per trait, whatever the rate and strength', () => {
    const reference = createRng('m').birth
    for (let i = 0; i < 2 * TRAIT_NAMES.length; i += 1) nextFloat(reference)
    for (const m of [mutation(0, 0), mutation(1, 0.5), mutation(0.3, 0.1)]) {
      const stream = createRng('m').birth
      mutateTraits(parent, m, stream)
      expect(stream).toEqual(reference)
    }
  })

  it('gives the same child for the same stream state', () => {
    const a = mutateTraits(parent, mutation(0.5, 0.1), createRng('same').birth)
    const b = mutateTraits(parent, mutation(0.5, 0.1), createRng('same').birth)
    expect(b).toEqual(a)
  })
})

describe('traitStats and meanTraits', () => {
  const bots = [
    botWith({ senseRadius: 4, caution: 0.2, reproThreshold: 60, metabolism: 0.8 }),
    botWith({ senseRadius: 8, caution: 0.6, reproThreshold: 80, metabolism: 1.2 }),
  ]

  it('reports mean, min and max of each trait', () => {
    const stats = traitStats(bots)
    expect(stats?.senseRadius).toEqual({ mean: 6, min: 4, max: 8 })
    expect(stats?.reproThreshold).toEqual({ mean: 70, min: 60, max: 80 })
    expect(stats?.caution.mean).toBeCloseTo(0.4, 12)
    expect(stats?.metabolism.mean).toBeCloseTo(1, 12)
  })

  it('gives the mean traits as a Traits value', () => {
    expect(meanTraits(bots)).toMatchObject({ senseRadius: 6, reproThreshold: 70 })
  })

  it('is null for an empty population', () => {
    expect(traitStats([])).toBeNull()
    expect(meanTraits([])).toBeNull()
  })
})

describe('speedOf', () => {
  const tuning = { bot: { speed: 0.6, metabolismSpeed: 2 } } as unknown as Tuning
  const at = (metabolism: number): number => speedOf(botWith({ ...parent, metabolism }) , tuning)

  it('is the base speed at the default metabolism and scales with the trait', () => {
    expect(at(1)).toBe(0.6)
    expect(at(1.2)).toBeCloseTo(0.6 * 1.4, 12)
    expect(at(0.8)).toBeCloseTo(0.6 * 0.6, 12)
  })
})
