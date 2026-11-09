// UI session: the live World plus speed, pause, the active tool and the
// selection, shared through useSyncExternalStore (same pattern as
// trading-sim's store). The World is advanced in place by `advance`, so the
// snapshot copies the few numbers the panels need and hands out the World
// itself for the canvas to draw. A new snapshot object is published on every
// change, which is what wakes React.
//
// Player actions go through `dispatch`, which applies a Command to the live
// world (between two ticks) and leaves a notice for the toolbar to show.
// `clickMap` is what a click on the map means for the active tool (the plague and
// meteor tools trigger a world event where you click).
//
// Saving and loading (M9): `exportSave` turns the run into a Save (seed, preset,
// commands, tick, hash). `startLoad` rebuilds a saved run in slices (replayJob.ts)
// so the page stays alive, shows progress, can be cancelled, and only swaps the new
// world in once it is complete and checked. The old run is untouched until then
// and is kept if the load fails or is cancelled. While a load runs the clock and
// the player's tools are stopped, so the old run cannot change under it.

import { useSyncExternalStore } from 'react'
import { edenPreset, findPreset, rules } from '../content/index.ts'
import { makeSave } from '../persist/save.ts'
import type { Save } from '../persist/save.ts'
import { applyCommand } from '../sim/commands.ts'
import type { CommandResult } from '../sim/commands.ts'
import { stateHash } from '../sim/hash.ts'
import { step } from '../sim/step.ts'
import type { Command, DeathsByCause, World } from '../sim/types.ts'
import { createWorld, totalDeaths, totalFood } from '../sim/world.ts'
import { startedMessage } from './eventInfo.ts'
import { cellCenter, nodeAt, pickAt } from './geometry.ts'
import { formatPoint } from './labels.ts'
import { createReplayJob } from './replayJob.ts'
import type { ReplayJob } from './replayJob.ts'
import { toolInfo } from './tools.ts'
import type { Selection, Tool } from './tools.ts'

export const SPEEDS = [1, 4, 16, 64] as const
export type Speed = (typeof SPEEDS)[number]

export const DEFAULT_SEED = 'a'
const DEFAULT_SPEED: Speed = 1

const SEED_PATTERN = /^[A-Za-z0-9-]{1,32}$/

/** The same rule the CLI uses: 1 to 32 letters, digits or dashes. */
export function isValidSeed(seed: string): boolean {
  return SEED_PATTERN.test(seed)
}

/** The last thing a tool did, for the toolbar to say out loud. `seq` changes on every notice. */
export type Notice = { seq: number; ok: boolean; text: string }

/** The last save or load result, for the save panel to say out loud. `seq` changes on every notice. */
export type SaveNotice = { seq: number; level: 'ok' | 'warn' | 'error'; text: string }

/** A load in progress: how far the replay has got. */
export type LoadProgress = { tick: number; target: number }

export type LoadOutcome =
  | { status: 'loaded'; hashMatches: boolean }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }

export const MISMATCH_WARNING = 'This save was made by a different version of the simulation; the run may differ.'

export type WorldSnapshot = {
  world: World
  seed: string
  presetId: string
  /** Changes whenever a different run replaces the current one (new world, or a load). */
  runId: number
  tick: number
  population: number
  births: number
  deaths: number
  deathsByCause: DeathsByCause
  food: number
  /** Player commands applied so far in this run. */
  commandCount: number
  speed: Speed
  paused: boolean
  tool: Tool
  selection: Selection | null
  notice: Notice | null
  saveNotice: SaveNotice | null
  /** Non-null while a saved run is being rebuilt. */
  load: LoadProgress | null
  /** How far between the last two ticks the picture is, 0 to 1. Always 1 while paused. */
  alpha: number
}

type Listener = () => void

const listeners = new Set<Listener>()
let world: World = createWorld(DEFAULT_SEED, edenPreset, rules)
let speed: Speed = DEFAULT_SPEED
let paused = false
let alpha = 1
let tool: Tool = 'inspect'
let selection: Selection | null = null
let notice: Notice | null = null
let noticeSeq = 0
let presetId: string = edenPreset.id
let runId = 0
let saveNotice: SaveNotice | null = null
let saveNoticeSeq = 0
let load: {
  job: ReplayJob
  save: Save
  timer: ReturnType<typeof setTimeout> | null
  done: (outcome: LoadOutcome) => void
} | null = null
let snapshot: WorldSnapshot = makeSnapshot()

