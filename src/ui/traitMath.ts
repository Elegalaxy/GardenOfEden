// Small pure helpers for the trait panels, kept apart from the drawing so they
// can be tested: how a trait value reads as text, which way a change points,
// and where a value sits inside its allowed range.

import type { TraitName } from '../sim/types.ts'

/** Decimals shown for each trait. */
export const TRAIT_DECIMALS: Record<TraitName, number> = {
  senseRadius: 1,
  caution: 2,
  reproThreshold: 1,
  metabolism: 2,
}

/** The number only, rounded for its trait: "6.4", "0.45". */
export function traitNumber(name: TraitName, value: number): string {
  return value.toFixed(TRAIT_DECIMALS[name])
}

export type Trend = 'up' | 'down' | 'flat'

/** Direction of a change once rounded the way the trait is shown, so "+0.00" never gets an arrow. */
export function trendOf(name: TraitName, delta: number): Trend {
  const rounded = Number(delta.toFixed(TRAIT_DECIMALS[name]))
  return rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat'
}

export const TREND_GLYPH: Record<Trend, string> = { up: '▲', down: '▼', flat: '■' }

/** A signed change: "+0.4", "−0.12" (a real minus sign), or "0.0" when it rounds to nothing. */
export function signedDelta(name: TraitName, delta: number): string {
  const trend = trendOf(name, delta)
  const text = Math.abs(delta).toFixed(TRAIT_DECIMALS[name])
  return trend === 'up' ? `+${text}` : trend === 'down' ? `−${text}` : text
}

/** Where `value` sits between `min` and `max`, 0 to 1, clamped. A degenerate range gives 0. */
export function fractionOf(value: number, min: number, max: number): number {
  if (!(max > min)) return 0
  return Math.min(1, Math.max(0, (value - min) / (max - min)))
}
