// The map's 60k caution bar as a runnable check: `npm run sim -- --caution-bar` (cli.ts). It runs the survey machinery (`surveySeed`)
// for each seed and judges the population mean caution trait at the end of the run, the same number as the survey's `caution` column
// (two decimals, `traitCell`). A seed with nobody alive at the end is extinct and has no caution.
//
// The bar (doc/GAME_DESIGN.md changelog, M120 of 2026-11-23, user-approved; it replaced the old a..c >= 0.402 and d..f >= 0.39 floors, which
// were a lucky seed draw on the old map): over seeds a..t at 60,000 ticks the median caution of the living seeds is at least
// `CAUTION_BAR_MEDIAN` and at most `CAUTION_BAR_MAX_EXTINCT` seeds are extinct. Only those two numbers decide PASS or FAIL; the count of
// living seeds below `CAUTION_INFO_BELOW` (the old d..f floor) is printed for information. A run with other seeds, ticks or settings is
// judged against the same numbers, so read it as a comparison with the no-terrain baseline (median 0.415, 0 extinct), not as the official bar.
// Pure functions only: no I/O, no sim imports beyond types.

import type { SeedSurvey } from './survey.ts'

/** Median caution of the living seeds must be at least this (GAME_DESIGN changelog, M120). */
export const CAUTION_BAR_MEDIAN = 0.41
/** At most this many extinct seeds (of the 20 in a..t). */
export const CAUTION_BAR_MAX_EXTINCT = 1
/** Living seeds below this caution are only counted, never gate (the old d..f floor). */
export const CAUTION_INFO_BELOW = 0.39
/** The official bar's seeds and length. */
export const CAUTION_BAR_SEEDS = 'abcdefghijklmnopqrst'.split('')
export const CAUTION_BAR_TICKS = 60000

export type CautionRow = { seed: string; final: number; caution: number | null }

export type CautionVerdict = {
  living: number
  extinct: number
  median: number | null
  below: number
  pass: boolean
}

/** One survey row as a caution row: the mean caution rounded to two decimals as the survey prints it, or null when nobody is alive. */
export function cautionRow(survey: Pick<SeedSurvey, 'seed' | 'final' | 'traits'>): CautionRow {
  return { seed: survey.seed, final: survey.final, caution: survey.traits === null ? null : Number(survey.traits.caution.toFixed(2)) }
}

/** Median of a list (the mean of the two middle values for an even count), rounded to four decimals so 0.41 compares cleanly. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length / 2
  const value = sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2]! : (sorted[mid - 1]! + sorted[mid]!) / 2
  return Math.round(value * 10000) / 10000
}

/** The verdict for a set of seeds. With no living seed there is no median and the bar fails. */
export function judgeCautionBar(rows: readonly CautionRow[]): CautionVerdict {
  const live = rows.filter((row) => row.caution !== null).map((row) => row.caution as number)
  const extinct = rows.length - live.length
  const med = median(live)
  const below = live.filter((c) => c < CAUTION_INFO_BELOW).length
  const pass = med !== null && med >= CAUTION_BAR_MEDIAN && extinct <= CAUTION_BAR_MAX_EXTINCT
  return { living: live.length, extinct, median: med, below, pass }
}

/** The printed table and summary. */
export function formatCautionBar(rows: readonly CautionRow[]): string {
  const lines = ['     seed   final  caution  extinct']
  for (const row of rows) {
    lines.push(`${row.seed.padStart(9)}${String(row.final).padStart(8)}${(row.caution === null ? '-' : row.caution.toFixed(2)).padStart(9)}${(row.caution === null ? 'yes' : 'no').padStart(9)}`)
  }
  const v = judgeCautionBar(rows)
  lines.push('')
  lines.push(`living ${v.living}  extinct ${v.extinct} of ${rows.length}  median caution of living ${v.median === null ? '-' : v.median.toFixed(3)}  living below ${CAUTION_INFO_BELOW}: ${v.below} (information only)`)
  lines.push(`bar: median >= ${CAUTION_BAR_MEDIAN} and at most ${CAUTION_BAR_MAX_EXTINCT} extinct  ->  ${v.pass ? 'PASS' : 'FAIL'}`)
  return lines.join('\n')
}
