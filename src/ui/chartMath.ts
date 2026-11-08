// Arithmetic for the population chart, kept apart from the drawing so it can
// be tested: round axis ends, thinning a long series to the pixels available,
// and finding the point or marker nearest the pointer. All pure.

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
