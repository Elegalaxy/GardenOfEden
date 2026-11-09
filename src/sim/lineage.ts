// Lineage records (M11): who begat whom. Dead bots leave `world.bots`, so the family tree lives in
// `World.lineage`, one small `LineageRecord` per bot that ever lived (founders, placed bots and
// newborns), in ascending id order (ids only grow, so adding a record is a push and `findRecord`
// is a binary search). It is plain JSON inside the World, so it replays and hashes with the run;
// it is bookkeeping only: it draws no random numbers and nothing in the sim reads it back.
//
// Hooks (the rules for when a record changes):
//   birth    `addRecord` for founders (createWorld), placed bots (placeBot command, parentId null, born =
//            current tick) and newborns (spawnChildren: also adds 1 to the parent record's `children`).
//   death    `recordDeath` sets `died` (the tick) and `cause`, next to every `deathsByCause` increment.
//   pruning  `pruneLineage` runs once per tick after the children are added, and does nothing until
//            there are more than `lineage.maxRecords` records. Then, in order:
//              1. mark every record that has a living descendant: walk each living bot up its parent
//                 chain, stopping at a record already marked (a living bot's own record is marked too);
//              2. drop dead, unmarked records (extinct branches), the earliest `died` first, then the
//                 lowest id, until `lineage.pruneTo` records remain;
//              3. if still over, drop dead marked records (ancestors of living bots), lowest id first,
//                 so the oldest ancestors go first.
//            A living bot's own record is never dropped (so the length can stay above `pruneTo`
//            only when more bots live than `pruneTo`, which the population cap rules out in the
//            shipped tuning). Pruning in a batch (down to `pruneTo`, well under `maxRecords`) means it
//            runs once every few hundred births instead of every tick. `lineagePruned` counts the
//            records dropped so far.
//
// A record whose parent record is gone is valid: `parentId` keeps the id, `findRecord` just misses.
// `children` is a lifetime count and is not lowered when a child record is pruned, so it can exceed
// the number of kept child records.
//
// Read-only queries for the family-tree view (no UI yet):
//   familyView      a record, its ancestors (nearest first), and its descendants as a depth-, width-
//                   and size-limited tree. Descendant counts cover the kept records only.
//   founderLines    the roots of the forest: records with `parentId` null, or whose parent record is
//                   no longer kept, each with its living and total descendant counts.
// Both count descendants without the record itself.

import type { DeathCause, LineageRecord, Traits, Tuning, World } from './types.ts'

/** A record plus its descendants shown in a `familyView`. */
export type FamilyNode = {
  record: LineageRecord
  children: FamilyNode[]
  /** Children of this record that are kept but not shown (too many siblings, too deep, or out of room). */
  hiddenChildren: number
}

export type FamilyView = {
  focus: LineageRecord
  /** Parent first, then grandparent, and so on, at most `up` of them. */
  ancestors: LineageRecord[]
  /** True when the walk up ended because an ancestor's record is no longer kept (not because of the `up` limit). */
  ancestorsMissing: boolean
  /** Kept children of the focus that `descendants` leaves out (too many siblings, `down` is 0, or out of room). */
  hiddenChildren: number
  /** The focus's kept children as a tree to depth `down`; shown children are those with the most living descendants first, then the lowest id. */
  descendants: FamilyNode[]
  /** Kept descendants of the focus still alive (the focus itself not counted). */
  livingDescendants: number
  /** All kept descendants of the focus (the focus itself not counted). */
  totalDescendants: number
}

export type FounderLine = {
  record: LineageRecord
  /** Kept descendants still alive (the founder itself not counted). */
  living: number
  /** All kept descendants (the founder itself not counted). */
  total: number
}

/** Default most children shown under one node of a `familyView`. */
export const DEFAULT_MAX_CHILDREN = 8

/** The record for a bot id, or undefined when there is none (never made, or pruned). Binary search. */
export function findRecord(world: World, id: number): LineageRecord | undefined {
  return world.lineage[indexOfId(world.lineage, id)]
}

