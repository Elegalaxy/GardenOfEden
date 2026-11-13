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
//              1. mark every record that has a living descendant: walk each living bot up both its
//                 mother and father lines, stopping at a record already marked (a living bot's own
//                 record is marked too);
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
// A record has a mother (`parentId`, the bearing parent, or the only parent when sex is off) and a
// `fatherId` (null for founders, placed bots and asexual births), plus its `sex` and its `inbreeding`
// score at birth (M18; `relatedness` computes it from two records).
// A record whose parent record is gone is valid: `parentId` keeps the id, `findRecord` just misses.
// `children` is a lifetime count and is not lowered when a child record is pruned, so it can exceed
// the number of kept child records.
//
// Read-only queries for the family-tree view. With two parents the family is a graph (a DAG: a child
// has a larger id than both parents), so a child is listed under its mother and under its father:
//   familyView      a record, its mother line (ancestors, nearest first), its father, and its
//                   descendants as a depth-, width- and size-limited tree in which every record
//                   appears once (under the first parent reached). Descendant counts cover the kept
//                   records only and count each record once.
//   founderLines    the roots of the forest: records none of whose parents is kept (parentId and
//                   fatherId each null or pruned), each with its living and total descendant counts.
//                   Lines can overlap: a child of two lines counts in both.
// Both count descendants without the record itself.

import type { DeathCause, LineageRecord, Sex, Traits, Tuning, World } from './types.ts'

/** A record plus its descendants shown in a `familyView`. */
export type FamilyNode = {
  record: LineageRecord
  children: FamilyNode[]
  /** Children of this record that are kept but not shown (too many siblings, too deep, or out of room). */
  hiddenChildren: number
}

