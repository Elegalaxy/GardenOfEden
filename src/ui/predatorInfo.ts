// Predator ecology as the page shows it (E3): pure helpers over a predator's `hunt` (and `life`), the world's dens and the
// stats samples. Reads only what the frame carries (nodes, ecology, samples) and takes the tuning as a parameter, so tests can
// pass their own. `isHungry` is the sim's own rule, so the page can never disagree with the sim about who bites. No state.

import { isHungry } from '../sim/predators.ts'
import { sampleAtOrBefore } from '../sim/stats.ts'
import type { Den, PredatorOrigin, PredatorState, Sample, Tuning, WorldNode } from '../sim/types.ts'

type EcologyTuning = Pick<Tuning, 'predator'>

/** Why a predator is not breeding yet, in the order the sim checks (kills, age, energy, cap); null when nothing blocks it. */
export type CubBlock = 'kills' | 'age' | 'energy' | 'cap' | null

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

/** A predator's life as numbers, or null when it has none (ecology off). `count` is the predators alive now, for the cap check. */
export function predatorLifeInfo(hunt: PredatorState, tuning: EcologyTuning, count: number): PredatorLifeInfo | null {
  const life = hunt.life
  if (life === undefined) return null
  const eco = tuning.predator.ecology
  const hungry = isHungry(hunt, tuning)
  let cubBlock: CubBlock = null
  if (life.kidsKills < eco.killsPerCub) cubBlock = 'kills'
  else if (life.age < eco.adultAge) cubBlock = 'age'
  else if (life.energy < eco.cubCost + eco.huntBelow) cubBlock = 'energy'
  else if (count >= tuning.predator.maxCount) cubBlock = 'cap'
  return {
    energy: life.energy,
    maxEnergy: eco.maxEnergy,
    huntBelow: eco.huntBelow,
    hungry,
    ticksToHungry: !hungry && eco.drain > 0 ? Math.ceil((life.energy - eco.huntBelow) / eco.drain) : null,
    ticksToStarve: eco.drain > 0 ? Math.ceil(life.energy / eco.drain) : null,
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
