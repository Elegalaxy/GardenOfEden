// The frame loop. Time becomes ticks at a fixed rate: 10 ticks per second at
// 1x, times the speed. `planFrame` is the pure arithmetic (tested on its own);
// `startLoop` drives it from requestAnimationFrame and feeds the store.
//
// Two guards keep a slow or hidden tab from freezing the page. A frame is
// counted as at most `MAX_FRAME_MS` long, and at most `MAX_TICKS_PER_FRAME`
// ticks run per frame; if that cap is hit the leftover time is dropped.

import { advance, getSnapshot } from './store.ts'
import type { Speed } from './store.ts'

export const BASE_TICKS_PER_SECOND = 10
export const MAX_TICKS_PER_FRAME = 200
export const MAX_FRAME_MS = 250

export type FramePlan = {
  /** Ticks to run this frame. */
  ticks: number
  /** Time carried to the next frame, in ms (less than one tick). */
  accumulatorMs: number
  /** Progress toward the next tick, 0 up to (not including) 1. */
  alpha: number
}

export function ticksPerSecond(speed: Speed): number {
  return BASE_TICKS_PER_SECOND * speed
}

export function planFrame(accumulatorMs: number, frameMs: number, speed: Speed): FramePlan {
  const tickMs = 1000 / ticksPerSecond(speed)
  const total = accumulatorMs + Math.min(Math.max(frameMs, 0), MAX_FRAME_MS)
  const due = Math.floor(total / tickMs)
  if (due > MAX_TICKS_PER_FRAME) return { ticks: MAX_TICKS_PER_FRAME, accumulatorMs: 0, alpha: 0 }
  const left = total - due * tickMs
  return { ticks: due, accumulatorMs: left, alpha: left / tickMs }
}

/** Starts the loop and returns a function that stops it. */
export function startLoop(): () => void {
  let handle = 0
  let last: number | null = null
  let accumulatorMs = 0

  const frame = (now: number): void => {
    const frameMs = last === null ? 0 : now - last
    last = now
    const state = getSnapshot()
    if (state.paused) {
      accumulatorMs = 0
    } else {
      const plan = planFrame(accumulatorMs, frameMs, state.speed)
      accumulatorMs = plan.accumulatorMs
      advance(plan.ticks, plan.alpha)
    }
    handle = requestAnimationFrame(frame)
  }

  handle = requestAnimationFrame(frame)
  return () => cancelAnimationFrame(handle)
}
