// UI session: the live World plus speed and pause state, shared through
// useSyncExternalStore (same pattern as trading-sim's store). The World is
// advanced in place by `advance`, so the snapshot copies the few numbers the
// readout needs and hands out the World itself for the canvas to draw. A new
// snapshot object is published on every change, which is what wakes React.

import { useSyncExternalStore } from 'react'
import { edenPreset, rules } from '../content/index.ts'
import { step } from '../sim/step.ts'
import type { DeathsByCause, World } from '../sim/types.ts'
import { createWorld, totalDeaths, totalFood } from '../sim/world.ts'

export const SPEEDS = [1, 4, 16, 64] as const
export type Speed = (typeof SPEEDS)[number]

const DEFAULT_SEED = 'a'
const DEFAULT_SPEED: Speed = 1

export type WorldSnapshot = {
  world: World
  tick: number
  population: number
  births: number
  deaths: number
  deathsByCause: DeathsByCause
  food: number
  speed: Speed
  paused: boolean
  /** How far between the last two ticks the picture is, 0 to 1. Always 1 while paused. */
  alpha: number
}

type Listener = () => void

const listeners = new Set<Listener>()
let world: World = createWorld(DEFAULT_SEED, edenPreset, rules)
let speed: Speed = DEFAULT_SPEED
let paused = false
let alpha = 1
let snapshot: WorldSnapshot = makeSnapshot()

function makeSnapshot(): WorldSnapshot {
  return {
    world,
    tick: world.tick,
    population: world.bots.length,
    births: world.totalBirths,
    deaths: totalDeaths(world),
    deathsByCause: { ...world.deathsByCause },
    food: totalFood(world),
    speed,
    paused,
    alpha,
  }
}

function publish(): void {
  snapshot = makeSnapshot()
  for (const listener of listeners) listener()
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
