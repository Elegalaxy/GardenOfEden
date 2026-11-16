// Seasons (S1). Resource regrowth swings with the tick: multiplier = base + amplitude * sin(2 * pi * tick / period).
// Tick 0 is the start of spring (multiplier = base, rising), a quarter period later summer starts and the sine peaks
// (base + amplitude), half a period in autumn starts (base again, falling), three quarters in winter starts and the
// sine bottoms out (base - amplitude). The four season names are the four quarters of the period. Only resource
// regrowth is seasonal: water, ruins, fertility, brains and memory ignore it, and bots do not perceive it. The
// function is pure: no random draws and no state, so a run is still fully set by seed and commands, and it takes a
// `Pick` of the tuning so the page can call it later. With `enabled` false the multiplier is the literal 1 (not
// base + 0), so a world without seasons keeps every number it had before. Only exactMath `sin` and + - * / are used
// (the phase is `tick - floor(tick / period) * period`, no `%`), so the result is bit-exact across engines.

import { sin } from './exactMath.ts'
import type { Tuning } from './types.ts'

export type SeasonName = 'spring' | 'summer' | 'autumn' | 'winter'

export type SeasonInfo = {
  enabled: boolean
  /** What resource regrowth is multiplied by this tick: exactly 1 when seasons are off. */
  multiplier: number
  name: SeasonName
  /** Fraction of the year gone, 0 (inclusive) to 1 (exclusive). */
  phase: number
  /** Ticks until the next season starts (at least 1). */
  ticksToNext: number
}

/** The largest swing allowed: regrowth never drops below half of base. */
export const MAX_AMPLITUDE = 0.5

const TWO_PI = 2 * Math.PI
const NAMES: readonly SeasonName[] = ['spring', 'summer', 'autumn', 'winter']

/** Throws a RangeError when the period is not a positive number or the amplitude is outside 0 to MAX_AMPLITUDE. */
export function checkSeasons(seasons: Tuning['seasons']): void {
  if (!(Number.isFinite(seasons.period) && seasons.period > 0)) {
    throw new RangeError(`seasons.period must be a number above 0, received ${seasons.period}`)
  }
  if (!(Number.isFinite(seasons.amplitude) && seasons.amplitude >= 0 && seasons.amplitude <= MAX_AMPLITUDE)) {
    throw new RangeError(`seasons.amplitude must be from 0 to ${MAX_AMPLITUDE}, received ${seasons.amplitude}`)
  }
}

export function seasonAt(tick: number, tuning: Pick<Tuning, 'seasons'>): SeasonInfo {
  const { seasons } = tuning
  checkSeasons(seasons)
  const into = tick - Math.floor(tick / seasons.period) * seasons.period
  const phase = into / seasons.period
  const quarter = Math.min(3, Math.floor(phase * 4))
  const ticksToNext = Math.max(1, Math.ceil(((quarter + 1) * seasons.period) / 4 - into))
  const multiplier = seasons.enabled ? seasons.base + seasons.amplitude * sin((TWO_PI * tick) / seasons.period) : 1
  return { enabled: seasons.enabled, multiplier, name: NAMES[quarter], phase, ticksToNext }
}
