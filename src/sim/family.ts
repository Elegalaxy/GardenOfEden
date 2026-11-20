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
// Toxic food (T1): the `toxic` flag travels with an entry and is never lost to a newer clean sighting: a copy that replaces the receiver's
// entry is toxic if either side knew, and when the receiver's entry is newer but the sender knows the node is toxic the receiver's entry gets
// the flag (a new object, not counted as learned). With poison off no entry has the flag and nothing changes.
// Culture (C1, culture.ts) reuses `mergeMemory` with options for an elder's lesson; family copies never carry the `taught` flag.
//
// Determinism: no random draws. Bots are visited in id order and each checks only its own parent,
// so the work is linear in the population. Both sides of a pair merge from copies taken before
// either changes. A chain (A parent of B parent of C) is handled in id order and each pair mutates
// in turn, so C can already hear what B just learned from A in the same tick. That is deterministic.

import { distance, trimMemory } from './perception.ts'
import type { Bot, MemoryEntry, NodeKind, Tuning, World } from './types.ts'

/** The entries a newborn starts with: copies of the shareable ones, marked as learned from the parent. */
export function inheritMemory(parentMemory: MemoryEntry[], parentId: number, tuning: Tuning): MemoryEntry[] {
  const inherited: MemoryEntry[] = []
  for (const entry of parentMemory) {
    if (tuning.family.shareKinds.includes(entry.kind)) {
      const copy: MemoryEntry = { ...entry, learnedFrom: parentId }
      // Culture (C1): a family copy is not "taught" (the flag is only ever set by an elder's lesson, culture.ts).
      if (copy.taught !== undefined) delete copy.taught
      inherited.push(copy)
    }
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
 *
 * `options` (culture, C1) is absent for family sharing, which then behaves exactly as before: `kinds` replaces `family.shareKinds`; `limit` keeps
 * only that many of the entries that would be copied, freshest sighting first (ties to the lower node id); `mark` sets `taught: true` on each
 * copy (as its last key). Without `mark` a copy never carries a `taught` flag.
 */
export function mergeMemory(
  bot: Pick<Bot, 'memory'>,
  from: MemoryEntry[],
  fromId: number,
  tuning: Tuning,
  live: Set<number>,
  options?: { kinds?: readonly NodeKind[]; limit?: number; mark?: boolean },
): number {
  const touched = new Set<number>()
  const kinds = options?.kinds ?? tuning.family.shareKinds
  const mark = options?.mark === true
  let source = from
  if (options?.limit !== undefined) {
    source = from.filter((theirs) => {
      if (!kinds.includes(theirs.kind) || !live.has(theirs.nodeId)) return false
      const mine = bot.memory.find((entry) => entry.nodeId === theirs.nodeId)
      return mine === undefined || theirs.seenTick > mine.seenTick
    })
    source.sort((a, b) => b.seenTick - a.seenTick || a.nodeId - b.nodeId)
    source = source.slice(0, options.limit)
  }
  for (const theirs of source) {
    if (!kinds.includes(theirs.kind) || !live.has(theirs.nodeId)) continue
    const index = bot.memory.findIndex((entry) => entry.nodeId === theirs.nodeId)
    if (index < 0) {
      bot.memory.push(copyEntry(theirs, fromId, mark))
      touched.add(theirs.nodeId)
    } else {
      const mine = bot.memory[index]!
      if (theirs.seenTick > mine.seenTick) {
        // Replace the object rather than edit it, so snapshots of this memory stay unchanged.
        const copy = copyEntry(theirs, fromId, false)
        if (mine.toxic === true && copy.toxic === undefined) copy.toxic = true
        if (mark) copy.taught = true
        bot.memory[index] = copy
        touched.add(theirs.nodeId)
      } else if (theirs.toxic === true && mine.toxic !== true) {
        const flagged: MemoryEntry = { ...mine, toxic: true }
        // Keep `taught` the last key.
        if (flagged.taught !== undefined) {
          delete flagged.taught
          flagged.taught = true
        }
        bot.memory[index] = flagged
      }
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

/** A copy of `theirs` learned from `fromId`: never carries their `taught` flag, gets its own when `mark` (last key). */
function copyEntry(theirs: MemoryEntry, fromId: number, mark: boolean): MemoryEntry {
  const copy: MemoryEntry = { ...theirs, learnedFrom: fromId }
  if (copy.taught !== undefined) delete copy.taught
  if (mark) copy.taught = true
  return copy
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
