// The player's tools. One is active at a time (aria-pressed, a filled background
// with an underline bar, and the status line names it; not colour alone). Keys 1-7 pick a tool and Esc goes back to
// inspect; the keys are ignored while typing in a field. `ToolStatus` (under the map, not
// above it) says what the active tool does and what the last click did; it reserves the
// room of its longest text, so switching tools or placing things never moves the page.
// The world-event keys live here too: P, M and L arm the plague, meteor and blight tools (like a
// tool key), D and B fire a drought or a bounty at once (a refused one just says why).

import { useEffect } from 'react'
import { KIND_LETTER, nextBotSexLabel } from './labels.ts'
import { globalEventForKey } from './eventInfo.ts'
import { PLACE_COUNTS } from './bulk.ts'
import { dispatch, setBotSex, setPlaceCount, setTool, useWorldStore } from './store.ts'
import { isTypingTarget } from './typing.ts'
import { PredatorKey } from './PredatorKey.tsx'
import { TOOLS, placesThings, toolForKey, toolInfo } from './tools.ts'
import type { Tool } from './tools.ts'

/** The little badge on a tool button: the same R/W/V/S keys as the map legend (water is a droplet shape). */
function ToolBadge({ id }: { id: Tool }) {
  switch (id) {
    case 'water':
      return (
        <span className="key key-water" aria-hidden="true">
          <span>{KIND_LETTER.water}</span>
        </span>
      )
    case 'predator':
      return <PredatorKey />
    case 'resource':
    case 'shelter':
      return (
        <span className={`key key-${id}`} aria-hidden="true">
          {KIND_LETTER[id]}
        </span>
      )
    case 'bot':
      return <span className="key key-bot" aria-hidden="true" />
    case 'remove':
      return (
        <span className="key key-remove" aria-hidden="true">
          &times;
        </span>
      )
    default:
      return (
        <span className="key key-inspect" aria-hidden="true">
          i
        </span>
      )
  }
}

export function Toolbar() {
  const { tool } = useWorldStore()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isTypingTarget(event.target)) return
      const global = globalEventForKey(event.key)
      if (global !== null) {
        event.preventDefault()
        void dispatch({ type: 'triggerEvent', event: global })
        return
      }
      const next = toolForKey(event.key)
      if (next === null) return
      event.preventDefault()
      setTool(next)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <section className="panel toolbar" aria-label="Tools">
      <div className="tool-group" role="group" aria-label="Tool">
        {TOOLS.map((info) => (
          <button
            key={info.id}
            type="button"
            className="secondary tool-button"
            aria-pressed={tool === info.id}
            aria-keyshortcuts={info.key}
            onClick={() => setTool(info.id)}
          >
            <ToolBadge id={info.id} />
            <span className="tool-label">{info.label}</span>
            <kbd className="tool-key">{info.key}</kbd>
          </button>
        ))}
      </div>
    </section>
  )
}

/**
 * How many a click of a placement tool places (bulk placing, M19). It keeps its room, hidden, while another tool is
 * active, so choosing a tool never moves the page; hidden means it is not in the tab order either.
 */
function PlaceCount() {
  const { tool, placeCount } = useWorldStore()
  const shown = placesThings(tool)
  return (
    <div className="place-count" role="group" aria-label="Place how many per click" style={shown ? undefined : { visibility: 'hidden' }}>
      <span className="place-label">Place</span>
      <div className="place-options">
        {PLACE_COUNTS.map((count) => (
          <button
            key={count}
            type="button"
            className="secondary place-option"
            aria-pressed={placeCount === count}
            onClick={() => setPlaceCount(count)}
          >
            {count}
          </button>
        ))}
      </div>
    </div>
  )
}

const SEX_CHOICES = [
  { id: null, label: 'Auto', short: 'Auto' },
  { id: 'female', label: 'Female', short: 'F' },
  { id: 'male', label: 'Male', short: 'M' },
] as const

/**
 * The sex of a placed bot (Add bot tool only). Like `PlaceCount` it keeps its room, hidden, for every other tool.
 * Compact (Auto / F / M) so that on the widest layouts it shares the row with the notice and the Place count.
 * Auto sends no sex and the sim alternates; the chosen button is marked by `aria-pressed` and a bar, not colour alone.
 */
function BotSexPicker() {
  const { tool, botSex } = useWorldStore()
  const shown = tool === 'bot'
  return (
    <div className={`place-count sex-picker${shown ? '' : ' sex-off'}`} role="group" aria-label="Sex of placed bots" style={shown ? undefined : { visibility: 'hidden' }}>
      <span className="place-label">Sex</span>
      <div className="place-options">
        {SEX_CHOICES.map((choice) => (
          <button
            key={choice.label}
            type="button"
            className="secondary place-option sex-option"
            aria-pressed={botSex === choice.id}
            aria-label={choice.label}
            title={choice.label}
            onClick={() => setBotSex(choice.id)}
          >
            {choice.short}
          </button>
        ))}
      </div>
    </div>
  )
}

/** What the active tool does and what the last click did. Fixed height: see `.tool-status` in panels.css. */
export function ToolStatus() {
  const { tool, notice, world, botSex } = useWorldStore()
  const active = toolInfo(tool)
  return (
    <section className="tool-status" aria-label="Tool help">
      <p className="tool-hint">
        <strong>{active.label}.</strong> {active.hint}{' '}
        {active.id === 'bot' ? <span className="figure">{nextBotSexLabel(world.bots, botSex)}.</span> : null} <span className="tool-hint-keys">Esc returns to Inspect.</span>
      </p>
      <div className="tool-notice-row">
        <p
          className={`tool-notice ${notice === null ? '' : notice.ok ? 'notice-ok' : 'notice-error'}`}
          role="status"
          aria-live="polite"
        >
          {notice === null ? (
            ' '
          ) : (
            <>
              <span aria-hidden="true">{notice.ok ? '✓' : '⚠'}</span> {notice.text}
            </>
          )}
        </p>
        <PlaceCount />
        <BotSexPicker />
      </div>
    </section>
  )
}
