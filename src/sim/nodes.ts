// How nodes act on bots and on themselves. Resources are eaten down and regrow
// by `regen` per tick up to `capacity`. Danger nodes hurt and shelter nodes
// heal everything standing inside their radius; `exposureAt` adds up what one
// spot receives from the real nodes (not from any bot's memory).

import type { Bot, Tuning, World, WorldNode } from './types.ts'
import { pushEvent } from './world.ts'

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
    if (node.kind === 'resource') continue
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

/** The bot takes food from a resource it stands in, up to `eatRate` and up to its room for energy. */
export function eat(world: World, bot: Bot, node: WorldNode, tuning: Tuning): void {
  const t = tuning.bot
  const room = (t.maxEnergy - bot.energy) / t.energyPerUnit
  const take = Math.min(t.eatRate, node.amount, room)
  if (take <= 0) return
  node.amount -= take
  bot.energy = Math.min(t.maxEnergy, bot.energy + take * t.energyPerUnit)
  if (node.amount <= 0) {
    node.amount = 0
    pushEvent(world, tuning, { tick: world.tick, type: 'depleted', nodeId: node.id, x: node.x, y: node.y })
  }
}

export function regrow(world: World): void {
  for (const node of world.nodes) {
    if (node.kind === 'resource') node.amount = Math.min(node.capacity, node.amount + node.regen)
  }
}
