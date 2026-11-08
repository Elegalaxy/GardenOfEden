// Population and food over time, as a hand-written SVG line chart (pattern
// from trading-sim's EquityChart, but drawn at the real pixel width so text
// stays readable on a phone).
//
// Population is a solid line on the left axis, food a dashed line on the right
// axis, so the two read apart without colour. Food here is resource food only
// (food sitting in ruins is not added in). Every player command is a thin
// vertical marker topped with a letter: R, D, S for a placed resource, danger
// or shelter, B for a bot, X for a removed node. Hover (or touch, or the
// arrow keys when the chart has focus) shows a tooltip with the tick, both
// values and any command at that marker. Long runs are thinned to about one
// point per pixel.

import { useMemo, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { Command, Sample, SimEvent, World } from '../sim/types.ts'
import { takeSample } from '../sim/world.ts'
import { compact, nearestIndex, niceMax, thin } from './chartMath.ts'
import { commandLetter, commandName, formatPoint } from './labels.ts'
import { useWorldStore } from './store.ts'
import { useElementWidth } from './useElementWidth.ts'

const HEIGHT = 240
const MARGIN = { left: 40, right: 48, top: 24, bottom: 26 }
const DIVISIONS = 4
const MARKER_SNAP_PX = 7
const MIN_LETTER_GAP_PX = 13

type Marker = {
  tick: number
  letter: string
  text: string
}

const numberFormat = new Intl.NumberFormat('en-US')

function toMarker(entry: { tick: number; cmd: Command }): Marker {
  const { cmd } = entry
  switch (cmd.type) {
    case 'placeNode':
      return {
        tick: entry.tick,
        letter: commandLetter(cmd.type, cmd.kind),
        text: `${commandName(cmd.type, cmd.kind)} at ${formatPoint(cmd.x, cmd.y)}`,
      }
    case 'placeBot':
      return { tick: entry.tick, letter: 'B', text: `place bot at ${formatPoint(cmd.x, cmd.y)}` }
    case 'removeNode':
      return { tick: entry.tick, letter: 'X', text: `remove node #${cmd.id}` }
  }
}

/** The one event of `log` that says what a removed node was, for a nicer marker label. */
function removedKinds(log: readonly SimEvent[]): Map<number, string> {
  const kinds = new Map<number, string>()
  for (const event of log) {
    if (event.command === 'removeNode' && event.nodeId !== undefined && event.nodeKind !== undefined) {
      kinds.set(event.nodeId, event.nodeKind)
    }
  }
  return kinds
}

/** Samples (thinned to the plot width, plus the live tick) and one marker per player command. */
function buildChartData(world: World, plotWidth: number, _revision: string): { points: readonly Sample[]; markers: Marker[] } {
  const samples: Sample[] = [...world.samples]
  const live = takeSample(world)
  const lastSample = samples[samples.length - 1]
  if (lastSample === undefined || live.tick > lastSample.tick) samples.push(live)
  const points = thin(samples, Math.max(2, plotWidth))
  const kinds = removedKinds(world.log)
  const markers = world.commands.map((entry) => {
    const marker = toMarker(entry)
    if (entry.cmd.type === 'removeNode') {
      const kind = kinds.get(entry.cmd.id)
      if (kind !== undefined) marker.text = `remove ${kind} #${entry.cmd.id}`
    }
    return marker
  })
  return { points, markers }
}

export function PopulationChart() {
  const { world, tick } = useWorldStore()
  const [wrapRef, width] = useElementWidth()
  const [hoverTick, setHoverTick] = useState<number | null>(null)

  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right)
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom

  // The world is mutated in place, so this key (not the world object) says when the chart data is stale.
  const revision = `${tick}/${world.log.length}/${world.commands.length}`
  const data = useMemo(() => buildChartData(world, plotWidth, revision), [world, plotWidth, revision])

  const { points, markers } = data
  const first = points[0]
  const last = points[points.length - 1]

  if (first === undefined || last === undefined || last.tick <= first.tick) {
    return (
      <section className="panel chart-panel" aria-label="Population chart">
        <h2>Population and food</h2>
        <p className="empty chart-empty">
          The chart starts drawing once the world has run a few ticks. Press <strong>Play</strong> or <strong>Step</strong>.
        </p>
      </section>
    )
  }

  const x0 = first.tick
  const x1 = last.tick
  const xSpan = Math.max(1, x1 - x0)
  const popMax = niceMax(Math.max(...points.map((p) => p.pop), 1), DIVISIONS)
  const foodMax = niceMax(Math.max(...points.map((p) => p.food), 1), DIVISIONS)
  const px = (t: number): number => MARGIN.left + ((t - x0) / xSpan) * plotWidth
  const popY = (v: number): number => MARGIN.top + plotHeight - (v / popMax) * plotHeight
  const foodY = (v: number): number => MARGIN.top + plotHeight - (v / foodMax) * plotHeight

  const popLine = points.map((p) => `${px(p.tick).toFixed(1)},${popY(p.pop).toFixed(1)}`).join(' ')
  const foodLine = points.map((p) => `${px(p.tick).toFixed(1)},${foodY(p.food).toFixed(1)}`).join(' ')

  const visibleMarkers = markers.filter((marker) => marker.tick >= x0 && marker.tick <= x1)

  // Which markers get a letter: skip one that would sit on top of the previous letter.
  // The skipped ones are counted on the letter before them ("D+1").
  const lettered = new Map<number, number>()
  let lastLetterX = -Infinity
  let lastLettered = -1
  visibleMarkers.forEach((marker, index) => {
    const x = px(marker.tick)
    if (x - lastLetterX >= MIN_LETTER_GAP_PX) {
      lettered.set(index, 0)
      lastLetterX = x
      lastLettered = index
    } else {
      lettered.set(lastLettered, (lettered.get(lastLettered) ?? 0) + 1)
    }
  })

  const pointTicks = points.map((p) => p.tick)
  const hoverIndex = hoverTick === null ? -1 : nearestIndex(pointTicks, hoverTick)
  const hoverPoint = hoverIndex >= 0 ? points[hoverIndex] : undefined
  const shown = hoverPoint ?? last
  const hoverX = hoverPoint === undefined ? null : px(hoverPoint.tick)
  const hoverMarkers =
    hoverX === null ? [] : visibleMarkers.filter((marker) => Math.abs(px(marker.tick) - hoverX) <= MARKER_SNAP_PX)

  const tickAt = (clientX: number, element: Element): number | null => {
    const rect = element.getBoundingClientRect()
    const x = clientX - rect.left
    if (x < MARGIN.left - 4 || x > width - MARGIN.right + 4) return null
    const rawTick = x0 + ((x - MARGIN.left) / Math.max(1, plotWidth)) * xSpan
    // Snap to a marker that is close in pixels, so markers are easy to hit.
    let best: Marker | undefined
    let bestPx = MARKER_SNAP_PX
    for (const marker of visibleMarkers) {
      const d = Math.abs(px(marker.tick) - x)
      if (d <= bestPx) {
        best = marker
        bestPx = d
      }
    }
    return best === undefined ? rawTick : best.tick
  }

  const onPointer = (event: PointerEvent<SVGSVGElement>): void => {
    setHoverTick(tickAt(event.clientX, event.currentTarget))
  }

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>): void => {
    if (event.key === 'Escape') {
      setHoverTick(null)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const current = hoverIndex >= 0 ? hoverIndex : points.length - 1
    let next = current
    if (event.key === 'ArrowLeft') next = Math.max(0, current - 1)
    if (event.key === 'ArrowRight') next = Math.min(points.length - 1, current + 1)
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = points.length - 1
    setHoverTick(points[next]?.tick ?? null)
  }

  const xTicks = Array.from({ length: 5 }, (_, i) => Math.round(x0 + (xSpan * i) / 4))
  const tooltipOnLeft = hoverX !== null && hoverX > MARGIN.left + plotWidth / 2

  return (
    <section className="panel chart-panel" aria-label="Population chart">
      <h2>Population and food</h2>
      <ul className="chart-legend">
        <li>
          <svg width="30" height="10" aria-hidden="true">
            <line x1="1" x2="29" y1="5" y2="5" className="line-pop" />
          </svg>
          Population <strong className="figure">{numberFormat.format(shown.pop)}</strong>
          <span className="legend-note">left axis</span>
        </li>
        <li>
          <svg width="30" height="10" aria-hidden="true">
            <line x1="1" x2="29" y1="5" y2="5" className="line-food" />
          </svg>
          Resource food <strong className="figure">{numberFormat.format(Math.round(shown.food))}</strong>
          <span className="legend-note">right axis</span>
        </li>
        <li>
          <svg width="14" height="14" aria-hidden="true">
            <line x1="7" x2="7" y1="0" y2="14" className="marker-line" />
          </svg>
          Command marker
          <span className="legend-note">R D S placed node · B bot · X removed</span>
        </li>
        <li className="legend-tick figure">
          Tick {numberFormat.format(shown.tick)}
        </li>
      </ul>
      <div className="chart-wrap" ref={wrapRef}>
        {width > 0 && (
          <svg
            className="chart"
            width={width}
            height={HEIGHT}
            role="img"
            tabIndex={0}
            aria-label={`Population and food from tick ${x0} to tick ${x1}. Latest population ${last.pop}, food ${Math.round(last.food)}. ${markers.length} player command${markers.length === 1 ? '' : 's'}. Use left and right arrow keys to read values.`}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setHoverTick(null)}
            onBlur={() => setHoverTick(null)}
            onKeyDown={onKeyDown}
          >
            {Array.from({ length: DIVISIONS + 1 }, (_, i) => {
              const y = MARGIN.top + (plotHeight * i) / DIVISIONS
              const popValue = popMax * (1 - i / DIVISIONS)
              const foodValue = foodMax * (1 - i / DIVISIONS)
              return (
                <g key={i}>
                  <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y} y2={y} className="grid-line" />
                  <text x={MARGIN.left - 6} y={y + 4} textAnchor="end" className="axis-text">
                    {compact(popValue)}
                  </text>
                  <text x={width - MARGIN.right + 6} y={y + 4} textAnchor="start" className="axis-text">
                    {compact(foodValue)}
                  </text>
                </g>
              )
            })}
            {xTicks.map((t, i) => (
              <text
                key={i}
                x={px(t)}
                y={HEIGHT - 8}
                textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
                className="axis-text"
              >
                {compact(t)}
              </text>
            ))}
            {visibleMarkers.map((marker, index) => (
              <g key={index}>
                <line
                  x1={px(marker.tick)}
                  x2={px(marker.tick)}
                  y1={MARGIN.top - 4}
                  y2={MARGIN.top + plotHeight}
                  className="marker-line"
                />
                {lettered.has(index) && (
                  <text x={px(marker.tick)} y={MARGIN.top - 8} textAnchor="middle" className="marker-letter">
                    {marker.letter}
                    {(lettered.get(index) ?? 0) > 0 ? `+${lettered.get(index)}` : ''}
                  </text>
                )}
              </g>
            ))}
            <polyline points={foodLine} className="line-food" />
            <polyline points={popLine} className="line-pop" />
            {hoverPoint !== undefined && hoverX !== null && (
              <g>
                <line x1={hoverX} x2={hoverX} y1={MARGIN.top} y2={MARGIN.top + plotHeight} className="hover-line" />
                <circle cx={hoverX} cy={popY(hoverPoint.pop)} r="4" className="dot-pop" />
                <rect x={hoverX - 4} y={foodY(hoverPoint.food) - 4} width="8" height="8" className="dot-food" />
              </g>
            )}
          </svg>
        )}
        {hoverPoint !== undefined && hoverX !== null && (
          <div
            className={tooltipOnLeft ? 'chart-tooltip tooltip-left' : 'chart-tooltip'}
            style={tooltipOnLeft ? { right: width - hoverX + 10 } : { left: hoverX + 10 }}
            role="status"
          >
            <p className="figure tooltip-tick">Tick {numberFormat.format(hoverPoint.tick)}</p>
            <dl className="tooltip-values">
              <dt>Population</dt>
              <dd className="figure">{numberFormat.format(hoverPoint.pop)}</dd>
              <dt>Food</dt>
              <dd className="figure">{numberFormat.format(Math.round(hoverPoint.food))}</dd>
            </dl>
            {hoverMarkers.slice(0, 3).map((marker, index) => (
              <p key={index} className="tooltip-command">
                <strong>{marker.letter}</strong> Tick {marker.tick}: {marker.text}
              </p>
            ))}
            {hoverMarkers.length > 3 && <p className="tooltip-command">+{hoverMarkers.length - 3} more commands</p>}
          </div>
        )}
      </div>
      <p className="chart-note">
        {x0 > 0
          ? `Showing ticks ${numberFormat.format(x0)} to ${numberFormat.format(x1)}; older samples were dropped.`
          : `Showing the whole run, ticks 0 to ${numberFormat.format(x1)}.`}
      </p>
    </section>
  )
}
