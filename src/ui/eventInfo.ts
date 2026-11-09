// What the Events panel, the notices and the banners say about each world
// event. Pure text and data, built from tuning so the numbers shown are the
// numbers the sim uses. Drought (key D) and bounty (key B) are global and fire
// at once; plague (P) and meteor (M) are area events, armed as tools and then
// clicked onto the map (tools.ts).

import { checkCommand } from '../sim/commands.ts'
import type { Command, EventKind, Rules, Tuning } from '../sim/types.ts'
import type { CheckableWorld } from '../sim/worldEvents.ts'
import { EVENT_LABEL, EVENT_LETTER, formatPoint } from './labels.ts'

export type EventInfo = {
  kind: EventKind
  label: string
  letter: string
  /** Keyboard shortcut. */
  key: string
  /** Global events fire from their button; area events need a click on the map. */
  global: boolean
  /** One line on what it does. */
  blurb: string
}

export const EVENT_INFOS: readonly EventInfo[] = [
  { kind: 'drought', label: EVENT_LABEL.drought, letter: EVENT_LETTER.drought, key: 'd', global: true, blurb: 'Food grows back much slower everywhere. Springs are not affected.' },
  { kind: 'bounty', label: EVENT_LABEL.bounty, letter: EVENT_LETTER.bounty, key: 'b', global: true, blurb: 'Food grows back much faster everywhere.' },
  { kind: 'plague', label: EVENT_LABEL.plague, letter: EVENT_LETTER.plague, key: 'p', global: false, blurb: 'A zone where bots lose health for a while. Pick it, then click the map.' },
  { kind: 'meteor', label: EVENT_LABEL.meteor, letter: EVENT_LETTER.meteor, key: 'm', global: false, blurb: 'Kills bots at the centre of the impact and leaves a danger crater. Pick it, then click the map.' },
]

export function eventInfo(kind: EventKind): EventInfo {
  return EVENT_INFOS.find((info) => info.kind === kind) ?? EVENT_INFOS[0]!
}

/** The global event a pressed key fires, or null. */
export function globalEventForKey(key: string): EventKind | null {
  return EVENT_INFOS.find((info) => info.global && info.key === key)?.kind ?? null
}

const numberFormat = new Intl.NumberFormat('en-US')

/** "1,500 ticks" */
export function formatTicks(ticks: number): string {
  return `${numberFormat.format(Math.max(0, Math.round(ticks)))} ticks`
}

/** "×0.35", "×3" */
export function formatMult(mult: number): string {
  return `×${Math.round(mult * 100) / 100}`
}

const fixed1 = (value: number): string => String(Math.round(value * 10) / 10)

/** What the event does, as one short phrase: "food regrowth ×0.35". */
export function effectSummary(kind: EventKind, tuning: Tuning): string {
  const e = tuning.events
  switch (kind) {
    case 'drought':
      return `food regrowth ${formatMult(e.drought.regrowMult)}`
    case 'bounty':
      return `food regrowth ${formatMult(e.bounty.regrowMult)}`
    case 'plague':
      return `−${fixed1(e.plague.damage)} health / tick within ${fixed1(e.plague.radius)} cells`
    case 'meteor':
      return `up to −${numberFormat.format(e.meteor.damage)} health within ${fixed1(e.meteor.radius)} cells`
  }
}

/** The key-value rows on an event's card. */
export function eventRows(kind: EventKind, tuning: Tuning): { label: string; value: string }[] {
  const e = tuning.events
  switch (kind) {
    case 'drought':
    case 'bounty':
      return [
        { label: 'Lasts', value: formatTicks(e[kind].duration) },
        { label: 'Effect', value: effectSummary(kind, tuning) },
      ]
    case 'plague':
      return [
        { label: 'Lasts', value: formatTicks(e.plague.duration) },
        { label: 'Effect', value: effectSummary(kind, tuning) },
      ]
    case 'meteor':
      return [
        { label: 'Lasts', value: `instant, crater ${formatTicks(e.meteor.craterTicks)}` },
        { label: 'Effect', value: effectSummary(kind, tuning) },
      ]
  }
}

/** Why the event cannot be started right now (a cap, or one is already running), or null. Area events are checked at the map centre. */
export function blockedReason(world: CheckableWorld, rules: Rules, kind: EventKind): string | null {
  return checkCommand(world, rules, { type: 'triggerEvent', event: kind, x: world.width / 2, y: world.height / 2 })
}

/** The notice after a successful trigger. `killed` is the number of bots a meteor killed. */
export function startedMessage(cmd: Extract<Command, { type: 'triggerEvent' }>, tuning: Tuning, killed: number): string {
  const where = formatPoint(cmd.x ?? 0, cmd.y ?? 0)
  switch (cmd.event) {
    case 'drought':
    case 'bounty':
      return `${EVENT_LABEL[cmd.event]} started: ${effectSummary(cmd.event, tuning)} for ${formatTicks(tuning.events[cmd.event].duration)}.`
    case 'plague':
      return `Plague started at ${where}: ${effectSummary('plague', tuning)} for ${formatTicks(tuning.events.plague.duration)}.`
    case 'meteor':
      return `Meteor struck at ${where}: ${killed} bot${killed === 1 ? '' : 's'} killed. A crater burns for ${formatTicks(tuning.events.meteor.craterTicks)}.`
  }
}
