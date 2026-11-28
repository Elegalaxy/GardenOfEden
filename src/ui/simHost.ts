// The simulation host (M13): everything the worker does, as plain functions with no DOM, no
// Worker and no timers of its own, so Vitest drives it directly. It owns the World, the
// replay (load) job and, from M15, the heat grid. `handle(msg)` takes one message from the
// page and returns the messages to send back, in order; `pumpLoad()` runs one slice of a
// load in progress and returns what that produced. `sim.worker.ts` is only an adapter that
// wires these to `postMessage` and `setTimeout`, and the inline client (simClient.ts) wires
// the same host to the main thread when no Worker is available.
//
// Rules the host keeps, so the run is the same as it was on the main thread:
//  - Messages are handled one at a time in the order they arrive, so a command lands between
//    the ticks of the advance before it and the advance after it, and is recorded at that tick.
//  - While a load runs, the current world is not touched: advance does nothing, commands and
//    resets are refused. The new world is built apart and replaces the old one only when it is
//    complete; a failed or cancelled load leaves the old run exactly as it was.
//  - The heat grid (heat.ts, M15) is accumulated always, after every step and every command, whether or not the page shows
//    a heatmap, so switching one on shows the whole history. A load builds its own grid through the replay job and the
//    live one is replaced only when the load completes. The grid is not part of the World, so it never touches the hash.
//    Snapshots go to the page only while a layer is on (see protocol.ts).
//  - A frame carries the numbers that change every tick; the bulky ones (samples, log, commands,
//    the selected bot's memory) ride along at most about four times a second, when asked for,
//    and with every answer to a command, a selection or a new run (see protocol.ts).

import { SIM_VERSION, edenPreset, featureRules, findPreset, isFeatureList, presetWithFeatures, rules as defaultRules, rulesWithFeatures } from '../content/index.ts'
import { makeSave } from '../persist/save.ts'
import type { Save } from '../persist/save.ts'
import { applyCommand } from '../sim/commands.ts'
import type { CommandResult } from '../sim/commands.ts'
import { stateHash } from '../sim/hash.ts'
import { familyView, founderLines } from '../sim/lineage.ts'
import { step } from '../sim/step.ts'
import type { Rules, World, WorldFeature } from '../sim/types.ts'
import { createWorld } from '../sim/world.ts'
import { packBots } from './botColumns.ts'
import { findBot } from './geometry.ts'
import { HEAT_LAYERS, HEAT_RANGES, createHeat, observeWorld, snapshotHeat } from './heat.ts'
import type { HeatGrid, HeatLayer, HeatRange } from './heat.ts'
import type { Frame, FromWorker, QueryAnswer, ResistanceStats, RunInfo, ToWorker } from './protocol.ts'
import { createReplayJob } from './replayJob.ts'
import type { ReplayJob } from './replayJob.ts'

export const DEFAULT_SEED = 'a'

const SEED_PATTERN = /^[A-Za-z0-9-]{1,32}$/

/** The same rule the CLI uses: 1 to 32 letters, digits or dashes. */
export function isValidSeed(seed: string): boolean {
  return SEED_PATTERN.test(seed)
}

export const LOADING_REASON = 'A saved run is loading. Wait for it or cancel it first.'

/**
 * What a failed replay says. A save from older rules whose command the current rules refuse (a rule was retired, such as the
 * danger zone in M21b) is worded as an old-rules problem rather than a broken file.
 */
export function replayFailureMessage(saveSim: number, reason: string): string {
  if (saveSim < SIM_VERSION && /was refused/.test(reason)) {
    return `This save was made with older rules (v${saveSim}) and no longer replays: ${reason}. Your current run was kept.`
  }
  return `This save could not be replayed (${reason}). Your current run was kept.`
}

/** Why a save cannot be loaded by this version (unknown preset, bad seed), or null. The text has no "kept" suffix. */
export function checkLoad(save: Pick<Save, 'seed' | 'presetId' | 'features'>): string | null {
  if (findPreset(save.presetId) === undefined) {
    return `This save needs the "${save.presetId}" preset, which this version does not have.`
  }
  if (!isFeatureList(save.features ?? [])) return 'This save lists experimental rules this version does not have.'
  if (!isValidSeed(save.seed)) return 'This save has an invalid seed.'
  return null
}

