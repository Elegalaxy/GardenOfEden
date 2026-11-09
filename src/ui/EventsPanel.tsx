// World events (M8): shake the society and watch what changes. Four cards, one per
// event, each with its shortcut key, how long it lasts and what it does. Drought (D)
// and bounty (B) are global and fire at once. Plague (P) and meteor (M) arm a map
// tool: pick one, then click the map (the hover ghost shows the radius). A card is
// disabled, with the reason written under it, when the sim would refuse the event
// (the same one already running, or too many at once). Below the cards, the events
// in progress with the ticks left; a standing meteor crater can be selected.

import { rules, tuning } from '../content/index.ts'
import { activeEntries } from '../sim/worldEvents.ts'
import type { ActiveEntry } from '../sim/worldEvents.ts'
import { EVENT_INFOS, blockedReason, effectSummary, eventInfo, eventRows, formatTicks } from './eventInfo.ts'
import type { EventInfo } from './eventInfo.ts'
import { formatPoint } from './labels.ts'
import { dispatch, select, setTool, useWorldStore } from './store.ts'

function EventCard({ info }: { info: EventInfo }) {
  const { world, tool } = useWorldStore()
  const reason = blockedReason(world, rules, info.kind)
  const armed = !info.global && tool === info.kind
  const onClick = (): void => {
    if (info.global) dispatch({ type: 'triggerEvent', event: info.kind })
    else setTool(armed ? 'inspect' : (info.kind as 'plague' | 'meteor'))
  }
  return (
    <li className="event-card">
      <button
        type="button"
        className="secondary event-button"
        aria-pressed={info.global ? undefined : armed}
        aria-keyshortcuts={info.key}
        disabled={reason !== null}
        onClick={onClick}
      >
        <span className={`key key-event key-${info.kind}`} aria-hidden="true">
          {info.letter}
        </span>
        <span className="tool-label">{info.label}</span>
        <kbd className="tool-key">{info.key.toUpperCase()}</kbd>
      </button>
      <p className="event-action">{info.global ? 'Starts at once.' : armed ? 'Armed: click the map.' : 'Then click the map.'}</p>
      <dl className="kv event-kv">
        {eventRows(info.kind, tuning).map((row) => (
          <div className="kv-row" key={row.label}>
            <dt>{row.label}</dt>
            <dd className="figure">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="event-reason" role={reason === null ? undefined : 'note'}>
        {reason === null ? ' ' : <><span aria-hidden="true">⚠</span> {reason}</>}
      </p>
    </li>
  )
}

function ActiveRow({ entry, tick }: { entry: ActiveEntry; tick: number }) {
  const info = eventInfo(entry.kind)
  const left = Math.max(0, entry.endTick - tick)
  const total = Math.max(1, entry.endTick - entry.startTick)
  const where = entry.radius > 0 ? `at ${formatPoint(entry.x, entry.y)}, radius ${Math.round(entry.radius * 10) / 10}` : 'everywhere'
  const what =
    entry.kind === 'meteor'
      ? `crater, −${Math.round(entry.magnitude * 10) / 10} health / tick`
      : effectSummary(entry.kind, tuning)
  return (
    <li className="active-row">
      <span className={`key key-event key-${entry.kind}`} aria-hidden="true">
        {info.letter}
      </span>
      <span className="active-name">
        <strong>{entry.kind === 'meteor' ? 'Meteor crater' : info.label}</strong>
        <span className="active-where">{where}</span>
      </span>
      <span className="active-effect">{what}</span>
      <span className="figure active-left">{formatTicks(left)} left</span>
      <span className="active-bar" aria-hidden="true">
        <span className="active-bar-fill" style={{ width: `${Math.min(100, Math.max(0, (left / total) * 100))}%` }} />
      </span>
      {entry.nodeId !== undefined && (
        <button
          type="button"
          className="link-button"
          onClick={() => select({ kind: 'node', id: entry.nodeId! })}
          title="Select the crater in the inspector"
        >
          select
        </button>
      )}
    </li>
  )
}

export function EventsPanel() {
  const { world, tick } = useWorldStore()
  const entries = activeEntries(world, tuning)
  return (
    <section className="panel events-panel" aria-label="World events">
      <h2>World events</h2>
      <ul className="event-cards">
        {EVENT_INFOS.map((info) => (
          <EventCard key={info.kind} info={info} />
        ))}
      </ul>
      <h4>In progress</h4>
      <div className="active-wrap">
        {entries.length === 0 ? (
          <p className="empty active-empty">No world events active. Trigger one above and watch the chart.</p>
        ) : (
          <ul className="active-list" aria-label="World events in progress">
            {entries.map((entry, index) => (
              <ActiveRow key={`${entry.kind}-${entry.startTick}-${entry.nodeId ?? index}`} entry={entry} tick={tick} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
