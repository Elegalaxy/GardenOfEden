// Heritable predator traits (H1, `Tuning.predator.traits`, off; acts only with ecology on, and only on predators that appeared while both
// were on: founders, placed and arriving predators start at 1 with generation 0 and no draw, a cub inherits).
//
// Three multipliers of the shipped numbers: `sense` (predator.senseRadius), `speed` (predator.speed) and `stamina` (predator.chaseTicks, how long
// a chase lasts before it gives up). `PREDATOR_TRAIT_NAMES` is the draw order: never reorder it, it changes every hash with traits on.
//
// `inheritPredatorTraits` mirrors `mutateTraits` (traits.ts): per trait, in order, a roll then an amount, always both draws (so six draws a cub,
// whatever the numbers), the trait changes by 1 + (2 * amount - 1) * strength when roll < rate, then it is clamped into its bounds.
// Draws come from the `predator` stream, taken only after a cub has found a valid territory. With strength 0 a cub copies its parent.
//
// `predatorDrain` is `ecology.drain` itself (no arithmetic) when a predator has no traits, else drain * (1 + sum of price * (trait - 1)), summed in
// name order: the price of a bigger body or longer sight is hunger. `predatorTrait` reads 1 when the key is absent, so every caller is unchanged
// with traits off (multiplying by 1 is exact). `predatorTraitStats` is the pure summary the harness and tests read.
// This file imports only rng.ts and types.ts (never predators.ts).

import { nextFloat } from './rng.ts'
import type { PredatorState, PredatorTraitName, PredatorTraits, RngStream, Tuning, World, WorldNode } from './types.ts'

/** Every predator trait, in the order used for mutation draws. Do not reorder: it changes every hash with traits on. */
export const PREDATOR_TRAIT_NAMES: readonly PredatorTraitName[] = ['sense', 'speed', 'stamina']

export const DEFAULT_PREDATOR_TRAITS: Readonly<PredatorTraits> = { sense: 1, speed: 1, stamina: 1 }

/** Throws when the trait numbers cannot work: rate in [0, 1], strength in [0, 1), every bound finite with 0 < min <= 1 <= max, prices finite and not negative. */
export function checkPredatorTraits(traits: Tuning['predator']['traits']): void {
  const { rate, strength } = traits.mutation
  if (!(Number.isFinite(rate) && rate >= 0 && rate <= 1)) throw new RangeError(`predator.traits.mutation.rate must be a number from 0 to 1, received ${rate}`)
  if (!(Number.isFinite(strength) && strength >= 0 && strength < 1)) {
    throw new RangeError(`predator.traits.mutation.strength must be a number from 0 up to (not including) 1, received ${strength}`)
  }
  for (const name of PREDATOR_TRAIT_NAMES) {
    const { min, max } = traits.bounds[name]
    if (!(Number.isFinite(min) && Number.isFinite(max) && min > 0 && min <= 1 && max >= 1)) {
      throw new RangeError(`predator.traits.bounds.${name} must have 0 < min <= 1 <= max, received min ${min} and max ${max}`)
    }
    const price = traits.price[name]
    if (!(Number.isFinite(price) && price >= 0)) throw new RangeError(`predator.traits.price.${name} must be a number from 0, received ${price}`)
  }
}

/** True when this world gives new predators traits: the rule is on, ecology is on and the world was made with it. */
export function traitsOn(world: Pick<World, 'ecology'>, tuning: Pick<Tuning, 'predator'>): boolean {
  return tuning.predator.traits.enabled && tuning.predator.ecology.enabled && world.ecology !== undefined
}

/** Give a predator its traits (a copy) and generation. Call after `startLife`, so the keys come in the order life, traits, generation. */
export function startTraits(hunt: PredatorState | null, traits: Readonly<PredatorTraits>, generation: number): void {
  if (hunt === null) return
  hunt.traits = { ...traits }
  hunt.generation = generation
}

/** A cub's traits from its parent's: see the header. Always takes `2 x PREDATOR_TRAIT_NAMES.length` draws. */
export function inheritPredatorTraits(parent: Readonly<PredatorTraits>, traits: Tuning['predator']['traits'], stream: RngStream): PredatorTraits {
  const child: PredatorTraits = { ...parent }
  for (const name of PREDATOR_TRAIT_NAMES) {
    const roll = nextFloat(stream)
    const amount = nextFloat(stream)
    let value = parent[name]
    if (roll < traits.mutation.rate) value *= 1 + (2 * amount - 1) * traits.mutation.strength
    const { min, max } = traits.bounds[name]
    child[name] = Math.min(max, Math.max(min, value))
  }
  return child
}

/** One trait of a predator; 1 when it has none. */
export function predatorTrait(hunt: Pick<PredatorState, 'traits'> | null, name: PredatorTraitName): number {
  return hunt?.traits?.[name] ?? 1
}

/** Energy a predator loses a tick: `ecology.drain` itself without traits, else drain * (1 + sum of price * (trait - 1)). */
export function predatorDrain(hunt: Pick<PredatorState, 'traits'> | null, tuning: Pick<Tuning, 'predator'>): number {
  const drain = tuning.predator.ecology.drain
  const traits = hunt?.traits
  if (traits === undefined) return drain
  let factor = 1
  for (const name of PREDATOR_TRAIT_NAMES) factor += tuning.predator.traits.price[name] * (traits[name] - 1)
  return drain * factor
}

export type PredatorTraitSummary = {
  count: number
  maxGeneration: number
  stats: Record<PredatorTraitName, { mean: number; min: number; max: number }>
}

/** Mean, min and max of each trait over the predators that have traits (in array order), and the highest generation; null when none do. */
export function predatorTraitStats(nodes: readonly Pick<WorldNode, 'kind' | 'hunt'>[]): PredatorTraitSummary | null {
  let count = 0
  let maxGeneration = 0
  const sums: PredatorTraits = { sense: 0, speed: 0, stamina: 0 }
  const mins: PredatorTraits = { sense: Infinity, speed: Infinity, stamina: Infinity }
  const maxs: PredatorTraits = { sense: -Infinity, speed: -Infinity, stamina: -Infinity }
  for (const node of nodes) {
    const traits = node.kind === 'predator' ? node.hunt?.traits : undefined
    if (traits === undefined) continue
    count += 1
    maxGeneration = Math.max(maxGeneration, node.hunt?.generation ?? 0)
    for (const name of PREDATOR_TRAIT_NAMES) {
      sums[name] += traits[name]
      mins[name] = Math.min(mins[name], traits[name])
      maxs[name] = Math.max(maxs[name], traits[name])
    }
  }
  if (count === 0) return null
  const stats = {} as PredatorTraitSummary['stats']
  for (const name of PREDATOR_TRAIT_NAMES) stats[name] = { mean: sums[name] / count, min: mins[name], max: maxs[name] }
  return { count, maxGeneration, stats }
}