/** How often (ms) the slow data rides along while the clock runs. */
export const SLOW_INTERVAL_MS = 250
/** Replay ticks per call to the replay job, and how long a slice of a load may run before it yields to messages. */
const SLICE_TICKS = 200
export const LOAD_SLICE_MS = 40
/** How often (ms) a heat snapshot is sent while the clock runs and a layer is on. */
export const HEAT_INTERVAL_MS = 250
/** Most commands one `commands` message may carry; the rest of a longer list is refused. */
export const MAX_BATCH = 500
export const BATCH_KIND_REASON = 'A batch can only place nodes and bots.'
export const BATCH_SIZE_REASON = `A batch holds at most ${MAX_BATCH} commands.`
/** Largest answer to a family query, whatever the page asks. */
const MAX_QUERY_NODES = 2000
const MAX_QUERY_DEPTH = 50

/** The founders' mean resistance and the mean and highest among the living, or null before the gene exists. */
function resistanceStats(world: World): ResistanceStats | null {
  if (world.resistance === undefined) return null
  let sum = 0
  let count = 0
  let max: number | null = null
  for (const bot of world.bots) {
    if (bot.resist === undefined) continue
    sum += bot.resist
    count += 1
    if (max === null || bot.resist > max) max = bot.resist
  }
  return { founderMean: world.resistance.founderMean, mean: count === 0 ? null : sum / count, max }
}

/**
 * The frame for a world as it stands. The parts are the world's own objects (not copies), except the bots,
 * which are packed into fresh typed arrays; posting the frame (structured clone, with `transferListOf` for the
 * arrays) is what separates the rest from the live world.
 */
export function buildFrame(world: World, run: RunInfo, selectedId: number | null, slow: boolean): Frame {
  return {
    run,
    fast: {
      tick: world.tick,
      nodes: world.nodes,
      bots: packBots(world.bots),
      events: world.events,
      totalBirths: world.totalBirths,
      inbredBirths: world.inbredBirths,
      deathsByCause: world.deathsByCause,
      eaten: world.eaten,
      familyLearned: world.familyLearned,
      commandCount: world.commands.length,
      lineageLength: world.lineage.length,
      ecology: world.ecology ?? null,
      disease: world.disease === undefined ? null : { infected: world.disease.infected, recovered: world.disease.recovered },
      resistance: resistanceStats(world),
      culture: world.culture === undefined ? null : { taught: world.culture.taught },
    },
    slow: slow
      ? {
          samples: world.samples,
          log: world.log,
          commands: world.commands,
          selectedBot: selectedId === null ? null : (findBot(world, selectedId) ?? null),
        }
      : null,
  }
}

export type SimHost = {
  /** Handles one message from the page; returns the replies, in the order to send them. */
  handle(msg: ToWorker): FromWorker[]
  /** Runs one slice of the load in progress (nothing when there is none) and returns the progress or the end. */
  pumpLoad(): FromWorker[]
  /** True while a load is in progress, so the adapter keeps calling `pumpLoad`. */
  readonly loading: boolean
  /** The live world, for tests and the adapter's error path. Never hand it to the page. */
  readonly world: World
  /** The live heat grid, for tests. Never hand it to the page (it gets snapshots). */
  readonly heat: HeatGrid
}

export type HostOptions = {
  rules?: Rules
  /** Milliseconds from any fixed start. Defaults to `performance.now`. */
  now?: () => number
  /** How often the slow data rides along (default `SLOW_INTERVAL_MS`). */
  slowIntervalMs?: number
  /** How long one slice of a load may run (default `LOAD_SLICE_MS`). */
  loadSliceMs?: number
  /** How often (ms) a heat snapshot is sent while the clock runs (default `HEAT_INTERVAL_MS`). */
  heatIntervalMs?: number
}

