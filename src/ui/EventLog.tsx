// The event log: newest first, filterable by type, scrollable. It holds births,
// deaths and your commands. (Resource depletions and ruins are not logged: they
// were frequent enough to push everything else out of the buffer.) Clicking an entry selects the bot or node it is about in the
// inspector. If that thing no longer exists (every death entry, a removed
// node) the entry is marked "gone" and cannot be selected.
//
// The sim keeps the newest `logCap` events (500); at most `MAX_ROWS` of the
// matching ones are drawn. The list is rebuilt only when the log, the filters
// or the selection change, not on every frame.

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { tuning } from '../content/index.ts'
import type { SimEvent, SimEventType, World } from '../sim/types.ts'
import { findBot, findNode } from './geometry.ts'
import { CAUSE_LABEL, KIND_LABEL, commandName, formatPoint } from './labels.ts'
import { select, useWorldStore } from './store.ts'
import type { Selection } from './tools.ts'

const MAX_ROWS = 150
const numberFormat = new Intl.NumberFormat('en-US')

const FILTERS: { type: SimEventType; label: string; glyph: string }[] = [
  { type: 'birth', label: 'Birth', glyph: '+' },
  { type: 'death', label: 'Death', glyph: '✕' },
  { type: 'command', label: 'Command', glyph: '▸' },
]
const GLYPH: Record<SimEventType, string> = { birth: '+', death: '✕', command: '▸' }
const TYPE_LABEL: Record<SimEventType, string> = { birth: 'Birth', death: 'Death', command: 'Command' }

/** What a log entry is about, when the player could select it. */
function targetOf(event: SimEvent): Selection | null {
  if (event.botId !== undefined) return { kind: 'bot', id: event.botId }
  if (event.nodeId !== undefined) return { kind: 'node', id: event.nodeId }
  return null
}

function exists(world: World, target: Selection): boolean {
  return target.kind === 'bot' ? findBot(world, target.id) !== undefined : findNode(world, target.id) !== undefined
}

function describe(event: SimEvent): string {
  const where = formatPoint(event.x, event.y)
  switch (event.type) {
    case 'birth':
      return `Bot #${event.botId} born at ${where}`
    case 'death':
      return `Bot #${event.botId} died: ${CAUSE_LABEL[event.cause ?? 'starve'].toLowerCase()}, at ${where}`
    case 'command': {
      const name = commandName(event.command ?? 'placeNode', event.nodeKind)
      const subject = event.botId !== undefined ? `bot #${event.botId}` : `${event.nodeKind === undefined ? 'node' : KIND_LABEL[event.nodeKind]} #${event.nodeId}`
      return `You: ${name} (${subject}) at ${where}`
    }
  }
}

/** The rows for the matching events, newest first. `_revision` only says when the (mutated-in-place) log changed. */
function buildRows(
  world: World,
  active: Record<SimEventType, boolean>,
  selectedKey: string,
  _revision: string,
): { rows: ReactNode[]; matching: number } {
  const rows: ReactNode[] = []
  let matching = 0
  for (let i = world.log.length - 1; i >= 0; i -= 1) {
    const event = world.log[i]!
    if (!active[event.type]) continue
    matching += 1
    if (rows.length >= MAX_ROWS) continue
    const target = targetOf(event)
    const alive = target !== null && exists(world, target)
    const isSelected = alive && selectedKey === `${target.kind}:${target.id}`
    const content = (
      <>
        <span className="log-tick figure">{numberFormat.format(event.tick)}</span>
        <span className="log-type">
          <span aria-hidden="true">{GLYPH[event.type]}</span> {TYPE_LABEL[event.type]}
        </span>
        <span className="log-text">{describe(event)}</span>
        <span className="log-status">{target === null ? '' : alive ? 'select' : 'gone'}</span>
      </>
    )
    rows.push(
      <li key={`${event.tick}-${i}-${event.type}-${event.botId ?? event.nodeId ?? 0}`} className={`log-row log-${event.type}`}>
        {alive ? (
          <button
            type="button"
            className="log-button"
            aria-pressed={isSelected}
            title={`Select ${target.kind} #${target.id} in the inspector`}
            onClick={() => select(target)}
          >
            {content}
          </button>
        ) : (
          <div className="log-button log-gone" title={target === null ? undefined : `${target.kind} #${target.id} no longer exists`}>
            {content}
          </div>
        )}
      </li>,
    )
  }
  return { rows, matching }
}

export function EventLog() {
  const { world, selection } = useWorldStore()
  const [active, setActive] = useState<Record<SimEventType, boolean>>({
    birth: true,
    death: true,
    command: true,
  })

  const counts: Record<SimEventType, number> = { birth: 0, death: 0, command: 0 }
  for (const event of world.log) counts[event.type] += 1

  const selectedKey = selection === null ? '' : `${selection.kind}:${selection.id}`
  // A bot or node can only vanish through a logged event (a death or a remove command), so
  // the log's length and newest tick are enough to know when row states may have changed.
  const revision = `${world.tick}/${world.log.length}/${world.commands.length}`
  const list = useMemo(() => buildRows(world, active, selectedKey, revision), [world, active, selectedKey, revision])

  return (
    <section className="panel event-log" aria-label="Event log">
      <h2>Event log</h2>
      <div className="log-filters" role="group" aria-label="Show event types">
        {FILTERS.map((filter) => (
          <button
            key={filter.type}
            type="button"
            className="secondary filter-button"
            aria-pressed={active[filter.type]}
            onClick={() => setActive((old) => ({ ...old, [filter.type]: !old[filter.type] }))}
          >
            <span aria-hidden="true">{filter.glyph}</span> {filter.label}{' '}
            <span className="figure filter-count">{numberFormat.format(counts[filter.type])}</span>
          </button>
        ))}
      </div>
      {world.log.length === 0 ? (
        <p className="empty">No events yet. Births, deaths and your commands appear here.</p>
      ) : list.matching === 0 ? (
        <p className="empty">No events match these filters. Turn a filter back on above.</p>
      ) : (
        <>
          <ol className="log-list" aria-label="Events, newest first">
            {list.rows}
          </ol>
          <p className="log-foot">
            Showing {numberFormat.format(Math.min(list.matching, MAX_ROWS))} of {numberFormat.format(list.matching)} matching
            events (the log keeps the newest {numberFormat.format(tuning.logCap)}).
          </p>
        </>
      )}
    </section>
  )
}
