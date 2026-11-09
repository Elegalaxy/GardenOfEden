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

import { useSyncExternalStore } from 'react'
import { edenPreset, rules } from '../content/index.ts'
import { applyCommand } from '../sim/commands.ts'
import type { CommandResult } from '../sim/commands.ts'
import { step } from '../sim/step.ts'
import type { Command, DeathsByCause, World } from '../sim/types.ts'
import { createWorld, totalDeaths, totalFood } from '../sim/world.ts'
import { startedMessage } from './eventInfo.ts'
import { cellCenter, nodeAt, pickAt } from './geometry.ts'
import { formatPoint } from './labels.ts'
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

export type WorldSnapshot = {
  world: World
  seed: string
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
let snapshot: WorldSnapshot = makeSnapshot()

function makeSnapshot(): WorldSnapshot {
  return {
    world,
    seed: world.seed,
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
  if (!isValidSeed(seed)) return false
  world = createWorld(seed, edenPreset, rules)
  selection = null
  alpha = 1
  say(true, `Started a new world with seed "${seed}".`)
  publish()
  return true
}
