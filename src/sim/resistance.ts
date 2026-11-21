// Heritable disease resistance (R1, `Tuning.resistance`, off). A latent gene: nothing exists until the first outbreak.
//
// activate         at the first outbreak with the rule on (disease.ts `startOutbreak`), `World.resistance` is created with its own RNG stream
//                  (`deriveStream(seed, 'resist:' + tick)`, not one of the named streams, so `world.rng` is untouched) and every living bot, in id
//                  order, gets `resist` = founderMin + draw * (founderMax - founderMin), one draw each. `founderMean` is their mean.
// inheritResist    a newborn's resist (reproduction.ts, only once `World.resistance` exists): a sexual child first takes one pick draw (below 0.5
//                  the mother's value, else the father's), then always a roll and an amount like `mutateTraits` (changed when roll < rate, by
//                  1 + (2 * amount - 1) * strength), then is clamped to min..max. So 3 draws per sexual child, 2 per asexual child.
// catchThreshold   the dose that makes a bot fall sick: catchAfter x (1 + catchWeight x (r - 1)); plain `catchAfter` for a bot with no resist.
// sickLength       ticks sick: round(sickTicks / (1 + sickWeight x (r - 1))), at least 1; plain `sickTicks` for a bot with no resist.
// A bot with no `resist` key takes the plain disease number through a branch (no multiplication by 1), so a run with the rule off is bit-identical.
// This file imports only rng and types.

import { deriveStream, nextFloat } from './rng.ts'
import type { Bot, RngStream, Tuning, World } from './types.ts'

/** Throws when the resistance numbers cannot work: 1 <= min <= founderMin <= founderMax <= max, weights 0 to 1, upkeep from 0, rate 0 to 1, strength from 0 below 1. */
export function checkResistance(t: Tuning['resistance']): void {
  if (typeof t.enabled !== 'boolean') throw new RangeError(`resistance.enabled must be true or false, received ${String(t.enabled)}`)
  for (const name of ['founderMin', 'founderMax', 'min', 'max'] as const) {
    if (!Number.isFinite(t[name])) throw new RangeError(`resistance.${name} must be a finite number, received ${t[name]}`)
  }
  if (!(t.min >= 1 && t.min <= t.founderMin && t.founderMin <= t.founderMax && t.founderMax <= t.max)) {
    throw new RangeError(`resistance needs 1 <= min <= founderMin <= founderMax <= max, received min ${t.min}, founderMin ${t.founderMin}, founderMax ${t.founderMax}, max ${t.max}`)
  }
  for (const name of ['catchWeight', 'sickWeight'] as const) {
    if (!(Number.isFinite(t[name]) && t[name] >= 0 && t[name] <= 1)) throw new RangeError(`resistance.${name} must be a number from 0 to 1, received ${t[name]}`)
  }
  if (!(Number.isFinite(t.upkeep) && t.upkeep >= 0)) throw new RangeError(`resistance.upkeep must be a finite number from 0, received ${t.upkeep}`)
  if (!(Number.isFinite(t.mutation.rate) && t.mutation.rate >= 0 && t.mutation.rate <= 1)) throw new RangeError(`resistance.mutation.rate must be a number from 0 to 1, received ${t.mutation.rate}`)
  if (!(Number.isFinite(t.mutation.strength) && t.mutation.strength >= 0 && t.mutation.strength < 1)) throw new RangeError(`resistance.mutation.strength must be a number from 0 up to below 1, received ${t.mutation.strength}`)
}

export function resistanceOn(tuning: Pick<Tuning, 'resistance'>): boolean {
  return tuning.resistance.enabled
}

/** Creates `World.resistance` and gives every living bot, in id order, one founder draw. Call once, at the first outbreak. */
export function activate(world: World, tuning: Pick<Tuning, 'resistance'>): void {
  const t = tuning.resistance
  const stream = deriveStream(world.seed, `resist:${world.tick}`)
  world.resistance = { stream, founderMean: 0, activatedTick: world.tick }
  let sum = 0
  for (const bot of world.bots) {
    bot.resist = t.founderMin + nextFloat(stream) * (t.founderMax - t.founderMin)
    sum += bot.resist
  }
  if (world.bots.length > 0) world.resistance.founderMean = sum / world.bots.length
}

/** A newborn's resist from its mother's and (when sexual) its father's; see the header for the draws. */
export function inheritResist(motherResist: number, fatherResist: number | null, t: Tuning['resistance'], stream: RngStream): number {
  let value = motherResist
  if (fatherResist !== null) value = nextFloat(stream) < 0.5 ? motherResist : fatherResist
  const roll = nextFloat(stream)
  const amount = nextFloat(stream)
  if (roll < t.mutation.rate) value *= 1 + (2 * amount - 1) * t.mutation.strength
  return Math.min(t.max, Math.max(t.min, value))
}

/** The dose at which this bot falls sick. */
export function catchThreshold(bot: Pick<Bot, 'resist'>, t: Tuning['resistance'], catchAfter: number): number {
  if (bot.resist === undefined) return catchAfter
  return catchAfter * (1 + t.catchWeight * (bot.resist - 1))
}

/** How many ticks this bot stays sick. */
export function sickLength(bot: Pick<Bot, 'resist'>, t: Tuning['resistance'], sickTicks: number): number {
  if (bot.resist === undefined) return sickTicks
  return Math.max(1, Math.round(sickTicks / (1 + t.sickWeight * (bot.resist - 1))))
}
