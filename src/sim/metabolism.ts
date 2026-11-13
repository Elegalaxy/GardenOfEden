// What staying alive costs, and when it ends. Each tick a bot loses energy
// (more on a tick it moved, more or less for a sense radius above or below the
// default, all scaled by its metabolism trait and by the shelter it stands
// in), takes danger damage, heals, ages and counts its reproduction
// cooldown down. Thirst falls by `thirstDrain` per tick, times the metabolism
// trait raised to `thirstMetabolismPower` for a bot hotter than 1 (a cooler bot
// pays the plain `thirstDrain`, it does not thirst less), and shelter does not
// slow it (drinking at a spring, in movement.ts, comes first in the tick). The
// steep power is deliberate: a fast bot is cheaper per cell walked and finds the
// rare springs sooner, so with a gentler cost it simply out-breeds everyone
// (see tuning.ts). A bot dies of danger or plague (health <= 0), thirst (thirst <= 0),
// starvation (energy <= 0) or old age (age >= the bot's own `lifespan`: maxAge, or less for an
// inbred bot, see reproduction.ts). When more than one is true on
// the same tick the first in that order is the recorded cause: the acute ones
// come first, and the health causes before everything because they are done to
// the bot. If health ran out and the bot took plague damage this tick, the cause is
// plague when the plague damage was larger than the danger damage, otherwise danger
// (a tie goes to danger). A meteor's cause, 'meteor', is only recorded by the command that
// strikes (worldEvents.ts); a bot never dies of it inside `deathCause`.

import { pow } from './exactMath.ts'
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
  const thirstLoss = t.thirstDrain * pow(Math.max(1, bot.traits.metabolism), t.thirstMetabolismPower)
  bot.thirst = Math.max(0, bot.thirst - thirstLoss)
  bot.health = Math.min(t.maxHealth, bot.health + t.healthRegen + exposure.heal - exposure.damage - exposure.plague)
  bot.age += 1
  if (bot.cooldown > 0) bot.cooldown -= 1
}

export function deathCause(bot: Bot, exposure: Exposure): DeathCause | null {
  if (bot.health <= 0) return exposure.plague > exposure.damage ? 'plague' : 'danger'
  if (bot.thirst <= 0) return 'thirst'
  if (bot.energy <= 0) return 'starve'
  if (bot.age >= bot.lifespan) return 'age'
  return null
}
