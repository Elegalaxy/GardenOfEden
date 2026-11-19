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
// the cubs born, newcomers arrived and predators starved or dead of age (0 with ecology off, which `--static-predators` gives). `huntGap` is the mean ticks between one
// predator's kills (its first kill has no gap before it; read from `hunt.kills` once a tick) and `idle` the mean of gap minus `predator.digestTicks`,
// so it is how long a predator spent looking for the next bot; both are null (a dash) when no predator killed twice.
// E2 adds `pZero` (the longest run of ticks after the warmup with no predator at all) and `pCap%` (the share of ticks after the warmup with
// `predator.maxCount` predators), the two bars that show a predator population dying out or filling the map; both after `idle`.
// H1 adds `pSense pSpeed pStam pGen` last: the mean sense, speed and stamina of the predators alive at the end and the highest predator generation seen (a dash with predator traits off, or when no predator is alive for the means).
// P1 adds `pCorr`, `pCorrL`, `pLag` and `pLeft` after `pCap%`: the Pearson correlation between the predator count and the bot count, taken every
// `stats.sampleEvery` ticks after the warmup, at lag 0 and at the best of the lags in `PREY_LAGS` (predators now against bots that many ticks earlier,
// with that lag), and the predators that left the map under the prey rule (0 with it off; `withoutPrey` and `--no-prey` switch it off). A dash
// means the series had no variance or was too short.
// T1 adds `pois tox toxK` last (toxic food, `--set poison.enabled=true`; a dash for each with poison off): bots dead of poison, the food units eaten from toxic
// nodes, and the share (percent) of the bots alive at the end that remember at least one toxic node. `withoutPoison` and `--no-poison` switch it off.
// `withoutFamily` gives the rules with that
// sharing switched off, for an A/B comparison (`--no-family`); `withoutSex` gives the rules with sexes off (`--asexual`); `withoutSeasons` switches seasons off (`--no-seasons`); `withoutEcology` switches predator ecology off (`--static-predators`); `withoutCone` switches the V1 vision cone off (`--no-cone`).

import { stateHash } from '../sim/hash.ts'
import { step } from '../sim/step.ts'
import { predatorTraitStats } from '../sim/predatorTraits.ts'
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
  /** Correlation of the predator count with the bot count at the same time (P1), and the best one over `PREY_LAGS` with its lag in ticks; null without variance. */
  predCorr: number | null
  predCorrBest: number | null
  predLag: number | null
  /** Predators that left the map under the prey rule (P1). */
  predLeft: number
  /** Mean sense, speed and stamina of the predators alive at the end, and the highest generation seen over the run (H1); null with predator traits off. */
  predTraits: { sense: number; speed: number; stamina: number } | null
  predMaxGen: number | null
  /** Toxic food (T1): poison deaths, units eaten from toxic nodes and the percentage of living bots that know a toxic node; null with poison off. */
  poison: { deaths: number; eaten: number; knowing: number } | null
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

/** The same rules with the V1 vision cone off (all-round sensing): `--no-cone`. */
export function withoutCone(rules: Rules): Rules {
  return { ...rules, tuning: { ...rules.tuning, perception: { ...rules.tuning.perception, cone: { ...rules.tuning.perception.cone, enabled: false } } } }
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

/** The same rules with the P1 prey rule off: `--no-prey`. */
export function withoutPrey(rules: Rules): Rules {
  const { predator } = rules.tuning
  return { ...rules, tuning: { ...rules.tuning, predator: { ...predator, prey: { ...predator.prey, enabled: false } } } }
}

/** The same rules with toxic food off: `--no-poison`. */
export function withoutPoison(rules: Rules): Rules {
  return { ...rules, tuning: { ...rules.tuning, poison: { ...rules.tuning.poison, enabled: false } } }
}

/** The same rules with mate choice off: `--no-mate-choice` (G1). */
export function withoutMateChoice(rules: Rules): Rules {
  return { ...rules, tuning: { ...rules.tuning, mateChoice: { ...rules.tuning.mateChoice, enabled: false } } }
}

/** Lags (ticks) at which the predator count is compared with the bot count (P1). */
export const PREY_LAGS = [0, 500, 1000, 1500, 2000, 3000]

/** Pearson correlation of two equal-length series; null when shorter than 2 or either has no variance. */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return null
  let sx = 0
  let sy = 0
  for (let i = 0; i < n; i += 1) {
    sx += xs[i]
    sy += ys[i]
  }
  const mx = sx / n
  const my = sy / n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  if (sxx === 0 || syy === 0) return null
  return sxy / Math.sqrt(sxx * syy)
}

