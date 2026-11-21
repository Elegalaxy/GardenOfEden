// Start a new world: a seed field and one button. Same seed plus the same
// commands always gives the same world, so restarting a seed is how you run a
// control. If the current run holds player commands, the button first asks
// before throwing them away. It lives in the header's Run & save menu; `onStarted` lets
// the menu close once a new world is running.

import { useId, useState } from 'react'
import { presets } from '../content/index.ts'
import type { Preset, ScriptEntry } from '../sim/types.ts'
import { DEFAULT_SEED, isValidSeed, resetWorld, useWorldStore } from './store.ts'

const PLAIN_WORLDS = ['eden', 'blank']

function eventName(entry: ScriptEntry): string {
  const name = entry.cmd.event.charAt(0).toUpperCase() + entry.cmd.event.slice(1)
  return entry.cmd.x === undefined || entry.cmd.y === undefined ? name : `${name} at ${Math.round(entry.cmd.x)}, ${Math.round(entry.cmd.y)}`
}

/** A scenario's description and its scripted events as a key-value grid. Its height is reserved so the menu does not jump. */
function ScenarioInfo({ preset }: { preset: Preset | undefined }) {
  const script = preset?.script ?? []
  return (
    <div className="scenario-info">
      {preset?.description !== undefined && <p className="run-hint">{preset.description}</p>}
      {script.length > 0 && (
        <dl className="scenario-events" aria-label="Scripted events">
          {script.map((entry, index) => (
            <div key={index} className="scenario-event">
              <dt>{eventName(entry)}</dt>
              <dd>{`t ${entry.tick.toLocaleString('en-US')}`}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

export function RunPanel({ onStarted }: { onStarted?: () => void }) {
  const { seed, presetId, commandCount, load } = useWorldStore()
  const [draft, setDraft] = useState(seed || DEFAULT_SEED)
  const [draftPreset, setDraftPreset] = useState(presetId)
  const [confirming, setConfirming] = useState(false)
  const inputId = useId()
  const presetInputId = useId()
  const hintId = useId()

  const valid = isValidSeed(draft)
  const same = draft === seed && draftPreset === presetId
  const start = (): void => {
    if (resetWorld(draft, draftPreset)) {
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
        <label htmlFor={presetInputId} className="run-label">
          World
        </label>
        <select
          id={presetInputId}
          className="seed-input preset-select"
          value={draftPreset}
          onChange={(event) => {
            setDraftPreset(event.target.value)
            setConfirming(false)
          }}
        >
          <optgroup label="Worlds">
            {presets
              .filter((preset) => PLAIN_WORLDS.includes(preset.id))
              .map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.id === 'blank' ? 'Blank (plain)' : preset.label}
                </option>
              ))}
          </optgroup>
          <optgroup label="Scenarios">
            {presets
              .filter((preset) => !PLAIN_WORLDS.includes(preset.id))
              .map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
          </optgroup>
        </select>
        <button type="submit" className="secondary" disabled={!valid || load !== null} title={load !== null ? 'A saved run is loading' : valid ? undefined : 'Fix the seed first: 1 to 32 letters, digits or dashes'}>
          {same ? 'Restart this seed' : 'Start new world'}
        </button>
      </form>
      <ScenarioInfo preset={presets.find((preset) => preset.id === draftPreset)} />
      <p id={hintId} className={valid ? 'run-hint' : 'run-hint run-hint-error'}>
        {valid
          ? `Running ${presetId} seed "${seed}". ${commandCount} command${commandCount === 1 ? '' : 's'} so far.`
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
