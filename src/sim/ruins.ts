// Ruins: what a dead bot leaves behind. A ruin is a small food node at the
// place of death, so the dead feed the living and a danger zone or a hungry
// stretch of map keeps a visible trace.
//
// Every death leaves one, whatever the cause. Its amount is `ruin.baseAmount`
// plus `ruin.energyShare` of the bot's remaining energy counted in food units,
// so a bot that died full leaves more than one that starved. A death within
// `ruin.mergeRadius` of an existing ruin adds to that ruin (capped at the
// ruin's capacity; the excess is lost) instead of making another, and at
// `ruin.maxCount` ruins a death adds to the nearest one however far it is.
// Ruins are eaten like resources (`eat` in nodes.ts), never regrow, lose
// `decay` per tick, and are removed when they reach 0. A ruin whose centre lies inside any danger
// node (a danger zone, a grove's zone, a meteor crater) loses `ruin.dangerDecayMult` times that,
// so the trace stays but the lure fades fast (M12).
//
// No random draws, and no events: a ruin per death would flood the log. The
// number of ruins is separate from `player.maxNodes`; the player's cap counts
// placed nodes only.

import { makeNode } from './world.ts'
import type { Bot, Rules, Tuning, World, WorldNode } from './types.ts'

/** Food units a bot's ruin starts with, before the capacity cap. */
export function ruinAmount(bot: Bot, tuning: Tuning): number {
  const { baseAmount, energyShare } = tuning.ruin
  return baseAmount + (energyShare * Math.max(0, bot.energy)) / tuning.bot.energyPerUnit
}

/** Leaves a ruin for a bot that died at its current position (or adds to a nearby one). */
export function leaveRuin(world: World, bot: Bot, rules: Rules): void {
  const def = rules.nodeDefs.ruin
  const { mergeRadius, maxCount } = rules.tuning.ruin
  const amount = ruinAmount(bot, rules.tuning)

  // Nodes are in ascending id order, so on equal distances the lowest id wins.
  let nearest: WorldNode | null = null
  let nearestDistance = Infinity
  let count = 0
  for (const node of world.nodes) {
    if (node.kind !== 'ruin') continue
    count += 1
    const d = Math.hypot(node.x - bot.x, node.y - bot.y)
    if (d < nearestDistance) {
      nearest = node
      nearestDistance = d
    }
  }

  if (nearest !== null && (nearestDistance <= mergeRadius || count >= maxCount)) {
    nearest.amount = Math.min(def.capacity, nearest.amount + amount)
    return
  }
  if (count >= maxCount) return
  const ruin = makeNode(world.nextId, 'ruin', bot.x, bot.y, def)
  ruin.amount = Math.min(def.capacity, amount)
  world.nextId += 1
  world.nodes.push(ruin)
}

/** Is the point inside the radius of any danger node (zones, groves and meteor craters alike)? */
export function insideAnyDanger(world: Pick<World, 'nodes'>, x: number, y: number): boolean {
  for (const node of world.nodes) {
    if (node.kind === 'danger' && Math.hypot(x - node.x, y - node.y) <= node.radius) return true
  }
  return false
}

/** What a ruin loses this tick: its `decay`, times `ruin.dangerDecayMult` if its centre is inside a danger node. */
export function ruinDecayRate(world: Pick<World, 'nodes'>, node: WorldNode, tuning: Tuning): number {
  return insideAnyDanger(world, node.x, node.y) ? node.decay * tuning.ruin.dangerDecayMult : node.decay
}

/** Every ruin loses its decay rate, and the emptied ones (eaten or fully decayed) are removed. */
export function decayRuins(world: World, tuning: Tuning): void {
  let anyGone = false
  for (const node of world.nodes) {
    if (node.kind !== 'ruin') continue
    node.amount = Math.max(0, node.amount - ruinDecayRate(world, node, tuning))
    if (node.amount <= 0) anyGone = true
  }
  if (anyGone) world.nodes = world.nodes.filter((node) => node.kind !== 'ruin' || node.amount > 0)
}
