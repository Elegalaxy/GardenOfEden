// Words for things, shared by the inspector, the event log, the chart and the
// notices, so the same thing is always called the same name.

import type { Bot, CommandType, DeathCause, EventKind, IntentKind, MemoryEntry, NodeKind, PredatorTraitName, SimEvent, TraitName } from '../sim/types.ts'
import { fertilityAt } from '../sim/reproduction.ts'
import { autoSex } from '../sim/world.ts'
import { isElder, isYoung } from '../sim/culture.ts'
import { FEATURES } from '../content/index.ts'
import type { Tuning, WorldFeature } from '../sim/types.ts'
import { traitNumber } from './traitMath.ts'

export const KIND_LABEL: Record<NodeKind, string> = {
  resource: 'resource',
  danger: 'crater',
  shelter: 'shelter',
  ruin: 'ruin',
  water: 'water',
  predator: 'predator',
  rough: 'rough ground',
}

/** What the Add bot tool will place next, with the living count of each sex: "Next: female (20 F / 21 M alive)". */
export function nextBotSexLabel(bots: readonly { sex: 'female' | 'male' }[], chosen: 'female' | 'male' | null = null): string {
  const females = bots.filter((bot) => bot.sex === 'female').length
  return `Next: ${chosen ?? autoSex(bots)} (${females} F / ${bots.length - females} M alive)`
}

export const KIND_LETTER: Record<NodeKind, string> = { resource: 'R', danger: 'D', shelter: 'S', ruin: 'U', water: 'W', predator: 'V', rough: 'G' }

export const CAUSE_LABEL: Record<DeathCause, string> = {
  starve: 'Starved',
  thirst: 'Thirst',
  danger: 'Crater',
  plague: 'Plague',
  meteor: 'Meteor',
  predator: 'Predator',
  age: 'Old age',
  poison: 'Poison',
  disease: 'Disease',
}

/** How a death is said in a sentence, capitalised: "Died of hunger", "Killed by a meteor". One scheme everywhere. */
export const CAUSE_SENTENCE: Record<DeathCause, string> = {
  starve: 'Died of hunger',
  thirst: 'Died of thirst',
  danger: 'Killed in a meteor crater',
  plague: 'Killed by plague',
  meteor: 'Killed by a meteor',
  predator: 'Killed by a predator',
  age: 'Died of old age',
  poison: 'Poisoned by toxic food',
  disease: 'Died of disease',
}

/** The inspector's and the event log's wording for a death. A missing cause reads as hunger. */
export function causeSentence(cause: DeathCause | undefined): string {
  return CAUSE_SENTENCE[cause ?? 'starve']
}

export const EVENT_LABEL: Record<EventKind, string> = { drought: 'Drought', bounty: 'Bounty', plague: 'Plague', meteor: 'Meteor', blight: 'Blight', outbreak: 'Outbreak' }

/**
 * One letter per world event for chart markers, banners and badges. They differ from the node and
 * command letters (R D S U W B X): H for the dry spell (Heat), F for the feast (Fruitful), P, M, L for the blight.
 */
export const EVENT_LETTER: Record<EventKind, string> = { drought: 'H', bounty: 'F', plague: 'P', meteor: 'M', blight: 'L', outbreak: 'I' }

export const INTENT_LABEL: Record<IntentKind, string> = {
  wander: 'Wandering',
  seekFood: 'Seeking food',
  seekWater: 'Seeking water',
  flee: 'Fleeing danger', // the fallback; `intentLabel` names a predator or a crater when it knows the target
  rest: 'Resting in shelter',
  reproduce: 'Heading to a shelter to wait for a mate',
  seekMate: 'Walking to a mate',
}

/** A goal in words. A fleeing bot's target says what it flees from: "Fleeing a predator", "Fleeing a crater". */
export function intentLabel(kind: IntentKind, target?: { kind: NodeKind }): string {
  if (kind === 'flee' && target !== undefined) {
    if (target.kind === 'predator') return 'Fleeing a predator'
    if (target.kind === 'danger') return 'Fleeing a crater'
  }
  return INTENT_LABEL[kind]
}

/**
 * One letter for a chart marker: R, V, S, W for a placed node of that kind, B for a bot, X for a removal,
 * H, F, P, M for a world event (drought, bounty, plague, meteor).
 */
export function commandLetter(command: CommandType, nodeKind?: NodeKind, eventKind?: EventKind): string {
  if (command === 'placeBot') return 'B'
  if (command === 'removeNode') return 'X'
  if (command === 'triggerEvent') return eventKind === undefined ? '!' : EVENT_LETTER[eventKind]
  return nodeKind === undefined ? '+' : KIND_LETTER[nodeKind]
}

