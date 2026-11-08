// Many-seed survey of one preset: run each seed for N ticks and summarise the
// population. Used by `npm run sim -- --seeds a,b,c --ticks 20000` and by the
// survival test, so both judge the same numbers.
//
// min and max are taken over ticks after `warmup` (the founders settling in is
// not a swing). `final` is the population at the last tick.

import { stateHash } from '../sim/hash.ts'
import { step } from '../sim/step.ts'
import type { DeathsByCause, Preset, Rules } from '../sim/types.ts'
import { createWorld } from '../sim/world.ts'

export type SeedSurvey = {
  seed: string
  ticks: number
  final: number
  min: number
  max: number
  births: number
  deaths: DeathsByCause
  hash: string
}

export function surveySeed(seed: string, preset: Preset, rules: Rules, ticks: number, warmup: number): SeedSurvey {
  const world = createWorld(seed, preset, rules)
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < ticks; i += 1) {
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
    hash: stateHash(world),
  }
}

export function formatSurvey(rows: SeedSurvey[]): string {
  const head = ['seed', 'final', 'min', 'max', 'births', 'starve', 'danger', 'age'].map((c) => c.padStart(8)).join('')
  const lines = rows.map((r) =>
    [r.seed, r.final, r.min, r.max, r.births, r.deaths.starve, r.deaths.danger, r.deaths.age]
      .map((cell) => String(cell).padStart(8))
      .join(''),
  )
  return [head, ...lines].join('\n')
}
