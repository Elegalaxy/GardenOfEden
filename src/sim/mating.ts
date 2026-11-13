// Finding a mate (M17). The one place bots perceive each other, and only for mating: a ready male
// senses the ready females within his sense radius and walks toward the nearest (brain.ts `seekMate`,
// movement.ts). Females do not search: a ready female walks to a shelter and waits there.
//
// "Ready female" here means female, fertile, cooldown over and energy at or above her threshold, as
// they stood at the start of the tick (`isReadyMother`). The index is a coarse grid of those females
// only (a handful at a time), built once per tick; a query scans just the grid cells the sense circle
// touches, so the cost does not grow with the population. No random draws. Ties go to the lowest id.

import { distance } from './perception.ts'
import { meetsReproductionNeeds } from './reproduction.ts'
import type { Bot, Tuning } from './types.ts'

const CELL = 4

export type MateIndex = { cells: Map<number, Bot[]>; count: number }

function key(cx: number, cy: number): number {
  return cx * 4096 + cy
}

/** A female that a seeking male can find: fertile, off cooldown, fed enough to breed. */
export function isReadyMother(bot: Bot, tuning: Tuning): boolean {
  return bot.sex === 'female' && meetsReproductionNeeds(bot, tuning)
}

/** Indexes the ready females of the world as it stands now (bots in id order, so each cell list is too). */
export function buildMateIndex(bots: readonly Bot[], tuning: Tuning): MateIndex {
  const cells = new Map<number, Bot[]>()
  let count = 0
  for (const bot of bots) {
    if (!isReadyMother(bot, tuning)) continue
    const k = key(Math.floor(bot.x / CELL), Math.floor(bot.y / CELL))
    const list = cells.get(k)
    if (list === undefined) cells.set(k, [bot])
    else list.push(bot)
    count += 1
  }
  return { cells, count }
}

/** The nearest indexed female within `radius` of the bot (ties: lowest id), or null. */
export function nearestMate(index: MateIndex, bot: Bot, radius: number): Bot | null {
  if (index.count === 0) return null
  let best: Bot | null = null
  let bestDistance = Infinity
  const x0 = Math.floor((bot.x - radius) / CELL)
  const x1 = Math.floor((bot.x + radius) / CELL)
  const y0 = Math.floor((bot.y - radius) / CELL)
  const y1 = Math.floor((bot.y + radius) / CELL)
  for (let cx = x0; cx <= x1; cx += 1) {
    for (let cy = y0; cy <= y1; cy += 1) {
      const list = index.cells.get(key(cx, cy))
      if (list === undefined) continue
      for (const other of list) {
        const d = distance(bot.x, bot.y, other.x, other.y)
        if (d <= radius && (d < bestDistance || (d === bestDistance && best !== null && other.id < best.id))) {
          best = other
          bestDistance = d
        }
      }
    }
  }
  return best
}

/** The bot with this id from a list in ascending id order (binary search), or undefined. */
export function findBotById(bots: readonly Bot[], id: number): Bot | undefined {
  let lo = 0
  let hi = bots.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const probe = bots[mid]!.id
    if (probe === id) return bots[mid]
    if (probe < id) lo = mid + 1
    else hi = mid - 1
  }
  return undefined
}