/** The lag (in samples, from `lags`) at which predators(t) correlates best (highest value) with bots(t - lag); null when no lag gives a correlation. */
export function bestLag(pred: readonly number[], bots: readonly number[], lags: readonly number[]): { lag: number; corr: number } | null {
  let best: { lag: number; corr: number } | null = null
  for (const lag of lags) {
    if (lag >= pred.length) continue
    const corr = pearson(pred.slice(lag), bots.slice(0, bots.length - lag))
    if (corr !== null && (best === null || corr > best.corr)) best = { lag, corr }
  }
  return best
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

/** A correlation for a table cell: two decimals, or a dash. */
export function corrCell(value: number | null): string {
  return value === null ? '-' : value.toFixed(2)
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
  let predMaxGen = 0
  const traitsTracked = rules.tuning.predator.traits.enabled
  const gapTracker = createGapTracker()
  const gaps: number[] = []
  const botSeries: number[] = []
  const predSeries: number[] = []
  const predatorCount = (): number => world.nodes.filter((node) => node.kind === 'predator').length
  for (let i = 0; i < ticks; i += 1) {
    refused.push(...scripted.due(world, rules))
    step(world, rules)
    gaps.push(...gapTracker.record(world))
    if (traitsTracked) {
      for (const node of world.nodes) {
        const generation = node.hunt?.generation
        if (generation !== undefined && generation > predMaxGen) predMaxGen = generation
      }
    }
    if (world.tick > warmup) {
      min = Math.min(min, world.bots.length)
      max = Math.max(max, world.bots.length)
      const predators = predatorCount()
      predMin = Math.min(predMin, predators)
      predMax = Math.max(predMax, predators)
      zeroRun = predators === 0 ? zeroRun + 1 : 0
      predZeroRun = Math.max(predZeroRun, zeroRun)
      if (predators >= rules.tuning.predator.maxCount) predCapTicks += 1
      if ((world.tick - warmup) % rules.tuning.stats.sampleEvery === 0) {
        botSeries.push(world.bots.length)
        predSeries.push(predators)
      }
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
  const traitSummary = predatorTraitStats(world.nodes)
  const every = rules.tuning.stats.sampleEvery
  const best = bestLag(predSeries, botSeries, PREY_LAGS.map((lag) => lag / every))
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
    predCorr: pearson(predSeries, botSeries),
    predCorrBest: best === null ? null : best.corr,
    predLag: best === null ? null : best.lag * every,
    predLeft: world.ecology?.prey?.left ?? 0,
    predTraits: traitSummary === null ? null : { sense: traitSummary.stats.sense.mean, speed: traitSummary.stats.speed.mean, stamina: traitSummary.stats.stamina.mean },
    predMaxGen: traitsTracked ? predMaxGen : null,
    poison:
      world.eaten.toxic === undefined
        ? null
        : {
            deaths: world.deathsByCause.poison ?? 0,
            eaten: world.eaten.toxic,
            knowing: world.bots.length === 0 ? 0 : (100 * world.bots.filter((bot) => bot.memory.some((entry) => entry.toxic === true)).length) / world.bots.length,
          },
    hash: stateHash(world),
    refused,
  }
}

export function formatSurvey(rows: SeedSurvey[]): string {
  const head = ['seed', 'final', 'min', 'max', 'births', 'starve', 'thirst', 'danger', 'plague', 'meteor', 'predator', 'age', 'sense', 'caution', 'reproAt', 'metab', 'sprint', 'longev', 'hardy', 'wary', 'ruin%', 'learned', 'lineage', 'pruned', 'pAge', 'fem', 'inb', 'preds', 'pMin', 'pMax', 'pBorn', 'pArr', 'pStarve', 'pAged', 'huntGap', 'idle', 'pZero', 'pCap%', 'pCorr', 'pCorrL', 'pLag', 'pLeft', 'pSense', 'pSpeed', 'pStam', 'pGen', 'pois', 'tox', 'toxK', 'inb%']
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
      corrCell(r.predCorr),
      corrCell(r.predCorrBest),
      r.predLag === null ? '-' : r.predLag,
      r.predLeft,
      r.predTraits === null ? '-' : r.predTraits.sense.toFixed(2),
      r.predTraits === null ? '-' : r.predTraits.speed.toFixed(2),
      r.predTraits === null ? '-' : r.predTraits.stamina.toFixed(2),
      r.predMaxGen === null ? '-' : r.predMaxGen,
      r.poison === null ? '-' : r.poison.deaths,
      r.poison === null ? '-' : r.poison.eaten.toFixed(0),
      r.poison === null ? '-' : r.poison.knowing.toFixed(0),
      r.births === 0 ? '-' : ((100 * r.inbred) / r.births).toFixed(1),
    ]
      .map((cell) => String(cell).padStart(9))
      .join(''),
  )
  return [head, ...lines].join('\n')
}
