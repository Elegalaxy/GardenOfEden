// Scenario scripts. A scenario preset carries `script`, a list of `{ tick, cmd }` world events (triggerEvent only).
// `createWorld` copies it into `World.script`; the last statement of `step` calls `applyScript`, which applies
// every entry whose tick the world has reached, exactly like a command issued between two ticks (after step T,
// before step T+1), but WITHOUT recording it in `World.commands`: a save is still `{ seed, presetId, commands }`,
// and a replay rebuilds the same script from the preset. A refused entry (the event rules say no) is dropped and
// its reason returned. When the list is empty the key is deleted, so a world with no script, or a finished one,
// has no `script` key. No random draws.

import { applyCommand } from './commands.ts'
import type { Preset, Rules, World } from './types.ts'

/** Throws unless every tick is a whole number >= 1, ticks never decrease, and every command is a triggerEvent. */
export function checkScript(preset: Pick<Preset, 'id' | 'script'>): void {
  let last = 1
  for (const [index, entry] of (preset.script ?? []).entries()) {
    const where = `preset ${preset.id} script entry ${index}`
    if (!Number.isInteger(entry.tick) || entry.tick < 1) throw new Error(`${where}: tick must be a whole number >= 1`)
    if (entry.tick < last) throw new Error(`${where}: ticks must not decrease`)
    if ((entry.cmd as { type: string }).type !== 'triggerEvent') throw new Error(`${where}: only triggerEvent is allowed`)
    last = entry.tick
  }
}

/** Applies the due entries. Returns the refusals as readable lines ([] at once when the world has no script). */
export function applyScript(world: World, rules: Rules): string[] {
  const script = world.script
  if (script === undefined) return []
  const refused: string[] = []
  while (script.length > 0 && script[0]!.tick <= world.tick) {
    const { tick, cmd } = script.shift()!
    const result = applyCommand(world, rules, cmd, false)
    if (!result.ok) refused.push(`tick ${tick}: ${cmd.event} refused: ${result.reason}`)
  }
  if (script.length === 0) delete world.script
  return refused
}
