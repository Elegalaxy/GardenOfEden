import { describe, expect, it } from 'vitest'

import { BASE_TICKS_PER_SECOND, MAX_FRAME_MS, MAX_TICKS_PER_FRAME, planFrame, ticksPerSecond } from './loop.ts'

describe('planFrame', () => {
  it('runs 10 ticks per second at 1x, scaled by speed', () => {
    expect(BASE_TICKS_PER_SECOND).toBe(10)
    expect(ticksPerSecond(1)).toBe(10)
    expect(ticksPerSecond(64)).toBe(640)
  })

  it('carries a partial tick to the next frame', () => {
    const first = planFrame(0, 60, 1) // 100 ms per tick
    expect(first.ticks).toBe(0)
    expect(first.alpha).toBeCloseTo(0.6, 10)
    const second = planFrame(first.accumulatorMs, 60, 1)
    expect(second.ticks).toBe(1)
    expect(second.accumulatorMs).toBeCloseTo(20, 10)
    expect(second.alpha).toBeCloseTo(0.2, 10)
  })

  it('runs several ticks in one frame at a high speed', () => {
    const plan = planFrame(0, 100, 16) // 160 ticks per second
    expect(plan.ticks).toBe(16)
  })

  it('caps ticks per frame and drops the backlog', () => {
    const plan = planFrame(0, 1000, 64) // counted as MAX_FRAME_MS, then capped
    expect(plan.ticks).toBeLessThanOrEqual(MAX_TICKS_PER_FRAME)
    const capped = planFrame(5000, 16, 64)
    expect(capped).toEqual({ ticks: MAX_TICKS_PER_FRAME, accumulatorMs: 0, alpha: 0 })
    expect(MAX_FRAME_MS).toBeLessThanOrEqual(1000)
  })

  it('ignores a negative frame time', () => {
    expect(planFrame(0, -50, 4)).toEqual({ ticks: 0, accumulatorMs: 0, alpha: 0 })
  })
})
