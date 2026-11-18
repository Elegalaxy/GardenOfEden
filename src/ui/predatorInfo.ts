// Predator ecology as the page shows it (E3): pure helpers over a predator's `hunt` (and `life`), the world's dens and the
// stats samples. Reads only what the frame carries (nodes, ecology, samples) and takes the tuning as a parameter, so tests can
// pass their own. `isHungry` is the sim's own rule, so the page can never disagree with the sim about who bites. No state.

import { isHungry, predatorLimit } from '../sim/predators.ts'
import { predatorDrain, PREDATOR_TRAIT_NAMES } from '../sim/predatorTraits.ts'
import { sampleAtOrBefore } from '../sim/stats.ts'
import type { Den, PredatorEcology, PredatorOrigin, PredatorState, PredatorTraitName, Sample, Tuning, WorldNode } from '../sim/types.ts'

type EcologyTuning = Pick<Tuning, 'predator'>

/** Why a predator is not breeding yet, in the order the sim checks (kills, age, energy, cap, prey limit); null when nothing blocks it. */
export type CubBlock = 'kills' | 'age' | 'energy' | 'cap' | 'prey' | null

export type PredatorLifeInfo = {
  energy: number
  maxEnergy: number
  /** It hunts and bites only while its energy is below this. */
  huntBelow: number
  hungry: boolean
  /** Ticks until a fed predator is hungry again; null when it is hungry already or does not lose energy. */
  ticksToHungry: number | null
  /** Ticks until it starves; null when it does not lose energy. */
  ticksToStarve: number | null
  age: number
  maxAge: number
  adult: boolean
  /** Kills since its last cub, and the kills a cub takes. */
  kidsKills: number
  killsPerCub: number
  cubBlock: CubBlock
}

/** A predator's life as numbers, or null when it has none (ecology off). `count` is the predators alive now, for the cap and prey checks; `botCount` the bots alive. */
export function predatorLifeInfo(hunt: PredatorState, tuning: EcologyTuning, count: number, botCount: number): PredatorLifeInfo | null {
  const life = hunt.life
  if (life === undefined) return null
  const eco = tuning.predator.ecology
  const hungry = isHungry(hunt, tuning)
  const drain = predatorDrain(hunt, tuning)
  let cubBlock: CubBlock = null
  if (life.kidsKills < eco.killsPerCub) cubBlock = 'kills'
  else if (life.age < eco.adultAge) cubBlock = 'age'
  else if (life.energy < eco.cubCost + eco.huntBelow) cubBlock = 'energy'
  else if (count >= tuning.predator.maxCount) cubBlock = 'cap'
  else if (count >= predatorLimit(botCount, tuning)) cubBlock = 'prey'
  return {
    energy: life.energy,
    maxEnergy: eco.maxEnergy,
    huntBelow: eco.huntBelow,
    hungry,
    ticksToHungry: !hungry && drain > 0 ? Math.ceil((life.energy - eco.huntBelow) / drain) : null,
    ticksToStarve: drain > 0 ? Math.ceil(life.energy / drain) : null,
    age: life.age,
    maxAge: eco.maxAge,
    adult: life.age >= eco.adultAge,
    kidsKills: life.kidsKills,
    killsPerCub: eco.killsPerCub,
    cubBlock,
  }
}

/** Where a predator came from, as words; the parent stays an id so the inspector can make it a button. */
export function originText(life: { origin: PredatorOrigin; born: number; parentId: number | null }): { text: string; parentId: number | null } {
  const born = life.born.toLocaleString('en-US')
  switch (life.origin) {
    case 'founder':
      return { text: 'Founder', parentId: null }
    case 'placed':
      return { text: `Placed by you at tick ${born}`, parentId: null }
    case 'cub':
      return { text: `Cub of #${life.parentId ?? '?'}, born tick ${born}`, parentId: life.parentId }
    case 'arrived':
      return { text: `Arrived from the map edge at tick ${born}`, parentId: null }
  }
}

/** The den a predator occupies: the first whose distance to the predator's home is within `denRadius` (the sim's `homedNear` rule), or null. */
export function denFor(dens: readonly Den[], hunt: Pick<PredatorState, 'homeX' | 'homeY'>, denRadius: number): Den | null {
  for (const den of dens) {
    if (Math.hypot(den.x - hunt.homeX, den.y - hunt.homeY) <= denRadius) return den
  }
  return null
}

export type PredatorCounts = {
  total: number
  /** Hunting-ready predators (`isHungry`); all of them when ecology is off. */
  hungry: number
  byOrigin: Record<PredatorOrigin, number>
}

