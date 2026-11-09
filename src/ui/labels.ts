// Words for things, shared by the inspector, the event log, the chart and the
// notices, so the same thing is always called the same name.

import type { CommandType, DeathCause, EventKind, IntentKind, NodeKind, SimEvent, TraitName } from '../sim/types.ts'
import { traitNumber } from './traitMath.ts'

export const KIND_LABEL: Record<NodeKind, string> = {
  resource: 'resource',
  danger: 'danger',
  shelter: 'shelter',
  ruin: 'ruin',
  water: 'water',
}

export const KIND_LETTER: Record<NodeKind, string> = { resource: 'R', danger: 'D', shelter: 'S', ruin: 'U', water: 'W' }

export const CAUSE_LABEL: Record<DeathCause, string> = {
  starve: 'Starved',
  thirst: 'Thirst',
  danger: 'Danger',
  plague: 'Plague',
  meteor: 'Meteor',
  age: 'Old age',
}

export const EVENT_LABEL: Record<EventKind, string> = { drought: 'Drought', bounty: 'Bounty', plague: 'Plague', meteor: 'Meteor' }

/**
 * One letter per world event for chart markers, banners and badges. They differ from the node and
 * command letters (R D S U W B X): H for the dry spell (Heat), F for the feast (Fruitful), P, M.
 */
export const EVENT_LETTER: Record<EventKind, string> = { drought: 'H', bounty: 'F', plague: 'P', meteor: 'M' }

export const INTENT_LABEL: Record<IntentKind, string> = {
  wander: 'Wandering',
  seekFood: 'Seeking food',
  seekWater: 'Seeking water',
  flee: 'Fleeing danger',
  rest: 'Resting in shelter',
  reproduce: 'Heading to shelter to reproduce',
}

/**
 * One letter for a chart marker: R, D, S, W for a placed node of that kind, B for a bot, X for a removal,
 * H, F, P, M for a world event (drought, bounty, plague, meteor).
 */
export function commandLetter(command: CommandType, nodeKind?: NodeKind, eventKind?: EventKind): string {
  if (command === 'placeBot') return 'B'
  if (command === 'removeNode') return 'X'
  if (command === 'triggerEvent') return eventKind === undefined ? '!' : EVENT_LETTER[eventKind]
  return nodeKind === undefined ? '+' : KIND_LETTER[nodeKind]
}

/** "place danger", "remove node", "place bot", "trigger drought". */
export function commandName(command: CommandType, nodeKind?: NodeKind, eventKind?: EventKind): string {
  if (command === 'triggerEvent') return eventKind === undefined ? 'trigger event' : `trigger ${eventKind}`
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
  if (event.eventKind !== undefined) return EVENT_LABEL[event.eventKind]
  const kind = event.nodeKind
  const name = kind === undefined ? 'Node' : `${KIND_LABEL[kind][0]!.toUpperCase()}${KIND_LABEL[kind].slice(1)}`
  return event.nodeId === undefined ? name : `${name} #${event.nodeId}`
}

export const TRAIT_LABEL: Record<TraitName, string> = {
  senseRadius: 'Sense radius',
  caution: 'Caution',
  reproThreshold: 'Repro threshold',
  metabolism: 'Metabolism',
}

/** One line on what a trait does, for tooltips. */
export const TRAIT_HELP: Record<TraitName, string> = {
  senseRadius: 'How far a bot sees nodes. Seeing further costs energy every tick.',
  caution: 'How strongly a bot flees danger instead of seeking food.',
  reproThreshold: 'Energy a bot needs before it reproduces. Low is early but risky for the parent.',
  metabolism: 'Scales energy loss, thirst and walking speed. Higher burns more and thirsts much more, but moves faster.',
}

/** A trait value with its unit: "6.4 cells", "0.45", "62.0 energy", "×1.05". */
export function formatTrait(name: TraitName, value: number): string {
  const text = traitNumber(name, value)
  switch (name) {
    case 'senseRadius':
      return `${text} cells`
    case 'reproThreshold':
      return `${text} energy`
    case 'metabolism':
      return `×${text}`
    case 'caution':
      return text
  }
}
