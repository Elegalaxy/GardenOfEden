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
// the kept lineage records whose parent record is also kept (a dash when there are none; with sexes it is the
// mother's age). `fem` (M17) is the number of females among the bots alive at the end.
// `inb` (M18) is the number of births whose parents were close relatives (inbreeding score above 0).
// The E1 columns come after `inb`: `preds` is the predators alive at the end, `pMin`/`pMax` their range after the warmup, `pBorn`/`pArr`/`pStarve`/`pAged`
// the cubs born, newcomers arrived and predators starved or dead of age (0 with ecology off). `huntGap` is the mean ticks between one
// predator's kills (its first kill has no gap before it; read from `hunt.kills` once a tick) and `idle` the mean of gap minus `predator.digestTicks`,
// so it is how long a predator spent looking for the next bot; both are null (a dash) when no predator killed twice.
// E2 adds `pZero` (the longest run of ticks after the warmup with no predator at all) and `pCap%` (the share of ticks after the warmup with
// `predator.maxCount` predators), the two bars that show a predator population dying out or filling the map; both after `idle`.
// `withoutFamily` gives the rules with that
// sharing switched off, for an A/B comparison (`--no-family`); `withoutSex` gives the rules with sexes off (`--asexual`); `withoutSeasons` switches seasons off (`--no-seasons`); `withoutEcology` switches predator ecology off (`--static-predators`).

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
  /** The warmup the min, max and predator columns skip. */
  warmup: number
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
  /** Females among the bots alive at the end (M17). */
  females: number
  /** Births with an inbreeding score above 0 (M18). */
  inbred: number
  /** Predators alive at the end, and their lowest and highest count after the warmup (E1). */
  preds: number
  predMin: number
  predMax: number
  /** Predator ecology counters (E1): cubs born, newcomers arrived, starved, dead of age. 0 with ecology off. */
  predBorn: number
  predArrived: number
  predStarved: number
  predAged: number
  /** Mean ticks between one predator's kills, and that minus `predator.digestTicks`; null when no predator killed twice. */
  huntGap: number | null
  idle: number | null
  /** Longest run of ticks after the warmup with no predator alive (E2). */
  predZeroRun: number
  /** Ticks after the warmup with `predator.maxCount` predators alive (E2). */
  predCapTicks: number
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

/** The same rules with the two sexes off: every bot breeds alone, as before M17. */
export function withoutSex(rules: Rules): Rules {
  return { ...rules, tuning: { ...rules.tuning, sex: { ...rules.tuning.sex, enabled: false } } }
}

/** The same rules with family knowledge sharing off: newborns start empty and nobody exchanges. */
export function withoutFamily(rules: Rules): Rules {
  return { ...rules, tuning: { ...rules.tuning, family: { ...rules.tuning.family, inherit: false, shareRadius: 0 } } }
}

/** The same rules with the seasons off (food regrowth back to the fixed rate): `--no-seasons`. */
export function withoutSeasons(rules: Rules): Rules {
  return { ...rules, tuning: { ...rules.tuning, seasons: { ...rules.tuning.seasons, enabled: false } } }
}

/** The same rules with predator ecology off (fixed predators): `--static-predators`. */
export function withoutEcology(rules: Rules): Rules {
  const { predator } = rules.tuning
  return { ...rules, tuning: { ...rules.tuning, predator: { ...predator, ecology: { ...predator.ecology, enabled: false } } } }
}

/** Remembers each predator's kill count and last kill tick; `record` is called once a tick and returns the gaps between kills seen this tick. */
export function createGapTracker(): { record: (world: Pick<World, 'tick' | 'nodes'>) => number[] } {
  const seen = new Map<number, { kills: number; last: number | null }>()
  return {
    record(world) {
      const gaps: number[] = []
      for (const node of world.nodes) {
        const hunt = node.hunt
        if (node.kind !== 'predator' || hunt === null) continue
        const entry = seen.get(node.id)
        if (entry === undefined) {
          // First sighting: kills it already has give no gap.
          seen.set(node.id, { kills: hunt.kills, last: null })
          continue
        }
        if (hunt.kills > entry.kills) {
          if (entry.last !== null) gaps.push(world.tick - entry.last)
          entry.last = world.tick
          entry.kills = hunt.kills
        }
      }
      return gaps
    },
  }
}

