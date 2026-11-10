// Heatmaps (M15): where bots go, are born and die. Pure and DOM-free. The heat lives outside the
// World: whatever runs `step` (the SimHost in the worker, and the replay job that rebuilds a saved
// run) calls `observeWorld` after every tick and after every player command, so the grid is the
// same for the live run and for a replay of its seed and commands. It is never hashed and never
// saved; loading a save rebuilds it because the replay observes the same ticks.
//
// One cell is one map cell (the floor of x and y), so a bot, a birth or a death lands in exactly one
// cell. Three layers, each kept two ways: `total` counts everything since the run began, `recent`
// is the same count that fades (multiplied by `HEAT_DECAY` every `HEAT_DECAY_EVERY` ticks, so
// about 650 ticks make half of it go). Traffic is +1 per living bot per tick. Births and deaths are
// not seen in the bot list, so they are read from the world's event log: the change in
// `totalBirths` and in the death total says how many new events there are, and that many newest
// birth (or death) entries of the log give their cells. The log is a ring of the newest
// `logCap` events; the host observes after every step, so nothing is ever missed, and if it ever
// were (a long catch-up), the events that fell out of the ring are counted in `unattributed`
// instead of being put in the wrong place. A meteor kills at command time, so the host observes
// after commands too.
//
// Everything here is display bookkeeping with its own constants (not in tuning.ts, since none of it
// changes behaviour): the sim draws no random numbers for it and never reads it back.

import type { SimEvent, World } from '../sim/types.ts'
import { totalDeaths } from '../sim/world.ts'

export const HEAT_LAYERS = ['traffic', 'births', 'deaths'] as const
export type HeatLayer = (typeof HEAT_LAYERS)[number]

export const HEAT_RANGES = ['all', 'recent'] as const
export type HeatRange = (typeof HEAT_RANGES)[number]

/** Every this many ticks the `recent` grids are multiplied by `HEAT_DECAY`. */
export const HEAT_DECAY_EVERY = 100
export const HEAT_DECAY = 0.9
/** Recent values under this are set to 0, so a quiet cell does not drift into denormal numbers. */
const HEAT_FLOOR = 1e-3

/** Number of coloured steps on the map and in the legend (an empty cell is a step of its own, not drawn). */
export const HEAT_BIN_COUNT = 5

/** Ticks it takes `recent` heat to halve (about 658). */
export const HEAT_HALF_LIFE_TICKS = (HEAT_DECAY_EVERY * Math.log(0.5)) / Math.log(HEAT_DECAY)

export const HEAT_LAYER_LABEL: Record<HeatLayer, string> = { traffic: 'Traffic', births: 'Births', deaths: 'Deaths' }
export const HEAT_RANGE_LABEL: Record<HeatRange, string> = { all: 'All time', recent: 'Recent' }

/** What each layer counts, as a plural noun for the readout ("17 deaths"). */
const HEAT_NOUN: Record<HeatLayer, { one: string; many: string }> = {
  traffic: { one: 'visit', many: 'visits' },
  births: { one: 'birth', many: 'births' },
  deaths: { one: 'death', many: 'deaths' },
}

export type HeatGrid = {
  width: number
  height: number
  /** Everything counted since the run began, row by row (index = y * width + x). */
  total: Record<HeatLayer, Float64Array>
  /** The same count with older events faded out. */
  recent: Record<HeatLayer, Float32Array>
  /** Births and deaths already counted (the change since is what is new). */
  seenBirths: number
  seenDeaths: number
  /** The tick last observed. */
  tick: number
  /** Births and deaths that happened but whose place could not be found (they fell out of the log). */
  unattributed: number
}

/** The part of a World that `observeWorld` reads. */
export type Observable = Pick<World, 'tick' | 'bots' | 'log' | 'totalBirths' | 'deathsByCause'>

export function createHeat(width: number, height: number): HeatGrid {
  const cells = Math.max(1, Math.floor(width)) * Math.max(1, Math.floor(height))
  const grids = <T extends Float32Array | Float64Array>(make: () => T): Record<HeatLayer, T> => ({ traffic: make(), births: make(), deaths: make() })
  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
    total: grids(() => new Float64Array(cells)),
    recent: grids(() => new Float32Array(cells)),
    seenBirths: 0,
    seenDeaths: 0,
    tick: 0,
    unattributed: 0,
  }
}

