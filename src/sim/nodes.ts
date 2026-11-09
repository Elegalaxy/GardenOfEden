// How nodes act on bots and on themselves. Resources are eaten down and regrow
// by `regen` per tick up to `capacity`; ruins are eaten the same way (`eat`)
// but never regrow (they decay, see ruins.ts). A water node is a permanent
// spring: `drink` raises a bot's thirst and takes nothing from the node. Danger nodes hurt and shelter
// nodes heal everything standing inside their radius; `exposureAt` adds up
// what one spot receives from the real nodes (not from any bot's memory).

import type { Bot, Tuning, World, WorldNode } from './types.ts'

/** What one spot on the map does to a bot this tick. */
export type Exposure = {
  /** Total health damage from danger nodes covering the spot. */
  damage: number
  /** Total health healed by shelter nodes covering the spot. */
  heal: number
  /** Energy-loss multiplier: the lowest `drainMult` of any covering shelter, else 1. */
  drainMult: number
  /** Nearest covering shelter, or null when the spot is not in one. */
  shelterId: number | null
}

export function exposureAt(world: World, x: number, y: number): Exposure {
  const exposure: Exposure = { damage: 0, heal: 0, drainMult: 1, shelterId: null }
  let shelterDistance = Infinity
  for (const node of world.nodes) {
    if (node.kind !== 'danger' && node.kind !== 'shelter') continue
    const d = Math.hypot(x - node.x, y - node.y)
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

export function regrow(world: World): void {
  for (const node of world.nodes) {
    if (node.kind === 'resource') node.amount = Math.min(node.capacity, node.amount + node.regen)
  }
}
