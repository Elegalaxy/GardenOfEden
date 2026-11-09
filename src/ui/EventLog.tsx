// The event log: newest first, filterable by type, scrollable. It holds births,
// deaths, your commands and the ends of world events (a drought running out, a
// crater fading; their starts are your commands). (Resource depletions and ruins are not logged: they
// were frequent enough to push everything else out of the buffer.) Clicking an entry selects the bot or node it is about in the
// inspector. If that thing no longer exists (every death entry, a removed
// node) the entry is marked "gone" and cannot be selected.
//
// The sim keeps the newest `logCap` events (500), but every command you gave is kept in
// `world.commands`; `mergeLog` (logMerge.ts) lists the older commands too, so none scroll
// out. At most `MAX_ROWS` of the matching entries are drawn. The list is rebuilt only when
// the log, the filters or the selection change, not on every frame.

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { tuning } from '../content/index.ts'
import type { SimEvent, SimEventType } from '../sim/types.ts'
import { findBot, findNode } from './geometry.ts'
import { EVENT_LABEL, KIND_LABEL, causeSentence, commandName, formatPoint } from './labels.ts'
import { mergeLog } from './logMerge.ts'
import type { LogEntry } from './logMerge.ts'
import { select, useWorldStore } from './store.ts'
import type { Selection } from './tools.ts'
import type { ViewWorld } from './viewWorld.ts'

const MAX_ROWS = 150
const numberFormat = new Intl.NumberFormat('en-US')

const FILTERS: { type: SimEventType; label: string; glyph: string }[] = [
  { type: 'birth', label: 'Birth', glyph: '+' },
  { type: 'death', label: 'Death', glyph: '✕' },
  { type: 'command', label: 'Command', glyph: '▸' },
  { type: 'event', label: 'World', glyph: '◆' },
]
const GLYPH: Record<SimEventType, string> = { birth: '+', death: '✕', command: '▸', event: '◆' }
const TYPE_LABEL: Record<SimEventType, string> = { birth: 'Birth', death: 'Death', command: 'Command', event: 'World' }

/** What a log entry is about, when the player could select it. */
function targetOf(event: SimEvent): Selection | null {
  if (event.botId !== undefined) return { kind: 'bot', id: event.botId }
  if (event.nodeId !== undefined) return { kind: 'node', id: event.nodeId }
  return null
}

function exists(world: ViewWorld, target: Selection): boolean {
  return target.kind === 'bot' ? findBot(world, target.id) !== undefined : findNode(world, target.id) !== undefined
}

function describe({ event, located }: LogEntry): string {
  const where = formatPoint(event.x, event.y)
  switch (event.type) {
    case 'birth':
      return `Bot #${event.botId} born at ${where}`
    case 'death':
      return `${causeSentence(event.cause)} (bot #${event.botId}) at ${where}`
    case 'event': {
      const kind = event.eventKind ?? 'drought'
      return kind === 'meteor' ? `Meteor crater faded at ${where}` : `${EVENT_LABEL[kind]} ended`
    }
    case 'command': {
      if (event.command === 'triggerEvent') {
        const kind = event.eventKind ?? 'drought'
        const global = kind === 'drought' || kind === 'bounty'
        return `You: ${commandName('triggerEvent', undefined, kind)}${global ? '' : ` at ${where}`}`
      }
      const name = commandName(event.command ?? 'placeNode', event.nodeKind)
      // Commands older than the sim's log are rebuilt without the id of what they placed.
      const subject =
        event.botId !== undefined
          ? ` (bot #${event.botId})`
          : event.nodeId !== undefined
            ? ` (${event.nodeKind === undefined ? 'node' : KIND_LABEL[event.nodeKind]} #${event.nodeId})`
            : ''
      return `You: ${name}${subject}${located ? ` at ${where}` : ''}`
    }
  }
}

/** Everything the log lists, oldest first. `_revision` only says when the (mutated-in-place) log or commands changed. */
function entriesOf(world: ViewWorld, _revision: string): LogEntry[] {
  return mergeLog(world.log, world.commands)
}

/** The rows for the matching entries (oldest first in, newest first out). `_revision` only says when the (mutated-in-place) log changed. */
function buildRows(
  world: ViewWorld,
  entries: readonly LogEntry[],
  active: Record<SimEventType, boolean>,
  selectedKey: string,
  _revision: string,
): { rows: ReactNode[]; matching: number } {
  const rows: ReactNode[] = []
  let matching = 0
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!
    const { event } = entry
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
        <span className="log-text">{describe(entry)}</span>
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
    event: true,
  })

  const revision = `${world.tick}/${world.log.length}/${world.commands.length}`
  const entries = useMemo(() => entriesOf(world, revision), [world, revision])
  const counts: Record<SimEventType, number> = { birth: 0, death: 0, command: 0, event: 0 }
  for (const entry of entries) counts[entry.event.type] += 1

  const selectedKey = selection === null ? '' : `${selection.kind}:${selection.id}`
  // A bot or node can only vanish through a logged event (a death or a remove command), so
  // the tick and the log and command counts are enough to know when row states may have changed.
  const list = useMemo(() => buildRows(world, entries, active, selectedKey, revision), [world, entries, active, selectedKey, revision])

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
      {entries.length === 0 ? (
        <p className="empty">No events yet. Births, deaths, your commands and world events appear here.</p>
      ) : list.matching === 0 ? (
        <p className="empty">No events match these filters. Turn a filter back on above.</p>
      ) : (
        <>
          <ol className="log-list" aria-label="Events, newest first">
            {list.rows}
          </ol>
          <p className="log-foot">
            Showing {numberFormat.format(Math.min(list.matching, MAX_ROWS))} of {numberFormat.format(list.matching)} matching
            events (the sim keeps the newest {numberFormat.format(tuning.logCap)}; every command you gave is kept).
          </p>
        </>
      )}
    </section>
  )
}
