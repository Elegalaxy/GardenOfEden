// Arithmetic for the population chart, kept apart from the drawing so it can
// be tested: round axis ends, thinning a long series to the pixels available,
// finding the point or marker nearest the pointer, choosing x-axis ticks that fit the
// width without their labels touching, and the shaded bands for timed world events. All pure.

import type { Command, TimedEventKind } from '../sim/types.ts'

/** A "round" axis maximum at or above `value` that divides into `divisions` equal round steps (at least 1 step of 1). */
export function niceMax(value: number, divisions: number): number {
  if (!(value > 0)) return divisions
  const rough = value / divisions
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  for (const factor of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const step = factor * magnitude
    if (step >= rough) return step * divisions
  }
  return 10 * magnitude * divisions
}

/**
 * Keeps at most about `limit` items of `items`, evenly spaced, always including the first and the last.
 * Returns the same array when it is already short enough.
 */
export function thin<T>(items: readonly T[], limit: number): readonly T[] {
  if (items.length <= limit || limit < 2) return items
  const stride = Math.ceil((items.length - 1) / (limit - 1))
  const out: T[] = []
  for (let i = 0; i < items.length - 1; i += stride) out.push(items[i]!)
  out.push(items[items.length - 1]!)
  return out
}

/** Index of the value in the ascending `ticks` nearest to `tick`; -1 for an empty list. */
export function nearestIndex(ticks: readonly number[], tick: number): number {
  if (ticks.length === 0) return -1
  let low = 0
  let high = ticks.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (ticks[mid]! < tick) low = mid + 1
    else high = mid
  }
  if (low > 0 && tick - ticks[low - 1]! <= ticks[low]! - tick) return low - 1
  return low
}

/** Thousands separators for axis labels; 12400 -> "12.4k" above 9999 to keep labels short. */
export function compact(value: number): string {
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 100) / 10}k`
  return String(Math.round(value))
}

/** A tick number as an axis label: plain ("5000") or abbreviated from 1000 up ("5k", "1.2k"). */
export function tickLabel(value: number, abbreviate: boolean): string {
  if (abbreviate && Math.abs(value) >= 1000) return `${Math.round(value / 100) / 10}k`
  return compact(value)
}

/** Round steps (1, 2, 2.5 and 5 times a power of ten) from `low` up to `high`, smallest first. */
function niceSteps(low: number, high: number): number[] {
  const steps: number[] = []
  for (let magnitude = 10 ** Math.floor(Math.log10(Math.max(low, 1e-9))); magnitude <= high * 10; magnitude *= 10) {
    for (const factor of [1, 2, 2.5, 5]) {
      const step = factor * magnitude
      if (step >= low && step <= high) steps.push(step)
    }
  }
  return steps
}

export type AxisTick = { value: number; label: string }

export type AxisTickOptions = {
  /** Estimated width of one character of the axis font, in pixels. */
  charPx?: number
  /** Smallest empty space between two neighbouring labels. */
  gapPx?: number
  /** Room the first and the last label may use outside the plot (the chart margins). */
  padLeft?: number
  padRight?: number
}

/**
 * Round tick values for the x axis of a plot `plotWidth` pixels wide that shows ticks `x0` to `x1`.
 * It looks for a round step that gives two to five ticks, smallest step (most ticks) first, and takes the first
 * whose labels do not touch (each label is centred on its tick and `charPx` wide per character, with `gapPx`
 * between neighbours); each step is tried with plain numbers first, then abbreviated ("5k"). Labels that would
 * repeat are never used. When nothing fits it returns the single last tick, so a very narrow chart drops labels
 * instead of overlapping them.
 */
export function xAxisTicks(x0: number, x1: number, plotWidth: number, options: AxisTickOptions = {}): AxisTick[] {
  const { charPx = 6.6, gapPx = 10, padLeft = 16, padRight = 16 } = options
  const span = x1 - x0
  const last: AxisTick = { value: x1, label: tickLabel(x1, true) }
  if (!(span > 0) || !(plotWidth > 0)) return [last]
  const at = (value: number): number => ((value - x0) / span) * plotWidth

  // The smallest round step that gives between two and five ticks and whose labels fit, so the most ticks that fit.
  for (const step of niceSteps(span / 5, span)) {
    const values: number[] = []
    for (let v = Math.ceil(x0 / step) * step; v <= x1 + 1e-9; v += step) values.push(Math.round(v))
    if (values.length < 2 || values.length > 5) continue
    for (const abbreviate of [false, true]) {
      const labels = values.map((v) => tickLabel(v, abbreviate))
      if (new Set(labels).size !== labels.length) continue
      let ok = true
      let previousEnd = -Infinity
      for (let i = 0; i < values.length && ok; i += 1) {
        const half = (labels[i]!.length * charPx) / 2
        const left = at(values[i]!) - half
        const right = at(values[i]!) + half
        if (left < -padLeft || right > plotWidth + padRight || left - previousEnd < gapPx) ok = false
        previousEnd = right
      }
      if (ok) return values.map((value, i) => ({ value, label: labels[i]! }))
    }
  }
  return [last]
}

/** The stretch of a run in which a timed world event (drought, bounty, plague) was in force. */
export type EventBand = {
  kind: TimedEventKind
  /** Tick the player triggered it. */
  start: number
  /** Tick it ends (or `nowTick` if it is still running). */
  end: number
  /** Still in force at `nowTick`. */
  ongoing: boolean
  /** 0, 1, 2 ...: the row its label sits in, so overlapping bands do not write over each other. */
  lane: number
}

/**
 * One band per timed event command, from its tick to `tick + duration` (cut off at `nowTick` while it runs).
 * Meteors are instant and have no band. Bands that overlap in time get different lanes.
 */
export function eventBands(
  commands: readonly { tick: number; cmd: Command }[],
  durations: Record<TimedEventKind, number>,
  nowTick: number,
): EventBand[] {
  const bands: EventBand[] = []
  const laneEnds: number[] = []
  for (const { tick, cmd } of commands) {
    if (cmd.type !== 'triggerEvent' || cmd.event === 'meteor') continue
    const end = tick + durations[cmd.event]
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= tick)
    if (lane < 0) lane = laneEnds.length
    laneEnds[lane] = end
    bands.push({ kind: cmd.event, start: tick, end: Math.min(end, nowTick), ongoing: end > nowTick, lane })
  }
  return bands
}