/** "place predator", "remove node", "place bot", "trigger drought". */
export function commandName(command: CommandType, nodeKind?: NodeKind, eventKind?: EventKind): string {
  if (command === 'triggerEvent') return eventKind === undefined ? 'trigger event' : `trigger ${eventKind}`
  if (command === 'placeBot') return 'place bot'
  if (command === 'removeNode') return nodeKind === undefined ? 'remove node' : `remove ${nodeKind}`
  return nodeKind === undefined ? 'place node' : `place ${nodeKind}`
}

/** What a predator is doing: chasing a bot, resting (with the ticks left), fed and walking home (E3), or prowling. */
export type PredatorActivity =
  | { kind: 'hunting'; targetId: number }
  | { kind: 'resting'; ticksLeft: number }
  | { kind: 'sated' }
  | { kind: 'prowling' }

/**
 * Reads a predator's state at `tick`: resting while `tick <= restUntil` (checked first), then sated (E3: with ecology on, a
 * predator at or above its hunt-below energy does not bite), hunting while it has a target, else prowling.
 */
export function predatorActivity(hunt: { targetId: number | null; restUntil: number } | null, tick: number, sated = false): PredatorActivity {
  if (hunt === null) return { kind: 'prowling' }
  if (hunt.restUntil > 0 && tick <= hunt.restUntil) return { kind: 'resting', ticksLeft: hunt.restUntil - tick }
  if (sated) return { kind: 'sated' }
  if (hunt.targetId !== null) return { kind: 'hunting', targetId: hunt.targetId }
  return { kind: 'prowling' }
}

/** How many nodes a bot's memory can hold: the shared cap plus the water and predator slot classes. */
export function memoryCapacity(memory: { cap: number; waterCap: number; predatorCap: number }): number {
  return memory.cap + memory.waterCap + memory.predatorCap
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
  sprint: 'Sprint',
  longevity: 'Longevity',
  hardiness: 'Hardiness',
  wariness: 'Wariness',
}

/** One line on what a trait does, for tooltips. */
export const TRAIT_HELP: Record<TraitName, string> = {
  senseRadius: 'How far a bot sees nodes. Seeing further costs energy every tick.',
  caution: 'How strongly a bot flees predators and craters instead of seeking food.',
  reproThreshold: 'Energy a bot needs before it reproduces. Low is early but risky for the parent.',
  metabolism: 'Scales energy loss, thirst and walking speed. Higher burns more and thirsts much more, but moves faster.',
  sprint: 'How much faster a bot runs while fleeing. Costs energy every tick, more the higher it is.',
  longevity: 'Scales lifespan and the whole fertility curve: lives longer but matures and breeds later.',
  hardiness: 'Divides all health damage (bites, plague, craters, meteors). Costs extra energy every tick.',
  wariness: 'How far a bot keeps from predators and how long it remembers one. Wary bots lose access to food and water near haunts.',
}

/** The three heritable predator traits (H3), as multipliers of the shipped predator numbers. */
export const PREDATOR_TRAIT_LABEL: Record<PredatorTraitName, string> = { sense: 'Sense', speed: 'Speed', stamina: 'Stamina' }