export function predatorCounts(nodes: readonly WorldNode[], tuning: EcologyTuning): PredatorCounts {
  const counts: PredatorCounts = { total: 0, hungry: 0, byOrigin: { founder: 0, placed: 0, cub: 0, arrived: 0 } }
  for (const node of nodes) {
    if (node.kind !== 'predator') continue
    counts.total += 1
    if (node.hunt !== null && isHungry(node.hunt, tuning)) counts.hungry += 1
    const origin = node.hunt?.life?.origin
    if (origin !== undefined) counts.byOrigin[origin] += 1
  }
  return counts
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

/** The notice for a refused predator placement at the cap: "Predator cap reached (8 / 8: 2 founders, 5 cubs, 1 placed). Remove one to place another." */
export function predatorCapNotice(nodes: readonly WorldNode[], tuning: EcologyTuning): string {
  const counts = predatorCounts(nodes, tuning)
  const { byOrigin } = counts
  const parts = [
    byOrigin.founder > 0 ? plural(byOrigin.founder, 'founder', 'founders') : '',
    byOrigin.cub > 0 ? plural(byOrigin.cub, 'cub', 'cubs') : '',
    byOrigin.placed > 0 ? `${byOrigin.placed} placed` : '',
    byOrigin.arrived > 0 ? `${byOrigin.arrived} arrived` : '',
  ].filter((part) => part !== '')
  const head = `${counts.total} / ${tuning.predator.maxCount}`
  return `Predator cap reached (${parts.length === 0 ? head : `${head}: ${parts.join(', ')}`}). Remove one to place another.`
}

/** How the predator count changed over the last `windowTicks`; null when either end of the window has no predator count (ecology off, or no history). */
export function predatorChange(
  samples: readonly Sample[],
  current: Sample,
  windowTicks: number,
): { span: number; delta: number } | null {
  const start = sampleAtOrBefore(samples, current.tick - windowTicks)
  if (start === undefined || start.tick >= current.tick) return null
  if (start.predators === undefined || current.predators === undefined) return null
  return { span: current.tick - start.tick, delta: current.predators - start.predators }
}

/** The samples that have a predator count, as chart points. */
export function predatorSeries(points: readonly Sample[]): { tick: number; count: number }[] {
  const series: { tick: number; count: number }[] = []
  for (const point of points) {
    if (point.predators !== undefined) series.push({ tick: point.tick, count: point.predators })
  }
  return series
}

export type PreyPressure = {
  /** How many predators the bots can carry now (the cap when the prey rule is off). */
  limit: number
  /** True while the predator count is over the limit. */
  over: boolean
  /** Ticks until the next predator leaves (the sim's `leaveAfter` countdown); null when not over the limit or the rule is off. */
  leavesIn: number | null
}

/** The prey rule as the page shows it. Over the limit means more predators than `predatorLimit(botCount)`; the sim's timer `overSince` gives the countdown. */
export function preyPressure(
  ecology: Pick<PredatorEcology, 'prey'> | undefined,
  botCount: number,
  count: number,
  tick: number,
  tuning: EcologyTuning,
): PreyPressure {
  const limit = predatorLimit(botCount, tuning)
  const active = tuning.predator.ecology.enabled && tuning.predator.prey.enabled
  const over = active && count > limit
  const since = ecology?.prey?.overSince ?? null
  const leavesIn = over && since !== null ? Math.max(0, since + tuning.predator.prey.leaveAfter - tick) : null
  return { limit, over, leavesIn }
}

/** A trait multiplier as text: "×1.15". */
export function multiplierText(value: number): string {
  return `×${value.toFixed(2)}`
}

/** Which way a multiplier points once rounded to two decimals (so "×1.00" is flat). */
export function multiplierTrend(value: number): 'up' | 'down' | 'flat' {
  const rounded = Number(value.toFixed(2))
  return rounded > 1 ? 'up' : rounded < 1 ? 'down' : 'flat'
}

export const MULTIPLIER_GLYPH = { up: '▲', down: '▼', flat: '■' } as const

export type PredatorTraitRow = {
  key: PredatorTraitName | 'generation'
  label: string
  /** The trait in the units of the shipped number: "9.2 cells", "0.97 /tick", "46 ticks"; the generation as a plain count. */
  value: string
  /** The multiplier against founders ("×1.15"); null for the generation. */
  multiplier: string | null
  trend: 'up' | 'down' | 'flat' | null
  /** Extra words for the tooltip. */
  note: string | null
}

/** A predator's heritable traits as rows (sense, speed, stamina, generation), or null when it has none (traits off, or a predator made before they were on). */
export function predatorTraitRows(hunt: Pick<PredatorState, 'traits' | 'generation'>, tuning: Pick<Tuning, 'predator' | 'bot' | 'mutation'>): PredatorTraitRow[] | null {
  const traits = hunt.traits
  if (traits === undefined) return null
  const { senseRadius, speed, chaseTicks } = tuning.predator
  const fastestFlee = tuning.bot.speed * tuning.mutation.bounds.sprint.max
  const base = { sense: senseRadius, speed, stamina: chaseTicks }
  const unit = {
    sense: (value: number) => `${value.toFixed(1)} cells`,
    speed: (value: number) => `${value.toFixed(2)} /tick`,
    stamina: (value: number) => `${Math.round(value)} ticks`,
  }
  const label = { sense: 'Sense', speed: 'Speed', stamina: 'Stamina' }
  const notes = {
    sense: 'Sense radius: how far it sees. Costs extra hunger.',
    speed: `Chase speed. Bots flee at up to ${fastestFlee.toFixed(2)}, so a faster predator can catch even a full sprinter.`,
    stamina: 'How long a chase lasts before it gives up.',
  }
  const rows: PredatorTraitRow[] = PREDATOR_TRAIT_NAMES.map((name) => ({
    key: name,
    label: label[name],
    value: unit[name](base[name] * traits[name]),
    multiplier: multiplierText(traits[name]),
    trend: multiplierTrend(traits[name]),
    note: notes[name],
  }))
  rows.push({ key: 'generation', label: 'Generation', value: String(hunt.generation ?? 0), multiplier: null, trend: null, note: 'Founders, placed and arriving predators are generation 0; a cub is its parent plus 1.' })
  return rows
}
