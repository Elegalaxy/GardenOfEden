// Arithmetic for the population chart, kept apart from the drawing so it can
// be tested: round axis ends, thinning a long series to the pixels available,
// finding the point or marker nearest the pointer, and the shaded bands for timed
// world events. All pure.

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
