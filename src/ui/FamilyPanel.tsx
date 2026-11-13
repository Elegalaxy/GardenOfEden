// The family panel (M14): the lineage of one bot as HTML lists, so a keyboard and a screen reader
// work with it. With a bot selected (or a record picked here) it shows that record, its mother's
// line as a chain (nearest first; each chip links to that bot's father), its father in the record
// details, and its descendants as an open-and-close tree in which a child of two parents appears
// once; with nothing selected it shows the founder lines (a bot belongs to the lines of both parents). Data comes from the worker's lineage records (`useFamilyData`), not from
// the page's copy of the world, so dead bots appear too. The pure parts (rows, wording, keys) are in
// familyMath.ts.
//
// Rows: the main button of a living bot selects it on the map and in the inspector (the tree stays
// where it is); on a dead bot's row it points this panel at that record. "Focus" re-centres the tree
// on any row. Arrow keys move between rows, right opens or goes to the first child, left closes or
// goes to the parent, Home and End jump; one row at a time is in the tab order (the others are
// reached by arrows). The tree box has a fixed height and scrolls, so a refresh moves nothing.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode, RefObject } from 'react'
import type { FamilyView, FounderLine } from '../sim/lineage.ts'
import { TRAIT_NAMES } from '../sim/traits.ts'
import type { LineageRecord } from '../sim/types.ts'
import {
  DEFAULT_ANCESTORS,
  DEFAULT_DEPTH,
  MAX_ANCESTORS,
  MAX_ROWS,
  TREE_KEYS,
  childrenText,
  deepestGeneration,
  extraDepth,
  flattenTree,
  formatCount,
  founderRows,
  allGone,
  indentCap,
  indentLevels,
  olderAncestors,
  resolveFocus,
  rowLabel,
  statusGlyph,
  statusText,
  treeMove,
} from './familyMath.ts'
import type { NodeRow, TreeKey, TreeRow } from './familyMath.ts'
import { focusRecord, pinFocusFor, useFamilyFocus } from './familyFocus.ts'
import { TRAIT_LABEL, formatTrait } from './labels.ts'
import { select, useStoreValue } from './store.ts'
import { useElementWidth } from './useElementWidth.ts'
import { useFamilyData } from './useFamilyData.ts'

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="fam-kpi">
      <dt>{label}</dt>
      <dd className="figure">{formatCount(value)}</dd>
    </div>
  )
}

function Status({ record }: { record: LineageRecord }) {
  return (
    <span className={`fam-status ${record.died === null ? 'fam-alive' : 'fam-gone'}`}>
      <span aria-hidden="true">{statusGlyph(record)}</span> {statusText(record)}
    </span>
  )
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv-row">
      <dt>{label}</dt>
      <dd className="figure">{children}</dd>
    </div>
  )
}

/** The focus record: who it is, how it ended, and (opened) its birth traits and parent. */
function FocusCard({ view, titleRef }: { view: FamilyView; titleRef: RefObject<HTMLHeadingElement | null> }) {
  const { focus, ancestors, father, fatherMissing } = view
  const mother = ancestors[0]
  return (
    <div className="fam-focus">
      <h3 ref={titleRef} tabIndex={-1} className="fam-title">
        Bot #{focus.id}
      </h3>
      <p className="fam-sub figure">
        <Status record={focus} /> · gen {focus.generation} · born t {formatCount(focus.born)} · {childrenText(focus.children)}
      </p>
      <details className="fam-details">
        <summary>Record details</summary>
        <dl className="kv">
          <DetailRow label="Born">tick {formatCount(focus.born)}</DetailRow>
          <DetailRow label="Status">{statusText(focus)}</DetailRow>
          <DetailRow label="Mother">
            {focus.parentId === null ? (
              'none (founder or placed)'
            ) : mother === undefined ? (
              <>#{focus.parentId} · record not kept</>
            ) : (
              <button type="button" className="link-button" onClick={() => focusRecord(mother.id)}>
                #{mother.id}
              </button>
            )}
          </DetailRow>
          <DetailRow label="Father">
            {focus.fatherId === null ? (
              'none (founder or placed)'
            ) : father === null || fatherMissing ? (
              <>#{focus.fatherId} · record not kept</>
            ) : (
              <button type="button" className="link-button" onClick={() => focusRecord(father.id)}>
                #{father.id}
              </button>
            )}
          </DetailRow>
          <DetailRow label="Sex">{focus.sex === 'female' ? 'Female' : 'Male'}</DetailRow>
          <DetailRow label="Children">{formatCount(focus.children)} in its lifetime</DetailRow>
          {TRAIT_NAMES.map((name) => (
            <DetailRow key={name} label={`Birth ${TRAIT_LABEL[name].toLowerCase()}`}>
              {formatTrait(name, focus.traits[name])}
            </DetailRow>
          ))}
        </dl>
      </details>
    </div>
  )
}