export function createSimHost(options: HostOptions = {}): SimHost {
  const baseRules = options.rules ?? defaultRules
  /** The base rules with a run's experimental rules on (the base itself when there are none). */
  const rulesFor = (list: readonly WorldFeature[]): Rules => (baseRules === defaultRules ? featureRules(list) : rulesWithFeatures(baseRules, list))
  const now = options.now ?? ((): number => performance.now())
  const slowIntervalMs = options.slowIntervalMs ?? SLOW_INTERVAL_MS
  const loadSliceMs = options.loadSliceMs ?? LOAD_SLICE_MS
  const heatIntervalMs = options.heatIntervalMs ?? HEAT_INTERVAL_MS

  let features: WorldFeature[] = []
  let runRules = rulesFor(features)
  let world = createWorld(DEFAULT_SEED, edenPreset, runRules)
  let presetId: string = edenPreset.id
  let runId = 0
  let selectedId: number | null = null
  let lastSlowAt = Number.NEGATIVE_INFINITY
  let load: { job: ReplayJob; save: Save; heat: HeatGrid } | null = null
  let heat = createHeat(world.width, world.height)
  let heatLayer: HeatLayer | null = null
  let heatRange: HeatRange = 'all'
  let lastHeatAt = Number.NEGATIVE_INFINITY

  /** The heat snapshot to send now, or nothing: no layer is on, or it is not yet time (unless `force`). */
  const heatMessages = (force: boolean): FromWorker[] => {
    if (heatLayer === null) return []
    const t = now()
    if (!force && t - lastHeatAt < heatIntervalMs) return []
    lastHeatAt = t
    return [{ type: 'heatSnapshot', heat: snapshotHeat(heat, heatLayer, heatRange, runId) }]
  }

  const frame = (forceSlow: boolean): Frame => {
    const t = now()
    const slow = forceSlow || t - lastSlowAt >= slowIntervalMs
    if (slow) lastSlowAt = t
    return buildFrame(world, { runId, seed: world.seed, presetId, features, width: world.width, height: world.height }, selectedId, slow)
  }

  const kept = (message: string): string => `${message} Your current run was kept.`

  function startLoad(save: Save): FromWorker[] {
    if (load !== null) return [{ type: 'loadDone', outcome: { status: 'failed', message: kept('Another saved run is still loading.') } }]
    const problem = checkLoad(save)
    const preset = findPreset(save.presetId)
    if (problem !== null || preset === undefined) {
      return [{ type: 'loadDone', outcome: { status: 'failed', message: kept(problem ?? 'This save has an unknown preset.') } }]
    }
    try {
      // The replay builds its own heat grid, observing the same moments as the live host does.
      const loadHeat = createHeat(preset.width, preset.height)
      const wanted = save.features ?? []
      const job = createReplayJob(save.seed, presetWithFeatures(preset, wanted), rulesFor(wanted), save.commands, save.tick, (replayed) => observeWorld(loadHeat, replayed))
      load = { job, save, heat: loadHeat }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error'
      return [{ type: 'loadDone', outcome: { status: 'failed', message: kept(`This save could not be started (${reason}).`) } }]
    }
    return [{ type: 'loadProgress', tick: 0, target: save.tick }]
  }

  function pumpLoad(): FromWorker[] {
    const current = load
    if (current === null) return []
    const { job, save } = current
    try {
      const started = now()
      do {
        job.run(SLICE_TICKS)
      } while (!job.finished && now() - started < loadSliceMs)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error'
      load = null
      return [{ type: 'loadDone', outcome: { status: 'failed', message: replayFailureMessage(save.sim, reason) } }]
    }
    if (!job.finished) return [{ type: 'loadProgress', tick: job.tick, target: job.target }]
    // Complete: only now does the new world replace the old one.
    const hashMatches = stateHash(job.world) === save.hash
    world = job.world
    heat = current.heat
    presetId = save.presetId
    features = [...(save.features ?? [])]
    runRules = rulesFor(features)
    runId += 1
    selectedId = null
    load = null
    return [
      { type: 'frame', frame: frame(true) },
      ...heatMessages(true),
      { type: 'loadDone', outcome: { status: 'loaded', hashMatches, seed: save.seed, tick: save.tick, commandCount: save.commands.length } },
    ]
  }

  function answer(msg: Extract<ToWorker, { type: 'query' }>): QueryAnswer {
    if (msg.kind === 'founders') return { kind: 'founders', lines: founderLines(world) }
    const clamp = (value: number, max: number): number => Math.min(max, Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)))
    const maxChildren = msg.maxChildren === undefined ? undefined : clamp(msg.maxChildren, MAX_QUERY_NODES)
    return {
      kind: 'family',
      view: familyView(world, msg.id, clamp(msg.up, MAX_QUERY_DEPTH), clamp(msg.down, MAX_QUERY_DEPTH), clamp(msg.maxNodes, MAX_QUERY_NODES), maxChildren),
    }
  }

  function handle(msg: ToWorker): FromWorker[] {
    switch (msg.type) {
      case 'advance': {
        if (load === null && Number.isFinite(msg.ticks)) {
          for (let i = Math.floor(msg.ticks); i > 0; i -= 1) {
            step(world, runRules)
            observeWorld(heat, world)
          }
        }
        return [{ type: 'frame', frame: frame(msg.slow === true), ack: 'advance' }, ...heatMessages(msg.slow === true)]
      }
      case 'command': {
        const meteorBefore = world.deathsByCause.meteor
        const result: CommandResult = load !== null ? { ok: false, reason: LOADING_REASON } : applyCommand(world, runRules, msg.cmd)
        // A meteor kills at command time, so the heat must see the world right after a command, too.
        if (result.ok) observeWorld(heat, world)
        return [
          { type: 'frame', frame: frame(true) },
          { type: 'commandResult', reqId: msg.reqId, result, meteorKills: world.deathsByCause.meteor - meteorBefore },
          ...heatMessages(true),
        ]
      }
      case 'commands': {
        // Bulk placing (M19): the same applyCommand as a single command, so every command is recorded as usual; the
        // frame, the heat observation and the heat snapshot are done once for the whole batch.
        let anyApplied = false
        const results: CommandResult[] = msg.cmds.map((cmd, index): CommandResult => {
          if (load !== null) return { ok: false, reason: LOADING_REASON }
          if (index >= MAX_BATCH) return { ok: false, reason: BATCH_SIZE_REASON }
          if (cmd.type !== 'placeNode' && cmd.type !== 'placeBot') return { ok: false, reason: BATCH_KIND_REASON }
          const result = applyCommand(world, runRules, cmd)
          if (result.ok) anyApplied = true
          return result
        })
        if (anyApplied) observeWorld(heat, world)
        return [{ type: 'frame', frame: frame(true) }, { type: 'commandsResult', reqId: msg.reqId, results }, ...heatMessages(true)]
      }
      case 'reset': {
        const preset = findPreset(msg.presetId ?? edenPreset.id)
        const wanted: unknown = msg.features ?? []
        if (load === null && preset !== undefined && isValidSeed(msg.seed) && isFeatureList(wanted)) {
          features = [...wanted]
          runRules = rulesFor(features)
          world = createWorld(msg.seed, presetWithFeatures(preset, features), runRules)
          heat = createHeat(world.width, world.height)
          presetId = preset.id
          runId += 1
          selectedId = null
        }
        return [{ type: 'frame', frame: frame(true) }, ...heatMessages(true)]
      }
      case 'load':
        return startLoad(msg.save)
      case 'cancelLoad': {
        if (load === null) return []
        load = null
        return [{ type: 'loadDone', outcome: { status: 'cancelled' } }]
      }
      case 'exportSave':
        return [{ type: 'save', reqId: msg.reqId, save: makeSave(world, presetId, stateHash(world), SIM_VERSION, features) }]
      case 'select':
        selectedId = typeof msg.id === 'number' ? msg.id : null
        return [{ type: 'frame', frame: frame(true) }]
      case 'query':
        return [{ type: 'queryResult', reqId: msg.reqId, ...answer(msg) }]
      case 'heat':
        // Anything that is not a known layer or range means "none" and "all time".
        heatLayer = HEAT_LAYERS.find((layer) => layer === msg.layer) ?? null
        heatRange = HEAT_RANGES.find((range) => range === msg.range) ?? 'all'
        return heatMessages(true)
      case 'sync':
        return [{ type: 'synced', reqId: msg.reqId }]
    }
  }

  return {
    handle,
    pumpLoad,
    get loading() {
      return load !== null
    },
    get world() {
      return world
    },
    get heat() {
      return heat
    },
  }
}

