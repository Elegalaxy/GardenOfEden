// Highlights (F2): the few log entries worth jumping to, found from the log the page already has. Pure, no DOM, no state.
//
// A highlight is a death by predator, meteor, plague, poison or disease; a predator that was born, struck by a meteor, killed by plague
// or left the map; or your own plague, meteor, blight or outbreak command. Births, other deaths (starve, thirst, danger, age), predators
// that arrived, starved or aged, drought and bounty, placing and removing things, and the ends of world events are not.
// `highlightsOf` lists them newest first, including the player commands that have scrolled out of the sim's log ring
// (`mergeLog`). The wording reuses the log's own helpers, so the notice reads like the row.

import type { DeathCause, EventKind, PredatorEventKind, SimEvent } from '../sim/types.ts'
import { causeSentence, commandName, formatPoint } from './labels.ts'
import { mergeLog } from './logMerge.ts'
import type { CommandRecord } from './logMerge.ts'
import { predatorEventPhrase } from './predatorInfo.ts'

const DEATH_CAUSES: ReadonlySet<DeathCause> = new Set<DeathCause>(['predator', 'meteor', 'plague', 'poison', 'disease'])
const PREDATOR_EVENTS: ReadonlySet<PredatorEventKind> = new Set<PredatorEventKind>(['born', 'struck', 'plagued', 'left'])
const COMMAND_EVENTS: ReadonlySet<EventKind> = new Set<EventKind>(['plague', 'meteor', 'blight', 'outbreak'])

/** True for the entries the N key jumps to. Entries with an unknown position (rebuilt removals) never qualify. */
export function isHighlight(event: SimEvent): boolean {
  switch (event.type) {
    case 'death':
      return event.cause !== undefined && DEATH_CAUSES.has(event.cause)
    case 'predator':
      return event.predatorEvent !== undefined && PREDATOR_EVENTS.has(event.predatorEvent)
    case 'command':
      return event.command === 'triggerEvent' && event.eventKind !== undefined && COMMAND_EVENTS.has(event.eventKind)
    default:
      return false
  }
}

/** The highlights among the sim's log and the commands, newest first. */
export function highlightsOf(log: readonly SimEvent[], commands: readonly CommandRecord[] = []): SimEvent[] {
  const found: SimEvent[] = []
  for (const entry of mergeLog(log, commands)) if (isHighlight(entry.event)) found.push(entry.event)
  return found.reverse()
}

/** A key that tells one highlight from another, so the page knows when a new one has arrived. */
export function highlightKey(event: SimEvent): string {
  return `${event.tick}:${event.type}:${event.botId ?? ''}:${event.nodeId ?? ''}:${event.cause ?? event.predatorEvent ?? event.eventKind ?? ''}:${event.x},${event.y}`
}

/** One line for the notice: "Killed by a predator (bot #4) at 12.5, 7.5". */
export function highlightText(event: SimEvent): string {
  const where = formatPoint(event.x, event.y)
  switch (event.type) {
    case 'death':
      return `${causeSentence(event.cause)} (bot #${event.botId}) at ${where}`
    case 'predator':
      return `Predator #${event.nodeId} ${predatorEventPhrase(event.predatorEvent)} at ${where}`
    case 'command':
      return `You: ${commandName('triggerEvent', undefined, event.eventKind)} at ${where}`
    default:
      return `Event at ${where}`
  }
}

/** The index the next press goes to: 0 (the newest) first or after a new highlight arrived, then one older each press, wrapping round. */
export function nextHighlightIndex(previous: number | null, count: number): number {
  if (count <= 0) return -1
  if (previous === null || previous < 0) return 0
  return (previous + 1) % count
}

/** The ring drawn at a highlight: where, and the page time (`performance.now`) it began. */
export type Pulse = {
  x: number
  y: number
  start: number
  /** Outer radius of the rings in cells (default 4.8). The outbreak pulse uses the outbreak radius. */
  radius?: number
  /** `disease` draws the rings in the disease colour (the outbreak pulse); absent is white (highlights). */
  tone?: 'disease'
}

/** How long the ring lasts, in ms of page time. */
export const PULSE_MS = 1500
