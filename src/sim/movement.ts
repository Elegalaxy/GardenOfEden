// Carrying out the chosen intent: one move (or one bite) per tick.
//
// Movement is greedy, with no path search. A bot steers toward its target at
// `speed` cells per tick. If the next step would end inside a remembered
// danger's radius (plus `avoidMargin`) it tries headings turned further and
// further to each side until one is safe, and stands still if none is. A step
// that moves away from a danger is always allowed, so a bot already inside the
// margin can leave. A desperate seeker (see brain.ts) skips avoidance.
//
// Fleeing walks straight away from every remembered danger the bot is at or
// near. Wandering is a random walk with small turns and one `ai` draw per
// tick, taken even when avoidance changes the step, so the draw order never
// depends on where danger is. A bot that reaches the map edge turns around.
//
// Steps are `speedOf(bot)` cells long: the base speed scaled by the metabolism
// trait (metabolism.ts).
//
// `act` returns whether the bot moved (moving costs extra energy).

import { isDesperate } from './brain.ts'
import { speedOf } from './metabolism.ts'
import { eat } from './nodes.ts'
import { distance, knownDangers } from './perception.ts'
import { nextFloat } from './rng.ts'
import type { Bot, MemoryEntry, Rules, World, WorldNode } from './types.ts'

/** Where a step along `heading` lands, kept on the map. `clamped` is true if the map edge stopped it. */
function stepAlong(world: World, bot: Bot, heading: number, length: number): { x: number; y: number; clamped: boolean } {
  const rawX = bot.x + Math.cos(heading) * length
  const rawY = bot.y + Math.sin(heading) * length
  const x = Math.min(world.width, Math.max(0, rawX))
  const y = Math.min(world.height, Math.max(0, rawY))
  return { x, y, clamped: x !== rawX || y !== rawY }
}

/** A step is safe if it ends outside every danger zone or does not bring the bot closer to one it is in. */
function isSafe(bot: Bot, x: number, y: number, dangers: MemoryEntry[], margin: number): boolean {
  for (const danger of dangers) {
    const after = distance(x, y, danger.x, danger.y)
    if (after >= danger.radius + margin) continue
    if (after > distance(bot.x, bot.y, danger.x, danger.y)) continue
    return false
  }
  return true
}

/**
 * Try the wanted heading, then headings turned by 1, -1, 2, -2, ... `steerStep`
 * radians, up to a half turn. Takes the first safe step. Returns false if none is.
 */
function steer(world: World, bot: Bot, heading: number, length: number, dangers: MemoryEntry[], rules: Rules): boolean {
  const { avoidMargin, steerStep } = rules.tuning.brain
  const tries = Math.ceil(Math.PI / steerStep)
  for (let i = 0; i <= 2 * tries; i += 1) {
    const turn = Math.ceil(i / 2) * steerStep * (i % 2 === 1 ? 1 : -1)
    const candidate = heading + turn
    const next = stepAlong(world, bot, candidate, length)
    if (next.x === bot.x && next.y === bot.y) continue
    if (!isSafe(bot, next.x, next.y, dangers, avoidMargin)) continue
    bot.x = next.x
    bot.y = next.y
    bot.heading = next.clamped ? candidate + Math.PI : candidate
    return true
  }
  return false
}

function walkToward(world: World, bot: Bot, tx: number, ty: number, dangers: MemoryEntry[], rules: Rules): boolean {
  const d = distance(bot.x, bot.y, tx, ty)
  const heading = Math.atan2(ty - bot.y, tx - bot.x)
  const speed = speedOf(bot, rules.tuning)
  const length = Math.min(speed, d)
  // Aim exactly at the target while the straight step is safe, so a bot can arrive on it.
  const straight = stepAlong(world, bot, heading, length)
  if (isSafe(bot, straight.x, straight.y, dangers, rules.tuning.brain.avoidMargin)) {
    bot.x = straight.x
    bot.y = straight.y
    bot.heading = heading
    return true
  }
  return steer(world, bot, heading, speed, dangers, rules)
}

/** Walk straight away from every remembered danger the bot is at or near. */
function flee(world: World, bot: Bot, rules: Rules): boolean {
  const { fleeMargin } = rules.tuning.brain
  let awayX = 0
  let awayY = 0
  for (const danger of knownDangers(bot)) {
    const d = distance(bot.x, bot.y, danger.x, danger.y)
    if (d - danger.radius >= fleeMargin) continue
    // Nearer to the centre pushes harder; exactly on the centre pushes along the heading.
    const weight = 1 / Math.max(d, 0.1)
    if (d < 1e-9) {
      awayX += Math.cos(bot.heading)
      awayY += Math.sin(bot.heading)
    } else {
      awayX += ((bot.x - danger.x) / d) * weight
      awayY += ((bot.y - danger.y) / d) * weight
    }
  }
  if (awayX === 0 && awayY === 0) return false
  const heading = Math.atan2(awayY, awayX)
  const next = stepAlong(world, bot, heading, speedOf(bot, rules.tuning))
  if (next.x === bot.x && next.y === bot.y) return false
  bot.x = next.x
  bot.y = next.y
  bot.heading = heading
  return true
}

function wander(world: World, bot: Bot, dangers: MemoryEntry[], rules: Rules): boolean {
  const t = rules.tuning.bot
  const heading = bot.heading + (nextFloat(world.rng.ai) * 2 - 1) * t.turnRate
  if (steer(world, bot, heading, speedOf(bot, rules.tuning), dangers, rules)) return true
  bot.heading = heading + Math.PI
  return false
}

/** Does the bot move this tick? Used by the energy cost. */
export function act(world: World, bot: Bot, rules: Rules, nodesById: Map<number, WorldNode>): boolean {
  const { tuning } = rules
  bot.px = bot.x
  bot.py = bot.y
  const dangers = isDesperate(bot, tuning) ? [] : knownDangers(bot)
  const target = bot.intent.targetId === null ? undefined : nodesById.get(bot.intent.targetId)

  switch (bot.intent.kind) {
    case 'flee':
      if (flee(world, bot, rules)) return true
      break
    case 'seekFood':
      if (target) {
        if (distance(bot.x, bot.y, target.x, target.y) <= target.radius) {
          eat(world, bot, target, tuning)
          return false
        }
        return walkToward(world, bot, target.x, target.y, dangers, rules)
      }
      break
    case 'rest':
    case 'reproduce':
      if (target) {
        if (distance(bot.x, bot.y, target.x, target.y) <= target.radius * tuning.brain.settleFraction) return false
        return walkToward(world, bot, target.x, target.y, dangers, rules)
      }
      break
    case 'wander':
      break
  }
  return wander(world, bot, dangers, rules)
}
