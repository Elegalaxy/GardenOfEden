// Bulk placing (M19): the "Place" count choice of the placement tools and the pure helpers behind it. A click with a count
// above 1 places that many bots or nodes at random cells around the clicked cell (`clusterPoints`; `spreadPoints` covers the
// whole map and is used when no click position is given). The randomness is the page's own (`Math.random`, fine
// in src/ui; the sim never sees it): each spot goes to the worker as explicit coordinates in an ordinary placeNode or
// placeBot command, so a saved run replays exactly. Spots are distinct cell centres, so two nodes of one kind never fall
// in the same cell (the sim refuses a gap under `player.minNodeGap`).

import type { Command, NodeKind } from '../sim/types.ts'

/** The counts the player can choose. 1 is a plain click. */
export const PLACE_COUNTS = [1, 10, 50, 200] as const
export type PlaceCount = (typeof PLACE_COUNTS)[number]
export const DEFAULT_PLACE_COUNT: PlaceCount = 1

/** What the worker did with a batch: how many were placed and the first reason one was refused (null when none was). */
export type BatchResult = { total: number; placed: number; refused: number; firstReason: string | null }

/** `count` distinct cell centres inside a map of `width` x `height` cells (fewer only if the map has fewer cells). */
export function spreadPoints(count: number, width: number, height: number, random: () => number): { x: number; y: number }[] {
  const cells = Math.floor(width) * Math.floor(height)
  const wanted = Math.max(0, Math.min(Math.floor(count), cells))
  const picked = new Set<number>()
  const points: { x: number; y: number }[] = []
  while (points.length < wanted) {
    const index = Math.min(cells - 1, Math.floor(random() * cells))
    if (picked.has(index)) continue
    picked.add(index)
    points.push({ x: (index % Math.floor(width)) + 0.5, y: Math.floor(index / Math.floor(width)) + 0.5 })
  }
  return points
}

/** How many cells of the disc each placed thing gets: bots may sit close, nodes need room (the sim refuses a gap under `player.minNodeGap`). */
export const BOT_CELLS_EACH = 2.5
export const NODE_CELLS_EACH = 9

/**
 * `count` distinct cell centres in a disc around the cell centre `around`, clipped to the map. The disc starts at about
 * `count * cellsEach` cells and grows until it holds enough cells, so a big count spills over the whole map when needed.
 */
export function clusterPoints(
  count: number,
  around: { x: number; y: number },
  width: number,
  height: number,
  random: () => number,
  cellsEach: number,
): { x: number; y: number }[] {
  const w = Math.floor(width)
  const h = Math.floor(height)
  const wanted = Math.max(0, Math.min(Math.floor(count), w * h))
  const cx = Math.min(w - 1, Math.max(0, Math.floor(around.x)))
  const cy = Math.min(h - 1, Math.max(0, Math.floor(around.y)))
  let radius = Math.max(2, Math.ceil(Math.sqrt((wanted * cellsEach) / Math.PI)))
  let cells: number[] = []
  for (;;) {
    cells = []
    for (let y = Math.max(0, cy - radius); y <= Math.min(h - 1, cy + radius); y += 1) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(w - 1, cx + radius); x += 1) {
        const dx = x - cx
        const dy = y - cy
        if (dx * dx + dy * dy <= radius * radius) cells.push(y * w + x)
      }
    }
    if (cells.length >= wanted || radius > w + h) break
    radius += 2
  }
  // Fisher-Yates over the candidates, then the first `wanted`.
  for (let i = cells.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(random() * (i + 1)))
    const swap = cells[i]!
    cells[i] = cells[j]!
    cells[j] = swap
  }
  return cells.slice(0, wanted).map((index) => ({ x: (index % w) + 0.5, y: Math.floor(index / w) + 0.5 }))
}

/**
 * The commands for a bulk click: bots (`kind` null) or nodes of `kind`. With `around` (the clicked cell centre) they
 * cluster there; without it they spread over the whole map.
 */
export function bulkCommands(
  kind: NodeKind | null,
  count: number,
  width: number,
  height: number,
  random: () => number,
  around?: { x: number; y: number },
): Command[] {
  const points =
    around === undefined
      ? spreadPoints(count, width, height, random)
      : clusterPoints(count, around, width, height, random, kind === null ? BOT_CELLS_EACH : NODE_CELLS_EACH)
  return points.map((point): Command =>
    kind === null ? { type: 'placeBot', x: point.x, y: point.y } : { type: 'placeNode', kind, x: point.x, y: point.y },
  )
}

function plain(reason: string): string {
  return reason.replace(/\.$/, '')
}

/** The sentence for a finished batch, e.g. "Placed 37 of 50 bots (cap reached)." */
export function batchNotice(noun: string, result: BatchResult): string {
  const { placed, total, firstReason } = result
  const head = `Placed ${placed} of ${total} ${noun}`
  if (result.refused === 0 || firstReason === null) return `${head}.`
  let why: string
  if (/full|cap/i.test(firstReason)) why = 'cap reached'
  else if (/too close/i.test(firstReason)) why = 'some spots were too close'
  else why = plain(firstReason)
  return `${head} (${why}).`
}