/** Adds the record for a new bot. Ids only grow, so this is a push; an out-of-order id is inserted in place, a repeated id is ignored. */
export function addRecord(
  world: World,
  id: number,
  parentId: number | null,
  generation: number,
  traits: Traits,
): LineageRecord {
  const record: LineageRecord = {
    id,
    parentId,
    generation,
    born: world.tick,
    died: null,
    cause: null,
    children: 0,
    traits: { ...traits },
  }
  const records = world.lineage
  const last = records[records.length - 1]
  if (last === undefined || last.id < id) {
    records.push(record)
    return record
  }
  const existing = findRecord(world, id)
  if (existing !== undefined) return existing
  let lo = 0
  let hi = records.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (records[mid].id < id) lo = mid + 1
    else hi = mid
  }
  records.splice(lo, 0, record)
  return record
}

/** Marks the bot's record dead at the current tick. Does nothing when the record is not kept. */
export function recordDeath(world: World, id: number, cause: DeathCause): void {
  const record = findRecord(world, id)
  if (record === undefined) return
  record.died = world.tick
  record.cause = cause
}

/** Drops records when there are more than `lineage.maxRecords`; see the header for the order. */
export function pruneLineage(world: World, tuning: Tuning): void {
  const { maxRecords, pruneTo } = tuning.lineage
  const records = world.lineage
  if (records.length <= maxRecords) return

  // 1. Records with a living descendant (a living bot's own record included).
  const marked = new Set<number>()
  for (const bot of world.bots) {
    let next: number | null = bot.id
    while (next !== null) {
      const record = findRecord(world, next)
      if (record === undefined) {
        // The bot's own record is gone: carry on from its parent. Further up, a gap ends the walk.
        next = next === bot.id ? bot.parentId : null
        continue
      }
      if (marked.has(record.id)) break
      marked.add(record.id)
      next = record.parentId
    }
  }

  let excess = records.length - pruneTo
  const removed = new Set<number>()

  // 2. Extinct branches: dead and unmarked, the earliest death first, then the lowest id.
  const extinct = records.filter((r) => r.died !== null && !marked.has(r.id))
  extinct.sort((a, b) => (a.died as number) - (b.died as number) || a.id - b.id)
  for (let i = 0; i < extinct.length && excess > 0; i += 1, excess -= 1) removed.add(extinct[i].id)

  // 3. Still over: dead ancestors of living bots, the oldest (lowest id) first. Records are in id order already.
  if (excess > 0) {
    for (const record of records) {
      if (excess <= 0) break
      if (record.died !== null && marked.has(record.id)) {
        removed.add(record.id)
        excess -= 1
      }
    }
  }

  if (removed.size === 0) return
  world.lineage = records.filter((r) => !removed.has(r.id))
  world.lineagePruned += removed.size
}

/** Kept children of every record that has any, by parent id. Child lists are in ascending id order. */
function childIndex(world: World): Map<number, LineageRecord[]> {
  const index = new Map<number, LineageRecord[]>()
  for (const record of world.lineage) {
    if (record.parentId === null) continue
    const list = index.get(record.parentId)
    if (list === undefined) index.set(record.parentId, [record])
    else list.push(record)
  }
  return index
}

/**
 * The family around one bot. `up` is how many ancestors to list, `down` the tree depth below the
 * focus (0 = no descendants shown), `maxNodes` the most descendant nodes in the tree and
 * `maxChildren` the most under any one node. Nodes are added level by level, so a tight `maxNodes`
 * cuts the deepest generation first. Null when the focus has no record.
 */
