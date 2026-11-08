import { describe, expect, it } from 'vitest'

import { compact, nearestIndex, niceMax, thin } from './chartMath.ts'

describe('niceMax', () => {
  it('rounds up to a value that splits into round steps', () => {
    expect(niceMax(41, 4)).toBe(60)
    expect(niceMax(100, 4)).toBe(100)
    expect(niceMax(3100, 4)).toBe(3200)
    expect(niceMax(7, 4)).toBe(8)
  })

  it('has a sane floor for zero or negative input', () => {
    expect(niceMax(0, 4)).toBe(4)
    expect(niceMax(-3, 4)).toBe(4)
  })
})

describe('thin', () => {
  it('leaves short lists alone', () => {
    const list = [1, 2, 3]
    expect(thin(list, 10)).toBe(list)
  })

  it('keeps the first and last of a long list and respects the limit', () => {
    const list = Array.from({ length: 2000 }, (_, i) => i)
    const out = thin(list, 100)
    expect(out[0]).toBe(0)
    expect(out.at(-1)).toBe(1999)
    expect(out.length).toBeLessThanOrEqual(101)
    expect(out.length).toBeGreaterThan(50)
  })
})

describe('nearestIndex', () => {
  const ticks = [0, 50, 100, 150]
  it('finds the closest tick', () => {
    expect(nearestIndex(ticks, 60)).toBe(1)
    expect(nearestIndex(ticks, 80)).toBe(2)
    expect(nearestIndex(ticks, -10)).toBe(0)
    expect(nearestIndex(ticks, 999)).toBe(3)
    expect(nearestIndex([], 5)).toBe(-1)
  })
})

describe('compact', () => {
  it('shortens big numbers', () => {
    expect(compact(950)).toBe('950')
    expect(compact(12_400)).toBe('12.4k')
  })
})
