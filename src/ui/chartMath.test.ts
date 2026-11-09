import { describe, expect, it } from 'vitest'

import type { Command } from '../sim/types.ts'
import { compact, eventBands, nearestIndex, niceMax, thin } from './chartMath.ts'

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

describe('eventBands', () => {
  const durations = { drought: 1500, bounty: 1000, plague: 800 }
  const at = (tick: number, cmd: Command): { tick: number; cmd: Command } => ({ tick, cmd })

  it('makes one band per timed event and none for meteors or other commands', () => {
    const bands = eventBands(
      [
        at(100, { type: 'placeBot', x: 1, y: 1 }),
        at(200, { type: 'triggerEvent', event: 'meteor', x: 5, y: 5 }),
        at(300, { type: 'triggerEvent', event: 'drought' }),
      ],
      durations,
      10_000,
    )
    expect(bands).toEqual([{ kind: 'drought', start: 300, end: 1800, ongoing: false, lane: 0 }])
  })

  it('cuts a running event off at the current tick', () => {
    const bands = eventBands([at(300, { type: 'triggerEvent', event: 'plague', x: 5, y: 5 })], durations, 500)
    expect(bands).toEqual([{ kind: 'plague', start: 300, end: 500, ongoing: true, lane: 0 }])
  })

  it('puts overlapping bands in different lanes and reuses a lane once it is free', () => {
    const bands = eventBands(
      [
        at(0, { type: 'triggerEvent', event: 'drought' }),
        at(500, { type: 'triggerEvent', event: 'plague', x: 1, y: 1 }),
        at(1600, { type: 'triggerEvent', event: 'bounty' }),
      ],
      durations,
      10_000,
    )
    expect(bands.map((band) => band.lane)).toEqual([0, 1, 0])
  })
})