function cellIndex(heat: HeatGrid, x: number, y: number): number {
  const cx = Math.min(heat.width - 1, Math.max(0, Math.floor(x)))
  const cy = Math.min(heat.height - 1, Math.max(0, Math.floor(y)))
  return cy * heat.width + cx
}

function add(heat: HeatGrid, layer: HeatLayer, index: number): void {
  heat.total[layer][index] += 1
  heat.recent[layer][index] += 1
}

/** Counts the `count` newest log entries of one type that are newer than the last observation. */
function attribute(heat: HeatGrid, log: readonly SimEvent[], type: 'birth' | 'death', layer: HeatLayer, count: number): void {
  let found = 0
  for (let i = log.length - 1; i >= 0 && found < count; i -= 1) {
    const event = log[i]!
    // Older than the last observation: already counted (an event of the same tick may still be new, after a command).
    if (event.tick < heat.tick) break
    if (event.type !== type) continue
    add(heat, layer, cellIndex(heat, event.x, event.y))
    found += 1
  }
  heat.unattributed += count - found
}

function decay(heat: HeatGrid, steps: number): void {
  const factor = Math.pow(HEAT_DECAY, steps)
  for (const layer of HEAT_LAYERS) {
    const grid = heat.recent[layer]
    for (let i = 0; i < grid.length; i += 1) {
      const value = grid[i]! * factor
      grid[i] = value < HEAT_FLOOR ? 0 : value
    }
  }
}

/**
 * Takes in what changed in the world since the last call. Call it after every `step` and after every
 * applied command (a meteor's kills happen then). A new tick counts every living bot once; the births
 * and deaths since the last call are put in their cells; `recent` fades on every `HEAT_DECAY_EVERY`-th tick.
 * Cheap: one pass over the bots, and over the grids only on a fading tick.
 */
export function observeWorld(heat: HeatGrid, world: Observable): void {
  const births = world.totalBirths - heat.seenBirths
  if (births > 0) attribute(heat, world.log, 'birth', 'births', births)
  heat.seenBirths = world.totalBirths

  const deaths = totalDeaths(world) - heat.seenDeaths
  if (deaths > 0) attribute(heat, world.log, 'death', 'deaths', deaths)
  heat.seenDeaths += Math.max(0, deaths)

  if (world.tick > heat.tick) {
    const total = heat.total.traffic
    const recent = heat.recent.traffic
    const { width, height } = heat
    for (const bot of world.bots) {
      const cx = Math.min(width - 1, Math.max(0, Math.floor(bot.x)))
      const cy = Math.min(height - 1, Math.max(0, Math.floor(bot.y)))
      total[cy * width + cx] += 1
      recent[cy * width + cx] += 1
    }
    const steps = Math.floor(world.tick / HEAT_DECAY_EVERY) - Math.floor(heat.tick / HEAT_DECAY_EVERY)
    heat.tick = world.tick
    if (steps > 0) decay(heat, steps)
  }
}

// ---- What the page gets ----

/** One layer of the grid, in the compact form that crosses to the page (96 x 64 = 6,144 numbers), with the summary the legend shows. */
export type HeatSnapshot = {
  /** The run it belongs to (matches `RunInfo.runId`), so a late snapshot of an old run is ignored. */
  runId: number
  layer: HeatLayer
  range: HeatRange
  width: number
  height: number
  /** The tick it was taken at. */
  tick: number
  /** Row by row. For 'all' these are whole counts; for 'recent' they are faded counts. */
  cells: Float32Array
  /** The largest cell, and where (the first one, reading row by row); `hottest` is null when every cell is 0. */
  max: number
  hottest: { x: number; y: number } | null
  /** The sum of all cells. */
  total: number
}

export function snapshotHeat(heat: HeatGrid, layer: HeatLayer, range: HeatRange, runId: number): HeatSnapshot {
  const source = range === 'all' ? heat.total[layer] : heat.recent[layer]
  const cells = new Float32Array(source.length)
  let max = 0
  let at = -1
  let total = 0
  for (let i = 0; i < source.length; i += 1) {
    const value = source[i]!
    cells[i] = value
    total += value
    if (value > max) {
      max = value
      at = i
    }
  }
  return {
    runId,
    layer,
    range,
    width: heat.width,
    height: heat.height,
    tick: heat.tick,
    cells,
    max: cells[at] ?? 0,
    hottest: at < 0 ? null : { x: at % heat.width, y: Math.floor(at / heat.width) },
    total,
  }
}

