// Traits of a population: the numbers children inherit. Three small jobs.
//
// mutateTraits  a newborn's traits from its parent's. For each trait, in the
//               order of TRAIT_NAMES, two draws from the `birth` stream are
//               always taken (so the draw count never depends on the numbers):
//               first a roll that decides whether the trait changes (it does
//               when roll < mutation.rate), then an amount. A changed trait is
//               multiplied by 1 + (2 * amount - 1) * strength, so it moves by at
//               most +-strength of itself. Then it is clamped into its bounds
//               (whether or not it changed). With strength 0 a child copies its
//               parent, apart from that clamp.
// traitStats    mean, min and max of each trait over a list of bots.
// meanTraits    just the means; what a stats Sample stores.
//
// Reading the means walks the bots in id order, so the sums are reproducible.

import { nextFloat } from './rng.ts'
import type { Bot, RngStream, TraitName, Traits, Tuning } from './types.ts'

/** Every trait, in the order used for mutation draws. Do not reorder: it changes every hash. */
export const TRAIT_NAMES: readonly TraitName[] = ['senseRadius', 'caution', 'reproThreshold', 'metabolism']

export type TraitStat = { mean: number; min: number; max: number }

export function mutateTraits(parent: Traits, mutation: Tuning['mutation'], stream: RngStream): Traits {
  const child: Traits = { ...parent }
  for (const name of TRAIT_NAMES) {
    const roll = nextFloat(stream)
    const amount = nextFloat(stream)
    let value = parent[name]
    if (roll < mutation.rate) value *= 1 + (2 * amount - 1) * mutation.strength
    const { min, max } = mutation.bounds[name]
    child[name] = Math.min(max, Math.max(min, value))
  }
  return child
}

/** Mean, min and max of each trait; null when there are no bots. */
export function traitStats(bots: readonly Pick<Bot, 'traits'>[]): Record<TraitName, TraitStat> | null {
  if (bots.length === 0) return null
  const stats = {} as Record<TraitName, TraitStat>
  for (const name of TRAIT_NAMES) {
    let sum = 0
    let min = Infinity
    let max = -Infinity
    for (const bot of bots) {
      const value = bot.traits[name]
      sum += value
      if (value < min) min = value
      if (value > max) max = value
    }
    stats[name] = { mean: sum / bots.length, min, max }
  }
  return stats
}

/** The population mean of each trait; null when there are no bots. */
export function meanTraits(bots: readonly Pick<Bot, 'traits'>[]): Traits | null {
  const stats = traitStats(bots)
  if (stats === null) return null
  return {
    senseRadius: stats.senseRadius.mean,
    caution: stats.caution.mean,
    reproThreshold: stats.reproThreshold.mean,
    metabolism: stats.metabolism.mean,
  }
}
