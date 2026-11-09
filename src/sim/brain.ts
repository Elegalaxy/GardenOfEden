// Choosing what to do. Each option gets a utility score from the bot's state
// and what it remembers; the highest score wins. Ties go to the earlier option
// in this order: flee, seek food, seek water, rest, reproduce, wander.
//
//   flee       rises with how close the bot is to a remembered danger, scaled by
//              its caution trait and by how hurt it is. Full strength inside.
//   seekFood   needs the bot to be hungry (with hysteresis, so it keeps eating
//              until sated) and a worthwhile remembered resource. Scales with
//              missing energy, so a starving bot can out-score fleeing and walk
//              into danger for food.
//   seekWater  the same shape as seekFood for thirst: needs the bot to be thirsty
//              (with hysteresis, until nearly full) and a remembered spring that
//              is not inside a remembered danger. Scales with missing thirst, so
//              a parched bot is as urgent as a starving one, and a bot that is
//              both goes for whichever is lower. A desperate bot (thirst under
//              `desperateBelow`) accepts a spring inside danger and ignores
//              avoidance on the way, the same bargain as food in a grove.
//   rest       needs a remembered shelter and low health (with hysteresis).
//   reproduce  needs the reproduction conditions and a remembered shelter.
//   wander     the fallback, with a small constant score.
//
// `decide` only sets `bot.intent`; movement.ts carries it out. It makes no
// random draws.

import { chooseFood, chooseWater, distance, knownDangers, nearestKnown } from './perception.ts'
import { meetsReproductionNeeds } from './reproduction.ts'
import type { Bot, Intent, IntentKind, Tuning, World } from './types.ts'

/** A seeking bot this hungry ignores danger avoidance (see `brain.desperateBelow`). */
export function isDesperate(bot: Bot, tuning: Tuning): boolean {
  const { desperateBelow } = tuning.brain
  if (bot.intent.kind === 'seekFood') return bot.energy < desperateBelow * tuning.bot.maxEnergy
  if (bot.intent.kind === 'seekWater') return bot.thirst < desperateBelow * tuning.bot.maxThirst
  return false
}

/** 0 outside the flee margin, rising to 1 at a danger's edge and inside it; plus the danger it comes from. */
function threatOf(bot: Bot, tuning: Tuning): { threat: number; id: number | null } {
  let threat = 0
  let id: number | null = null
  for (const danger of knownDangers(bot)) {
    const edge = distance(bot.x, bot.y, danger.x, danger.y) - danger.radius
    const level = edge <= 0 ? 1 : edge >= tuning.brain.fleeMargin ? 0 : 1 - edge / tuning.brain.fleeMargin
    if (level > threat) {
      threat = level
      id = danger.nodeId
    }
  }
  return { threat, id }
}

export function decide(world: World, bot: Bot, tuning: Tuning): void {
  const t = tuning.bot
  const b = tuning.brain
  const energyFraction = bot.energy / t.maxEnergy
  const healthFraction = bot.health / t.maxHealth
  const thirstFraction = bot.thirst / t.maxThirst

  let best: Intent = { kind: 'wander', targetId: null }
  let bestScore = b.wanderScore
  const consider = (kind: IntentKind, targetId: number | null, score: number): void => {
    if (score > bestScore) {
      best = { kind, targetId }
      bestScore = score
    }
  }

  // Evaluated in priority order, and a later option must score strictly higher
  // to win, so ties keep the earlier one. Wander is the starting best.
  const { threat, id: dangerId } = threatOf(bot, tuning)
  if (threat > 0) {
    consider('flee', dangerId, threat * (b.fleeBase + b.fleeCaution * bot.traits.caution + b.fleeHealth * (1 - healthFraction)))
  }

  const hungry =
    bot.energy < t.hungryBelow * t.maxEnergy ||
    (bot.intent.kind === 'seekFood' && bot.energy < t.satedAbove * t.maxEnergy)
  if (hungry) {
    const brave = energyFraction < b.desperateBelow
    const food = chooseFood(world, bot, tuning, brave)
    if (food) consider('seekFood', food.nodeId, b.seekWeight * (1 - energyFraction))
  }

  const thirsty =
    bot.thirst < t.thirstyBelow * t.maxThirst ||
    (bot.intent.kind === 'seekWater' && bot.thirst < t.quenchedAbove * t.maxThirst)
  if (thirsty) {
    const water = chooseWater(bot, tuning, thirstFraction < b.desperateBelow)
    if (water) consider('seekWater', water.nodeId, b.thirstWeight * (1 - thirstFraction))
  }

  const shelter = nearestKnown(bot, 'shelter')
  if (shelter) {
    const needsRest =
      bot.health < b.restBelow * t.maxHealth ||
      (bot.intent.kind === 'rest' && bot.health < b.restUntil * t.maxHealth)
    if (needsRest) consider('rest', shelter.nodeId, b.restWeight * (1 - healthFraction))
    if (meetsReproductionNeeds(bot, tuning)) consider('reproduce', shelter.nodeId, b.reproduceScore)
  }

  bot.intent = best
}
