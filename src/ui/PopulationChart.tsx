// Population and food over time, as a hand-written SVG line chart (pattern
// from trading-sim's EquityChart, but drawn at the real pixel width so text
// stays readable on a phone).
//
// Population is a solid line on the left axis, food a dashed line on the right
// axis, so the two read apart without colour. Food here is resource food only
// (food sitting in ruins is not added in). Every player command is a thin
// vertical marker topped with a letter: R, D, S for a placed resource, danger
// or shelter, W for water, B for a bot, X for a removed node, H F P M for a world
// event (drought, bounty, plague, meteor). A timed event (drought, bounty, plague)
// also gets a shaded band over the ticks it was in force, labelled and patterned
// (diagonal lines = drought, dots = bounty, crosshatch = plague), never colour
// alone. Hover (or touch, or the
// arrow keys when the chart has focus) shows a tooltip with the tick, both
// values and any command at that marker. Long runs are thinned to about one
// point per pixel.

import { useMemo, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { tuning } from '../content/index.ts'
import type { Command, Sample, SimEvent, TimedEventKind } from '../sim/types.ts'
import { takeSample } from '../sim/world.ts'
import { compact, eventBands, nearestIndex, niceMax, thin, xAxisTicks } from './chartMath.ts'
import type { EventBand } from './chartMath.ts'
import { EVENT_LABEL, EVENT_LETTER, commandLetter, commandName, formatPoint } from './labels.ts'
import { useWorldStore } from './store.ts'
import { useElementWidth } from './useElementWidth.ts'
import type { ViewWorld } from './viewWorld.ts'

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
    case 'triggerEvent': {
      const name = commandName(cmd.type, undefined, cmd.event)
      return {
        tick: entry.tick,
        letter: commandLetter(cmd.type, undefined, cmd.event),
        text: cmd.x === undefined || cmd.y === undefined ? name : `${name} at ${formatPoint(cmd.x, cmd.y)}`,
      }
    }
  }
}

const BAND_DURATIONS: Record<TimedEventKind, number> = {
  drought: tuning.events.drought.duration,
  bounty: tuning.events.bounty.duration,
  plague: tuning.events.plague.duration,
}
const BAND_LABEL_PX = 60
const BAND_LANE_PX = 12

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
function buildChartData(
  world: ViewWorld,
  plotWidth: number,
  _revision: string,
): { points: readonly Sample[]; markers: Marker[]; bands: EventBand[] } {
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
  return { points, markers, bands: eventBands(world.commands, BAND_DURATIONS, world.tick) }
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

  const { points, markers, bands } = data
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
  const visibleBands = bands.filter((band) => band.end >= x0 && band.start <= x1)

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
  const hoverBands =
    hoverPoint === undefined ? [] : visibleBands.filter((band) => band.start <= hoverPoint.tick && hoverPoint.tick <= band.end)

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

  // As many round ticks as fit the plot width without their labels touching (fewer, or abbreviated, on a phone).
  const xTicks = xAxisTicks(x0, x1, plotWidth, { padLeft: MARGIN.left - 4, padRight: MARGIN.right - 4 })
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
          <span className="legend-note">R D S W placed node · B bot · X removed · H F P M event</span>
        </li>
        <li>
          <svg width="30" height="14" aria-hidden="true">
            <rect x="1" y="1" width="28" height="12" className="band-swatch" />
          </svg>
          Event band
          <span className="legend-note">hatched = drought, dotted = bounty, crossed = plague</span>
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
            <defs>
              <pattern id="band-drought" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="8" className="band-stroke" />
              </pattern>
              <pattern id="band-bounty" width="8" height="8" patternUnits="userSpaceOnUse">
                <circle cx="4" cy="4" r="1.4" className="band-dot" />
              </pattern>
              <pattern id="band-plague" width="8" height="8" patternUnits="userSpaceOnUse">
                <path d="M0 0 L8 8 M8 0 L0 8" className="band-stroke" />
              </pattern>
            </defs>
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
            {xTicks.map((tick) => (
              <text key={tick.value} x={px(tick.value)} y={HEIGHT - 8} textAnchor="middle" className="axis-text x-tick">
                {tick.label}
              </text>
            ))}
            {visibleBands.map((band, index) => {
              const left = px(Math.max(band.start, x0))
              const right = px(Math.min(band.end, x1))
              const bandWidth = Math.max(1, right - left)
              const label = `${EVENT_LETTER[band.kind]} ${EVENT_LABEL[band.kind]}${band.ongoing ? ' (now)' : ''}`
              return (
                <g key={`band-${index}`} className="event-band">
                  <rect x={left} y={MARGIN.top} width={bandWidth} height={plotHeight} fill={`url(#band-${band.kind})`} className="band-fill" />
                  <line x1={left} x2={left} y1={MARGIN.top} y2={MARGIN.top + plotHeight} className="band-edge" />
                  {bandWidth >= 12 && (
                    <text x={left + 4} y={MARGIN.top + 11 + band.lane * BAND_LANE_PX} className="band-label">
                      {bandWidth >= BAND_LABEL_PX ? label : EVENT_LETTER[band.kind]}
                    </text>
                  )}
                </g>
              )
            })}
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
            {hoverBands.map((band, index) => (
              <p key={`band-${index}`} className="tooltip-command">
                <strong>{EVENT_LETTER[band.kind]}</strong> {EVENT_LABEL[band.kind]} in force (ticks {numberFormat.format(band.start)} to{' '}
                {numberFormat.format(band.start + BAND_DURATIONS[band.kind])})
              </p>
            ))}
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