export type FamilyView = {
  focus: LineageRecord
  /** The mother line: mother first, then her mother, and so on, at most `up` of them (each record's `fatherId` leads to the other side). */
  ancestors: LineageRecord[]
  /** True when the walk up ended because an ancestor's record is no longer kept (not because of the `up` limit). */
  ancestorsMissing: boolean
  /** The focus's father record, or null (no father, or his record is no longer kept: see `fatherMissing`). */
  father: LineageRecord | null
  /** True when the focus has a `fatherId` but that record is no longer kept. */
  fatherMissing: boolean
  /** Kept children of the focus that `descendants` leaves out (too many siblings, `down` is 0, or out of room). */
  hiddenChildren: number
  /** The focus's kept children as a tree to depth `down`; shown children are those with the most living descendants first, then the lowest id. */
  descendants: FamilyNode[]
  /** Kept descendants of the focus still alive (the focus itself not counted; each record once). */
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
  fatherId: number | null,
  sex: Sex,
  generation: number,
  traits: Traits,
  inbreeding = 0,
): LineageRecord {
  const record: LineageRecord = {
    id,
    parentId,
    fatherId,
    sex,
    inbreeding,
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

/**
 * Inbreeding score (M18) of a child of this mother and father, from their records: 1 when one is the
 * other's parent or they are full siblings (same mother and same father), 0.5 for half siblings (exactly
 * one parent in common), else 0. It compares the parent ids stored in the two records, so it needs only
 * the mates' own records (a living bot's record is never pruned); a parent that is null (founder, placed
 * bot, asexual birth) never matches anything, and a mate whose record is missing counts as unrelated.
 * Draws no random numbers.
 */
export function relatedness(world: Pick<World, 'lineage'>, motherId: number, fatherId: number): number {
  const mother = world.lineage[indexOfId(world.lineage, motherId)]
  const father = world.lineage[indexOfId(world.lineage, fatherId)]
  if (mother === undefined || father === undefined) return 0
  if (mother.parentId === fatherId || mother.fatherId === fatherId) return 1
  if (father.parentId === motherId || father.fatherId === motherId) return 1
  const sameMother = mother.parentId !== null && mother.parentId === father.parentId
  const sameFather = mother.fatherId !== null && mother.fatherId === father.fatherId
  if (sameMother && sameFather) return 1
  return sameMother || sameFather ? 0.5 : 0
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
    // Walk up both parent lines (mother and father) with a stack; a record already marked is not walked again.
    const stack: number[] = [bot.id]
    while (stack.length > 0) {
      const next = stack.pop() as number
      const record = findRecord(world, next)
      if (record === undefined) {
        // The bot's own record is gone: carry on from its parents. Further up, a gap ends that walk.
        if (next === bot.id) {
          if (bot.parentId !== null) stack.push(bot.parentId)
          if (bot.fatherId !== null) stack.push(bot.fatherId)
        }
        continue
      }
      if (marked.has(record.id)) continue
      marked.add(record.id)
      if (record.parentId !== null) stack.push(record.parentId)
      if (record.fatherId !== null) stack.push(record.fatherId)
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

/**
 * Kept children of every record that has any, by parent id. A record is listed under its mother
 * (`parentId`) and under its father (`fatherId`), so the family is a graph, not a tree. Child lists
 * are in ascending id order.
 */
function childIndex(world: World): Map<number, LineageRecord[]> {
  const index = new Map<number, LineageRecord[]>()
  const add = (parent: number, record: LineageRecord): void => {
    const list = index.get(parent)
    if (list === undefined) index.set(parent, [record])
    else list.push(record)
  }
  for (const record of world.lineage) {
    if (record.parentId !== null) add(record.parentId, record)
    if (record.fatherId !== null && record.fatherId !== record.parentId) add(record.fatherId, record)
  }
  return index
}

/** Every kept record below `root` (the root itself not included), each once, found with a visited set. */
function descendantsOf(root: LineageRecord, index: ReadonlyMap<number, LineageRecord[]>): LineageRecord[] {
  const seen = new Set<number>([root.id])
  const found: LineageRecord[] = []
  const stack: LineageRecord[] = [root]
  while (stack.length > 0) {
    const record = stack.pop() as LineageRecord
    for (const child of index.get(record.id) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      found.push(child)
      stack.push(child)
    }
  }
  return found
}

/**
 * The family around one bot. `up` is how many ancestors to list (the mother line), `down` the tree
 * depth below the focus (0 = no descendants shown), `maxNodes` the most descendant nodes in the tree
 * and `maxChildren` the most under any one node. Nodes are added level by level, so a tight `maxNodes`
 * cuts the deepest generation first. A child of two kept parents appears once in the tree, under
 * whichever parent is reached first. Null when the focus has no record.
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
  const father = focus.fatherId === null ? undefined : findRecord(world, focus.fatherId)
  const fatherMissing = focus.fatherId !== null && father === undefined

  // Descendant counts, bottom-up (a child always has a larger id than either parent). The focus's own
  // counts are exact (a visited set); the per-node counts that rank siblings add up the children's
  // counts, so a record reachable through two children is counted twice there (ranking only).
  const index = childIndex(world)
  const subtree = descendantsOf(focus, index)
  const livingDescendants = subtree.reduce((sum, r) => sum + (r.died === null ? 1 : 0), 0)
  const order = [focus, ...subtree].sort((a, b) => b.id - a.id)
  const livingBelow = new Map<number, number>()
  for (const record of order) {
    let living = 0
    for (const child of index.get(record.id) ?? []) living += (child.died === null ? 1 : 0) + (livingBelow.get(child.id) ?? 0)
    livingBelow.set(record.id, living)
  }

  // The tree, one level at a time. Siblings are ranked by living members of their branch (the child included).
  // `seen` makes every record appear once: a child already placed under another parent is skipped here.
  const weight = (r: LineageRecord): number => (livingBelow.get(r.id) ?? 0) + (r.died === null ? 1 : 0)
  const seen = new Set<number>([focus.id])
  const root: FamilyNode = { record: focus, children: [], hiddenChildren: 0 }
  let budget = Math.max(0, maxNodes)
  let level: FamilyNode[] = [root]
  for (let depth = 0; depth <= down; depth += 1) {
    const nextLevel: FamilyNode[] = []
    for (const node of level) {
      const kept = (index.get(node.record.id) ?? []).filter((r) => !seen.has(r.id))
      const ordered = [...kept].sort((a, b) => weight(b) - weight(a) || a.id - b.id)
      const canShow = depth < down ? Math.min(ordered.length, Math.max(0, maxChildren), budget) : 0
      for (let i = 0; i < canShow; i += 1) {
        const child: FamilyNode = { record: ordered[i], children: [], hiddenChildren: 0 }
        seen.add(ordered[i].id)
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
    father: father ?? null,
    fatherMissing,
    hiddenChildren: root.hiddenChildren,
    descendants: root.children,
    livingDescendants,
    totalDescendants: subtree.length,
  }
}

/**
 * The roots of the forest: every record none of whose parents is kept (`parentId` and `fatherId` each
 * null or pruned), with its descendant counts. Sorted by living descendants (most first), then by id.
 * Lines can overlap: a child of two lines counts in both, so the totals can add up to more than the
 * number of records.
 */
export function founderLines(world: World): FounderLine[] {
  const records = world.lineage
  const index = childIndex(world)
  const lines: FounderLine[] = []
  for (const record of records) {
    const motherKept = record.parentId !== null && indexOfId(records, record.parentId) >= 0
    const fatherKept = record.fatherId !== null && indexOfId(records, record.fatherId) >= 0
    if (motherKept || fatherKept) continue
    const below = descendantsOf(record, index)
    lines.push({ record, living: below.reduce((sum, r) => sum + (r.died === null ? 1 : 0), 0), total: below.length })
  }
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
