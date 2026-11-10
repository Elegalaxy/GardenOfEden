// Pure helpers for the family panel (M14): turning a `FamilyView` from the lineage store into
// rows to draw, the wording of a record's status, indentation limits for a narrow screen, the
// keyboard moves of the tree, and which record the panel is about. No React, no store, so
// Vitest covers all of it (familyMath.test.ts).

import type { FamilyNode, FamilyView, FounderLine } from '../sim/lineage.ts'
import type { LineageRecord } from '../sim/types.ts'
import { CAUSE_LABEL, causeSentence } from './labels.ts'

/** Ancestors listed by default (the lineage store can hold more; "show older" asks for `MAX_ANCESTORS`). */
export const DEFAULT_ANCESTORS = 5
export const MAX_ANCESTORS = 40
/** Levels of descendants open by default. */
export const DEFAULT_DEPTH = 3
/** What the panel asks the worker for: deeper than it opens, so expanding a node needs no new query. */
export const QUERY_DEPTH = 8
export const QUERY_MAX_NODES = 400
/** Most children listed under one node; the rest are counted ("+n more"). */
export const MAX_CHILDREN_SHOWN = 12
/** Most rows drawn in the tree, whatever is open. */
export const MAX_ROWS = 200
/** Most founder lines drawn. */
export const MAX_FOUNDER_ROWS = 60
/** Levels of indentation before deeper rows stop moving right: a narrow panel and a wide one. */
export const INDENT_CAP_NARROW = 4
export const INDENT_CAP_WIDE = 7
/** Panel width (px) below which the narrow indentation cap applies. */
export const NARROW_WIDTH = 420

const numberFormat = new Intl.NumberFormat('en-US')
export const formatCount = (value: number): string => numberFormat.format(value)

// ---- Wording ----

export const isAlive = (record: Pick<LineageRecord, 'died'>): boolean => record.died === null

/** "alive", or "died at t 12,345 · Starved". The words come first; the glyph is decoration. */
export function statusText(record: Pick<LineageRecord, 'died' | 'cause'>): string {
  if (record.died === null) return 'alive'
  const cause = record.cause === null ? '' : ` · ${CAUSE_LABEL[record.cause]}`
  return `died at t ${formatCount(record.died)}${cause}`
}

export const statusGlyph = (record: Pick<LineageRecord, 'died'>): string => (record.died === null ? '●' : '✕')

/** "no children", "1 child", "3 children". The record's lifetime count: pruned children are still counted. */
export function childrenText(count: number): string {
  if (count <= 0) return 'no children'
  return count === 1 ? '1 child' : `${formatCount(count)} children`
}

/** One sentence for a screen reader: everything on the row. */
export function rowLabel(record: LineageRecord): string {
  const died = record.died === null ? 'alive' : `${causeSentence(record.cause ?? undefined).toLowerCase()} at tick ${formatCount(record.died)}`
  return `Bot #${record.id}, generation ${record.generation}, born at tick ${formatCount(record.born)}, ${died}, ${childrenText(record.children)}`
}

/** How many older ancestors may exist beyond the ones listed (an upper bound: founders are generation 0), or 0 when the chain is complete. */
export function olderAncestors(view: Pick<FamilyView, 'ancestors' | 'ancestorsMissing'>): number {
  const last = view.ancestors[view.ancestors.length - 1]
  if (last === undefined || view.ancestorsMissing || last.parentId === null) return 0
  return Math.max(1, last.generation)
}

/** The deepest generation among the focus and the descendants the view loaded. */
export function deepestGeneration(view: Pick<FamilyView, 'focus' | 'descendants'>): number {
  let deepest = view.focus.generation
  const stack: FamilyNode[] = [...view.descendants]
  while (stack.length > 0) {
    const node = stack.pop() as FamilyNode
    if (node.record.generation > deepest) deepest = node.record.generation
    for (const child of node.children) stack.push(child)
  }
  return deepest
}

// ---- Indentation ----

export const indentCap = (width: number): number => (width > 0 && width < NARROW_WIDTH ? INDENT_CAP_NARROW : INDENT_CAP_WIDE)

/** Levels to indent a row at `depth` (1 = a child of the focus): the first level is flush left, and it stops growing at `cap`. */
export const indentLevels = (depth: number, cap: number): number => Math.max(0, Math.min(depth, cap) - 1)

/** Levels deeper than the indentation shows (0 for rows that still move right); shown as "+n" on the row. */
export const extraDepth = (depth: number, cap: number): number => Math.max(0, depth - cap)

// ---- Tree rows ----

export type NodeRow = {
  kind: 'node'
  id: number
  record: LineageRecord
  /** 1 for a child of the focus. */
  depth: number
  /** The row above in the tree, or null for a child of the focus. */
  parentId: number | null
  /** Children the view loaded under this node. */
  childCount: number
  /** Kept children of this node that the view left out. */
  hiddenChildren: number
  /** It has something to open: loaded children, or a count of hidden ones. */
  expandable: boolean
  expanded: boolean
}

export type MoreRow = { kind: 'more'; key: string; depth: number; count: number }

export type TreeRow = NodeRow | MoreRow

export type Flattened = {
  rows: TreeRow[]
  /** Rows that would have been shown but are past `maxRows`. */
  omitted: number
}

