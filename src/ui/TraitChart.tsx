// Trait averages over time: one small line chart per trait (small multiples),
// each with the population mean now and how far it has drifted since the first
// sample. Each trait has its own line style and end marker (solid circle,
// dashed square, dotted triangle, dash-dot diamond) and its own labelled
// panel, so nothing depends on colour.
//
// The vertical axis of a chart spans the trait's allowed range (the mutation
// bounds in tuning), so a line near the top or bottom is a trait pressed
// against its limit. A faint dotted line marks the founders' value. A gap in a
// line means nobody was alive at that sample.

import { useMemo } from 'react'
import { tuning } from '../content/index.ts'
import { traitDrift } from '../sim/stats.ts'
import { TRAIT_NAMES } from '../sim/traits.ts'
import type { Sample, TraitName, World } from '../sim/types.ts'
import { takeSample } from '../sim/world.ts'
import { thin } from './chartMath.ts'
import { TRAIT_HELP, TRAIT_LABEL } from './labels.ts'
import { useWorldStore } from './store.ts'
import { TREND_GLYPH, fractionOf, signedDelta, traitNumber, trendOf } from './traitMath.ts'
import { useElementWidth } from './useElementWidth.ts'

const HEIGHT = 96
const MARGIN = { left: 34, right: 12, top: 8, bottom: 8 }
const numberFormat = new Intl.NumberFormat('en-US')

type Shape = 'circle' | 'square' | 'triangle' | 'diamond'
const SHAPE: Record<TraitName, Shape> = {
  senseRadius: 'circle',
  caution: 'square',
  reproThreshold: 'triangle',
  metabolism: 'diamond',
}

/** An end-of-line marker centred on (x, y). */
function Marker({ shape, x, y }: { shape: Shape; x: number; y: number }) {
  const r = 4.5
  switch (shape) {
    case 'circle':
      return <circle cx={x} cy={y} r={r} className="trait-dot" />
    case 'square':
      return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} className="trait-dot" />
    case 'triangle':
      return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y + r} ${x - r - 1},${y + r}`} className="trait-dot" />
    case 'diamond':
      return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}`} className="trait-dot" />
  }
}

/** All samples plus the live tick, oldest first. */
function buildSamples(world: World, _revision: string): Sample[] {
  const samples: Sample[] = [...world.samples]
  const live = takeSample(world)
  const last = samples[samples.length - 1]
  if (last === undefined || live.tick > last.tick) samples.push(live)
  return samples
}

type MiniProps = { name: TraitName; samples: readonly Sample[]; x0: number; x1: number }

function TraitMini({ name, samples, x0, x1 }: MiniProps) {
  const [wrapRef, width] = useElementWidth()
  const { min, max } = tuning.mutation.bounds[name]
  const founders = tuning.traits[name]
  const live = samples[samples.length - 1]!
  const drift = traitDrift(samples, live, name)

  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right)
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
  const xSpan = Math.max(1, x1 - x0)
  const px = (t: number): number => MARGIN.left + ((t - x0) / xSpan) * plotWidth
  const py = (v: number): number => MARGIN.top + (1 - fractionOf(v, min, max)) * plotHeight

  const points = thin(samples, Math.max(2, plotWidth))
  // Break the line wherever nobody was alive.
  const segments: string[] = []
  let current: string[] = []
  let end: { x: number; y: number } | null = null
  for (const point of points) {
    const value = point.traits?.[name]
    if (value === undefined) {
      if (current.length > 0) segments.push(current.join(' '))
      current = []
      continue
    }
    const x = px(point.tick)
    const y = py(value)
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`)
    end = { x, y }
  }
  if (current.length > 0) segments.push(current.join(' '))

  const trend = drift === null ? null : trendOf(name, drift.delta)
  const label = TRAIT_LABEL[name]
  const extinct = live.traits === null

  return (
    <div className="trait-cell" title={TRAIT_HELP[name]}>
      <div className="trait-head">
        <span className="trait-name">
          <svg width="30" height="12" aria-hidden="true" className="trait-key">
            <line x1="1" x2="29" y1="6" y2="6" className={`trait-line trait-line-${name}`} />
          </svg>
          {label}
        </span>
        <strong className="figure trait-now">
          {drift === null ? '—' : traitNumber(name, drift.now)}
        </strong>
      </div>
      <p className={`figure trait-drift trait-${trend ?? 'flat'}`}>
        {drift === null || trend === null ? (
          'No bots yet'
        ) : (
          <>
            <span aria-hidden="true">{TREND_GLYPH[trend]}</span> {signedDelta(name, drift.delta)}{' '}
            <span className="trait-from">from {traitNumber(name, drift.start)}</span>
          </>
        )}
      </p>
      <div className="trait-wrap" ref={wrapRef}>
        {width > 0 && (
          <svg
            className="trait-svg"
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={
              drift === null
                ? `${label}: no data`
                : `${label} population mean from tick ${numberFormat.format(x0)} to ${numberFormat.format(x1)}: started at ${traitNumber(name, drift.start)}, ${extinct ? 'last seen' : 'now'} ${traitNumber(name, drift.now)}. Allowed range ${min} to ${max}.`
            }
          >
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={MARGIN.top} y2={MARGIN.top} className="grid-line" />
            <line
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={MARGIN.top + plotHeight}
              y2={MARGIN.top + plotHeight}
              className="grid-line"
            />
            <text x={MARGIN.left - 5} y={MARGIN.top + 4} textAnchor="end" className="axis-text">
              {max}
            </text>
            <text x={MARGIN.left - 5} y={MARGIN.top + plotHeight + 4} textAnchor="end" className="axis-text">
              {min}
            </text>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={py(founders)} y2={py(founders)} className="trait-founders" />
            {segments.map((segment, index) => (
              <polyline key={index} points={segment} className={`trait-line trait-line-${name}`} />
            ))}
            {end !== null && <Marker shape={SHAPE[name]} x={end.x} y={end.y} />}
          </svg>
        )}
      </div>
    </div>
  )
}

export function TraitChart() {
  const { world, tick } = useWorldStore()
  // The world is mutated in place, so this key (not the world object) says when the data is stale.
  const revision = `${tick}/${world.samples.length}`
  const samples = useMemo(() => buildSamples(world, revision), [world, revision])

  const first = samples[0]!
  const last = samples[samples.length - 1]!
  const anyone = samples.some((sample) => sample.traits !== null)

  if (!anyone || last.tick <= first.tick) {
    return (
      <section className="panel trait-panel" aria-label="Trait averages over time">
        <h2>Traits over time</h2>
        <p className="empty chart-empty trait-empty">
          {anyone
            ? 'Trait lines start once the world has run a few ticks. Press Play or Step.'
            : 'No bots yet, so there are no trait averages. Add a bot to start a line.'}
        </p>
      </section>
    )
  }

  return (
    <section className="panel trait-panel" aria-label="Trait averages over time">
      <h2>Traits over time</h2>
      <div className="trait-grid">
        {TRAIT_NAMES.map((name) => (
          <TraitMini key={name} name={name} samples={samples} x0={first.tick} x1={last.tick} />
        ))}
      </div>
      <p className="chart-note">
        Population mean of each trait, ticks {numberFormat.format(first.tick)} to {numberFormat.format(last.tick)}. Each chart spans the
        trait&apos;s allowed range; the faint dotted line is the founders&apos; value.
        {last.traits === null ? ' Everyone is gone: lines stop at the last living sample.' : ''}
      </p>
    </section>
  )
}
