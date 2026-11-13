// Family knowledge sharing (M10). The one exception to "bots only interact through shared nodes":
// a parent (mother or father) and its own child can pass on what they remember. Nobody else can (no
// siblings, no strangers, and the two parents never share with each other): knowledge reaches
// siblings and grandparents only by relaying through a parent link.
//
// Two ways knowledge passes:
//  - At birth the child starts with a copy of its mother's memory as it was at conception
//    (`inheritMemory`), then its father's merged in (`inheritFromParents`: a newer sighting wins),
//    unless `family.inherit` is off.
//  - By exchange: on ticks where `tick % family.shareEvery === 0`, a living child and its living
//    parents (mother, then father) within `family.shareRadius` cells swap memory (`shareFamilyKnowledge`). A radius of 0
//    turns exchange off.
//
// What passes: entries whose kind is in `family.shareKinds` (resource, water, shelter, danger; not
// ruins, which are gone too soon to be worth telling). An entry is copied only when the receiver
// lacks that node or holds an older sighting; the copy keeps the original `seenTick` and `amount`,
// so how stale it is travels with it and the usual retry rule still applies. Then the usual trim
// runs, so a shared entry can only push out an older one. Each copy records who it came from in
// `learnedFrom`; a bot that sees the node itself clears it again (see `remember`).
//
// Determinism: no random draws. Bots are visited in id order and each checks only its own parent,
// so the work is linear in the population. Both sides of a pair merge from copies taken before
// either changes. A chain (A parent of B parent of C) is handled in id order and each pair mutates
// in turn, so C can already hear what B just learned from A in the same tick. That is deterministic.

import { distance, trimMemory } from './perception.ts'
import type { Bot, MemoryEntry, Tuning, World } from './types.ts'

/** The entries a newborn starts with: copies of the shareable ones, marked as learned from the parent. */
export function inheritMemory(parentMemory: MemoryEntry[], parentId: number, tuning: Tuning): MemoryEntry[] {
  const inherited: MemoryEntry[] = []
  for (const entry of parentMemory) {
    if (tuning.family.shareKinds.includes(entry.kind)) inherited.push({ ...entry, learnedFrom: parentId })
  }
  return inherited
}

/**
 * A two-parent newborn's memory: the mother's shareable entries (as `inheritMemory`), then the
 * father's merged in (a node the child lacks is added, a strictly newer sighting wins; copies are
 * marked learned from the father), trimmed to the usual caps. Entries of removed nodes (not in `live`) from the father are skipped.
 */
export function inheritFromParents(
  motherMemory: MemoryEntry[],
  motherId: number,
  fatherMemory: MemoryEntry[],
  fatherId: number,
  tuning: Tuning,
  live: Set<number>,
): MemoryEntry[] {
  const child = { memory: inheritMemory(motherMemory, motherId, tuning) }
  mergeMemory(child, fatherMemory, fatherId, tuning, live)
  return child.memory
}

/**
 * Merges the shareable entries of `from` (a snapshot, never changed here) into the bot's memory:
 * a new node is added, a node the bot already knows is replaced only by a strictly newer sighting.
 * Entries of removed nodes (not in `live`) are skipped. Trims to the memory caps afterwards, and
 * returns how many of the copies are still in the memory after the trim.
 */
export function mergeMemory(bot: Pick<Bot, 'memory'>, from: MemoryEntry[], fromId: number, tuning: Tuning, live: Set<number>): number {
  const touched = new Set<number>()
  for (const theirs of from) {
    if (!tuning.family.shareKinds.includes(theirs.kind) || !live.has(theirs.nodeId)) continue
    const index = bot.memory.findIndex((entry) => entry.nodeId === theirs.nodeId)
    if (index < 0) {
      bot.memory.push({ ...theirs, learnedFrom: fromId })
      touched.add(theirs.nodeId)
    } else if (theirs.seenTick > bot.memory[index]!.seenTick) {
      // Replace the object rather than edit it, so snapshots of this memory stay unchanged.
      bot.memory[index] = { ...theirs, learnedFrom: fromId }
      touched.add(theirs.nodeId)
    }
  }
  if (touched.size === 0) return 0
  trimMemory(bot.memory, tuning)
  let learned = 0
  for (const entry of bot.memory) {
    if (touched.has(entry.nodeId)) learned += 1
  }
  return learned
}

/** The exchange phase: each living child swaps memory with its living mother, then its living father, when they are close. Adds to `world.familyLearned`. */
export function shareFamilyKnowledge(world: World, tuning: Tuning): void {
  const { shareRadius, shareEvery } = tuning.family
  if (shareRadius <= 0 || shareEvery <= 0 || world.tick % shareEvery !== 0) return
  const byId = new Map<number, Bot>()
  let hasChild = false
  for (const bot of world.bots) {
    byId.set(bot.id, bot)
    if (bot.parentId !== null || bot.fatherId !== null) hasChild = true
  }
  if (!hasChild) return
  const live = new Set<number>()
  for (const node of world.nodes) live.add(node.id)

  for (const child of world.bots) {
    // Mother first, then father; the two parents never share with each other.
    for (const parentId of [child.parentId, child.fatherId]) {
      if (parentId === null) continue
      const parent = byId.get(parentId)
      if (parent === undefined || distance(child.x, child.y, parent.x, parent.y) > shareRadius) continue
      const childMemory = child.memory.slice()
      const parentMemory = parent.memory.slice()
      world.familyLearned += mergeMemory(child, parentMemory, parent.id, tuning, live)
      world.familyLearned += mergeMemory(parent, childMemory, child.id, tuning, live)
    }
  }
}
