// Replay: rebuild a run from its seed, preset and recorded commands. Each
// command is applied when the world has reached its tick (after that tick's
// step, before the next), which is exactly when the live run applied it, so
// the result has the same `stateHash` as the live world.

import { applyCommand } from './commands.ts'
import { step } from './step.ts'
import type { Command, Preset, Rules, World } from './types.ts'
import { createWorld } from './world.ts'

export type RecordedCommand = { tick: number; cmd: Command }

/**
 * Builds the world for `seed` and `preset`, applies `commands` (in order, each at its tick),
 * then steps on to `untilTick` (default: the last command's tick). Throws if a recorded
 * command is rejected, because a recording only holds accepted commands.
 */
export function replayWorld(
  seed: string,
  preset: Preset,
  rules: Rules,
  commands: readonly RecordedCommand[],
  untilTick?: number,
): World {
  const world = createWorld(seed, preset, rules)
  for (const recorded of commands) {
    if (recorded.tick < world.tick) {
      throw new Error(`replay commands must be in tick order: tick ${recorded.tick} comes after tick ${world.tick}`)
    }
    while (world.tick < recorded.tick) step(world, rules)
    const result = applyCommand(world, rules, recorded.cmd)
    if (!result.ok) throw new Error(`replay command at tick ${recorded.tick} was rejected: ${result.reason}`)
  }
  const target = untilTick ?? world.tick
  while (world.tick < target) step(world, rules)
  return world
}
