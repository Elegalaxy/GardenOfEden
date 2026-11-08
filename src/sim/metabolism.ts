// What staying alive costs, and when it ends. Each tick a bot loses energy
// (more on a tick it moved, more or less for a sense radius above or below the
// default, all scaled by its metabolism trait and by the shelter it stands
// in), takes danger damage, heals, ages and counts its reproduction
// cooldown down. A bot dies of danger (health <= 0), starvation (energy <= 0)
// or old age (age >= maxAge), checked in that order.

import type { Exposure } from './nodes.ts'
import type { Bot, DeathCause, Tuning } from './types.ts'

/** Cells per tick: the base speed, faster for a higher metabolism trait and slower for a lower one. */
export function speedOf(bot: Bot, tuning: Tuning): number {
  const t = tuning.bot
  return t.speed * (1 + t.metabolismSpeed * (bot.traits.metabolism - 1))
}

export function metabolise(bot: Bot, moved: boolean, exposure: Exposure, tuning: Tuning): void {
  const t = tuning.bot
  const sensing = t.senseDrain * (bot.traits.senseRadius - tuning.traits.senseRadius)
  bot.energy -= (t.baseDrain + sensing + (moved ? t.moveDrain : 0)) * bot.traits.metabolism * exposure.drainMult
  bot.health = Math.min(t.maxHealth, bot.health + t.healthRegen + exposure.heal - exposure.damage)
  bot.age += 1
  if (bot.cooldown > 0) bot.cooldown -= 1
}

export function deathCause(bot: Bot, tuning: Tuning): DeathCause | null {
  if (bot.health <= 0) return 'danger'
  if (bot.energy <= 0) return 'starve'
  if (bot.age >= tuning.bot.maxAge) return 'age'
  return null
}
