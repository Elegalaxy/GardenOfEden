// "Colour bots by" (M20): a row of exclusive choices (Plain, Bloodline, Sex, Trait, Illness; key C cycles them), a trait
// picker that is always laid out but only visible in Trait mode, and a one-line legend that reads out what the
// colours mean (the trait ramp with its lowest and highest value, the sex shapes, or the illness stages with a live sick and immune count). The choice lives in the page's
// store only. Nothing here changes size when the mode changes: the legend line and the picker keep their room.

import { useEffect } from 'react'
import type { KeyboardEvent } from 'react'
import { TRAIT_NAMES } from '../sim/traits.ts'
import type { TraitName } from '../sim/types.ts'
import {
  BOT_COLOUR_LABEL,
  BOT_COLOUR_MODES,
  FEMALE_FILL,
  HEALTHY_FILL,
  ILLNESS_FILL,
  MALE_FILL,
  TRAIT_RAMP,
  bloodlineColour,
  isBotColourKey,
  traitRange,
} from './botColour.ts'
import type { BotColourMode } from './botColour.ts'
import { outbreakSummary } from './eventInfo.ts'
import { TRAIT_LABEL, formatTrait } from './labels.ts'
import { cycleBotColour, setBotColour, useStoreValue } from './store.ts'
import { isTypingTarget } from './typing.ts'

/** A few hues across the wheel, for the bloodline legend. */
const SAMPLE_HUES = [0, 45, 100, 160, 205, 255, 310]

function Legend({ mode, trait }: { mode: BotColourMode; trait: TraitName }) {
  const bots = useStoreValue((s) => s.world.bots)
  if (mode === 'plain') {
    return <p className="colour-legend">All bots the same colour. Pick a mode to tell families, sexes or a trait apart.</p>
  }
  if (mode === 'bloodline') {
    return (
      <p className="colour-legend">
        <span className="colour-ramp" aria-hidden="true">
          {SAMPLE_HUES.map((hue) => (
            <span key={hue} className="colour-step" style={{ backgroundColor: bloodlineColour(hue) }} />
          ))}
        </span>
        Same colour, same family line. Each child drifts a little.
      </p>
    )
  }
  if (mode === 'sex') {
    return (
      <p className="colour-legend">
        <span className="colour-sex">
          <span style={{ color: FEMALE_FILL }} aria-hidden="true">●</span> female
        </span>
        <span className="colour-sex">
          <span style={{ color: MALE_FILL }} aria-hidden="true">◆</span> male
        </span>
      </p>
    )
  }
  if (mode === 'illness') {
    const summary = outbreakSummary(bots)
    const stages: [string, string][] = [
      ['Healthy', HEALTHY_FILL],
      ['Exposed', ILLNESS_FILL.exposed],
      ['Sick', ILLNESS_FILL.sick],
      ['Immune', ILLNESS_FILL.immune],
    ]
    return (
      <p className="colour-legend">
        {stages.map(([label, colour]) => (
          <span key={label} className="colour-sex">
            <span className="colour-dot" style={{ backgroundColor: colour }} aria-hidden="true" /> {label}
          </span>
        ))}
        <span className="colour-note figure">{summary === null ? 'No one sick or immune' : `${summary.sick} sick · ${summary.immune} immune`}</span>
      </p>
    )
  }
  const range = traitRange(bots, trait)
  return (
    <p className="colour-legend figure">
      {range === null ? (
        'No bots to colour.'
      ) : (
        <>
          <strong>{formatTrait(trait, range.min)}</strong>
          <span className="colour-ramp" aria-hidden="true">
            {TRAIT_RAMP.map((colour) => (
              <span key={colour} className="colour-step" style={{ backgroundColor: colour }} />
            ))}
          </span>
          <strong>{formatTrait(trait, range.max)}</strong>
          <span className="colour-note">{TRAIT_LABEL[trait]}, lowest to highest alive</span>
        </>
      )}
    </p>
  )
}

export function BotColourControl() {
  const { mode, trait } = useStoreValue((s) => s.botColour)

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (!isBotColourKey(event) || isTypingTarget(event.target)) return
      event.preventDefault()
      cycleBotColour()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Radio group: one tab stop (the checked one), arrows move and choose, Home and End jump.
  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = BOT_COLOUR_MODES.indexOf(mode)
    let next = index
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % BOT_COLOUR_MODES.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index - 1 + BOT_COLOUR_MODES.length) % BOT_COLOUR_MODES.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = BOT_COLOUR_MODES.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    setBotColour({ mode: BOT_COLOUR_MODES[next]! })
    const group = event.currentTarget
    queueMicrotask(() => group.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus())
  }

  return (
    <section className="panel colour-panel" aria-label="Bot colour">
      <div className="colour-controls">
        <span className="colour-label" id="colour-label">
          Colour bots by
        </span>
        <div className="heat-group" role="radiogroup" aria-labelledby="colour-label" onKeyDown={move}>
          {BOT_COLOUR_MODES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              className="secondary heat-option"
              aria-checked={option === mode}
              tabIndex={option === mode ? 0 : -1}
              onClick={() => setBotColour({ mode: option })}
            >
              {BOT_COLOUR_LABEL[option]}
            </button>
          ))}
        </div>
        <label className="colour-trait" style={{ visibility: mode === 'trait' ? 'visible' : 'hidden' }}>
          <span className="colour-trait-label">Trait</span>
          <select
            value={trait}
            disabled={mode !== 'trait'}
            tabIndex={mode === 'trait' ? 0 : -1}
            onChange={(event) => setBotColour({ trait: event.target.value as TraitName })}
          >
            {TRAIT_NAMES.map((name) => (
              <option key={name} value={name}>
                {TRAIT_LABEL[name]}
              </option>
            ))}
          </select>
        </label>
        <span className="heat-hint">
          <kbd className="tool-key">C</kbd> cycles the colour
        </span>
      </div>
      <Legend mode={mode} trait={trait} />
    </section>
  )
}
