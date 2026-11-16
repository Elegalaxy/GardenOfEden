import { describe, expect, it } from 'vitest'

import type { Tuning } from '../sim/types.ts'
import { formatMultiplier, nextSeason, seasonLabel, seasonSummary } from './seasonInfo.ts'

const on = { seasons: { enabled: true, period: 400, amplitude: 0.4, base: 1 } } as Pick<Tuning, 'seasons'>
const off = { seasons: { ...on.seasons, enabled: false } } as Pick<Tuning, 'seasons'>

describe('seasonSummary', () => {
  it('names the four quarters from tick 0 (spring first)', () => {
    expect(seasonSummary(0, on).value).toBe('Spring')
    expect(seasonSummary(100, on).value).toBe('Summer')
    expect(seasonSummary(250, on).value).toBe('Autumn')
    expect(seasonSummary(399, on).value).toBe('Winter')
    expect(seasonSummary(400, on).value).toBe('Spring')
  })

  it('shows the multiplier and the ticks to the next season', () => {
    expect(seasonSummary(0, on).detail).toBe('x1.00 · 100 to summer')
    expect(seasonSummary(100, on).detail).toBe('x1.40 · 100 to autumn')
    expect(seasonSummary(300, on).detail).toBe('x0.60 · 100 to spring')
    expect(seasonSummary(399, on).detail).toContain('1 to spring')
  })

  it('is a fixed "Off" answer when seasons are disabled', () => {
    expect(seasonSummary(0, off)).toEqual({ enabled: false, value: 'Off', detail: 'x1.00 · no seasons' })
    expect(seasonSummary(12345, off)).toEqual(seasonSummary(0, off))
  })
})

describe('helpers', () => {
  it('cycles and formats', () => {
    expect(nextSeason('winter')).toBe('spring')
    expect(nextSeason('spring')).toBe('summer')
    expect(seasonLabel('autumn')).toBe('Autumn')
    expect(formatMultiplier(0.736)).toBe('x0.74')
  })
})