export type FlattenOptions = {
  /** Nodes at a shallower depth than this start open. */
  defaultDepth: number
  /** The player's own open (true) or closed (false) choices, by record id; they win over the default. */
  toggled: ReadonlyMap<number, boolean>
  maxRows: number
}

export const isOpen = (id: number, depth: number, options: Pick<FlattenOptions, 'defaultDepth' | 'toggled'>): boolean =>
  options.toggled.get(id) ?? depth < options.defaultDepth

/**
 * The tree as a flat list in reading order (a node, then what is under it if it is open). `hiddenRoot` is the
 * focus's children that the view left out. Open nodes list at most the children the view loaded, then a "+n more"
 * row for the hidden ones. At most `maxRows` rows come back; `omitted` counts the rest.
 */
export function flattenTree(descendants: readonly FamilyNode[], hiddenRoot: number, options: FlattenOptions): Flattened {
  const rows: TreeRow[] = []
  let omitted = 0
  const push = (row: TreeRow): void => {
    if (rows.length < options.maxRows) rows.push(row)
    else omitted += 1
  }
  const visit = (nodes: readonly FamilyNode[], hidden: number, depth: number, parentId: number | null): void => {
    for (const node of nodes) {
      const id = node.record.id
      const expandable = node.children.length > 0 || node.hiddenChildren > 0
      const expanded = expandable && isOpen(id, depth, options)
      push({
        kind: 'node',
        id,
        record: node.record,
        depth,
        parentId,
        childCount: node.children.length,
        hiddenChildren: node.hiddenChildren,
        expandable,
        expanded,
      })
      if (expanded) visit(node.children, node.hiddenChildren, depth + 1, id)
    }
    if (hidden > 0) push({ kind: 'more', key: `more-${parentId ?? 'root'}`, depth, count: hidden })
  }
  visit(descendants, hiddenRoot, 1, null)
  return { rows, omitted }
}

// ---- Keyboard ----

export type TreeKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

export const TREE_KEYS: readonly string[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']

export type TreeMove = { kind: 'focus'; id: number } | { kind: 'open'; id: number } | { kind: 'close'; id: number }

/**
 * What a key does from the row `activeId`: up and down (and Home, End) move between node rows; right opens a closed
 * node, or moves to its first child; left closes an open node, or moves to its parent row. Null when nothing happens.
 */
export function treeMove(rows: readonly TreeRow[], activeId: number, key: TreeKey): TreeMove | null {
  const nodes = rows.filter((row): row is NodeRow => row.kind === 'node')
  const index = nodes.findIndex((row) => row.id === activeId)
  if (index < 0) return nodes.length > 0 ? { kind: 'focus', id: nodes[0]!.id } : null
  const row = nodes[index]!
  const to = (target: NodeRow | undefined): TreeMove | null => (target === undefined || target.id === activeId ? null : { kind: 'focus', id: target.id })
  switch (key) {
    case 'ArrowDown':
      return to(nodes[index + 1])
    case 'ArrowUp':
      return to(nodes[index - 1])
    case 'Home':
      return to(nodes[0])
    case 'End':
      return to(nodes[nodes.length - 1])
    case 'ArrowRight': {
      if (row.expandable && !row.expanded) return { kind: 'open', id: row.id }
      const next = nodes[index + 1]
      return row.expanded && next !== undefined && next.parentId === row.id ? to(next) : null
    }
    case 'ArrowLeft': {
      if (row.expanded) return { kind: 'close', id: row.id }
      return row.parentId === null ? null : to(nodes.find((candidate) => candidate.id === row.parentId))
    }
  }
}

// ---- Founder lines ----

export type FounderRows = { rows: FounderLine[]; hidden: number }

/** The first `max` founder lines (they arrive sorted by living descendants, then id) and how many are left out. */
export function founderRows(lines: readonly FounderLine[], max: number = MAX_FOUNDER_ROWS): FounderRows {
  return { rows: lines.slice(0, max), hidden: Math.max(0, lines.length - max) }
}

/** True when no founder line has anyone alive: the line's own founder and all descendants are gone. */
export function allGone(lines: readonly FounderLine[]): boolean {
  return lines.every((line) => line.living === 0 && line.record.died !== null)
}

// ---- What the panel is about ----

/**
 * The player's choice of record to show, separate from the map selection. It holds while the selection is still
 * the one it was made for, and in the run it was made in: clicking another bot on the map, or a new run, drops it.
 * `id: null` means "founder lines" even though a bot is selected.
 */
export type FocusOverride = { id: number | null; forSelection: number | null; runId: number }

/** The record the panel shows: the override while it holds, else the selected bot, else nothing (the founder lines). */
export function resolveFocus(override: FocusOverride | null, selectedBotId: number | null, runId: number): number | null {
  if (override !== null && override.runId === runId && override.forSelection === selectedBotId) return override.id
  return selectedBotId
}

// ---- Stale answers ----

/** Hands out numbers for requests; only the newest request's answer is current. */
export type LatestOnly = { next(): number; isCurrent(ticket: number): boolean }

export function createLatestOnly(): LatestOnly {
  let latest = 0
  return {
    next: () => {
      latest += 1
      return latest
    },
    isCurrent: (ticket) => ticket === latest,
  }
}

/** Whether a polling tick should ask again: while running every time, while paused only if the tick moved (a step) since the last answer. */
export function shouldRequery(paused: boolean, tick: number, answeredTick: number | null): boolean {
  if (answeredTick === null) return true
  return !paused || tick !== answeredTick
}