/** A gap for a table cell: whole ticks, or a dash. */
export function gapCell(value: number | null): string {
  return value === null ? '-' : value.toFixed(0)
}

/** The share of ticks after the warmup spent at the predator cap, as a whole percentage; a dash when no tick was counted. */
function capCell(r: SeedSurvey): string {
  const counted = r.ticks - r.warmup
  return counted <= 0 ? '-' : ((100 * r.predCapTicks) / counted).toFixed(0)
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
  let predMin = Infinity
  let predMax = -Infinity
  let zeroRun = 0
  let predZeroRun = 0
  let predCapTicks = 0
  const gapTracker = createGapTracker()
  const gaps: number[] = []
  const predatorCount = (): number => world.nodes.filter((node) => node.kind === 'predator').length
  for (let i = 0; i < ticks; i += 1) {
    refused.push(...scripted.due(world, rules))
    step(world, rules)
    gaps.push(...gapTracker.record(world))
    if (world.tick > warmup) {
      min = Math.min(min, world.bots.length)
      max = Math.max(max, world.bots.length)
      const predators = predatorCount()
      predMin = Math.min(predMin, predators)
      predMax = Math.max(predMax, predators)
      zeroRun = predators === 0 ? zeroRun + 1 : 0
      predZeroRun = Math.max(predZeroRun, zeroRun)
      if (predators >= rules.tuning.predator.maxCount) predCapTicks += 1
    }
  }
  if (min === Infinity) {
    min = world.bots.length
    max = world.bots.length
  }
  if (predMin === Infinity) {
    predMin = predatorCount()
    predMax = predMin
  }
  const stats = world.ecology?.stats
  const gapMean = gaps.length === 0 ? null : gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
  return {
    seed,
    ticks,
    warmup,
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
    females: world.bots.filter((bot) => bot.sex === 'female').length,
    inbred: world.inbredBirths,
    preds: predatorCount(),
    predMin,
    predMax,
    predBorn: stats?.births ?? 0,
    predArrived: stats?.arrivals ?? 0,
    predStarved: stats?.starved ?? 0,
    predAged: stats?.aged ?? 0,
    huntGap: gapMean,
    idle: gapMean === null ? null : gapMean - rules.tuning.predator.digestTicks,
    predZeroRun,
    predCapTicks,
    hash: stateHash(world),
    refused,
  }
}

export function formatSurvey(rows: SeedSurvey[]): string {
  const head = ['seed', 'final', 'min', 'max', 'births', 'starve', 'thirst', 'danger', 'plague', 'meteor', 'predator', 'age', 'sense', 'caution', 'reproAt', 'metab', 'sprint', 'longev', 'hardy', 'wary', 'ruin%', 'learned', 'lineage', 'pruned', 'pAge', 'fem', 'inb', 'preds', 'pMin', 'pMax', 'pBorn', 'pArr', 'pStarve', 'pAged', 'huntGap', 'idle', 'pZero', 'pCap%']
    .map((c) => c.padStart(9))
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
      r.deaths.predator,
      r.deaths.age,
      traitCell(r.traits, 'senseRadius'),
      traitCell(r.traits, 'caution'),
      traitCell(r.traits, 'reproThreshold'),
      traitCell(r.traits, 'metabolism'),
      traitCell(r.traits, 'sprint'),
      traitCell(r.traits, 'longevity'),
      traitCell(r.traits, 'hardiness'),
      traitCell(r.traits, 'wariness'),
      ruinShareCell(r.eaten),
      r.learned,
      r.lineage,
      r.pruned,
      parentAgeCell(r.parentAge),
      r.females,
      r.inbred,
      r.preds,
      r.predMin,
      r.predMax,
      r.predBorn,
      r.predArrived,
      r.predStarved,
      r.predAged,
      gapCell(r.huntGap),
      gapCell(r.idle),
      r.predZeroRun,
      capCell(r),
    ]
      .map((cell) => String(cell).padStart(9))
      .join(''),
  )
  return [head, ...lines].join('\n')
}