/**
 * Wires a host to a way of sending messages: `receive` takes a message from the page, sends the replies, and keeps
 * `pumpLoad` going (one slice per timer tick, so a `cancelLoad` that arrives meanwhile is handled between slices).
 * The worker adapter and the inline client both use this. A message that makes the host throw is answered with an `error`
 * message (the page then stops its clock rather than wait for a frame that will not come).
 */
export function createHostRunner(
  post: (msg: FromWorker) => void,
  options: HostOptions & { host?: SimHost; schedule?: (run: () => void) => void } = {},
): { receive(msg: ToWorker): void; host: SimHost } {
  const host = options.host ?? createSimHost(options)
  const schedule = options.schedule ?? ((run: () => void): void => void setTimeout(run, 0))
  let pumping = false

  const send = (messages: FromWorker[]): void => {
    for (const message of messages) post(message)
  }
  const guard = (work: () => FromWorker[]): FromWorker[] => {
    try {
      return work()
    } catch (error) {
      return [{ type: 'error', message: error instanceof Error ? error.message : 'unknown error' }]
    }
  }
  const pump = (): void => {
    pumping = false
    send(guard(() => host.pumpLoad()))
    keepPumping()
  }
  const keepPumping = (): void => {
    if (!host.loading || pumping) return
    pumping = true
    schedule(pump)
  }

  return {
    host,
    receive(msg: ToWorker): void {
      send(guard(() => host.handle(msg)))
      keepPumping()
    },
  }
}
