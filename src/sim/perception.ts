// What a bot can know. A bot senses every node whose edge is inside its sense
// radius, and keeps a small memory of what it saw (at most `memory.cap`
// entries; the oldest sighting is forgotten first). Memory is the only thing
// the brain and movement read, so a bot never acts on a node it has not seen.
//
// A remembered resource is only worth walking to if it held at least one bite
// when last seen, or if the sighting is old enough (`memory.retryTicks`) that
// it has probably regrown. A ruin counts as food too, but it never regrows, so
// it is only worth walking to while it held a bite when last seen. Danger entries keep their radius so a bot can steer
// around them without seeing them again.

import type { Bot, MemoryEntry, NodeKind, Tuning, World, WorldNode } from './types.ts'

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay)
}

/** Nodes whose edge is inside the bot's sense radius, in id order. */
export function perceive(world: World, bot: Bot): WorldNode[] {
  const sensed: WorldNode[] = []
  for (const node of world.nodes) {
    if (distance(bot.x, bot.y, node.x, node.y) - node.radius <= bot.traits.senseRadius) sensed.push(node)
  }
  return sensed
}

/** Index of the entry to forget first: oldest sighting, then lowest node id. */
function oldestEntry(memory: MemoryEntry[]): number {
  let worst = 0
  for (let i = 1; i < memory.length; i += 1) {
    const a = memory[i]
    const b = memory[worst]
    if (a.seenTick < b.seenTick || (a.seenTick === b.seenTick && a.nodeId < b.nodeId)) worst = i
  }
  return worst
}

/** Refresh what the bot sees, forget removed nodes, and stay within the memory cap. */
export function remember(world: World, bot: Bot, sensed: WorldNode[], tuning: Tuning, live: Set<number>): void {
  const memory = bot.memory.filter((entry) => live.has(entry.nodeId))
  for (const node of sensed) {
    const found = memory.find((entry) => entry.nodeId === node.id)
    if (found) {
      found.x = node.x
      found.y = node.y
      found.radius = node.radius
      found.seenTick = world.tick
      found.amount = node.amount
    } else {
      memory.push({
        nodeId: node.id,
        kind: node.kind,
        x: node.x,
        y: node.y,
        radius: node.radius,
        seenTick: world.tick,
        amount: node.amount,
      })
    }
  }
  while (memory.length > tuning.memory.cap) memory.splice(oldestEntry(memory), 1)
  bot.memory = memory
}

/** Remembered danger nodes. */
export function knownDangers(bot: Bot): MemoryEntry[] {
  return bot.memory.filter((entry) => entry.kind === 'danger')
}

/** True when a point is inside any remembered danger's edge plus `margin`. */
export function insideDanger(dangers: MemoryEntry[], x: number, y: number, margin: number): boolean {
  for (const danger of dangers) {
    if (distance(x, y, danger.x, danger.y) < danger.radius + margin) return true
  }
  return false
}

/** Nearest remembered node of a kind; ties go to the lower node id. */
export function nearestKnown(bot: Bot, kind: NodeKind): MemoryEntry | null {
  let best: MemoryEntry | null = null
  let bestDistance = Infinity
  for (const entry of bot.memory) {
    if (entry.kind !== kind) continue
    const d = distance(bot.x, bot.y, entry.x, entry.y)
    if (d < bestDistance || (d === bestDistance && best !== null && entry.nodeId < best.nodeId)) {
      best = entry
      bestDistance = d
    }
  }
  return best
}

/** Nodes a bot can eat: resources and ruins. */
export function isFood(kind: NodeKind): boolean {
  return kind === 'resource' || kind === 'ruin'
}

/**
 * Nearest remembered food (resource or ruin) worth walking to; ties go to the lower node id.
 * Unless the bot is `brave`, food sitting inside a remembered danger (plus the
 * avoid margin) is skipped.
 */
export function chooseFood(world: World, bot: Bot, tuning: Tuning, brave: boolean): MemoryEntry | null {
  const dangers = brave ? [] : knownDangers(bot)
  let best: MemoryEntry | null = null
  let bestDistance = Infinity
  for (const entry of bot.memory) {
    if (!isFood(entry.kind)) continue
    const regrows = entry.kind === 'resource'
    const worthIt =
      entry.amount >= tuning.bot.eatRate || (regrows && world.tick - entry.seenTick >= tuning.memory.retryTicks)
    if (!worthIt) continue
    if (insideDanger(dangers, entry.x, entry.y, tuning.brain.avoidMargin)) continue
    const d = distance(bot.x, bot.y, entry.x, entry.y)
    if (d < bestDistance || (d === bestDistance && best !== null && entry.nodeId < best.nodeId)) {
      best = entry
      bestDistance = d
    }
  }
  return best
}
