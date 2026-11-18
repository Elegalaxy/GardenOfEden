// Headless run of one seeded world, printed as a table.
//   npm run sim -- --seed a --ticks 5000 [--preset eden] [--every 500]
//   npm run sim -- --seeds a,b,c --ticks 20000 [--preset eden] [--warmup 1000]
// First form: one row at tick 0, then one every `--every` ticks (and the last
// tick), then the final state hash. Second form: one summary row per seed
// (final, min and max population after the warmup, births, deaths by cause).
// Both print the mean of each trait over the living bots (sense, caution,
// reproAt, metab), after a line with the founders' values.
// `learned` counts memory entries bots took from a parent or child (M10); the last two columns are the
// lineage records kept and the ones pruned so far (M11);
// `pAge` (M16) is the mean parent age at a birth over the kept lineage records.
// `--no-family` (either form) switches that sharing off, for comparing against a run with it.
// `--asexual` (either form) switches the two sexes off (a bot breeds alone, as before M17); the last
// survey column `fem` is the number of females alive at the end, and `inb` (M18) counts inbred births.
// `--no-cone` (either form) switches directional sensing off (V1; it is on in Eden since V2, so this flag applies before `--set` overrides).
// `--no-seasons` (either form) switches seasonal regrowth off (S1; seasons are on in Eden since S2, so this gives the pre-season control).
// `--predator-traits` (H1, either form) is shorthand for `--set predator.traits.enabled=true`; the last survey columns are then pSense pSpeed pStam pGen.
// `--static-predators` (either form) switches predator ecology off (fixed predators, as before E1; ecology is on by default since E2).
// The last survey columns (E1) are `preds` (predators at the end), `pMin`/`pMax` (their range after the warmup), `pBorn`, `pArr`, `pStarve`,
// `pAged` (cubs born, newcomers arrived, predators starved or dead of age), `huntGap` (mean ticks between one predator's kills, the first
// of each predator skipped) and `idle` (huntGap minus `predator.digestTicks`: the time a predator spent looking); a dash when there is no data.
// E2 adds `pZero` (longest run of ticks after the warmup with no predator) and `pCap%` (share of those ticks at `predator.maxCount`).
// `--set seasons.amplitude=0.4` (repeatable, either form) replaces one existing number or boolean of the tuning for this run only
// (an unknown path is an error), so a sweep needs no edit to tuning.ts; applied after the other switches, in order.
// `--event drought@3000` (repeatable) applies a world event at a tick in either
// form (see script.ts: `plague@6000:48,32`, `meteor@5000:30,20`).
// Same arguments always print the same output.

import { findPreset, presets, rules } from '../content/index.ts'
import { checkEcology, checkPrey } from '../sim/predators.ts'
import { checkPerception } from '../sim/perception.ts'
import { checkSeasons } from '../sim/seasons.ts'
import { stateHash } from '../sim/hash.ts'
import { step } from '../sim/step.ts'
import { meanTraits } from '../sim/traits.ts'
import { createWorld, totalDeaths, totalFood, totalRuinFood } from '../sim/world.ts'
import type { Rules, World } from '../sim/types.ts'
import { EVENT_USAGE, makeScript, parseEventSpec } from './script.ts'
import type { ScriptedCommand } from './script.ts'
import { parseOverride, withOverrides } from './overrides.ts'
import type { Override } from './overrides.ts'
import { formatSurvey, meanParentAge, parentAgeCell, ruinShareCell, surveySeed, traitCell, withoutCone, withoutEcology, withoutFamily, withoutPrey, withoutSeasons, withoutSex } from './survey.ts'

const USAGE = [
  'usage: npm run sim -- --seed <seed> --ticks <1-1000000> [--preset <id>] [--every <1-1000000>]',
  '       npm run sim -- --seeds <seed,seed,...> --ticks <1-1000000> [--preset <id>] [--warmup <0-1000000>]',
  `       either form also takes ${EVENT_USAGE} and --no-family (no knowledge sharing between parent and child)`,
  '       and --asexual (no two sexes: a bot breeds alone), --no-seasons (no seasonal regrowth), --no-cone (all-round sensing)',
  '       and --static-predators (predator ecology off: fixed predators), --no-prey (P1 prey rule off), --predator-traits (H1 heritable predator traits on)',
  '       and --set path.to.setting=value (repeatable: replace one existing tuning number or boolean for this run)',
  `       presets: ${presets.map((preset) => preset.id).join(', ')}`,
].join('\n')
const SEED_PATTERN = /^[A-Za-z0-9-]{1,32}$/
const TICKS_MAX = 1_000_000
const DEFAULT_PRESET = 'eden'
const DEFAULT_EVERY = 500
const DEFAULT_WARMUP = 1000

