// UI session: the page's copy of the world plus speed, pause, the active tool and the
// selection, shared through useSyncExternalStore (same pattern as trading-sim's store).
// Since M13 the simulation itself runs in a Web Worker (sim.worker.ts, logic in simHost.ts);
// this store talks to it through a SimClient (simClient.ts) with the messages in protocol.ts,
// and keeps a `ViewWorld` built from the frames it sends back (viewWorld.ts). The mirror is
// updated in place, a new snapshot object is published on every change, and that is what
// wakes React.
//
// The clock stays here (loop.ts): `advance(ticks, progress)` is called every frame with the
// ticks that are due. At most one advance is in flight; ticks that fall due meanwhile pile up
// (capped) and go out together, so a worker that cannot keep up slows the run instead of
// flooding its queue. The picture's progress between ticks (`alpha`) is applied when the frame
// that matches it arrives, so bots never jump backwards.
//
// Player actions go through `dispatch`, which asks the worker to apply a Command between two
// ticks and resolves with its result (and leaves a notice for the toolbar to show). The hover
// ghost's `checkCommand` runs on the mirror, here on the page. `clickMap` is what a click on
// the map means for the active tool (the plague and meteor tools trigger a world event where
// you click).
//
// Saving and loading (M9): `exportSave` asks the worker for the run as a Save (the state hash
// is computed there). `startLoad` hands a Save to the worker, which rebuilds the run in slices,
// reports progress, can be cancelled, and only swaps the new world in once it is complete and
// checked; the old run is untouched until then and is kept if the load fails or is cancelled.
// While a load runs the clock and the player's tools are stopped.
//
// Heatmaps (M15): `setHeatLayer` / `setHeatRange` / `cycleHeatLayer` say which layer of the heat grid (heat.ts) the map
// shows and how (all time or recent). The worker accumulates the heat whether or not a layer is on and sends a compact
// `heatSnapshot` only while one is; the latest matching one is `snapshot.heat`. The cell under the pointer is kept in a
// small store of its own (`setHoverCell`, `useHoverCell`) so moving the mouse does not wake every panel.
//
// Everything that changes the run is a message, so it is answered later: tests use
// `settled()` to wait until every earlier message has been answered.

import { useSyncExternalStore } from 'react'
import { edenPreset, rules } from '../content/index.ts'
import type { Save } from '../persist/save.ts'
import type { CommandResult } from '../sim/commands.ts'
import type { FamilyView, FounderLine } from '../sim/lineage.ts'
import type { Command, DeathsByCause } from '../sim/types.ts'
import { createWorld, totalDeaths, totalFood } from '../sim/world.ts'
import { startedMessage } from './eventInfo.ts'
import { cellCenter, nodeAt, pickAt } from './geometry.ts'
import type { Cell } from './geometry.ts'
import { nextHeatLayer } from './heat.ts'
import type { HeatLayer, HeatRange, HeatSnapshot } from './heat.ts'
import { formatPoint } from './labels.ts'
import type { FromWorker, Frame, ToWorker } from './protocol.ts'
import { DEFAULT_SEED, LOADING_REASON, checkLoad, isValidSeed } from './simHost.ts'
import { createInlineClient, createWorkerClient } from './simClient.ts'
import type { SimClient } from './simClient.ts'
import { toolInfo } from './tools.ts'
import type { Selection, Tool } from './tools.ts'
import { applyFrame, toViewWorld } from './viewWorld.ts'
import type { ViewWorld } from './viewWorld.ts'

export { DEFAULT_SEED, isValidSeed }

export const SPEEDS = [1, 4, 16, 64] as const
export type Speed = (typeof SPEEDS)[number]

const DEFAULT_SPEED: Speed = 1

