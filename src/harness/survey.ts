// Many-seed survey of one preset: run each seed for N ticks and summarise the
// population. Used by `npm run sim -- --seeds a,b,c --ticks 20000` and by the
// survival test, so both judge the same numbers.
//
// min and max are taken over ticks after `warmup` (the founders settling in is
// not a swing). `final` is the population at the last tick. `traits` is the
// mean of each trait over the bots alive at the last tick (null if none).
// `eaten` is the food units eaten over the whole run, from resources and from
// ruins; `ruin%` in the table is the ruins' share of it. A `script` (see script.ts)
// applies player commands, such as world events, at their ticks; `refused` lists
// the ones the sim refused. `learned` is how many memory entries bots took from a
// parent or child over the run (M10); `lineage` and `pruned` are the lineage records kept at the end and
// dropped over the run (M11). `pAge` (M16) is the mean parent age at a birth: child.born - parent.born over
// the kept lineage records whose parent record is also kept (a dash when there are none). `withoutFamily` gives the rules with that
// sharing switched off, for an A/B comparison (`--no-family`).

import { stateHash } from '../sim/hash.ts'
import { step } from '../sim/step.ts'
import { meanTraits } from '../sim/traits.ts'
import { findRecord } from '../sim/lineage.ts'
import type { DeathsByCause, Eaten, Preset, Rules, Traits, World } from '../sim/types.ts'
import { createWorld } from '../sim/world.ts'
import { makeScript } from './script.ts'
import type { ScriptedCommand } from './script.ts'

export type SeedSurvey = {
  seed: string
  ticks: number
  final: number
  min: number
  max: number
  births: number
  deaths: DeathsByCause
  traits: Traits | null
  eaten: Eaten
  /** Memory entries learned from a parent or child (birth and exchange). */
  learned: number
  /** Lineage records kept at the end, and records pruned over the run (M11). */
  lineage: number
  pruned: number
  /** Mean parent age at a birth over the kept lineage records (M16); null when none qualify. */
  parentAge: number | null
  hash: string
  /** Scripted commands the sim refused. */
  refused: string[]
}

/** Mean of child.born - parent.born over kept records whose parent record is kept; null when none. */
export function meanParentAge(world: Pick<World, 'lineage'>): number | null {
  let sum = 0
  let count = 0
  for (const record of world.lineage) {
    if (record.parentId === null) continue
    const parent = findRecord(world as World, record.parentId)
    if (parent === undefined) continue
    sum += record.born - parent.born
    count += 1
  }
  return count === 0 ? null : sum / count
}

/** The mean parent age for a table cell: whole ticks, or a dash. */
export function parentAgeCell(value: number | null): string {
  return value === null ? '-' : value.toFixed(0)
}

/** The ruins' share of all food eaten, as a percentage with one decimal; a dash when nothing was eaten. */
export function ruinShareCell(eaten: Eaten): string {
  const total = eaten.resource + eaten.ruin
  return total <= 0 ? '-' : `${((100 * eaten.ruin) / total).toFixed(1)}`
}

/** The same rules with family knowledge sharing off: newborns start empty and nobody exchanges. */
export function withoutFamily(rules: Rules): Rules {
  return { ...rules, tuning: { ...rules.tuning, family: { ...rules.tuning.family, inherit: false, shareRadius: 0 } } }
}

/** A mean trait for a table cell: two decimals, or a dash when nobody is alive. */
export function traitCell(traits: Traits | null, name: keyof Traits): string {
  return traits === null ? '-' : traits[name].toFixed(2)
}

export function surveySeed(
  seed: string,
  preset: Preset,
  rules: Rules,
  ticks: number,
  warmup: number,
  script: readonly ScriptedCommand[] = [],
): SeedSurvey {
  const world = createWorld(seed, preset, rules)
  const scripted = makeScript(script)
  const refused: string[] = []
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < ticks; i += 1) {
    refused.push(...scripted.due(world, rules))
    step(world, rules)
    if (world.tick > warmup) {
      min = Math.min(min, world.bots.length)
      max = Math.max(max, world.bots.length)
    }
  }
  if (min === Infinity) {
    min = world.bots.length
    max = world.bots.length
  }
  return {
    seed,
    ticks,
    final: world.bots.length,
    min,
    max,
    births: world.totalBirths,
    deaths: { ...world.deathsByCause },
    traits: meanTraits(world.bots),
    eaten: { ...world.eaten },
    learned: world.familyLearned,
    lineage: world.lineage.length,
    pruned: world.lineagePruned,
    parentAge: meanParentAge(world),
    hash: stateHash(world),
    refused,
  }
}

export function formatSurvey(rows: SeedSurvey[]): string {
  const head = ['seed', 'final', 'min', 'max', 'births', 'starve', 'thirst', 'danger', 'plague', 'meteor', 'age', 'sense', 'caution', 'reproAt', 'metab', 'ruin%', 'learned', 'lineage', 'pruned', 'pAge']
    .map((c) => c.padStart(8))
    .join('')
  const lines = rows.map((r) =>
    [
      r.seed,
      r.final,
      r.min,
      r.max,
      r.births,
      r.deaths.starve,
      r.deaths.thirst,
      r.deaths.danger,
      r.deaths.plague,
      r.deaths.meteor,
      r.deaths.age,
      traitCell(r.traits, 'senseRadius'),
      traitCell(r.traits, 'caution'),
      traitCell(r.traits, 'reproThreshold'),
      traitCell(r.traits, 'metabolism'),
      ruinShareCell(r.eaten),
      r.learned,
      r.lineage,
      r.pruned,
      parentAgeCell(r.parentAge),
    ]
      .map((cell) => String(cell).padStart(8))
      .join(''),
  )
  return [head, ...lines].join('\n')
}
