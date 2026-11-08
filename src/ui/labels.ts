// Words for things, shared by the inspector, the event log, the chart and the
// notices, so the same thing is always called the same name.

import type { CommandType, DeathCause, IntentKind, NodeKind, SimEvent } from '../sim/types.ts'

export const KIND_LABEL: Record<NodeKind, string> = { resource: 'resource', danger: 'danger', shelter: 'shelter' }

export const KIND_LETTER: Record<NodeKind, string> = { resource: 'R', danger: 'D', shelter: 'S' }

export const CAUSE_LABEL: Record<DeathCause, string> = { starve: 'Starved', danger: 'Danger', age: 'Old age' }

export const INTENT_LABEL: Record<IntentKind, string> = {
  wander: 'Wandering',
  seekFood: 'Seeking food',
  flee: 'Fleeing danger',
  rest: 'Resting in shelter',
  reproduce: 'Heading to shelter to reproduce',
}

/** One letter for a chart marker: R, D, S for a placed node of that kind, B for a bot, X for a removal. */
export function commandLetter(command: CommandType, nodeKind?: 'resource' | 'danger' | 'shelter'): string {
  if (command === 'placeBot') return 'B'
  if (command === 'removeNode') return 'X'
  return nodeKind === undefined ? '+' : KIND_LETTER[nodeKind]
}

/** "place danger", "remove node", "place bot". */
export function commandName(command: CommandType, nodeKind?: NodeKind): string {
  if (command === 'placeBot') return 'place bot'
  if (command === 'removeNode') return nodeKind === undefined ? 'remove node' : `remove ${nodeKind}`
  return nodeKind === undefined ? 'place node' : `place ${nodeKind}`
}

/** "12.5, 7.5" */
export function formatPoint(x: number, y: number): string {
  return `${Math.round(x * 10) / 10}, ${Math.round(y * 10) / 10}`
}

/** The id a log entry is about, as the player sees it: "Bot #4", "Resource #9". */
export function eventSubject(event: SimEvent): string {
  if (event.botId !== undefined) return `Bot #${event.botId}`
  const kind = event.nodeKind
  const name = kind === undefined ? 'Node' : `${KIND_LABEL[kind][0]!.toUpperCase()}${KIND_LABEL[kind].slice(1)}`
  return event.nodeId === undefined ? name : `${name} #${event.nodeId}`
}
