// How nodes act on bots and on themselves. Resources are eaten down and regrow
// by `regen` per tick up to `capacity`; ruins are eaten the same way (`eat`)
// but never regrow (they decay, see ruins.ts). A water node is a permanent
// spring: `drink` raises a bot's thirst and takes nothing from the node. Danger nodes hurt and shelter
// nodes heal everything standing inside their radius; `exposureAt` adds up
// what one spot receives from the real nodes (not from any bot's memory), and
// from any plague zone covering it (a world event, see worldEvents.ts). A drought
// or bounty scales how fast resources regrow (`regrowthMultiplier`).

import { hypot } from './exactMath.ts'
import type { Bot, Tuning, World, WorldNode } from './types.ts'

/** What one spot on the map does to a bot this tick. */
export type Exposure = {
  /** Total health damage from danger nodes covering the spot. */
  damage: number
  /** Total health damage from active plague events covering the spot (kept apart so a death can be told apart). */
  plague: number
  /** Total health healed by shelter nodes covering the spot. */
  heal: number
  /** Energy-loss multiplier: the lowest `drainMult` of any covering shelter, else 1. */
  drainMult: number
  /** Nearest covering shelter, or null when the spot is not in one. */
  shelterId: number | null
}

export function exposureAt(world: World, x: number, y: number): Exposure {
  const exposure: Exposure = { damage: 0, plague: 0, heal: 0, drainMult: 1, shelterId: null }
  let shelterDistance = Infinity
  for (const node of world.nodes) {
    if (node.kind !== 'danger' && node.kind !== 'shelter') continue
    const d = hypot(x - node.x, y - node.y)
    if (d > node.radius) continue
    if (node.kind === 'danger') {
      exposure.damage += node.damage
    } else {
      exposure.heal += node.heal
      exposure.drainMult = Math.min(exposure.drainMult, node.drainMult)
      if (d < shelterDistance) {
        shelterDistance = d
        exposure.shelterId = node.id
      }
    }
  }
  for (const event of world.events) {
    if (event.kind === 'plague' && hypot(x - event.x, y - event.y) <= event.radius) exposure.plague += event.magnitude
  }
  return exposure
}

/**
 * The bot takes food from a resource or ruin it stands in, up to `eatRate` and up to its room for
 * energy. An emptied resource stays and regrows; an emptied ruin is removed at the end of the tick.
 */
export function eat(world: World, bot: Bot, node: WorldNode, tuning: Tuning): void {
  const t = tuning.bot
  const room = (t.maxEnergy - bot.energy) / t.energyPerUnit
  const take = Math.min(t.eatRate, node.amount, room)
  if (take <= 0) return
  node.amount = Math.max(0, node.amount - take)
  bot.energy = Math.min(t.maxEnergy, bot.energy + take * t.energyPerUnit)
  world.eaten[node.kind === 'ruin' ? 'ruin' : 'resource'] += take
}

/** The bot drinks `drinkRate` at a water node it stands in (up to full). The spring is not used up. */
export function drink(bot: Bot, tuning: Tuning): void {
  const t = tuning.bot
  bot.thirst = Math.min(t.maxThirst, bot.thirst + t.drinkRate)
}

/** Regrowth is multiplied by every drought and bounty in progress (both at once multiply). 1 when there are none. */
export function regrowthMultiplier(world: World): number {
  let mult = 1
  for (const event of world.events) {
    if (event.kind === 'drought' || event.kind === 'bounty') mult *= event.magnitude
  }
  return mult
}

export function regrow(world: World): void {
  const mult = regrowthMultiplier(world)
  for (const node of world.nodes) {
    if (node.kind === 'resource') node.amount = Math.min(node.capacity, node.amount + node.regen * mult)
  }
}
