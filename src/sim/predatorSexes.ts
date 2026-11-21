// Predator sexes (PS1, `Tuning.predator.sexes`, off; acts only with ecology on, and only in a world made with both, whose `ecology.sexes`
// holds `oneSexSince`, `mated` and `alone`). A predator that appeared while both were on has `hunt.sex` (the last key of its state).
//
// Every new predator gets `predatorAutoSex`: the sex there are FEWER of among the predators that have one, a tie gives female. No draw. Founders,
// arrivals, cubs (counted together with the cubs already made this tick) and placed predators without a chosen sex all use it, so Eden's three
// founders are female, male, female.
//
// Only a female bears a cub (the existing checks in predators.ts, with `sexes.killsPerCub` instead of `ecology.killsPerCub`), and only with a mate:
// `findMate` is the nearest adult male (`life.age >= ecology.adultAge`) within `mateRange` of her, ties to the lowest id. There is no courtship and the
// male pays nothing and has no cooldown. With no mate there is no cub and no draw. Once only one sex has been alive for `loneAfter` ticks
// (`ecology.sexes.oneSexSince`) any predator breeds alone under the E1 rule and its cub is the missing sex. `lastOfSex` is used by the prey rule's
// leaving step: the only predator of its sex stays unless nobody else can leave.
//
// `predatorSexCounts` is a pure summary the harness and the page read. This file imports only types.ts and exactMath.ts (never predators.ts).

import { hypot } from './exactMath.ts'
import type { PredatorState, Sex, Tuning, World, WorldNode } from './types.ts'

type PredatorNodes = readonly Pick<WorldNode, 'kind' | 'hunt'>[]

/** Throws when the sexes numbers cannot work: two booleans, `mateRange` above 0, `loneAfter` and `killsPerCub` whole numbers from 1. */
export function checkPredatorSexes(sexes: Tuning['predator']['sexes']): void {
  if (typeof sexes.enabled !== 'boolean') throw new RangeError(`predator.sexes.enabled must be true or false, received ${String(sexes.enabled)}`)
  if (typeof sexes.crossover !== 'boolean') throw new RangeError(`predator.sexes.crossover must be true or false, received ${String(sexes.crossover)}`)
  if (!(Number.isFinite(sexes.mateRange) && sexes.mateRange > 0)) {
    throw new RangeError(`predator.sexes.mateRange must be a number above 0, received ${sexes.mateRange}`)
  }
  if (!(Number.isInteger(sexes.loneAfter) && sexes.loneAfter >= 1)) {
    throw new RangeError(`predator.sexes.loneAfter must be a whole number from 1, received ${sexes.loneAfter}`)
  }
  if (!(Number.isInteger(sexes.killsPerCub) && sexes.killsPerCub >= 1)) {
    throw new RangeError(`predator.sexes.killsPerCub must be a whole number from 1, received ${sexes.killsPerCub}`)
  }
}

/** True when this world gives new predators a sex: the rule is on, ecology is on and the world was made with both. */
export function sexesOn(world: Pick<World, 'ecology'>, tuning: Pick<Tuning, 'predator'>): boolean {
  return tuning.predator.sexes.enabled && tuning.predator.ecology.enabled && world.ecology?.sexes !== undefined
}

/** Females and males among the predators that have a sex. */
export function predatorSexCounts(nodes: PredatorNodes): { females: number; males: number } {
  let females = 0
  let males = 0
  for (const node of nodes) {
    const sex = node.kind === 'predator' ? node.hunt?.sex : undefined
    if (sex === 'female') females += 1
    else if (sex === 'male') males += 1
  }
  return { females, males }
}

/** The sex a new predator gets: the one there are fewer of among predators that have a sex; a tie gives female. No draws. */
export function predatorAutoSex(nodes: PredatorNodes): Sex {
  const { females, males } = predatorSexCounts(nodes)
  return males < females ? 'male' : 'female'
}

/** Give a predator its sex. Call after `startTraits`, so the keys come in the order life, traits, generation, sex. */
export function startSex(hunt: PredatorState | null, sex: Sex): void {
  if (hunt === null) return
  hunt.sex = sex
}

/** The nearest adult male within `mateRange` of the female (a tie goes to the lowest id, nodes being in id order); null when there is none. */
export function findMate(nodes: readonly WorldNode[], female: WorldNode, tuning: Pick<Tuning, 'predator'>): WorldNode | null {
  const { mateRange } = tuning.predator.sexes
  const { adultAge } = tuning.predator.ecology
  let best: WorldNode | null = null
  let bestDistance = Infinity
  for (const node of nodes) {
    const hunt = node.hunt
    if (node.kind !== 'predator' || hunt === null || hunt.sex !== 'male') continue
    if (hunt.life === undefined || hunt.life.age < adultAge) continue
    const d = hypot(node.x - female.x, node.y - female.y)
    if (d > mateRange || d >= bestDistance) continue
    best = node
    bestDistance = d
  }
  return best
}

/** True when `node` has a sex and no other predator of that sex is alive. */
export function lastOfSex(nodes: PredatorNodes, node: Pick<WorldNode, 'hunt'>): boolean {
  const sex = node.hunt?.sex
  if (sex === undefined) return false
  for (const other of nodes) {
    if (other.kind === 'predator' && other.hunt !== node.hunt && other.hunt?.sex === sex) return false
  }
  return true
}
