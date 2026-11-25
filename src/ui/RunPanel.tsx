// Start a new world: a seed field and one button. Same seed plus the same
// commands always gives the same world, so restarting a seed is how you run a
// control. If the current run holds player commands, the button first asks
// before throwing them away. It lives in the header's Run & save menu; `onStarted` lets
// the menu close once a new world is running.
// Under the world choice a closed "Experimental rules" section switches on rules that are built but off in Eden
// (src/content/features.ts); it is hidden while there is none to offer.

import { useId, useState } from 'react'
import { FEATURES, presets } from '../content/index.ts'
import type { Preset, ScriptEntry, WorldFeature } from '../sim/types.ts'
import { featureNames } from './labels.ts'
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

/**
 * One checkbox per rule that may be picked, plus any that the run on screen (or the draft) already has, so it can be
 * switched off. Closed by default; nothing at all when there is no rule to show.
 */
function FeaturePicker({ running, draft, onChange }: { running: readonly WorldFeature[]; draft: readonly WorldFeature[]; onChange: (next: WorldFeature[]) => void }) {
  const shown = FEATURES.filter((feature) => feature.pickable || running.includes(feature.id) || draft.includes(feature.id))
  if (shown.length === 0) return null
  const toggle = (id: WorldFeature, on: boolean): void =>
    onChange(FEATURES.map((feature) => feature.id).filter((other) => (other === id ? on : draft.includes(other))))
  return (
    <details className="run-features">
      <summary>Experimental rules ({draft.length} on)</summary>
      <p className="feature-warning">
        <span aria-hidden="true">⚠</span> These rules failed the long-run balance tests, so they stay off in Eden. Worlds may die out; combinations are untested.
      </p>
      <fieldset aria-label="Experimental rules">
        {shown.map((feature) => (
          <label key={feature.id} className="feature-row">
            <input type="checkbox" checked={draft.includes(feature.id)} onChange={(event) => toggle(feature.id, event.target.checked)} />
            <span className="feature-text">
              <span className="feature-label">{feature.label}</span>
              <span className="feature-summary">{feature.summary}</span>
              <span className="feature-caveat">{feature.caveat}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </details>
  )
}

export function RunPanel({ onStarted }: { onStarted?: () => void }) {
  const { seed, presetId, features, commandCount, load } = useWorldStore()
  const [draft, setDraft] = useState(seed || DEFAULT_SEED)
  const [draftPreset, setDraftPreset] = useState(presetId)
  const [draftFeatures, setDraftFeatures] = useState<WorldFeature[]>(features)
  const [confirming, setConfirming] = useState(false)
  const inputId = useId()
  const presetInputId = useId()
  const hintId = useId()

  const valid = isValidSeed(draft)
  const same = draft === seed && draftPreset === presetId && draftFeatures.join() === features.join()
  const start = (): void => {
    if (resetWorld(draft, draftPreset, draftFeatures)) {
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
      <FeaturePicker
        running={features}
        draft={draftFeatures}
        onChange={(next) => {
          setDraftFeatures(next)
          setConfirming(false)
        }}
      />
      <p id={hintId} className={valid ? 'run-hint' : 'run-hint run-hint-error'}>
        {valid
          ? `Running ${presetId} seed "${seed}"${features.length > 0 ? ` · experimental: ${featureNames(features)}` : ''}. ${commandCount} command${commandCount === 1 ? '' : 's'} so far.`
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
