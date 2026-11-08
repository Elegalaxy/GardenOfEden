import { describe, expect, it } from 'vitest'

import { ratePer, sampleAtOrBefore, windowChange } from './stats.ts'
import type { Sample } from './types.ts'

function sample(tick: number, pop: number, births: number, deaths: number, food = 0): Sample {
  return { tick, pop, births, deaths, food }
}

const samples: Sample[] = [sample(0, 10, 0, 0), sample(50, 12, 3, 1), sample(100, 11, 5, 4), sample(150, 15, 9, 4)]

describe('sampleAtOrBefore', () => {
  it('finds the newest sample not after the tick', () => {
    expect(sampleAtOrBefore(samples, 120)?.tick).toBe(100)
    expect(sampleAtOrBefore(samples, 150)?.tick).toBe(150)
  })

  it('falls back to the first sample for a tick before the run, and to undefined for none', () => {
    expect(sampleAtOrBefore(samples, -50)?.tick).toBe(0)
    expect(sampleAtOrBefore([], 10)).toBeUndefined()
  })
})

describe('windowChange', () => {
  it('measures change over the period', () => {
    expect(windowChange(samples, sample(150, 15, 9, 4), 'pop', 100)).toEqual({ span: 100, delta: 3 })
  })

  it('covers the whole run when it is younger than the period', () => {
    expect(windowChange(samples, sample(150, 15, 9, 4), 'births', 600)).toEqual({ span: 150, delta: 9 })
  })

  it('reports no history when the current sample is the oldest one', () => {
    expect(windowChange([sample(0, 10, 0, 0)], sample(0, 10, 0, 0), 'pop', 600)).toEqual({ span: 0, delta: 0 })
  })
})

describe('ratePer', () => {
  it('scales a total to a per-minute rate', () => {
    expect(ratePer(samples, sample(150, 15, 9, 4), 'births', 600, 600, 50)).toBe(36)
  })

  it('returns null until enough history exists', () => {
    expect(ratePer(samples, sample(20, 10, 1, 0), 'births', 600, 600, 50)).toBeNull()
  })
})
