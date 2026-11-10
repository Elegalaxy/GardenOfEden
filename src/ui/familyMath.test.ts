import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../content/index.ts'
import { familyView } from '../sim/lineage.ts'
import type { FamilyNode, FamilyView, FounderLine } from '../sim/lineage.ts'
import { replayWorld } from '../sim/replay.ts'
import type { DeathCause, LineageRecord } from '../sim/types.ts'
import { createInlineClient } from './simClient.ts'
import {
  DEFAULT_DEPTH,
  INDENT_CAP_NARROW,
  INDENT_CAP_WIDE,
  MAX_FOUNDER_ROWS,
  MAX_ROWS,
  allGone,
  childrenText,
  createLatestOnly,
  deepestGeneration,
  extraDepth,
  flattenTree,
  founderRows,
  indentCap,
  indentLevels,
  olderAncestors,
  resolveFocus,
  rowLabel,
  shouldRequery,
  statusGlyph,
  statusText,
  treeMove,
} from './familyMath.ts'
import type { FocusOverride, NodeRow, TreeRow } from './familyMath.ts'
import { advance, queryFamily, setSimClient, settled } from './store.ts'

const traits = { senseRadius: 6, caution: 0.5, reproThreshold: 80, metabolism: 1 }

function record(id: number, parentId: number | null, extra: Partial<LineageRecord> = {}): LineageRecord {
  return { id, parentId, generation: parentId === null ? 0 : 1, born: id * 10, died: null, cause: null, children: 0, traits, ...extra }
}

function node(rec: LineageRecord, children: FamilyNode[] = [], hiddenChildren = 0): FamilyNode {
  return { record: rec, children, hiddenChildren }
}

/** A chain: each node has one child, `length` deep, ids from `start`. */
function chain(length: number, start = 1, hiddenAtEnd = 0): FamilyNode {
  const make = (i: number): FamilyNode =>
    node(record(start + i, i === 0 ? 0 : start + i - 1, { generation: i + 1 }), i + 1 < length ? [make(i + 1)] : [], i + 1 < length ? 0 : hiddenAtEnd)
  return make(0)
}

const none = new Map<number, boolean>()
const opts = { defaultDepth: DEFAULT_DEPTH, toggled: none, maxRows: MAX_ROWS }
const nodeRows = (rows: TreeRow[]): NodeRow[] => rows.filter((row): row is NodeRow => row.kind === 'node')

describe('status wording', () => {
  it('says alive, or when and how a bot died, for every cause', () => {
    expect(statusText(record(1, null))).toBe('alive')
    expect(statusGlyph(record(1, null))).toBe('●')
    const labels: Record<DeathCause, string> = {
      starve: 'Starved',
      thirst: 'Thirst',
      danger: 'Danger',
      plague: 'Plague',
      meteor: 'Meteor',
      age: 'Old age',
    }
    for (const cause of Object.keys(labels) as DeathCause[]) {
      const dead = record(2, null, { died: 12345, cause })
      expect(statusText(dead)).toBe(`died at t 12,345 · ${labels[cause]}`)
      expect(statusGlyph(dead)).toBe('✕')
    }
    expect(statusText(record(3, null, { died: 9, cause: null }))).toBe('died at t 9')
  })

  it('counts children, singular and plural', () => {
    expect(childrenText(0)).toBe('no children')
    expect(childrenText(1)).toBe('1 child')
    expect(childrenText(1234)).toBe('1,234 children')
  })

  it('reads a whole row aloud, without colour', () => {
    expect(rowLabel(record(7, 3, { generation: 2, born: 500, children: 1 }))).toBe('Bot #7, generation 2, born at tick 500, alive, 1 child')
    expect(rowLabel(record(8, 3, { died: 900, cause: 'thirst' }))).toContain('died of thirst at tick 900')
  })
})