/** Most ticks that may pile up while an advance is in flight. The same cap as the loop's per-frame cap (loop.test.ts checks they match). */
export const MAX_PENDING_TICKS = 200

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
  /** The page's copy of the world (see viewWorld.ts); updated in place. */
  world: ViewWorld
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
  /** Where the simulation runs: a real Worker, or the page's own thread (tests, or no Worker available). */
  engine: 'worker' | 'inline'
  /** The heatmap layer the map shows, or null for none; and whether it counts all time or only recent events. */
  heatLayer: HeatLayer | null
  heatRange: HeatRange
  /**
   * The latest heat snapshot for this layer and range and the current run, or null (none on, or the first one has not
   * arrived yet). Replaced about four times a second while running; its identity says when it changed.
   */
  heat: HeatSnapshot | null
}

type Listener = () => void

const listeners = new Set<Listener>()
let view: ViewWorld = toViewWorld(createWorld(DEFAULT_SEED, edenPreset, rules), edenPreset.id)
let speed: Speed = DEFAULT_SPEED
let paused = false
let alpha = 1
let tool: Tool = 'inspect'
let selection: Selection | null = null
let notice: Notice | null = null
let noticeSeq = 0
let saveNotice: SaveNotice | null = null
let saveNoticeSeq = 0
let load: (LoadProgress & { done: (outcome: LoadOutcome) => void }) | null = null
let heatLayer: HeatLayer | null = null
let heatRange: HeatRange = 'all'
let heat: HeatSnapshot | null = null

// The clock's side of the conversation with the worker.
/** Ticks that fell due while an advance was in flight. */
let due = 0
/** The picture progress of the latest frame the loop planned. */
let latestAlpha = 1
/** One entry per advance message not yet answered: the progress to show with its frame (null: leave it alone). */
const sentAlphas: (number | null)[] = []
const idleWaiters: (() => void)[] = []

type Pending = { resolve: (msg: FromWorker) => void; reject: (error: Error) => void }
const pending = new Map<number, Pending>()
let requestSeq = 0

let client: SimClient
let snapshot: WorldSnapshot = makeSnapshot()

