// Words for things, shared by the inspector, the event log, the chart and the
// notices, so the same thing is always called the same name.

import type { CommandType, DeathCause, EventKind, IntentKind, NodeKind, SimEvent, TraitName } from '../sim/types.ts'
import { fertilityAt } from '../sim/reproduction.ts'
import { autoSex } from '../sim/world.ts'
import type { Tuning } from '../sim/types.ts'
import { traitNumber } from './traitMath.ts'

export const KIND_LABEL: Record<NodeKind, string> = {
  resource: 'resource',
  danger: 'danger',
  shelter: 'shelter',
  ruin: 'ruin',
  water: 'water',
}

/** What the Add bot tool will place next, with the living count of each sex: "Next: female (20 F / 21 M alive)". */
export function nextBotSexLabel(bots: readonly { sex: 'female' | 'male' }[]): string {
  const females = bots.filter((bot) => bot.sex === 'female').length
  return `Next: ${autoSex(bots)} (${females} F / ${bots.length - females} M alive)`
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

/** How a death is said in a sentence, capitalised: "Died of hunger", "Killed by a meteor". One scheme everywhere. */
export const CAUSE_SENTENCE: Record<DeathCause, string> = {
  starve: 'Died of hunger',
  thirst: 'Died of thirst',
  danger: 'Killed by danger',
  plague: 'Killed by plague',
  meteor: 'Killed by a meteor',
  age: 'Died of old age',
}

/** The inspector's and the event log's wording for a death. A missing cause reads as hunger. */
export function causeSentence(cause: DeathCause | undefined): string {
  return CAUSE_SENTENCE[cause ?? 'starve']
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
  reproduce: 'Heading to a shelter to wait for a mate',
  seekMate: 'Walking to a mate',
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

/**
 * The first of `candidates` (write them longest first) whose width, by `measure`, fits in `maxWidth`; null when
 * none does, so the caller can leave the label out instead of letting it spill over its shape.
 */
export function fitLabel(candidates: readonly string[], maxWidth: number, measure: (text: string) => number): string | null {
  for (const text of candidates) {
    if (measure(text) <= maxWidth) return text
  }
  return null
}

/** Width of the chord of a circle of radius `r` at `dy` from its centre (0 when `dy` is outside the circle). */
export function chordWidth(r: number, dy: number): number {
  const d = Math.abs(dy)
  return d >= r ? 0 : 2 * Math.sqrt(r * r - d * d)
}

export type FertilityPhase = 'young' | 'rising' | 'prime' | 'declining' | 'past'

/** Fertility at an age as a whole percent plus a phase word for the inspector (M16). */
export function fertilityLabel(age: number, tuning: Pick<Tuning, 'bot' | 'fertility'>): { percent: number; phase: FertilityPhase } {
  const percent = Math.round(100 * fertilityAt(age, tuning))
  const { primeAge, declineAge, fertileUntil } = tuning.fertility
  if (age < tuning.bot.adultAge) return { percent, phase: 'young' }
  if (age >= fertileUntil) return { percent, phase: 'past' }
  if (age < primeAge) return { percent, phase: 'rising' }
  if (age < declineAge) return { percent, phase: 'prime' }
  return { percent, phase: 'declining' }
}

/** The inbreeding score (M18, 0 to 1) as words: "no" at 0, else the percent (1 = parent and child or full siblings). */
export function inbreedingLabel(score: number): string {
  if (score <= 0) return 'No'
  return `Yes · ${Math.round(100 * score)}%`
}

export const FERTILITY_PHASE_LABEL: Record<FertilityPhase, string> = {
  young: 'too young',
  rising: 'rising',
  prime: 'prime',
  declining: 'declining',
  past: 'past breeding',
}