describe('ancestors and depth', () => {
  const view = (ancestors: LineageRecord[], ancestorsMissing: boolean): Pick<FamilyView, 'ancestors' | 'ancestorsMissing'> => ({ ancestors, ancestorsMissing })

  it('counts older ancestors only when the chain was cut by the limit', () => {
    expect(olderAncestors(view([], false))).toBe(0)
    const founder = record(1, null, { generation: 0 })
    expect(olderAncestors(view([record(2, 1, { generation: 1 }), founder], false))).toBe(0)
    expect(olderAncestors(view([record(9, 8, { generation: 8 })], false))).toBe(8)
    expect(olderAncestors(view([record(9, 8, { generation: 8 })], true))).toBe(0)
  })

  it('finds the deepest generation among the focus and the loaded descendants', () => {
    const focus = record(1, null, { generation: 4 })
    expect(deepestGeneration({ focus, descendants: [] })).toBe(4)
    const deep = node(record(2, 1, { generation: 5 }), [node(record(3, 2, { generation: 7 }))])
    expect(deepestGeneration({ focus, descendants: [deep, node(record(4, 1, { generation: 5 }))] })).toBe(7)
  })
})

describe('indentation', () => {
  it('stops moving right at the cap and counts the levels beyond it', () => {
    expect([1, 2, 3, 4, 5, 6].map((d) => indentLevels(d, INDENT_CAP_NARROW))).toEqual([0, 1, 2, 3, 3, 3])
    expect([1, 4, 5, 6].map((d) => extraDepth(d, INDENT_CAP_NARROW))).toEqual([0, 0, 1, 2])
    expect(extraDepth(7, INDENT_CAP_WIDE)).toBe(0)
    expect(extraDepth(9, INDENT_CAP_WIDE)).toBe(2)
  })

  it('uses the narrow cap in a narrow panel, and the wide one before the width is known', () => {
    expect(indentCap(300)).toBe(INDENT_CAP_NARROW)
    expect(indentCap(419)).toBe(INDENT_CAP_NARROW)
    expect(indentCap(420)).toBe(INDENT_CAP_WIDE)
    expect(indentCap(0)).toBe(INDENT_CAP_WIDE)
  })
})

describe('flattenTree', () => {
  it('lists children in reading order and opens the first levels by default', () => {
    const tree = [node(record(2, 1), [node(record(4, 2), [node(record(6, 4), [node(record(8, 6))])])]), node(record(3, 1))]
    const { rows, omitted } = flattenTree(tree, 0, opts)
    expect(omitted).toBe(0)
    // Depth 1 and 2 are open (depth < 3), depth 3 is closed, so #8 is not listed.
    expect(nodeRows(rows).map((r) => [r.id, r.depth, r.parentId, r.expanded])).toEqual([
      [2, 1, null, true],
      [4, 2, 2, true],
      [6, 3, 4, false],
      [3, 1, null, false],
    ])
    expect(nodeRows(rows).find((r) => r.id === 6)?.expandable).toBe(true)
    expect(nodeRows(rows).find((r) => r.id === 3)?.expandable).toBe(false)
  })

  it('follows the player: an open node past the default depth lists its children, a closed one hides them', () => {
    const tree = [chain(5, 2)]
    const closedTop = flattenTree(tree, 0, { ...opts, toggled: new Map([[2, false]]) })
    expect(nodeRows(closedTop.rows).map((r) => r.id)).toEqual([2])
    const openDeep = flattenTree(tree, 0, { ...opts, toggled: new Map([[4, true]]) })
    expect(nodeRows(openDeep.rows).map((r) => r.id)).toEqual([2, 3, 4, 5])
    const allOpen = flattenTree(tree, 0, { ...opts, toggled: new Map([[4, true], [5, true]]) })
    expect(nodeRows(allOpen.rows).map((r) => r.id)).toEqual([2, 3, 4, 5, 6])
  })

  it('adds a "+n more" row for children the view left out, under an open node and at the top', () => {
    const tree = [node(record(2, 1), [node(record(3, 2))], 5)]
    const { rows } = flattenTree(tree, 7, opts)
    expect(rows.map((r) => (r.kind === 'more' ? `more${r.count}@${r.depth}` : `#${r.id}`))).toEqual(['#2', '#3', 'more5@2', 'more7@1'])
    // Closed: its hidden count stays out of sight until it is opened.
    const closed = flattenTree(tree, 0, { ...opts, toggled: new Map([[2, false]]) })
    expect(closed.rows).toHaveLength(1)
    // A node with only hidden children is still openable.
    const leaf = flattenTree([node(record(2, 1), [], 3)], 0, { ...opts, toggled: new Map([[2, false]]) })
    expect(nodeRows(leaf.rows)[0]).toMatchObject({ expandable: true, expanded: false, hiddenChildren: 3, childCount: 0 })
  })

  it('never returns more than maxRows and says how many it left out', () => {
    const wide = Array.from({ length: 12 }, (_, i) => node(record(100 + i, 1), Array.from({ length: 12 }, (_, j) => node(record(1000 + i * 20 + j, 100 + i)))))
    const all = flattenTree(wide, 0, { ...opts, maxRows: 10_000 })
    expect(all.rows).toHaveLength(12 + 144)
    expect(flattenTree(wide, 0, opts).rows).toHaveLength(156)
    const tight = flattenTree(wide, 0, { ...opts, maxRows: 50 })
    expect(tight.rows).toHaveLength(50)
    expect(tight.omitted).toBe(all.rows.length - 50)
  })

  it('caps a very large tree at 200 rows', () => {
    const big = Array.from({ length: 12 }, (_, i) => node(record(100 + i, 1), Array.from({ length: 12 }, (_, j) => node(record(1000 + i * 20 + j, 100 + i), [node(record(5000 + i * 20 + j, 1000 + i * 20 + j))]))))
    const { rows, omitted } = flattenTree(big, 0, { ...opts, defaultDepth: 9 })
    expect(rows).toHaveLength(MAX_ROWS)
    expect(omitted).toBe(12 + 144 + 144 - MAX_ROWS)
  })
})

