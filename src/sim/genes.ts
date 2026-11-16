// The bloodline colour gene (M20). Every bot carries a `hue` in degrees (0 up to, not including, 360). It
// does nothing in the rules: it is a neutral marker that is handed down so a family shows as one colour
// on the map. Founders and placed bots get evenly spread hues (golden-angle steps by index). A child takes
// its mother's or its father's hue (a coin flip) and drifts it by up to `tuning.gene.drift` degrees either
// way; an asexual child takes only the drift draw. Draws come from the `gene` stream, so the other streams
// (and every run's behaviour) are unchanged. Only + - * / and floor are used, so it is exact on any engine.

import { nextFloat } from './rng.ts'
import type { RngStream, Tuning } from './types.ts'

/** The golden angle in degrees: successive multiples land far from each other on the colour wheel. */
const GOLDEN_ANGLE = 137.50776405003785

/** Wraps any finite number of degrees into 0 up to (not including) 360. No `%`, so negatives are exact. */
export function wrapHue(hue: number): number {
  const wrapped = hue - Math.floor(hue / 360) * 360
  // Float rounding can land exactly on 360 for a tiny negative input.
  return wrapped >= 360 ? 0 : wrapped
}

/** The hue for the nth founder or placed bot. */
export function goldenHue(n: number): number {
  return wrapHue(n * GOLDEN_ANGLE)
}

/**
 * A child's hue. Sexual (`fatherHue` given): draw 1 picks the mother's (below 0.5) or father's hue, draw 2
 * drifts it. Asexual (`fatherHue` null): only the drift draw. Two draws or one, always from `stream`.
 */
export function childHue(
  motherHue: number,
  fatherHue: number | null,
  tuning: Pick<Tuning, 'gene'>,
  stream: RngStream,
): number {
  let base = motherHue
  if (fatherHue !== null) base = nextFloat(stream) < 0.5 ? motherHue : fatherHue
  const drift = (2 * nextFloat(stream) - 1) * tuning.gene.drift
  return wrapHue(base + drift)
}