type Options = {
  seeds: string[]
  survey: boolean
  ticks: number
  preset: string
  every: number
  warmup: number
  noFamily: boolean
  asexual: boolean
  noSeasons: boolean
  noCone: boolean
  staticPredators: boolean
  noPrey: boolean
  overrides: Override[]
  script: ScriptedCommand[]
}

function parseCount(name: string, text: string | undefined, min = 1): number {
  const value = Number(text)
  if (text === undefined || !Number.isInteger(value) || value < min || value > TICKS_MAX) {
    throw new Error(`${name} must be a whole number from ${min} to ${TICKS_MAX}, received ${text ?? 'nothing'}`)
  }
  return value
}

function parseArgs(argv: string[]): Options {
  let seeds: string[] | undefined
  let survey = false
  let warmup = DEFAULT_WARMUP
  let ticks: number | undefined
  let preset = DEFAULT_PRESET
  let every = DEFAULT_EVERY
  let noFamily = false
  let asexual = false
  let noSeasons = false
  let noCone = false
  let staticPredators = false
  let noPrey = false
  const overrides: Override[] = []
  const script: ScriptedCommand[] = []
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--no-family') {
      // The only flag without a value: step back so the loop's `i += 2` moves on by one.
      noFamily = true
      i -= 1
    } else if (flag === '--asexual') {
      asexual = true
      i -= 1
    } else if (flag === '--no-cone') {
      noCone = true
    } else if (flag === '--no-seasons') {
      noSeasons = true
      i -= 1
    } else if (flag === '--static-predators') {
      staticPredators = true
      i -= 1
    } else if (flag === '--predator-traits') {
      overrides.push(parseOverride('predator.traits.enabled=true'))
      i -= 1
    } else if (flag === '--no-prey') {
      noPrey = true
      i -= 1
    } else if (flag === '--set') {
      overrides.push(parseOverride(value))
    } else if (flag === '--seed') {
      if (value === undefined || !SEED_PATTERN.test(value)) {
        throw new Error('--seed must be 1-32 letters, digits or dashes')
      }
      seeds = [value]
    } else if (flag === '--seeds') {
      const list = (value ?? '').split(',')
      if (list.length === 0 || list.some((seed) => !SEED_PATTERN.test(seed))) {
        throw new Error('--seeds must be a comma-separated list of 1-32 letter, digit or dash seeds')
      }
      seeds = list
      survey = true
    } else if (flag === '--warmup') {
      warmup = parseCount('--warmup', value, 0)
    } else if (flag === '--ticks') {
      ticks = parseCount('--ticks', value)
    } else if (flag === '--every') {
      every = parseCount('--every', value)
    } else if (flag === '--event') {
      script.push(parseEventSpec(value))
    } else if (flag === '--preset') {
      if (value === undefined || findPreset(value) === undefined) {
        throw new Error(`--preset must be one of: ${presets.map((p) => p.id).join(', ')}`)
      }
      preset = value
    } else {
      throw new Error(`unknown argument ${flag}`)
    }
  }
  if (seeds === undefined) throw new Error('--seed or --seeds is required')
  if (ticks === undefined) throw new Error('--ticks is required')
  return { seeds, survey, ticks, preset, every, warmup, noFamily, asexual, noSeasons, noCone, staticPredators, noPrey, overrides, script }
}

