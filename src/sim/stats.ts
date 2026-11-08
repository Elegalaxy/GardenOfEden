// Read helpers for the stats samples. Samples are taken every
// `stats.sampleEvery` ticks, so the newest one can lag the world by a few
// ticks; callers pass a `current` sample from `takeSample(world)` for the
// freshest numbers. All functions are pure.

import type { Sample } from './types.ts'

export type SampleField = 'pop' | 'births' | 'deaths' | 'food'

/** The newest sample at or before `tick`, or the first sample if none is that old; undefined when there are none. */
export function sampleAtOrBefore(samples: readonly Sample[], tick: number): Sample | undefined {
  let found: Sample | undefined
  for (const sample of samples) {
    if (sample.tick > tick) break
    found = sample
  }
  return found ?? samples[0]
}

export type WindowChange = {
  /** Ticks actually covered, at most the window asked for. 0 when there is no history. */
  span: number
  /** `current[field]` minus the value at the start of the span. */
  delta: number
}

/** How much `field` changed over the last `windowTicks` ticks (less if the run is younger than that). */
export function windowChange(
  samples: readonly Sample[],
  current: Sample,
  field: SampleField,
  windowTicks: number,
): WindowChange {
  const start = sampleAtOrBefore(samples, current.tick - windowTicks)
  if (start === undefined || start.tick >= current.tick) return { span: 0, delta: 0 }
  return { span: current.tick - start.tick, delta: current[field] - start[field] }
}

/**
 * Average change of a running total per `perTicks` ticks, measured over the last `windowTicks`.
 * Null until at least `minSpan` ticks of history exist (a rate from a few ticks would be noise).
 */
export function ratePer(
  samples: readonly Sample[],
  current: Sample,
  field: 'births' | 'deaths',
  windowTicks: number,
  perTicks: number,
  minSpan: number,
): number | null {
  const { span, delta } = windowChange(samples, current, field, windowTicks)
  if (span < minSpan || span <= 0) return null
  return (delta / span) * perTicks
}
