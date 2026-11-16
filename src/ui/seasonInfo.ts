// What the page shows about the season (S3): the stats tile's name, regrowth multiplier and countdown.
// Pure: it reads the tick and the seasons tuning through `seasonAt` (the sim's own function, so the page and the
// rules never disagree). The four names are the four quarters of the period, tick 0 being the start of spring.
// With seasons off there is one fixed answer ("Off", multiplier 1) so the tile never changes size.

import { seasonAt, type SeasonName } from '../sim/seasons.ts'
import type { Tuning } from '../sim/types.ts'

export type SeasonSummary = {
  enabled: boolean
  /** "Spring", "Summer", "Autumn", "Winter", or "Off". */
  value: string
  /** The tile's muted line, e.g. "x0.74 · 620 to winter" (x is the regrowth multiplier; the tile title spells it out). */
  detail: string
}

const ORDER: readonly SeasonName[] = ['spring', 'summer', 'autumn', 'winter']

export function seasonLabel(name: SeasonName): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** The season that follows `name` (winter wraps to spring). */
export function nextSeason(name: SeasonName): SeasonName {
  return ORDER[(ORDER.indexOf(name) + 1) % ORDER.length]!
}

/** A regrowth multiplier as "x0.74" (two decimals). */
export function formatMultiplier(value: number): string {
  return `x${value.toFixed(2)}`
}

const numberFormat = new Intl.NumberFormat('en-US')

export function seasonSummary(tick: number, tuning: Pick<Tuning, 'seasons'>): SeasonSummary {
  const info = seasonAt(tick, tuning)
  if (!info.enabled) return { enabled: false, value: 'Off', detail: `${formatMultiplier(1)} · no seasons` }
  return {
    enabled: true,
    value: seasonLabel(info.name),
    detail: `${formatMultiplier(info.multiplier)} · ${numberFormat.format(info.ticksToNext)} to ${nextSeason(info.name)}`,
  }
}
