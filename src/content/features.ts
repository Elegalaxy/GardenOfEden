// Experimental world rules: rules that are built but off in Eden, which a new world may opt into. The switches live
// outside the World (like the preset id): this module turns a feature list into the {rules, preset} that the unchanged
// createWorld, step and replayWorld take. With an empty list it returns the very same objects, so hashes are unchanged.
//
// A saved world stores only the feature ids, so it replays on the settings below. Bump SIM_VERSION (version.ts) whenever
// any of these settings changes. Each feature replaces only the keys listed for its own tuning block (terrain also
// replaces the preset's rough discs); every other number stays the shipped one. Combinations are allowed and untested.

import type { Preset, Rules, Tuning, WorldFeature } from '../sim/types.ts'
import { rules } from './rules.ts'

export type FeatureInfo = {
  id: WorldFeature
  label: string
  /** What the rule does, in one sentence. */
  summary: string
  /** How it failed the balance tests, which is why it is off in Eden. */
  caveat: string
  /** Whether the new-world picker offers it (the harness takes every feature). */
  pickable: boolean
}

/** Every feature, in canonical order. */
export const FEATURES: readonly FeatureInfo[] = [
  {
    id: 'poison',
    label: 'Toxic food',
    summary: 'Two food nodes are toxic: they feed a bot but cost health, and bots learn to avoid them.',
    caveat: 'Missed the 60,000-tick caution bar on the old 96 x 64 map (0.4007 against 0.402).',
    pickable: true,
  },
  {
    id: 'terrain',
    label: 'Rough ground',
    summary: 'A belt of marsh in the east slows bots that are wandering and predators.',
    caveat: 'Missed the 60,000-tick caution bar: median 0.36, with only wandering bots slowed.',
    pickable: true,
  },
  {
    id: 'culture',
    label: 'Culture',
    summary: 'Elders teach young bots where water and shelter are.',
    caveat: 'A seed died out in the 60,000-tick runs.',
    pickable: true,
  },
  {
    id: 'predatorSexes',
    label: 'Predator sexes',
    summary: 'Predators are female or male, and a cub needs a pair unless one sex has gone.',
    caveat: 'One seed was 0.03 short on caution with a mate range of 120; the range used here, 145, is untested.',
    pickable: true,
  },
  {
    id: 'resistance',
    label: 'Disease resistance',
    summary: 'Bots inherit resistance to disease. Nothing happens until an outbreak.',
    caveat: 'Missed the floor for the drop in shelters by 0.9 points. Needs an outbreak (key I): nothing happens before one.',
    pickable: true,
  },
]

const POISON: Partial<Tuning['poison']> = { enabled: true, toxicCount: 2, damagePerUnit: 3 }

const TERRAIN: Partial<Tuning['terrain']> = { enabled: true, botSpeedMult: 0.7, predatorSpeedMult: 0.7, wanderOnly: true, fleeExempt: false }

/** The marsh belt that replaces the preset's rough discs while terrain is on, on every preset (Blank too). */
const TERRAIN_DISCS: NonNullable<Preset['terrain']> = [
  { x: 75, y: 5, radius: 8.75 },
  { x: 76, y: 18, radius: 8.75 },
  { x: 74, y: 42, radius: 8.75 },
  { x: 75, y: 55, radius: 8.75 },
]

const CULTURE: Partial<Tuning['culture']> = { enabled: true, perLesson: 3, teachEvery: 50, teachRadius: 3, teachKinds: ['water', 'shelter'], beyondSense: false }

const PREDATOR_SEXES: Partial<Tuning['predator']['sexes']> = { enabled: true, mateRange: 145, loneAfter: 1500, killsPerCub: 2, crossover: true }

const RESISTANCE: Partial<Tuning['resistance']> = {
  enabled: true,
  founderMin: 1,
  founderMax: 1.4,
  catchWeight: 0,
  sickWeight: 0.5,
  damageWeight: 1,
  centred: true,
  upkeep: 0,
  mutation: { rate: 0.2, strength: 0.1 },
}

/** Writes one feature's settings into a tuning copy. The settings are cloned, so no two rules share an object. */
const APPLY: Record<WorldFeature, (tuning: Tuning) => void> = {
  poison: (tuning) => {
    tuning.poison = { ...tuning.poison, ...structuredClone(POISON) }
  },
  terrain: (tuning) => {
    tuning.terrain = { ...tuning.terrain, ...structuredClone(TERRAIN) }
  },
  culture: (tuning) => {
    tuning.culture = { ...tuning.culture, ...structuredClone(CULTURE) }
  },
  predatorSexes: (tuning) => {
    tuning.predator.sexes = { ...tuning.predator.sexes, ...structuredClone(PREDATOR_SEXES) }
  },
  resistance: (tuning) => {
    tuning.resistance = { ...tuning.resistance, ...structuredClone(RESISTANCE) }
  },
}

/** Is `value` a list of known features, each at most once, in canonical order? The empty list is one. */
export function isFeatureList(value: unknown): value is WorldFeature[] {
  if (!Array.isArray(value)) return false
  let last = -1
  for (const item of value) {
    const at = FEATURES.findIndex((feature) => feature.id === item)
    if (at <= last) return false
    last = at
  }
  return true
}

/** The rules with the features on: `base` itself for an empty list, else a copy with only those blocks replaced. */
export function rulesWithFeatures(base: Rules, features: readonly WorldFeature[]): Rules {
  if (features.length === 0) return base
  const copy = structuredClone(base)
  for (const feature of features) APPLY[feature](copy.tuning)
  return copy
}

/** The preset a world with these features starts from: the same object unless terrain is on. */
export function presetWithFeatures(preset: Preset, features: readonly WorldFeature[]): Preset {
  if (!features.includes('terrain')) return preset
  return { ...preset, terrain: TERRAIN_DISCS.map((disc) => ({ ...disc })) }
}

const memo = new Map<string, Rules>()

/** The shipped rules with the features on, built once per list; the shipped `rules` object itself for an empty list. */
export function featureRules(features: readonly WorldFeature[]): Rules {
  if (features.length === 0) return rules
  const key = features.join(',')
  let made = memo.get(key)
  if (made === undefined) {
    made = rulesWithFeatures(rules, features)
    memo.set(key, made)
  }
  return made
}