/** The value of one cell of a snapshot (0 outside the map). */
export function heatAt(snapshot: Pick<HeatSnapshot, 'cells' | 'width' | 'height'>, cx: number, cy: number): number {
  if (cx < 0 || cy < 0 || cx >= snapshot.width || cy >= snapshot.height) return 0
  return snapshot.cells[cy * snapshot.width + cx] ?? 0
}

// ---- Bins and the legend ----

/** Traffic is spread over a huge range (a few busy cells, many quiet ones), so it is shown on a square-root scale; births and deaths are linear. */
export type HeatScale = 'sqrt' | 'linear'

export function scaleFor(layer: HeatLayer): HeatScale {
  return layer === 'traffic' ? 'sqrt' : 'linear'
}

/** The largest value that still falls in bin `bin` (1 to HEAT_BIN_COUNT) for a layer whose biggest cell is `max`. */
export function binUpper(bin: number, max: number, scale: HeatScale): number {
  const n = HEAT_BIN_COUNT
  return scale === 'sqrt' ? (max * bin * bin) / (n * n) : (max * bin) / n
}

/** 0 for an empty cell (not drawn), else 1 to HEAT_BIN_COUNT: the first bin whose upper edge holds the value. */
export function heatBin(value: number, max: number, scale: HeatScale): number {
  if (!(value > 0) || !(max > 0)) return 0
  for (let bin = 1; bin < HEAT_BIN_COUNT; bin += 1) {
    if (value <= binUpper(bin, max, scale)) return bin
  }
  return HEAT_BIN_COUNT
}

/** Counts with a thousands separator; faded values with as many decimals as they need to be told apart. */
export function formatHeat(value: number, whole: boolean): string {
  if (whole || value >= 100) return Math.round(value).toLocaleString('en-US')
  if (value >= 10) return value.toFixed(0)
  if (value >= 1) return value.toFixed(1)
  return value.toFixed(2)
}

export type LegendBin = {
  bin: number
  /** Lowest and highest value in the bin. For whole counts both are integers and `empty` says no integer falls in it. */
  lo: number
  hi: number
  empty: boolean
  /** "1-3", "4", "5-9" (an en dash); "none" for an empty bin. */
  label: string
}

/**
 * The legend's rows: what range of values each of the bins covers. `whole` is true for all-time counts, which are
 * integers (a bin may then hold no value at all when the maximum is small); faded values give ranges with decimals,
 * and a value on an edge belongs to the lower bin.
 */
export function legendBins(max: number, scale: HeatScale, whole: boolean): LegendBin[] {
  const bins: LegendBin[] = []
  if (!(max > 0)) return bins
  let previous = 0
  for (let bin = 1; bin <= HEAT_BIN_COUNT; bin += 1) {
    const upper = binUpper(bin, max, scale)
    if (whole) {
      const lo = Math.floor(previous) + 1
      const hi = Math.floor(upper)
      const empty = lo > hi
      bins.push({ bin, lo, hi, empty, label: empty ? 'none' : lo === hi ? formatHeat(lo, true) : `${formatHeat(lo, true)}–${formatHeat(hi, true)}` })
    } else {
      bins.push({ bin, lo: previous, hi: upper, empty: false, label: bin === 1 ? `up to ${formatHeat(upper, false)}` : `${formatHeat(previous, false)}–${formatHeat(upper, false)}` })
    }
    previous = upper
  }
  return bins
}

/** "17 deaths", "1 visit", "3.4 births" (a faded count has no singular). */
export function describeHeat(layer: HeatLayer, range: HeatRange, value: number): string {
  const whole = range === 'all'
  const noun = HEAT_NOUN[layer]
  return `${formatHeat(value, whole)} ${whole && value === 1 ? noun.one : noun.many}`
}

/** The layer the H key moves to: none, traffic, births, deaths, and round to none again. */
export function nextHeatLayer(current: HeatLayer | null): HeatLayer | null {
  if (current === null) return HEAT_LAYERS[0]
  const next = HEAT_LAYERS[HEAT_LAYERS.indexOf(current) + 1]
  return next ?? null
}

/** Whether a key press is the heatmap key (H, on its own: not with Ctrl, Alt, Meta or Shift). The caller still ignores presses while typing in a field. */
export function isHeatKey(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
  return event.key === 'h' || event.key === 'H'
}