function row(world: World): string {
  const { starve, thirst, danger, plague, meteor, predator, age } = world.deathsByCause
  const traits = meanTraits(world.bots)
  const cells = [
    world.tick,
    world.bots.length,
    world.totalBirths,
    totalDeaths(world),
    starve,
    thirst,
    danger,
    plague,
    meteor,
    predator,
    age,
    totalFood(world).toFixed(1),
    totalRuinFood(world).toFixed(1),
    traitCell(traits, 'senseRadius'),
    traitCell(traits, 'caution'),
    traitCell(traits, 'reproThreshold'),
    traitCell(traits, 'metabolism'),
    traitCell(traits, 'sprint'),
    traitCell(traits, 'longevity'),
    traitCell(traits, 'hardiness'),
    traitCell(traits, 'wariness'),
    ruinShareCell(world.eaten),
    world.familyLearned,
    world.lineage.length,
    world.lineagePruned,
    parentAgeCell(meanParentAge(world)),
  ]
  return cells.map((cell) => String(cell).padStart(9)).join('')
}

function foundersLine(active: Rules): string {
  const t = active.tuning.traits
  return `founders: sense=${t.senseRadius} caution=${t.caution} reproAt=${t.reproThreshold} metab=${t.metabolism} sprint=${t.sprint} longev=${t.longevity} hardy=${t.hardiness} wary=${t.wariness}`
}

function main(argv: string[]): void {
  let options: Options
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(USAGE)
    process.exitCode = 1
    return
  }
  const preset = findPreset(options.preset)
  if (preset === undefined) return
  const familyRules = options.noFamily ? withoutFamily(rules) : rules
  const sexRules = options.asexual ? withoutSex(familyRules) : familyRules
  const seasonRules = options.noSeasons ? withoutSeasons(sexRules) : sexRules
  const staticRules = options.staticPredators ? withoutEcology(seasonRules) : seasonRules
  const coneRules = options.noCone ? withoutCone(staticRules) : staticRules
  const preyRules = options.noPrey ? withoutPrey(coneRules) : coneRules
  let active: Rules
  try {
    active = withOverrides(preyRules, options.overrides)
    checkSeasons(active.tuning.seasons)
    if (active.tuning.predator.ecology.enabled) checkEcology(active.tuning.predator.ecology)
    if (active.tuning.predator.ecology.enabled && active.tuning.predator.prey.enabled) checkPrey(active.tuning.predator.prey, active.tuning.predator.maxCount)
    if (active.tuning.perception.cone.enabled) checkPerception(active.tuning.perception.cone)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return
  }
  const flags = `${options.noFamily ? ' no-family' : ''}${options.asexual ? ' asexual' : ''}${options.noSeasons ? ' no-seasons' : ''}${options.noCone ? ' no-cone' : ''}${options.staticPredators ? ' static-predators' : ''}${options.noPrey ? ' no-prey' : ''}${options.overrides.map((o) => ' set ' + o.path.join('.') + '=' + o.value).join('')}`
  if (options.survey) {
    console.log(`preset=${options.preset} ticks=${options.ticks} warmup=${options.warmup}${flags}`)
    console.log(foundersLine(active))
    const rows = options.seeds.map((seed) => surveySeed(seed, preset, active, options.ticks, options.warmup, options.script))
    console.log(formatSurvey(rows))
    for (const result of rows) for (const line of result.refused) console.log(`seed ${result.seed}: ${line}`)
    return
  }
  const seed = options.seeds[0]
  const world = createWorld(seed, preset, active)
  console.log(`seed=${seed} preset=${options.preset} ticks=${options.ticks}${flags}`)
  console.log(foundersLine(active))
  console.log(
    ['tick', 'pop', 'births', 'deaths', 'starve', 'thirst', 'danger', 'plague', 'meteor', 'predator', 'age', 'food', 'ruins', 'sense', 'caution', 'reproAt', 'metab', 'sprint', 'longev', 'hardy', 'wary', 'ruin%', 'learned', 'lineage', 'pruned', 'pAge']
      .map((cell) => cell.padStart(9))
      .join(''),
  )
  console.log(row(world))
  const script = makeScript(options.script)
  for (let i = 0; i < options.ticks; i += 1) {
    for (const line of script.due(world, active)) console.log(line)
    step(world, active)
    if (world.tick % options.every === 0 || world.tick === options.ticks) console.log(row(world))
  }
  console.log(`hash ${stateHash(world)}`)
}

main(process.argv.slice(2))
