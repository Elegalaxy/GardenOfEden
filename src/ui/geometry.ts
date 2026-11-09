// Map geometry shared by drawing and clicking: pixels <-> cells, bot positions
// between ticks, and "what is under this spot". Pure functions, no DOM.

import type { Bot, World, WorldNode } from '../sim/types.ts'
import type { Selection } from './tools.ts'

/** What the picking helpers read of a bot, so they work on a World's bots and on the page's ViewBots alike. */
type Located = Pick<Bot, 'id' | 'x' | 'y' | 'px' | 'py'>

export type Layout = {
  /** CSS pixels per map cell. */
  scale: number
  offsetX: number
  offsetY: number
}

export type Cell = { cx: number; cy: number }

/** The cell under a point given in CSS pixels relative to the canvas, or null outside the map. */
export function cellAtPixel(layout: Layout, world: Pick<World, 'width' | 'height'>, px: number, py: number): Cell | null {
  const x = (px - layout.offsetX) / layout.scale
  const y = (py - layout.offsetY) / layout.scale
  if (!(x >= 0 && y >= 0 && x < world.width && y < world.height)) return null
  return { cx: Math.floor(x), cy: Math.floor(y) }
}

/** Map position of a cell's centre: where a placement lands. */
export function cellCenter(cell: Cell): { x: number; y: number } {
  return { x: cell.cx + 0.5, y: cell.cy + 0.5 }
}

/** A bot's drawn position: blended from where its last turn started to where it is, by `alpha` (0 to 1). */
export function botPosition(bot: Pick<Bot, 'x' | 'y' | 'px' | 'py'>, alpha: number): { x: number; y: number } {
  return { x: bot.px + (bot.x - bot.px) * alpha, y: bot.py + (bot.y - bot.py) * alpha }
}

/**
 * The smallest node whose circle contains the point (so a resource inside a danger wins); among equal sizes the
 * newest, so removing what you just placed undoes it. Undefined when nothing covers the point.
 */
export function nodeAt(world: Pick<World, 'nodes'>, x: number, y: number): WorldNode | undefined {
  let best: WorldNode | undefined
  for (const node of world.nodes) {
    if (Math.hypot(node.x - x, node.y - y) > node.radius) continue
    if (best === undefined || node.radius <= best.radius) best = node
  }
  return best
}

/** The bot nearest the point within `reach` cells, or undefined. */
export function botAt<B extends Located>(world: { bots: readonly B[] }, x: number, y: number, alpha: number, reach: number): B | undefined {
  let best: B | undefined
  let bestDistance = reach
  for (const bot of world.bots) {
    const p = botPosition(bot, alpha)
    const d = Math.hypot(p.x - x, p.y - y)
    if (d <= bestDistance) {
      best = bot
      bestDistance = d
    }
  }
  return best
}

/** What a click at a map position selects: a bot if one is close, else the node under it, else nothing. */
export function pickAt(world: { bots: readonly Located[] } & Pick<World, 'nodes'>, x: number, y: number, alpha: number, reach: number): Selection | null {
  const bot = botAt(world, x, y, alpha, reach)
  if (bot !== undefined) return { kind: 'bot', id: bot.id }
  const node = nodeAt(world, x, y)
  return node === undefined ? null : { kind: 'node', id: node.id }
}

/** Bots are kept in ascending id order, so a binary search finds one. */
export function findBot<B extends Pick<Bot, 'id'>>(world: { bots: readonly B[] }, id: number): B | undefined {
  let low = 0
  let high = world.bots.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const bot = world.bots[mid]!
    if (bot.id === id) return bot
    if (bot.id < id) low = mid + 1
    else high = mid - 1
  }
  return undefined
}

export function findNode(world: Pick<World, 'nodes'>, id: number): WorldNode | undefined {
  return world.nodes.find((node) => node.id === id)
}
