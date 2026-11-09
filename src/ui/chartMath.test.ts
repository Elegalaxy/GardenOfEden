import { describe, expect, it } from 'vitest'

import type { Command } from '../sim/types.ts'
import { compact, eventBands, nearestIndex, niceMax, thin, tickLabel, xAxisTicks } from './chartMath.ts'

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

describe('tickLabel', () => {
  it('writes plain numbers, or abbreviates from 1000 up', () => {
    expect(tickLabel(950, false)).toBe('950')
    expect(tickLabel(950, true)).toBe('950')
    expect(tickLabel(5000, false)).toBe('5000')
    expect(tickLabel(5000, true)).toBe('5k')
    expect(tickLabel(1200, true)).toBe('1.2k')
    expect(tickLabel(12_400, false)).toBe('12.4k')
  })
})

describe('xAxisTicks', () => {
  const CHAR = 6.6
  const GAP = 10

  /** True when no two labels (centred on their tick) are closer than the gap. */
  function spaced(ticks: { value: number; label: string }[], x0: number, x1: number, width: number): boolean {
    for (let i = 1; i < ticks.length; i += 1) {
      const a = ticks[i - 1]!
      const b = ticks[i]!
      const aRight = ((a.value - x0) / (x1 - x0)) * width + (a.label.length * CHAR) / 2
      const bLeft = ((b.value - x0) / (x1 - x0)) * width - (b.label.length * CHAR) / 2
      if (bLeft - aRight < GAP) return false
    }
    return true
  }

  it('gives five round ticks on a wide plot', () => {
    const ticks = xAxisTicks(0, 20_000, 600)
    expect(ticks.map((tick) => tick.value)).toEqual([0, 5000, 10_000, 15_000, 20_000])
    expect(ticks.map((tick) => tick.label)).toEqual(['0', '5000', '10k', '15k', '20k'])
    expect(xAxisTicks(0, 11_100, 600)).toHaveLength(5)
  })

  it('starts at the first round value inside the range when the run starts later', () => {
    const ticks = xAxisTicks(1234, 5234, 600)
    expect(ticks[0]!.value).toBeGreaterThanOrEqual(1234)
    expect(ticks.at(-1)!.value).toBeLessThanOrEqual(5234)
    expect(ticks.length).toBeGreaterThanOrEqual(3)
  })

  it('uses fewer ticks as the plot narrows, and never lets labels touch', () => {
    const wide = xAxisTicks(0, 11_100, 600).length
    const narrow = xAxisTicks(0, 11_100, 146).length
    expect(narrow).toBeLessThan(wide)
    for (const width of [60, 90, 120, 146, 200, 280, 400, 600]) {
      for (const x1 of [37, 300, 1111, 4445, 11_100, 99_999]) {
        const ticks = xAxisTicks(0, x1, width)
        expect(ticks.length).toBeGreaterThan(0)
        if (ticks.length > 1) expect(spaced(ticks, 0, x1, width)).toBe(true)
      }
    }
  })

  it('abbreviates thousands when plain numbers would not fit', () => {
    const plain = xAxisTicks(0, 4000, 300)
    expect(plain.map((tick) => tick.label)).toEqual(['0', '1000', '2000', '3000', '4000'])
    const squeezed = xAxisTicks(0, 4000, 120)
    expect(squeezed.map((tick) => tick.label)).toEqual(['0', '1k', '2k', '3k', '4k'])
  })

  it('never repeats a label', () => {
    for (const x1 of [5, 12, 1500, 1520]) {
      const labels = xAxisTicks(0, x1, 300).map((tick) => tick.label)
      expect(new Set(labels).size).toBe(labels.length)
    }
  })

  it('drops to one label on a plot too narrow for two', () => {
    const ticks = xAxisTicks(0, 11_100, 20)
    expect(ticks).toHaveLength(1)
  })

  it('keeps the end labels inside the margins', () => {
    const ticks = xAxisTicks(0, 11_100, 146, { padLeft: 36, padRight: 44 })
    const first = ticks[0]!
    const left = ((first.value - 0) / 11_100) * 146 - (first.label.length * 6.6) / 2
    expect(left).toBeGreaterThanOrEqual(-36)
  })

  it('handles an empty or reversed range', () => {
    expect(xAxisTicks(10, 10, 300)).toHaveLength(1)
    expect(xAxisTicks(10, 5, 300)).toHaveLength(1)
    expect(xAxisTicks(0, 100, 0)).toHaveLength(1)
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