describe('treeMove', () => {
  // #2 (open) > #4 (open) > #6 (closed, has children), then #3 (leaf).
  const tree = [node(record(2, 1), [node(record(4, 2), [node(record(6, 4), [node(record(8, 6))])])]), node(record(3, 1))]
  const { rows } = flattenTree(tree, 0, opts)

  it('moves between rows with the up and down keys, and stays put at the ends', () => {
    expect(treeMove(rows, 2, 'ArrowDown')).toEqual({ kind: 'focus', id: 4 })
    expect(treeMove(rows, 4, 'ArrowUp')).toEqual({ kind: 'focus', id: 2 })
    expect(treeMove(rows, 2, 'ArrowUp')).toBeNull()
    expect(treeMove(rows, 3, 'ArrowDown')).toBeNull()
    expect(treeMove(rows, 4, 'Home')).toEqual({ kind: 'focus', id: 2 })
    expect(treeMove(rows, 2, 'End')).toEqual({ kind: 'focus', id: 3 })
    expect(treeMove(rows, 2, 'Home')).toBeNull()
  })

  it('opens a closed node on right, then goes to its first child', () => {
    expect(treeMove(rows, 6, 'ArrowRight')).toEqual({ kind: 'open', id: 6 })
    expect(treeMove(rows, 2, 'ArrowRight')).toEqual({ kind: 'focus', id: 4 })
    expect(treeMove(rows, 3, 'ArrowRight')).toBeNull()
  })

  it('closes an open node on left, then goes to the parent row', () => {
    expect(treeMove(rows, 2, 'ArrowLeft')).toEqual({ kind: 'close', id: 2 })
    expect(treeMove(rows, 6, 'ArrowLeft')).toEqual({ kind: 'focus', id: 4 })
    expect(treeMove(rows, 3, 'ArrowLeft')).toBeNull()
  })

  it('goes to the first row when the active one is not listed, and nowhere with no rows', () => {
    expect(treeMove(rows, 999, 'ArrowDown')).toEqual({ kind: 'focus', id: 2 })
    expect(treeMove([], 1, 'ArrowDown')).toBeNull()
  })

  it('skips "+n more" rows', () => {
    const withMore = flattenTree([node(record(2, 1), [node(record(3, 2))], 4), node(record(5, 1))], 0, opts)
    expect(treeMove(withMore.rows, 3, 'ArrowDown')).toEqual({ kind: 'focus', id: 5 })
  })
})