function makeSnapshot(): WorldSnapshot {
  return {
    world: view,
    seed: view.seed,
    presetId: view.presetId,
    runId: view.runId,
    tick: view.tick,
    population: view.bots.length,
    births: view.totalBirths,
    deaths: totalDeaths(view),
    deathsByCause: { ...view.deathsByCause },
    food: totalFood(view),
    commandCount: view.commandCount,
    speed,
    paused,
    tool,
    selection,
    notice,
    saveNotice,
    load: load === null ? null : { tick: load.tick, target: load.target },
    alpha,
    engine: client === undefined ? 'inline' : client.kind,
    heatLayer,
    heatRange,
    // A snapshot of the run before a reset or a load is not shown for the new one.
    heat: heat !== null && heat.runId === view.runId ? heat : null,
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

/** Where the simulation runs. Only changes if a worker had to fall back, so using it does not re-render every frame. */
export function useEngine(): WorldSnapshot['engine'] {
  return useSyncExternalStore(subscribe, () => getSnapshot().engine, () => getSnapshot().engine)
}

/**
 * One value out of the snapshot. The component re-renders only when the value changes (compared with `Object.is`), so pick
 * something stable (a number, a boolean, the selection object), not a fresh object: the snapshot itself changes every frame.
 */
export function useStoreValue<T>(pick: (snapshot: WorldSnapshot) => T): T {
  return useSyncExternalStore(subscribe, () => pick(getSnapshot()), () => pick(getSnapshot()))
}

// ---- Talking to the worker ----

/** Sends a message that is answered by one carrying the same `reqId`. */
function ask(make: (reqId: number) => ToWorker): Promise<FromWorker> {
  return new Promise((resolve, reject) => {
    requestSeq += 1
    pending.set(requestSeq, { resolve, reject })
    client.post(make(requestSeq))
  })
}

function settleIdle(): void {
  if (due !== 0 || sentAlphas.length !== 0) return
  for (const resolve of idleWaiters.splice(0)) resolve()
}

/** Sends the ticks that piled up, if nothing is in flight. */
function pumpAdvance(): void {
  if (load !== null || due === 0 || sentAlphas.length > 0) return
  const ticks = due
  due = 0
  sentAlphas.push(latestAlpha)
  client.post({ type: 'advance', ticks, slow: paused })
}

function onFrame(frame: Frame, acksAdvance: boolean): void {
  view = applyFrame(view, frame)
  if (acksAdvance) {
    const sent = sentAlphas.shift()
    if (paused) alpha = 1
    else if (sent !== undefined && sent !== null) alpha = sent
  }
  publish()
  if (acksAdvance) {
    pumpAdvance()
    settleIdle()
  }
}

function onLoadDone(outcome: Extract<FromWorker, { type: 'loadDone' }>['outcome']): void {
  const current = load
  if (current === null) return
  load = null
  switch (outcome.status) {
    case 'loaded': {
      // The new run's frame arrived just before this message. It starts paused at the saved tick.
      paused = true
      selection = null
      alpha = 1
      due = 0
      const commands = `${outcome.commandCount} command${outcome.commandCount === 1 ? '' : 's'}`
      const loaded = `Loaded seed "${outcome.seed}" at tick ${outcome.tick} with ${commands}. The run is paused.`
      reportSave(outcome.hashMatches ? 'ok' : 'warn', outcome.hashMatches ? loaded : `${loaded} ${MISMATCH_WARNING}`)
      current.done({ status: 'loaded', hashMatches: outcome.hashMatches })
      return
    }
    case 'cancelled':
      reportSave('ok', 'Loading cancelled. Your current run was kept.')
      current.done({ status: 'cancelled' })
      return
    case 'failed':
      reportSave('error', outcome.message)
      current.done({ status: 'failed', message: outcome.message })
      return
  }
}

/** The worker could not carry on (it threw, or died): stop the clock and fail whatever waits on it. */
function onWorkerError(message: string): void {
  const error = new Error(message)
  for (const request of pending.values()) request.reject(error)
  pending.clear()
  due = 0
  sentAlphas.length = 0
  paused = true
  alpha = 1
  settleIdle()
  say(false, 'The simulation stopped. Reload the page to start again.')
  const current = load
  if (current !== null) {
    load = null
    current.done({ status: 'failed', message })
  }
  reportSave('error', `The simulation stopped unexpectedly (${message}). Reload the page.`)
}

function onMessage(msg: FromWorker): void {
  switch (msg.type) {
    case 'ready':
      return
    case 'frame':
      onFrame(msg.frame, msg.ack === 'advance')
      return
    case 'commandResult':
    case 'save':
    case 'queryResult':
    case 'synced': {
      const request = pending.get(msg.reqId)
      pending.delete(msg.reqId)
      request?.resolve(msg)
      return
    }
    case 'heatSnapshot':
      // Only the one asked for, for this run: a late answer to an earlier layer, range or run is dropped.
      if (msg.heat.layer === heatLayer && msg.heat.range === heatRange && msg.heat.runId === view.runId) {
        heat = msg.heat
        publish()
      }
      return
    case 'loadProgress':
      if (load !== null) {
        load.tick = msg.tick
        load.target = msg.target
        publish()
      }
      return
    case 'loadDone':
      onLoadDone(msg.outcome)
      return
    case 'error':
      onWorkerError(msg.message)
      return
  }
}

function connect(next: SimClient): void {
  client = next
  client.listen(onMessage)
  client.onFallback((reason) => {
    reportSave('warn', `${reason} The simulation runs on the page itself instead, so the page may stutter while a long run loads.`)
  })
}

/** Resolves once every message sent before this call has been answered and applied. */
export function settled(): Promise<void> {
  return ask((reqId) => ({ type: 'sync', reqId })).then(() => undefined)
}

// ---- The clock ----

/**
 * Runs `ticks` ticks (the loop passes none on a frame with no tick due) and shows the picture `progress`
 * of the way to the next one. Resolves when every tick asked for so far has been run and shown.
 */
export function advance(ticks: number, progress: number): Promise<void> {
  if (load !== null) return Promise.resolve()
  if (ticks > 0) due = Math.min(MAX_PENDING_TICKS, due + ticks)
  latestAlpha = progress
  if (due === 0 && sentAlphas.length === 0) {
    // Nothing to run and nothing on the way: only the progress between ticks changes.
    if (alpha !== progress) {
      alpha = progress
      publish()
    }
    return Promise.resolve()
  }
  const finished = new Promise<void>((resolve) => idleWaiters.push(resolve))
  pumpAdvance()
  return finished
}

export function setSpeed(next: Speed): void {
  if (next === speed) return
  speed = next
  publish()
}

export function setPaused(next: boolean): void {
  if (next === paused) return
  paused = next
  if (paused) {
    alpha = 1
    due = 0
    // Pausing asks for a full refresh, so the lists and charts are as fresh as the picture.
    sentAlphas.push(null)
    client.post({ type: 'advance', ticks: 0, slow: true })
  }
  publish()
}

/** One tick, only while paused. */
export function stepOnce(): Promise<void> {
  if (!paused) return Promise.resolve()
  return advance(1, 1)
}

// ---- Heatmaps ----

function sendHeatRequest(): void {
  client.post({ type: 'heat', layer: heatLayer, range: heatRange })
}

/** Shows a heatmap layer on the map, or none (null). The first snapshot comes back from the worker a moment later. */
export function setHeatLayer(next: HeatLayer | null): void {
  if (next === heatLayer) return
  heatLayer = next
  heat = null
  sendHeatRequest()
  publish()
}

export function setHeatRange(next: HeatRange): void {
  if (next === heatRange) return
  heatRange = next
  heat = null
  if (heatLayer !== null) sendHeatRequest()
  publish()
}

/** The H key: none, traffic, births, deaths, round again. */
export function cycleHeatLayer(): void {
  setHeatLayer(nextHeatLayer(heatLayer))
}

const hoverListeners = new Set<Listener>()
let hoverCell: Cell | null = null

/** The map cell under the pointer (or the keyboard cursor), or null. Kept outside the snapshot so moving the pointer re-renders only what reads it. */
export function setHoverCell(next: Cell | null): void {
  if (next === null ? hoverCell === null : hoverCell !== null && hoverCell.cx === next.cx && hoverCell.cy === next.cy) return
  hoverCell = next === null ? null : { cx: next.cx, cy: next.cy }
  for (const listener of hoverListeners) listener()
}

export function useHoverCell(): Cell | null {
  return useSyncExternalStore(
    (listener) => {
      hoverListeners.add(listener)
      return () => {
        hoverListeners.delete(listener)
      }
    },
    () => hoverCell,
    () => hoverCell,
  )
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
  client.post({ type: 'select', id: next?.kind === 'bot' ? next.id : null })
  publish()
}

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

/**
 * Asks the worker to apply a player command between two ticks, in the order sent. Resolves with its result once the
 * page's copy shows the effect. A rejected command changes nothing but the notice.
 */
export function dispatch(cmd: Command): Promise<CommandResult> {
  if (load !== null) {
    say(false, LOADING_REASON)
    publish()
    return Promise.resolve({ ok: false, reason: LOADING_REASON })
  }
  return ask((reqId) => ({ type: 'command', reqId, cmd })).then((msg) => {
    if (msg.type !== 'commandResult') return { ok: false, reason: 'No answer.' }
    const { result } = msg
    say(result.ok, result.ok ? describeApplied(cmd, result.id, msg.meteorKills) : result.reason)
    publish()
    return result
  })
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
      select(pickAt(view, x, y, paused ? 1 : alpha, reach))
      return
    case 'resource':
    case 'water':
    case 'danger':
    case 'shelter':
      void dispatch({ type: 'placeNode', kind: toolInfo(tool).nodeKind ?? tool, x: centre.x, y: centre.y })
      return
    case 'bot':
      void dispatch({ type: 'placeBot', x: centre.x, y: centre.y })
      return
    case 'plague':
    case 'meteor':
      void dispatch({ type: 'triggerEvent', event: tool, x: centre.x, y: centre.y })
      return
    case 'remove': {
      const target = nodeAt(view, x, y)
      if (target === undefined) {
        say(false, 'No node here to remove. Click inside a node.')
        publish()
        return
      }
      void dispatch({ type: 'removeNode', id: target.id })
      return
    }
  }
}

/**
 * Starts a fresh eden world for `seed`. Returns false (and changes nothing) for an invalid seed or while a load runs.
 * The new world appears when the worker's first frame for it arrives (use `settled()` to wait for it).
 */
export function resetWorld(seed: string): boolean {
  if (!isValidSeed(seed) || load !== null) return false
  due = 0
  saveNotice = null
  selection = null
  alpha = 1
  say(true, `Started a new world with seed "${seed}".`)
  client.post({ type: 'reset', seed })
  publish()
  return true
}

/** The current run as a Save. The worker hashes the whole world, so this never stalls the page, but do not ask every frame. */
export function exportSave(): Promise<Save> {
  return ask((reqId) => ({ type: 'exportSave', reqId })).then((msg) => {
    if (msg.type !== 'save') throw new Error('The simulation sent no save.')
    return msg.save
  })
}

/** The family around one bot, from the worker's lineage records (see familyView in sim/lineage.ts). The family panel (M14) reads this. */
export function queryFamily(id: number, up: number, down: number, maxNodes: number, maxChildren?: number): Promise<FamilyView | null> {
  return ask((reqId) => ({ type: 'query', reqId, kind: 'family', id, up, down, maxNodes, maxChildren })).then((msg) => {
    if (msg.type !== 'queryResult' || msg.kind !== 'family') throw new Error('The simulation sent no family.')
    return msg.view
  })
}

/** The roots of the family forest (see founderLines in sim/lineage.ts). */
export function queryFounders(): Promise<FounderLine[]> {
  return ask((reqId) => ({ type: 'query', reqId, kind: 'founders' })).then((msg) => {
    if (msg.type !== 'queryResult' || msg.kind !== 'founders') throw new Error('The simulation sent no founders.')
    return msg.lines
  })
}

/** Posts a save or load result for the save panel. */
export function reportSave(level: SaveNotice['level'], text: string): void {
  saveNoticeSeq += 1
  saveNotice = { seq: saveNoticeSeq, level, text }
  publish()
}

/**
 * Hands a saved run to the worker, which rebuilds it in slices and swaps it in when complete. Resolves when the load
 * ends: loaded (paused at the saved tick; `hashMatches` false means the simulation differs from the one that saved it),
 * cancelled, or failed. A failed or cancelled load leaves the current run exactly as it was.
 */
export function startLoad(save: Save): Promise<LoadOutcome> {
  const refuse = (message: string): Promise<LoadOutcome> => {
    reportSave('error', `${message} Your current run was kept.`)
    return Promise.resolve({ status: 'failed', message })
  }
  if (load !== null) return refuse('Another saved run is still loading.')
  const problem = checkLoad(save)
  if (problem !== null) return refuse(problem)
  return new Promise<LoadOutcome>((resolve) => {
    saveNotice = null
    due = 0
    load = { tick: 0, target: save.tick, done: resolve }
    client.post({ type: 'load', save })
    publish()
  })
}

/** Stops a load in progress. The current run is kept. The load resolves as cancelled when the worker confirms. */
export function cancelLoad(): void {
  if (load === null) return
  client.post({ type: 'cancelLoad' })
}

/**
 * Swaps the simulation client and starts over from the default world. For tests (a spy around an inline client,
 * a host with a fake clock); the app never calls it.
 */
export function setSimClient(next: SimClient): void {
  client.terminate()
  const error = new Error('The simulation client was replaced.')
  for (const request of pending.values()) request.reject(error)
  pending.clear()
  due = 0
  latestAlpha = 1
  sentAlphas.length = 0
  load = null
  view = toViewWorld(createWorld(DEFAULT_SEED, edenPreset, rules), edenPreset.id)
  paused = false
  alpha = 1
  selection = null
  notice = null
  saveNotice = null
  heatLayer = null
  heatRange = 'all'
  heat = null
  settleIdle()
  connect(next)
  publish()
}

connect(typeof window === 'undefined' ? createInlineClient() : createWorkerClient())
snapshot = makeSnapshot()

// Hot reload replaces this module; the old worker would otherwise keep running beside the new one.
import.meta.hot?.dispose(() => client.terminate())
