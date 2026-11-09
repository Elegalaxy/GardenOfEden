// A replay that can be run in slices, so loading a long save can be cancelled and
// report progress (the simulation host runs it, in the worker, since M13). It does exactly what `replayWorld` does (same calls in the same order, so
// the same `stateHash`), but `run(maxTicks)` stops after a number of ticks and the
// caller comes back later. The sim stays pure; only the slicing lives here.

import { applyCommand } from '../sim/commands.ts'
import type { RecordedCommand } from '../sim/replay.ts'
import { step } from '../sim/step.ts'
import type { Preset, Rules, World } from '../sim/types.ts'
import { createWorld } from '../sim/world.ts'

export type ReplayJob = {
  /** The world being rebuilt. Only trust it once `finished` is true. */
  readonly world: World
  readonly finished: boolean
  /** Ticks run so far. */
  readonly tick: number
  /** The tick the job stops at. */
  readonly target: number
  /** Runs up to `maxTicks` ticks (commands cost nothing). Throws if the replay rejects a command. */
  run(maxTicks: number): void
}

export function createReplayJob(
  seed: string,
  preset: Preset,
  rules: Rules,
  commands: readonly RecordedCommand[],
  target: number,
): ReplayJob {
  const world = createWorld(seed, preset, rules)
  let next = 0
  let finished = false

  const job: ReplayJob = {
    world,
    get finished() {
      return finished
    },
    get tick() {
      return world.tick
    },
    target,
    run(maxTicks: number): void {
      let budget = Math.max(1, Math.floor(maxTicks))
      while (!finished) {
        const recorded = commands[next]
        if (recorded !== undefined) {
          if (recorded.tick < world.tick) {
            throw new Error(`commands must be in tick order: tick ${recorded.tick} comes after tick ${world.tick}`)
          }
          if (recorded.tick > target) {
            throw new Error(`a command at tick ${recorded.tick} comes after the saved tick ${target}`)
          }
          if (world.tick < recorded.tick) {
            if (budget === 0) return
            step(world, rules)
            budget -= 1
          } else {
            const result = applyCommand(world, rules, recorded.cmd)
            if (!result.ok) throw new Error(`the command at tick ${recorded.tick} was refused: ${result.reason}`)
            next += 1
          }
        } else if (world.tick < target) {
          if (budget === 0) return
          step(world, rules)
          budget -= 1
        } else {
          finished = true
        }
      }
    },
  }
  return job
}