function makeSnapshot(): WorldSnapshot {
  return {
    world,
    seed: world.seed,
    presetId,
    runId,
    tick: world.tick,
    population: world.bots.length,
    births: world.totalBirths,
    deaths: totalDeaths(world),
    deathsByCause: { ...world.deathsByCause },
    food: totalFood(world),
    commandCount: world.commands.length,
    speed,
    paused,
    tool,
    selection,
    notice,
    saveNotice,
    load: load === null ? null : { tick: load.job.tick, target: load.job.target },
    alpha,
  }
}

function publish(): void {
  snapshot = makeSnapshot()
  for (const listener of listeners) listener()
}

function say(ok: boolean, text: string): void {
  noticeSeq += 1
  notice = { seq: noticeSeq, ok, text }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSnapshot(): WorldSnapshot {
  return snapshot
}

export function useWorldStore(): WorldSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Runs `ticks` ticks (the loop passes none on a frame with no tick due) and shows the picture `progress` of the way to the next one. */
export function advance(ticks: number, progress: number): void {
  if (load !== null) return
  for (let i = 0; i < ticks; i += 1) step(world, rules)
  alpha = progress
  publish()
}

export function setSpeed(next: Speed): void {
  if (next === speed) return
  speed = next
  publish()
}

export function setPaused(next: boolean): void {
  if (next === paused) return
  paused = next
  if (paused) alpha = 1
  publish()
}

/** One tick, only while paused. */
export function stepOnce(): void {
  if (!paused) return
  advance(1, 1)
}

export function setTool(next: Tool): void {
  if (next === tool) return
  tool = next
  notice = null
  publish()
}

export function select(next: Selection | null): void {
  if (next?.kind === selection?.kind && next?.id === selection?.id) return
  selection = next
  publish()
}

const LOADING_REASON = 'A saved run is loading. Wait for it or cancel it first.'

function describeApplied(cmd: Command, id: number, killed: number): string {
  switch (cmd.type) {
    case 'triggerEvent':
      return startedMessage(cmd, rules.tuning, killed)
    case 'placeNode':
      return `Placed ${cmd.kind} #${id} at ${formatPoint(cmd.x, cmd.y)}.`
    case 'placeBot':
      return `Placed bot #${id} at ${formatPoint(cmd.x, cmd.y)}.`
    case 'removeNode':
      return `Removed node #${id}.`
  }
}

/** Applies a player command to the live world and publishes. A rejected command changes nothing but the notice. */
export function dispatch(cmd: Command): CommandResult {
  if (load !== null) {
    say(false, LOADING_REASON)
    publish()
    return { ok: false, reason: LOADING_REASON }
  }
  const meteorDeaths = world.deathsByCause.meteor
  const result = applyCommand(world, rules, cmd)
  say(result.ok, result.ok ? describeApplied(cmd, result.id, world.deathsByCause.meteor - meteorDeaths) : result.reason)
  publish()
  return result
}

/**
 * What a click at map position (x, y) does for the active tool. Placements snap to the centre of the
 * clicked cell. `reach` is how far (in cells) an inspect click may miss a bot.
 */
export function clickMap(x: number, y: number, reach: number): void {
  if (load !== null && tool !== 'inspect') {
    say(false, LOADING_REASON)
    publish()
    return
  }
  const centre = cellCenter({ cx: Math.floor(x), cy: Math.floor(y) })
  switch (tool) {
    case 'inspect':
      select(pickAt(world, x, y, paused ? 1 : alpha, reach))
      return
    case 'resource':
    case 'water':
    case 'danger':
    case 'shelter':
      dispatch({ type: 'placeNode', kind: toolInfo(tool).nodeKind ?? tool, x: centre.x, y: centre.y })
      return
    case 'bot':
      dispatch({ type: 'placeBot', x: centre.x, y: centre.y })
      return
    case 'plague':
    case 'meteor':
      dispatch({ type: 'triggerEvent', event: tool, x: centre.x, y: centre.y })
      return
    case 'remove': {
      const target = nodeAt(world, x, y)
      if (target === undefined) {
        say(false, 'No node here to remove. Click inside a node.')
        publish()
        return
      }
      dispatch({ type: 'removeNode', id: target.id })
      return
    }
  }
}

/** Starts a fresh eden world for `seed`. Returns false (and changes nothing) for an invalid seed. */
export function resetWorld(seed: string): boolean {
  if (!isValidSeed(seed) || load !== null) return false
  world = createWorld(seed, edenPreset, rules)
  presetId = edenPreset.id
  runId += 1
  saveNotice = null
  selection = null
  alpha = 1
  say(true, `Started a new world with seed "${seed}".`)
  publish()
  return true
}

/** The current run as a Save. Hashes the whole world, so call it on a click or a timer, not every frame. */
export function exportSave(): Save {
  return makeSave(world, presetId, stateHash(world))
}

/** Posts a save or load result for the save panel. */
export function reportSave(level: SaveNotice['level'], text: string): void {
  saveNoticeSeq += 1
  saveNotice = { seq: saveNoticeSeq, level, text }
  publish()
}

/** Replay ticks per slice, and how long a slice may run before the page gets control back. */
const SLICE_TICKS = 200
const SLICE_MS = 30

function pumpLoad(): void {
  const current = load
  if (current === null) return
  current.timer = null
  const { job, save } = current
  try {
    const started = performance.now()
    do {
      job.run(SLICE_TICKS)
    } while (!job.finished && performance.now() - started < SLICE_MS)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error'
    const message = `This save could not be replayed (${reason}). Your current run was kept.`
    load = null
    reportSave('error', message)
    current.done({ status: 'failed', message })
    return
  }
  if (!job.finished) {
    current.timer = setTimeout(pumpLoad, 0)
    publish()
    return
  }
  // Complete: only now does the new world replace the old one.
  const hashMatches = stateHash(job.world) === save.hash
  world = job.world
  presetId = save.presetId
  runId += 1
  selection = null
  alpha = 1
  paused = true
  load = null
  const commands = `${save.commands.length} command${save.commands.length === 1 ? '' : 's'}`
  const loaded = `Loaded seed "${save.seed}" at tick ${save.tick} with ${commands}. The run is paused.`
  reportSave(hashMatches ? 'ok' : 'warn', hashMatches ? loaded : `${loaded} ${MISMATCH_WARNING}`)
  current.done({ status: 'loaded', hashMatches })
}

/**
 * Rebuilds a saved run in slices and swaps it in when complete. Resolves when the load ends: loaded
 * (paused at the saved tick; `hashMatches` false means the simulation differs from the one that saved it),
 * cancelled, or failed. A failed or cancelled load leaves the current run exactly as it was.
 */
export function startLoad(save: Save): Promise<LoadOutcome> {
  const refuse = (message: string): Promise<LoadOutcome> => {
    reportSave('error', `${message} Your current run was kept.`)
    return Promise.resolve({ status: 'failed', message })
  }
  if (load !== null) return refuse('Another saved run is still loading.')
  const preset = findPreset(save.presetId)
  if (preset === undefined) return refuse(`This save needs the "${save.presetId}" preset, which this version does not have.`)
  if (!isValidSeed(save.seed)) return refuse('This save has an invalid seed.')
  return new Promise<LoadOutcome>((resolve) => {
    saveNotice = null
    load = {
      job: createReplayJob(save.seed, preset, rules, save.commands, save.tick),
      save,
      timer: null,
      done: resolve,
    }
    load.timer = setTimeout(pumpLoad, 0)
    publish()
  })
}

/** Stops a load in progress. The current run is kept. */
export function cancelLoad(): void {
  const current = load
  if (current === null) return
  if (current.timer !== null) clearTimeout(current.timer)
  load = null
  reportSave('ok', 'Loading cancelled. Your current run was kept.')
  current.done({ status: 'cancelled' })
}
