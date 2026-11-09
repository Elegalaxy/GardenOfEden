// Start a new world: a seed field and one button. Same seed plus the same
// commands always gives the same world, so restarting a seed is how you run a
// control. If the current run holds player commands, the button first asks
// before throwing them away. It lives in the header's Run & save menu; `onStarted` lets
// the menu close once a new world is running.

import { useId, useState } from 'react'
import { DEFAULT_SEED, isValidSeed, resetWorld, useWorldStore } from './store.ts'

export function RunPanel({ onStarted }: { onStarted?: () => void }) {
  const { seed, commandCount, load } = useWorldStore()
  const [draft, setDraft] = useState(seed || DEFAULT_SEED)
  const [confirming, setConfirming] = useState(false)
  const inputId = useId()
  const hintId = useId()

  const valid = isValidSeed(draft)
  const same = draft === seed
  const start = (): void => {
    if (resetWorld(draft)) {
      setConfirming(false)
      onStarted?.()
    }
  }
  const onSubmit = (): void => {
    if (!valid) return
    if (commandCount > 0) setConfirming(true)
    else start()
  }

  return (
    <section className="run-panel" aria-label="Run">
      <form
        className="run-form"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <label htmlFor={inputId} className="run-label">
          Seed
        </label>
        <input
          id={inputId}
          className="seed-input"
          value={draft}
          maxLength={32}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!valid}
          aria-describedby={hintId}
          onChange={(event) => {
            setDraft(event.target.value)
            setConfirming(false)
          }}
        />
        <button type="submit" className="secondary" disabled={!valid || load !== null} title={load !== null ? 'A saved run is loading' : valid ? undefined : 'Fix the seed first: 1 to 32 letters, digits or dashes'}>
          {same ? 'Restart this seed' : 'Start new world'}
        </button>
      </form>
      <p id={hintId} className={valid ? 'run-hint' : 'run-hint run-hint-error'}>
        {valid
          ? `Running seed "${seed}". ${commandCount} command${commandCount === 1 ? '' : 's'} so far.`
          : 'A seed is 1 to 32 letters, digits or dashes.'}
      </p>
      {confirming && (
        <div className="confirm" role="alertdialog" aria-label="Confirm new world">
          <p>
            Discard this run and its {commandCount} command{commandCount === 1 ? '' : 's'}? This cannot be undone.
          </p>
          <div className="confirm-buttons">
            <button type="button" className="primary" onClick={start}>
              Discard and start
            </button>
            <button type="button" className="secondary" onClick={() => setConfirming(false)}>
              Keep this run
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
