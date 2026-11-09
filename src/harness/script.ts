// Scripted player commands for headless runs: `--event drought@3000`,
// `--event plague@6000:48,32`, `--event meteor@5000:30,20` (repeatable).
// The text is `kind@tick`, plus `:x,y` for the area events (plague, meteor). A
// script applies each command when the world reaches its tick (after that
// tick's step, before the next; tick 0 is before the first step), exactly like
// a command the player issues in the UI, and a command the sim refuses is
// reported instead of applied.

import { applyCommand } from '../sim/commands.ts'
import type { Command, EventKind, Rules, World } from '../sim/types.ts'

export type ScriptedCommand = { tick: number; cmd: Command }

const KINDS: readonly EventKind[] = ['drought', 'bounty', 'plague', 'meteor']
const AREA: readonly EventKind[] = ['plague', 'meteor']
const TICK_MAX = 1_000_000

export const EVENT_USAGE = '--event <drought|bounty>@<tick> or --event <plague|meteor>@<tick>:<x>,<y> (repeatable)'

/** Parses one `--event` value. Throws an Error with a readable message on bad input. */
export function parseEventSpec(text: string | undefined): ScriptedCommand {
  const match = /^([a-z]+)@(\d+)(?::(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?))?$/.exec(text ?? '')
  if (match === null) throw new Error(`--event must look like ${EVENT_USAGE}, received ${text ?? 'nothing'}`)
  const kind = match[1] as EventKind
  if (!KINDS.includes(kind)) throw new Error(`--event kind must be one of: ${KINDS.join(', ')}, received ${kind}`)
  const tick = Number(match[2])
  if (!Number.isInteger(tick) || tick > TICK_MAX) throw new Error(`--event tick must be a whole number from 0 to ${TICK_MAX}`)
  const hasPoint = match[3] !== undefined
  if (AREA.includes(kind) && !hasPoint) throw new Error(`--event ${kind} needs a place: ${kind}@${tick}:<x>,<y>`)
  if (!AREA.includes(kind) && hasPoint) throw new Error(`--event ${kind} is global and takes no place: ${kind}@${tick}`)
  if (hasPoint) return { tick, cmd: { type: 'triggerEvent', event: kind, x: Number(match[3]), y: Number(match[4]) } }
  return { tick, cmd: { type: 'triggerEvent', event: kind } }
}

/** A script that hands out its commands as the world reaches their ticks. Commands at the same tick keep their order. */
export function makeScript(commands: readonly ScriptedCommand[]): { due: (world: World, rules: Rules) => string[] } {
  const sorted = commands.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.tick - b.entry.tick || a.index - b.index)
  let next = 0
  return {
    /** Applies every command whose tick the world has reached. Returns the refusals, as readable lines. */
    due(world, rules) {
      const refused: string[] = []
      while (next < sorted.length && sorted[next]!.entry.tick <= world.tick) {
        const { tick, cmd } = sorted[next]!.entry
        next += 1
        const result = applyCommand(world, rules, cmd)
        if (!result.ok) refused.push(`tick ${tick}: ${cmd.type === 'triggerEvent' ? cmd.event : cmd.type} refused: ${result.reason}`)
      }
      return refused
    },
  }
}
