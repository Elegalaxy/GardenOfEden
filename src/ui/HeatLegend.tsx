// The heatmap controls and legend (M15), in one panel under the map: a layer choice (None, Traffic, Births,
// Deaths; key H cycles it), a range choice (All time or Recent), the numeric key to the five steps of the map
// overlay, the largest cell with its coordinates, and a line that reads the value under the pointer. The numbers
// carry the meaning, so the overlay never relies on colour alone. Every part keeps its room whether or not a layer
// is on (the legend block and the readout line have a minimum height), so switching layers or moving the pointer
// never moves the page. The choice lives in the page's store only.

import { useEffect } from 'react'
import type { KeyboardEvent } from 'react'
import {
  HEAT_LAYERS,
  HEAT_LAYER_LABEL,
  HEAT_RANGES,
  HEAT_RANGE_LABEL,
  describeHeat,
  formatHeat,
  heatAt,
  isHeatKey,
  legendBins,
  scaleFor,
} from './heat.ts'
import type { HeatLayer, HeatRange } from './heat.ts'
import { heatBinColor } from './heatRender.ts'
import { cycleHeatLayer, setHeatLayer, setHeatRange, useHoverCell, useStoreValue } from './store.ts'
import { isTypingTarget } from './typing.ts'

/** What one cell of each layer counts, and how the colour is spread. */
const LAYER_UNIT: Record<HeatLayer, string> = {
  traffic: 'bot visits per cell, square-root colour scale',
  births: 'births per cell',
  deaths: 'deaths per cell',
}

const RANGE_NOTE: Record<HeatRange, string> = {
  all: 'all time',
  recent: 'recent, older events fade (half in about 650 ticks)',
}

type Option<T extends string> = { value: T; label: string }

/**
 * A row of exclusive choices with radio-group semantics: one tab stop (the checked one), arrow keys move and
 * choose, Home and End jump. `disabledReason` greys the whole group out and says why.
 */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabledReason,
}: {
  label: string
  options: readonly Option<T>[]
  value: T
  onChange: (next: T) => void
  disabledReason?: string
}) {
  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabledReason !== undefined) return
    const index = options.findIndex((option) => option.value === value)
    let next = index
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % options.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index - 1 + options.length) % options.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = options.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    onChange(options[next]!.value)
    // The newly chosen button takes the focus (roving tab stop).
    const group = event.currentTarget
    queueMicrotask(() => group.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus())
  }
  return (
    <div className="heat-group" role="radiogroup" aria-label={label} title={disabledReason} onKeyDown={move}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          className="secondary heat-option"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          disabled={disabledReason !== undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

const LAYER_OPTIONS: readonly Option<HeatLayer | 'none'>[] = [
  { value: 'none', label: 'None' },
  ...HEAT_LAYERS.map((layer) => ({ value: layer, label: HEAT_LAYER_LABEL[layer] })),
]

const RANGE_OPTIONS: readonly Option<HeatRange>[] = HEAT_RANGES.map((range) => ({ value: range, label: HEAT_RANGE_LABEL[range] }))

export function HeatLegend() {
  const layer = useStoreValue((s) => s.heatLayer)
  const range = useStoreValue((s) => s.heatRange)
  const heat = useStoreValue((s) => s.heat)
  const cell = useHoverCell()

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (!isHeatKey(event) || isTypingTarget(event.target)) return
      event.preventDefault()
      cycleHeatLayer()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const whole = range === 'all'
  const bins = layer === null || heat === null ? [] : legendBins(heat.max, scaleFor(layer), whole)

  let body
  if (layer === null) {
    body = <p className="heat-note">Heatmap off. Pick a layer, or press H, to see where bots go, are born and die.</p>
  } else if (heat === null) {
    body = <p className="heat-note">Loading {HEAT_LAYER_LABEL[layer].toLowerCase()}…</p>
  } else if (heat.max <= 0) {
    body = (
      <p className="heat-note">
        <strong>{HEAT_LAYER_LABEL[layer]}</strong>: nothing counted {whole ? 'in this run' : 'recently'} yet.
      </p>
    )
  } else {
    body = (
      <>
        <p className="heat-unit">
          <strong>{HEAT_LAYER_LABEL[layer]}</strong>: {LAYER_UNIT[layer]} · {RANGE_NOTE[range]}
        </p>
        <ol className="heat-bins" aria-label="Colour steps from palest to brightest, and the values in each">
          {bins.map((bin) => (
            <li key={bin.bin} className={`heat-bin${bin.empty ? ' heat-bin-empty' : ''}`}>
              <span className="heat-swatch" style={{ backgroundImage: `linear-gradient(${heatBinColor(bin.bin)}, ${heatBinColor(bin.bin)})` }} aria-hidden="true" />
              <span className="figure">{bin.label}</span>
            </li>
          ))}
        </ol>
        <p className="heat-peak figure">
          Peak <strong>{formatHeat(heat.max, whole)}</strong>
          {heat.hottest !== null && (
            <>
              {' '}
              at ({heat.hottest.x}, {heat.hottest.y})
            </>
          )}
          {' · '}Total <strong>{formatHeat(heat.total, whole)}</strong>
        </p>
      </>
    )
  }

  let readout = ' '
  if (layer !== null && heat !== null) {
    readout =
      cell === null
        ? 'Under cursor: point at the map.'
        : `Under cursor (${cell.cx}, ${cell.cy}): ${describeHeat(layer, range, heatAt(heat, cell.cx, cell.cy))}${whole ? '' : ', recent'}`
  }

  return (
    <section className="panel heat-panel" aria-label="Heatmap">
      <div className="heat-controls">
        <Segmented
          label="Heatmap layer"
          options={LAYER_OPTIONS}
          value={layer ?? 'none'}
          onChange={(next) => setHeatLayer(next === 'none' ? null : next)}
        />
        <Segmented
          label="Heatmap range"
          options={RANGE_OPTIONS}
          value={range}
          onChange={setHeatRange}
          disabledReason={layer === null ? 'Pick a layer first.' : undefined}
        />
        <span className="heat-hint">
          <kbd className="tool-key">H</kbd> cycles the layer
        </span>
      </div>
      <div className="heat-body">{body}</div>
      <p className="heat-readout figure">{readout}</p>
    </section>
  )
}
