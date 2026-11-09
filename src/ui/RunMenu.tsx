// The header's "Run & save" menu: a summary of the run, and one button that opens a
// panel over the page (it never pushes the map down) holding the seed form (RunPanel)
// and save/load (SavePanel). Closed by default; Esc, the button, a click outside or
// starting a new world closes it.
//
// Results must not be missed while the menu is shut: a save, load or share result
// appears as a toast under the header (warnings and errors stay until dismissed or the
// menu is opened, a success fades after a few seconds), and a load in progress (for
// example from a share link) forces the menu open so its progress bar and Cancel
// button are on screen. The toast takes no room when there is nothing to say.

import { useEffect, useId, useRef, useState } from 'react'
import { RunPanel } from './RunPanel.tsx'
import { SavePanel } from './SavePanel.tsx'
import { useWorldStore } from './store.ts'

const NOTICE_ICON = { ok: '✓', warn: '⚠', error: '✕' } as const
const TOAST_MS = 6000

export function RunMenu() {
  const { seed, commandCount, load, saveNotice } = useWorldStore()
  const [userOpen, setUserOpen] = useState(false)
  const [seen, setSeen] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  const loading = load !== null
  const open = userOpen || loading

  useEffect(() => {
    if (!userOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      setUserOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [userOpen])

  // A result shown inside the open menu counts as seen (state adjusted while rendering, not in an effect).
  const noticeSeq = saveNotice?.seq ?? 0
  if (open && noticeSeq > seen) setSeen(noticeSeq)

  // A success toast fades by itself.
  const noticeLevel = saveNotice?.level
  useEffect(() => {
    if (open || noticeLevel !== 'ok' || noticeSeq <= seen) return
    const timer = window.setTimeout(() => setSeen(noticeSeq), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [open, noticeLevel, noticeSeq, seen])

  const toast = !open && saveNotice !== null && saveNotice.seq > seen ? saveNotice : null
  const summary = `Seed "${seed}" · ${commandCount} command${commandCount === 1 ? '' : 's'}`

  return (
    <div
      className="run-menu-root"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !userOpen || loading) return
        event.stopPropagation() // Esc here closes the menu; it must not also switch the map tool
        setUserOpen(false)
        toggleRef.current?.focus()
      }}
    >
      <p className="run-summary figure" title={summary}>
        {summary}
      </p>
      <button
        ref={toggleRef}
        type="button"
        className="secondary run-toggle"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={loading}
        title={loading ? 'A saved run is loading' : undefined}
        onClick={() => setUserOpen((value) => !value)}
      >
        Run &amp; save <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      <div id={menuId} className="panel run-menu" role="region" aria-label="Run and save" hidden={!open}>
        <h2>New world</h2>
        <RunPanel onStarted={() => setUserOpen(false)} />
        <h2>Save and load</h2>
        <SavePanel />
      </div>
      <div className="save-toast-slot" role="status" aria-live="polite">
        {toast !== null && (
          <div className={`panel save-toast save-${toast.level}`}>
            <p>
              <span aria-hidden="true">{NOTICE_ICON[toast.level]}</span> {toast.text}
            </p>
            <button type="button" className="secondary" onClick={() => setSeen(toast.seq)}>
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