export function familyView(
  world: World,
  id: number,
  up: number,
  down: number,
  maxNodes: number,
  maxChildren: number = DEFAULT_MAX_CHILDREN,
): FamilyView | null {
  const focus = findRecord(world, id)
  if (focus === undefined) return null

  const ancestors: LineageRecord[] = []
  let ancestorsMissing = false
  let cursor: LineageRecord = focus
  while (ancestors.length < up && cursor.parentId !== null) {
    const parent = findRecord(world, cursor.parentId)
    if (parent === undefined) {
      ancestorsMissing = true
      break
    }
    ancestors.push(parent)
    cursor = parent
  }

  // Descendant counts for the whole subtree, bottom-up (a child always has a larger id than its parent).
  const index = childIndex(world)
  const subtree: LineageRecord[] = []
  const stack: LineageRecord[] = [focus]
  while (stack.length > 0) {
    const record = stack.pop() as LineageRecord
    subtree.push(record)
    for (const child of index.get(record.id) ?? []) stack.push(child)
  }
  subtree.sort((a, b) => b.id - a.id)
  const livingBelow = new Map<number, number>()
  const totalBelow = new Map<number, number>()
  for (const record of subtree) {
    let living = 0
    let total = 0
    for (const child of index.get(record.id) ?? []) {
      living += (child.died === null ? 1 : 0) + (livingBelow.get(child.id) ?? 0)
      total += 1 + (totalBelow.get(child.id) ?? 0)
    }
    livingBelow.set(record.id, living)
    totalBelow.set(record.id, total)
  }

  // The tree, one level at a time. Siblings are ranked by living members of their branch (the child included).
  const weight = (r: LineageRecord): number => (livingBelow.get(r.id) ?? 0) + (r.died === null ? 1 : 0)
  const root: FamilyNode = { record: focus, children: [], hiddenChildren: 0 }
  let budget = Math.max(0, maxNodes)
  let level: FamilyNode[] = [root]
  for (let depth = 0; depth <= down; depth += 1) {
    const nextLevel: FamilyNode[] = []
    for (const node of level) {
      const kept = index.get(node.record.id) ?? []
      const ordered = [...kept].sort((a, b) => weight(b) - weight(a) || a.id - b.id)
      const canShow = depth < down ? Math.min(ordered.length, Math.max(0, maxChildren), budget) : 0
      for (let i = 0; i < canShow; i += 1) {
        const child: FamilyNode = { record: ordered[i], children: [], hiddenChildren: 0 }
        node.children.push(child)
        nextLevel.push(child)
      }
      budget -= canShow
      node.hiddenChildren = ordered.length - canShow
    }
    level = nextLevel
    if (level.length === 0) break
  }

  return {
    focus,
    ancestors,
    ancestorsMissing,
    hiddenChildren: root.hiddenChildren,
    descendants: root.children,
    livingDescendants: livingBelow.get(focus.id) ?? 0,
    totalDescendants: totalBelow.get(focus.id) ?? 0,
  }
}

/**
 * The roots of the forest: every record with `parentId` null or whose parent record is not kept,
 * with its descendant counts. Sorted by living descendants (most first), then by id.
 */
export function founderLines(world: World): FounderLine[] {
  const records = world.lineage
  const living = new Array<number>(records.length).fill(0)
  const total = new Array<number>(records.length).fill(0)
  const lines: FounderLine[] = []
  const rootIndexes: number[] = []
  // Newest first: a child is added to its parent's counts after the child's own counts are complete.
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const record = records[i]
    const parentIndex = record.parentId === null ? -1 : indexOfId(records, record.parentId)
    if (parentIndex < 0) {
      rootIndexes.push(i)
      continue
    }
    living[parentIndex] += (record.died === null ? 1 : 0) + living[i]
    total[parentIndex] += 1 + total[i]
  }
  for (const i of rootIndexes) lines.push({ record: records[i], living: living[i], total: total[i] })
  return lines.sort((a, b) => b.living - a.living || a.record.id - b.record.id)
}

/** Index of the record with this id in an id-sorted list, or -1. */
function indexOfId(records: readonly LineageRecord[], id: number): number {
  let lo = 0
  let hi = records.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const probe = records[mid].id
    if (probe === id) return mid
    if (probe < id) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}