describe('founder lines', () => {
  const line = (id: number, living: number, total: number, died: number | null = null): FounderLine => ({ record: record(id, null, { died, cause: died === null ? null : 'starve' }), living, total })

  it('keeps the first rows and counts the rest', () => {
    const lines = Array.from({ length: MAX_FOUNDER_ROWS + 5 }, (_, i) => line(i + 1, 0, 0))
    const { rows, hidden } = founderRows(lines)
    expect(rows).toHaveLength(MAX_FOUNDER_ROWS)
    expect(hidden).toBe(5)
    expect(founderRows(lines.slice(0, 3))).toEqual({ rows: lines.slice(0, 3), hidden: 0 })
  })

  it('knows when every line has died out', () => {
    expect(allGone([line(1, 0, 4, 100), line(2, 0, 0, 50)])).toBe(true)
    expect(allGone([line(1, 0, 4, 100), line(2, 0, 0)])).toBe(false)
    expect(allGone([line(1, 2, 4, 100)])).toBe(false)
    expect(allGone([])).toBe(true)
  })
})

describe('what the panel shows', () => {
  const override = (id: number | null, forSelection: number | null, runId = 1): FocusOverride => ({ id, forSelection, runId })

  it('shows the selected bot, or the founder lines when nothing is selected', () => {
    expect(resolveFocus(null, 5, 1)).toBe(5)
    expect(resolveFocus(null, null, 1)).toBeNull()
  })

  it('keeps the player\'s choice while the selection is the one it was made for', () => {
    expect(resolveFocus(override(9, 5), 5, 1)).toBe(9)
    expect(resolveFocus(override(9, null), null, 1)).toBe(9)
    expect(resolveFocus(override(null, 5), 5, 1)).toBeNull()
  })

  it('drops the choice when another bot is selected, or the run changes', () => {
    expect(resolveFocus(override(9, 5), 6, 1)).toBe(6)
    expect(resolveFocus(override(9, 5), null, 1)).toBeNull()
    expect(resolveFocus(override(9, 5, 1), 5, 2)).toBe(5)
  })
})

describe('stale answers', () => {
  it('counts only the newest request as current', () => {
    const latest = createLatestOnly()
    const first = latest.next()
    expect(latest.isCurrent(first)).toBe(true)
    const second = latest.next()
    expect(latest.isCurrent(first)).toBe(false)
    expect(latest.isCurrent(second)).toBe(true)
  })

  it('drops an answer that arrives after a newer request, whatever the order', async () => {
    const latest = createLatestOnly()
    const kept: string[] = []
    const request = (label: string, delay: number): Promise<void> => {
      const ticket = latest.next()
      return new Promise<void>((resolve) => setTimeout(resolve, delay)).then(() => {
        if (latest.isCurrent(ticket)) kept.push(label)
      })
    }
    await Promise.all([request('slow old', 30), request('fast new', 1)])
    expect(kept).toEqual(['fast new'])
  })

  it('asks again while running, and while paused only if the tick moved', () => {
    expect(shouldRequery(false, 100, 100)).toBe(true)
    expect(shouldRequery(true, 100, 100)).toBe(false)
    expect(shouldRequery(true, 101, 100)).toBe(true)
    expect(shouldRequery(true, 100, null)).toBe(true)
  })
})

describe('the family of a live bot, through the store', () => {
  it('matches familyView on a replayed world', async () => {
    setSimClient(createInlineClient())
    await settled()
    for (let i = 0; i < 15; i += 1) await advance(100, 1)
    await settled()
    const world = replayWorld('a', edenPreset, rules, [], 1500)
    const heir = world.bots.find((bot) => bot.generation >= 2)
    expect(heir).toBeDefined()
    const view = await queryFamily(heir!.id, 5, 8, 400, 12)
    expect(view).toEqual(familyView(world, heir!.id, 5, 8, 400, 12))
    expect(view?.ancestors.length).toBeGreaterThan(0)
    // The rows built from it agree with its own counts.
    const { rows } = flattenTree(view!.descendants, view!.hiddenChildren, { ...opts, defaultDepth: 99, maxRows: 10_000 })
    const listed = nodeRows(rows).length
    const hidden = rows.some((row) => row.kind === 'more')
    expect(listed).toBeLessThanOrEqual(view!.totalDescendants)
    if (!hidden) expect(listed).toBe(view!.totalDescendants)
  })
})
