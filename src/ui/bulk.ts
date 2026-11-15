// Bulk placing (M19): the "Place" count choice of the placement tools and the pure helpers behind it. A click with a count
// above 1 places that many bots or nodes at random cells of the map. The randomness is the page's own (`Math.random`, fine
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

/** The commands for a bulk click: bots (`kind` null) or nodes of `kind`, at random spots. */
export function bulkCommands(kind: NodeKind | null, count: number, width: number, height: number, random: () => number): Command[] {
  return spreadPoints(count, width, height, random).map((point): Command =>
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
