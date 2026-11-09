// Headless run of one seeded world, printed as a table.
//   npm run sim -- --seed a --ticks 5000 [--preset eden] [--every 500]
//   npm run sim -- --seeds a,b,c --ticks 20000 [--preset eden] [--warmup 1000]
// First form: one row at tick 0, then one every `--every` ticks (and the last
// tick), then the final state hash. Second form: one summary row per seed
// (final, min and max population after the warmup, births, deaths by cause).
// Both print the mean of each trait over the living bots (sense, caution,
// reproAt, metab), after a line with the founders' values.
// The last column, `learned`, counts memory entries bots took from a parent or child (M10).
// `--no-family` (either form) switches that sharing off, for comparing against a run with it.
// `--event drought@3000` (repeatable) applies a world event at a tick in either
// form (see script.ts: `plague@6000:48,32`, `meteor@5000:30,20`).
// Same arguments always print the same output.

import { findPreset, presets, rules } from '../content/index.ts'
import { stateHash } from '../sim/hash.ts'
import { step } from '../sim/step.ts'
import { meanTraits } from '../sim/traits.ts'
import { createWorld, totalDeaths, totalFood, totalRuinFood } from '../sim/world.ts'
import type { World } from '../sim/types.ts'
import { EVENT_USAGE, makeScript, parseEventSpec } from './script.ts'
import type { ScriptedCommand } from './script.ts'
import { formatSurvey, ruinShareCell, surveySeed, traitCell, withoutFamily } from './survey.ts'

const USAGE = [
  'usage: npm run sim -- --seed <seed> --ticks <1-1000000> [--preset <id>] [--every <1-1000000>]',
  '       npm run sim -- --seeds <seed,seed,...> --ticks <1-1000000> [--preset <id>] [--warmup <0-1000000>]',
  `       either form also takes ${EVENT_USAGE} and --no-family (no knowledge sharing between parent and child)`,
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
  const script: ScriptedCommand[] = []
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--no-family') {
      // The only flag without a value: step back so the loop's `i += 2` moves on by one.
      noFamily = true
      i -= 1
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
  return { seeds, survey, ticks, preset, every, warmup, noFamily, script }
}

function row(world: World): string {
  const { starve, thirst, danger, plague, meteor, age } = world.deathsByCause
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
    age,
    totalFood(world).toFixed(1),
    totalRuinFood(world).toFixed(1),
    traitCell(traits, 'senseRadius'),
    traitCell(traits, 'caution'),
    traitCell(traits, 'reproThreshold'),
    traitCell(traits, 'metabolism'),
    ruinShareCell(world.eaten),
    world.familyLearned,
  ]
  return cells.map((cell) => String(cell).padStart(8)).join('')
}

function foundersLine(): string {
  const t = rules.tuning.traits
  return `founders: sense=${t.senseRadius} caution=${t.caution} reproAt=${t.reproThreshold} metab=${t.metabolism}`
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
  const active = options.noFamily ? withoutFamily(rules) : rules
  if (options.survey) {
    console.log(`preset=${options.preset} ticks=${options.ticks} warmup=${options.warmup}${options.noFamily ? ' no-family' : ''}`)
    console.log(foundersLine())
    const rows = options.seeds.map((seed) => surveySeed(seed, preset, active, options.ticks, options.warmup, options.script))
    console.log(formatSurvey(rows))
    for (const result of rows) for (const line of result.refused) console.log(`seed ${result.seed}: ${line}`)
    return
  }
  const seed = options.seeds[0]
  const world = createWorld(seed, preset, active)
  console.log(`seed=${seed} preset=${options.preset} ticks=${options.ticks}${options.noFamily ? ' no-family' : ''}`)
  console.log(foundersLine())
  console.log(
    ['tick', 'pop', 'births', 'deaths', 'starve', 'thirst', 'danger', 'plague', 'meteor', 'age', 'food', 'ruins', 'sense', 'caution', 'reproAt', 'metab', 'ruin%', 'learned']
      .map((cell) => cell.padStart(8))
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