export const PREDATOR_TRAIT_HELP: Record<PredatorTraitName, string> = {
  sense: 'Multiplier on how far a predator sees. Costs extra hunger.',
  speed: 'Multiplier on how fast a predator chases. Costs extra hunger.',
  stamina: 'Multiplier on how long a chase lasts before the predator gives up. Costs a little extra hunger.',
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
    case 'sprint':
    case 'longevity':
    case 'hardiness':
    case 'wariness':
      return `×${text}`
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
export function fertilityLabel(
  age: number,
  tuning: Pick<Tuning, 'bot' | 'fertility'>,
  scale = 1,
): { percent: number; phase: FertilityPhase } {
  const percent = Math.round(100 * fertilityAt(age, tuning, scale))
  const primeAge = tuning.fertility.primeAge * scale
  const declineAge = tuning.fertility.declineAge * scale
  const fertileUntil = tuning.fertility.fertileUntil * scale
  if (age < tuning.bot.adultAge * scale) return { percent, phase: 'young' }
  if (age >= fertileUntil) return { percent, phase: 'past' }
  if (age < primeAge) return { percent, phase: 'rising' }
  if (age < declineAge) return { percent, phase: 'prime' }
  return { percent, phase: 'declining' }
}

/** A bloodline hue as text: "hue 212°" (whole degrees). */
export function hueLabel(hue: number): string {
  return `hue ${Math.round(hue) % 360}°`
}

/**
 * The Sight row (V3): how far a bot or predator sees ahead and behind, in cells with one decimal, or one number when the vision cone
 * is off. `ahead` is R * front and `behind` is R * rear (the two ends of `coneFactor`).
 */
export function sightText(radius: number, front: number, rear: number, enabled: boolean): string {
  if (!enabled) return `${radius.toFixed(1)} all round (cells)`
  return `${(radius * front).toFixed(1)} ahead · ${(radius * rear).toFixed(1)} behind (cells)`
}

/** Tooltip for the Sight row. */
export const SIGHT_HELP = 'Sees less behind. Keeps tracking a predator it has seen while it stays in range. Outline on the map.'

/** The inbreeding score (M18, 0 to 1) as words: "no" at 0, else the percent (1 = parent and child or full siblings). */
/**
 * The Inspector's Illness row (D3): "Healthy", "Exposed 3 / 5", "Sick, 120 ticks left", "Immune, 900 left". `illness` is the
 * selected bot's full record when the page has it (slow data); with only the frame's stage the ticks are left out.
 */
export function illnessLabel(
  stage: 'exposed' | 'sick' | 'immune' | undefined,
  illness: { dose: number; until: number } | undefined,
  tick: number,
  catchAfter: number,
): string {
  if (stage === undefined) return 'Healthy'
  const left = illness === undefined ? null : Math.max(0, Math.round(illness.until - tick))
  switch (stage) {
    case 'exposed':
      return illness === undefined ? 'Exposed' : `Exposed ${Math.round(illness.dose)} / ${catchAfter}`
    case 'sick':
      return left === null ? 'Sick' : `Sick, ${left.toLocaleString('en-US')} ${left === 1 ? 'tick' : 'ticks'} left`
    case 'immune':
      return left === null ? 'Immune' : `Immune, ${left.toLocaleString('en-US')} left`
  }
}

export function inbreedingLabel(score: number): string {
  if (score <= 0) return 'No'
  return `Yes · ${Math.round(100 * score)}%`
}

/** Inbred births over all births (G3) as a percent with one decimal; a dash before the first birth. */
/** The names of a run's experimental rules, in canonical order: "Toxic food, Culture" (empty for none). */
export function featureNames(features: readonly WorldFeature[]): string {
  return FEATURES.filter((feature) => features.includes(feature.id))
    .map((feature) => feature.label)
    .join(', ')
}

/** What a remembered place is flagged with, as words. */
export function memoryFlags(entry: Pick<MemoryEntry, 'toxic' | 'taught'>): string[] {
  return [entry.toxic === true ? 'Toxic' : '', entry.taught === true ? 'Taught' : ''].filter((flag) => flag !== '')
}

/** A bot's life stage for teaching: young bots learn from elders (ages scale with the longevity trait). */
export function teachingStage(bot: Pick<Bot, 'age' | 'traits'>, tuning: Pick<Tuning, 'culture'>): 'young' | 'adult' | 'elder' {
  return isElder(bot, tuning) ? 'elder' : isYoung(bot, tuning) ? 'young' : 'adult'
}

/** The Inspector's row for a toxic food node: "3 damage per unit eaten". */
export function toxicText(damagePerUnit: number): string {
  return `${damagePerUnit} damage per unit eaten`
}

/** What the Inspector and the trait panel say before the first outbreak wakes the resistance gene. */
export const LATENT_RESISTANCE = 'latent until an outbreak'

/** A bot's resistance as "×1.23 ▲": the arrow compares it with the founders' mean, to two decimals. */
export function resistanceText(resist: number, founderMean: number): string {
  const own = Number(resist.toFixed(2))
  const mean = Number(founderMean.toFixed(2))
  const glyph = own > mean ? '▲' : own < mean ? '▼' : '■'
  return `×${resist.toFixed(2)} ${glyph}`
}

/** The trait panel's line for a woken gene: "×1.12 mean · ×1.38 max" (dashes with nobody alive). */
export function resistanceSummary(stats: { mean: number | null; max: number | null }): string {
  const text = (value: number | null): string => (value === null ? '—' : `×${value.toFixed(2)}`)
  return `${text(stats.mean)} mean · ${text(stats.max)} max`
}

export function inbredBirthsLabel(inbred: number, births: number): string {
  if (births <= 0) return '—'
  return `${((100 * inbred) / births).toFixed(1)}%`
}

export const INBRED_BIRTHS_HELP =
  'Share of births whose parents were close kin (parent and child, full or half siblings). With mate choice on (Eden) kin never pair, so this stays 0% unless the rule is off or the world came from an older save. The child penalty for inbreeding still applies.'

export const FERTILITY_PHASE_LABEL: Record<FertilityPhase, string> = {
  young: 'too young',
  rising: 'rising',
  prime: 'prime',
  declining: 'declining',
  past: 'past breeding',
}