function Ancestors({ view, older, onOlder }: { view: FamilyView; older: boolean; onOlder: () => void }) {
  const { ancestors, ancestorsMissing, focus } = view
  const more = older ? 0 : Math.min(olderAncestors(view), MAX_ANCESTORS - ancestors.length)
  // The "+n older" button goes away when pressed; keyboard focus moves to the first ancestor it adds.
  const chips = useRef<(HTMLButtonElement | null)[]>([])
  const grewFrom = useRef<number | null>(null)
  useEffect(() => {
    const from = grewFrom.current
    if (from === null || ancestors.length <= from) return
    grewFrom.current = null
    chips.current[from]?.focus()
  }, [ancestors.length])
  return (
    <section className="fam-section" aria-label="Mother's line">
      <h4>Mother's line</h4>
      {ancestors.length === 0 ? (
        <p className="empty fam-note">
          {focus.parentId === null ? 'None: this bot has no mother (a founder, or one you placed).' : 'Its mother record is no longer kept.'}
        </p>
      ) : (
        <ol className="fam-chain">
          {ancestors.map((record, index) => (
            <li key={record.id} className="fam-chain-item">
              <button
                type="button"
                className="fam-chip"
                ref={(element) => {
                  chips.current[index] = element
                }}
                aria-label={`${index === 0 ? 'Mother' : `Ancestor ${index + 1}`}: ${rowLabel(record)}. Focus the tree here`}
                onClick={() => focusRecord(record.id)}
              >
                <span className="fam-chip-id">#{record.id}</span>
                <span className="fam-chip-meta figure">
                  <span aria-hidden="true">{statusGlyph(record)}</span> gen {record.generation}
                </span>
              </button>
              {record.fatherId !== null && (
                <button
                  type="button"
                  className="secondary fam-father-button"
                  aria-label={`Focus the tree on bot #${record.fatherId}, father of bot #${record.id}`}
                  onClick={() => focusRecord(record.fatherId)}
                >
                  father #{record.fatherId}
                </button>
              )}
            </li>
          ))}
          {more > 0 && (
            <li>
              <button
                type="button"
                className="secondary fam-more-button"
                onClick={() => {
                  grewFrom.current = ancestors.length
                  onOlder()
                }}
              >
                +{formatCount(more)} older
              </button>
            </li>
          )}
        </ol>
      )}
      {ancestors.length > 0 && ancestorsMissing && <p className="empty fam-note">Earlier ancestors not kept (old records are pruned).</p>}
      {older && ancestors.length >= MAX_ANCESTORS && <p className="empty fam-note">Showing the nearest {MAX_ANCESTORS} ancestors.</p>}
    </section>
  )
}

type TreeProps = {
  view: FamilyView
  rows: TreeRow[]
  omitted: number
  cap: number
  activeId: number | null
  selectedId: number | null
  onActive: (id: number) => void
  onToggle: (row: NodeRow) => void
  onKey: (id: number, key: TreeKey) => void
  register: (id: number, element: HTMLButtonElement | null) => void
  onPick: (record: LineageRecord) => void
}

