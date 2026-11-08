// The player's tools. One is active at a time (aria-pressed, a filled background
// with an underline bar, and the line below names it; not colour alone). Keys 1-6 pick a tool and Esc goes back to
// inspect; the keys are ignored while typing in a field. The line under the
// buttons says what the active tool does and what the last click did.

import { useEffect } from 'react'
import { KIND_LETTER } from './labels.ts'
import { setTool, useWorldStore } from './store.ts'
import { TOOLS, toolForKey, toolInfo } from './tools.ts'
import type { Tool } from './tools.ts'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** The little round badge on a tool button: the same R/D/S keys as the map legend. */
function ToolBadge({ id }: { id: Tool }) {
  switch (id) {
    case 'resource':
    case 'danger':
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
  const { tool, notice } = useWorldStore()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isTypingTarget(event.target)) return
      const next = toolForKey(event.key)
      if (next === null) return
      event.preventDefault()
      setTool(next)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const active = toolInfo(tool)
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
      <p className="tool-hint">
        <strong>{active.label}.</strong> {active.hint} <span className="tool-hint-keys">Esc returns to Inspect.</span>
      </p>
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
    </section>
  )
}