function Tree({ view, rows, omitted, cap, activeId, selectedId, onActive, onToggle, onKey, register, onPick }: TreeProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !TREE_KEYS.includes(event.key)) return
    const holder = (event.target as HTMLElement).closest('[data-row-id]')
    if (holder === null) return
    event.preventDefault()
    onKey(Number(holder.getAttribute('data-row-id')), event.key as TreeKey)
  }
  if (rows.length === 0) {
    return (
      <div className="fam-tree-box">
        <p className="empty fam-note">No descendants kept for this bot.</p>
      </div>
    )
  }
  return (
    <div className="fam-tree-box">
      <ul className="fam-tree" aria-label={`Descendants of bot #${view.focus.id}`} onKeyDown={onKeyDown}>
        {rows.map((row) => {
          const style = { '--level': indentLevels(row.depth, cap) } as CSSProperties
          if (row.kind === 'more') {
            return (
              <li key={row.key} className="fam-row fam-more-row" style={style}>
                <span className="fam-note">+{formatCount(row.count)} more not shown. Use Focus on a relative to see its branch.</span>
              </li>
            )
          }
          const { record } = row
          const deeper = extraDepth(row.depth, cap)
          const active = row.id === activeId
          const alive = record.died === null
          return (
            <li key={row.id} className="fam-row" style={style} data-row-id={row.id} data-selected={selectedId === row.id || undefined} onFocus={() => onActive(row.id)}>
              {row.expandable ? (
                <button
                  type="button"
                  className="fam-toggle"
                  aria-expanded={row.expanded}
                  aria-label={`${row.expanded ? 'Collapse' : 'Expand'} bot #${row.id}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => onToggle(row)}
                >
                  <span aria-hidden="true">{row.expanded ? '▾' : '▸'}</span>
                </button>
              ) : (
                <span className="fam-toggle-gap" aria-hidden="true" />
              )}
              <button
                type="button"
                className="fam-main"
                ref={(element) => register(row.id, element)}
                tabIndex={active ? 0 : -1}
                aria-label={rowLabel(record)}
                aria-current={selectedId === row.id ? 'true' : undefined}
                title={alive ? 'Select this bot on the map and in the inspector' : 'Gone. Show its record and tree here'}
                onClick={() => onPick(record)}
              >
                <span className="fam-line">
                  <strong>#{record.id}</strong>
                  <span className="fam-meta figure">gen {record.generation}</span>
                  {deeper > 0 && (
                    <span className="fam-deeper figure" title={`${deeper} level${deeper === 1 ? '' : 's'} deeper than the indentation shows`}>
                      +{deeper} deeper
                    </span>
                  )}
                  <span className="fam-meta figure">born t {formatCount(record.born)}</span>
                </span>
                <span className="fam-line fam-line-2 figure">
                  <Status record={record} />
                  <span className="fam-meta">{childrenText(record.children)}</span>
                </span>
              </button>
              <button
                type="button"
                className="secondary fam-focus-button"
                aria-label={`Focus the tree on bot #${row.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => focusRecord(row.id)}
              >
                Focus
              </button>
            </li>
          )
        })}
      </ul>
      {omitted > 0 && <p className="fam-foot">{formatCount(omitted)} more rows not shown. Close a branch or focus on a relative.</p>}
    </div>
  )
}

function Descendants({ view, selectedId, cap, focusKey }: { view: FamilyView; selectedId: number | null; cap: number; focusKey: string }) {
  // The player's open and closed choices belong to one focus; another focus starts from the defaults again.
  const [ui, setUi] = useState<{ key: string; toggled: Map<number, boolean>; active: number | null }>({ key: focusKey, toggled: new Map(), active: null })
  const current = ui.key === focusKey ? ui : { key: focusKey, toggled: new Map<number, boolean>(), active: null }
  const mains = useRef(new Map<number, HTMLButtonElement>())

  const { rows, omitted } = useMemo(
    () => flattenTree(view.descendants, view.hiddenChildren, { defaultDepth: DEFAULT_DEPTH, toggled: current.toggled, maxRows: MAX_ROWS }),
    [view, current.toggled],
  )
  const firstNode = rows.find((row): row is NodeRow => row.kind === 'node')
  const activeId = rows.some((row) => row.kind === 'node' && row.id === current.active) ? current.active : (firstNode?.id ?? null)

  const update = (change: (toggled: Map<number, boolean>) => void, active: number | null = current.active): void => {
    const toggled = new Map(current.toggled)
    change(toggled)
    setUi({ key: focusKey, toggled, active })
  }

  const onKey = (id: number, key: TreeKey): void => {
    const move = treeMove(rows, id, key)
    if (move === null) return
    if (move.kind === 'focus') {
      setUi({ key: focusKey, toggled: current.toggled, active: move.id })
      mains.current.get(move.id)?.focus()
    } else {
      update((toggled) => toggled.set(move.id, move.kind === 'open'), move.id)
    }
  }

  const onPick = (record: LineageRecord): void => {
    if (record.died === null) {
      pinFocusFor(record.id, view.focus.id)
      select({ kind: 'bot', id: record.id })
    } else {
      focusRecord(record.id)
    }
  }

  return (
    <section className="fam-section" aria-label="Descendants">
      <h4>Descendants</h4>
      <Tree
        view={view}
        rows={rows}
        omitted={omitted}
        cap={cap}
        activeId={activeId}
        selectedId={selectedId}
        onActive={(id) => {
          if (id !== current.active) setUi({ key: focusKey, toggled: current.toggled, active: id })
        }}
        onToggle={(row) => update((toggled) => toggled.set(row.id, !row.expanded), row.id)}
        onKey={onKey}
        register={(id, element) => {
          if (element === null) mains.current.delete(id)
          else mains.current.set(id, element)
        }}
        onPick={onPick}
      />
    </section>
  )
}

function FounderTable({ lines, titleRef }: { lines: FounderLine[]; titleRef: RefObject<HTMLHeadingElement | null> }) {
  const { rows, hidden } = founderRows(lines)
  return (
    <>
      <h3 ref={titleRef} tabIndex={-1} className="fam-title">
        Founder lines
      </h3>
      <p className="fam-note">Founders and bots you placed, with everyone descended from them (in a long run, also the oldest line whose ancestors were pruned). A bot belongs to the lines of both parents, so lines can overlap. Pick a line, or select a bot on the map.</p>
      {lines.length === 0 ? (
        <p className="empty fam-note">No lineage records yet.</p>
      ) : (
        <>
          {allGone(lines) && (
            <p className="fam-note" role="status">
              <span aria-hidden="true">✕</span> Every line has died out.
            </p>
          )}
          <div className="fam-tree-box">
            <table className="fam-founders">
              <thead>
                <tr>
                  <th scope="col">Founder</th>
                  <th scope="col" className="num">
                    Gen
                  </th>
                  <th scope="col" className="num">
                    Living
                  </th>
                  <th scope="col" className="num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((line) => (
                  <tr key={line.record.id}>
                    <th scope="row">
                      <button type="button" className="fam-founder-button" aria-label={`Bot #${line.record.id}: ${rowLabelShort(line)}. Show its tree`} onClick={() => focusRecord(line.record.id)}>
                        <strong>#{line.record.id}</strong>
                        <span className="fam-meta figure">
                          <span aria-hidden="true">{statusGlyph(line.record)}</span> {line.record.died === null ? 'alive' : statusText(line.record)}
                        </span>
                      </button>
                    </th>
                    <td className="num figure">{line.record.generation}</td>
                    <td className="num figure">{formatCount(line.living)}</td>
                    <td className="num figure">{formatCount(line.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hidden > 0 && <p className="fam-foot">{formatCount(hidden)} more lines not shown (the ones with the fewest living descendants).</p>}
          </div>
        </>
      )}
    </>
  )
}

function rowLabelShort(line: FounderLine): string {
  return `${statusText(line.record)}, ${formatCount(line.living)} living and ${formatCount(line.total)} total descendants`
}

export function FamilyPanel() {
  const selection = useStoreValue((snapshot) => snapshot.selection)
  const runId = useStoreValue((snapshot) => snapshot.runId)
  const selectedBotId = selection !== null && selection.kind === 'bot' ? selection.id : null
  const { override, seq, reveal } = useFamilyFocus()
  const focus = resolveFocus(override, selectedBotId, runId)
  const focusKey = `${runId}:${focus ?? 'lines'}`

  // "Show older ancestors" is a per-focus choice kept here (it changes the question asked of the worker); the query asks for more only then.
  const [olderFor, setOlderFor] = useState<string | null>(null)
  const { data, failed } = useFamilyData(focus, olderFor === focusKey ? MAX_ANCESTORS : DEFAULT_ANCESTORS, runId)
  const stale = data === null || data.focus !== focus

  const [setWidthRef, width] = useElementWidth()
  const cap = indentCap(width)
  const sectionRef = useRef<HTMLElement | null>(null)
  const titleRef = useRef<HTMLHeadingElement | null>(null)

  // After the player moves the focus (Focus, a founder line, "Show family"), keyboard focus goes to the new title: the
  // button that was pressed may not exist in the new tree. It waits for the answer for the new focus.
  const handledSeq = useRef(seq)
  const wanted = useRef(false)
  useEffect(() => {
    if (seq === handledSeq.current) return
    handledSeq.current = seq
    wanted.current = true
    if (reveal) sectionRef.current?.scrollIntoView({ block: 'nearest' })
  }, [seq, reveal])
  useEffect(() => {
    if (!wanted.current || stale) return
    wanted.current = false
    titleRef.current?.focus({ preventScroll: !reveal })
  }, [data, stale, reveal])

  let body: ReactNode
  if (data === null) {
    body = <p className="empty fam-note">Loading family records…</p>
  } else if (data.focus === null) {
    body = <FounderTable lines={data.lines} titleRef={titleRef} />
  } else if (data.view === null) {
    body = (
      <>
        <h3 ref={titleRef} tabIndex={-1} className="fam-title">
          Bot #{data.focus}
        </h3>
        <p className="fam-note">No lineage record for this bot: it was never recorded, or the old record was pruned.</p>
      </>
    )
  } else {
    body = (
      <FamilyTreeWithOlder
        view={data.view}
        selectedId={selectedBotId}
        cap={cap}
        focusKey={focusKey}
        titleRef={titleRef}
        onOlder={() => setOlderFor(focusKey)}
        olderOpen={olderFor === focusKey}
      />
    )
  }

  return (
    <section className="panel family-panel" id="family-panel" aria-label="Family" aria-busy={stale} ref={sectionRef}>
      <div className="fam-head">
        <h2>Family</h2>
        {data !== null && data.focus !== null && (
          <button type="button" className="secondary fam-lines-button" onClick={() => focusRecord(null)}>
            Founder lines
          </button>
        )}
      </div>
      {failed && (
        <p className="fam-note fam-error" role="status">
          Could not read the family records. Showing the last answer.
        </p>
      )}
      <div ref={setWidthRef} className={`fam-body${stale ? ' fam-stale' : ''}`}>
        {body}
      </div>
    </section>
  )
}

/** The tree for one view; "older" is lifted into the panel because it changes the question asked of the worker. */
function FamilyTreeWithOlder({
  view,
  selectedId,
  cap,
  focusKey,
  titleRef,
  onOlder,
  olderOpen,
}: {
  view: FamilyView
  selectedId: number | null
  cap: number
  focusKey: string
  titleRef: RefObject<HTMLHeadingElement | null>
  onOlder: () => void
  olderOpen: boolean
}) {
  return (
    <>
      <FocusCard view={view} titleRef={titleRef} />
      <dl className="fam-kpis">
        <Kpi label="Living descendants" value={view.livingDescendants} />
        <Kpi label="Total descendants" value={view.totalDescendants} />
        <Kpi label="Deepest gen" value={deepestGeneration(view)} />
      </dl>
      <Ancestors view={view} older={olderOpen} onOlder={onOlder} />
      <Descendants view={view} selectedId={selectedId} cap={cap} focusKey={focusKey} />
    </>
  )
}
