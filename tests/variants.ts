// Rule variants shared by tests (not a test file itself). `asexual` turns the two sexes off, so a single
// bot standing in a shelter breeds alone: tests of energy, cooldown and memory mechanics use it to keep
// one-bot scenes simple. `stage1` is the world as it was before M17 (asexual and the old numbers for
// eatRate, reproCooldown, birthCost and the founders' reproThreshold), used by the asexual control tests.
// `edenWithDanger` is Eden as it was before M21b (three fixed danger zones in the groves and four scattered ones, no
// predators, same node order so the world stream draws the same): the control tests that pin pre-M17 or pre-M20 numbers
// run on it, since those numbers belong to that map.

import type { Preset, Rules } from '../src/sim/types.ts'
import { edenPreset } from '../src/content/index.ts'

export function asexual(rules: Rules): Rules {
  return { ...rules, tuning: { ...rules.tuning, sex: { ...rules.tuning.sex, enabled: false } } }
}

/** Eden before M21b: the preset's predators are danger zones at the same points and the four scattered danger zones are back. */
export function edenWithDanger(): Preset {
  return {
    ...edenPreset,
    nodes: edenPreset.nodes.map((node) => (node.kind === 'predator' ? { ...node, kind: 'danger' as const } : node)),
    scatter: [
      { kind: 'resource', count: 34 },
      { kind: 'danger', count: 4 },
      { kind: 'shelter', count: 12 },
      { kind: 'water', count: 4 },
    ],
  }
}

/**
 * M22 traits with no effect: the four new traits are pinned at 1 (bounds min = max = 1) and their costs are 0, so a bot
 * behaves as before M22 but the `birth` stream still takes its 12 extra draws per sexual child (8 per asexual one). Control
 * tests that pin counts re-pin them on this variant (the pre-M22 numbers cannot come back, the draws moved).
 */
export function neutralTraits(rules: Rules): Rules {
  const one = { min: 1, max: 1 }
  const { tuning } = rules
  return {
    ...rules,
    tuning: {
      ...tuning,
      bot: { ...tuning.bot, sprintUpkeep: 0, hardinessDrain: 0, longevityDrain: 0 },
      mutation: {
        ...tuning.mutation,
        bounds: { ...tuning.mutation.bounds, sprint: one, longevity: one, hardiness: one, wariness: one },
      },
    },
  }
}

/** The same rules with the seasons switched off (they are on in Eden since S2; control tests that pin pre-season numbers or read exact amounts run on this). */
export function noSeasons(rules: Rules): Rules {
  return { ...rules, tuning: { ...rules.tuning, seasons: { ...rules.tuning.seasons, enabled: false } } }
}

/** The same rules with predator ecology switched on (E1; it is off in the shipped numbers), with optional number overrides. */
export function withEcology(rules: Rules, over: Partial<Rules['tuning']['predator']['ecology']> = {}): Rules {
  const { predator } = rules.tuning
  return { ...rules, tuning: { ...rules.tuning, predator: { ...predator, ecology: { ...predator.ecology, ...over, enabled: true } } } }
}

/** The same rules with predator ecology off: fixed predators (the shipped rules have it on since E2). */
export function staticPredators(rules: Rules): Rules {
  const { predator } = rules.tuning
  return { ...rules, tuning: { ...rules.tuning, predator: { ...predator, ecology: { ...predator.ecology, enabled: false } } } }
}

/** The same rules with the V1 vision cone switched on (it is off in the shipped numbers), with optional number overrides. */
export function withCone(rules: Rules, over: Partial<Rules['tuning']['perception']['cone']> = {}): Rules {
  const { perception } = rules.tuning
  return { ...rules, tuning: { ...rules.tuning, perception: { ...perception, cone: { ...perception.cone, ...over, enabled: true } } } }
}

/** The same rules with the vision cone off (all-round sensing, the shipped setting). */
export function noCone(rules: Rules): Rules {
  const { perception } = rules.tuning
  return { ...rules, tuning: { ...rules.tuning, perception: { ...perception, cone: { ...perception.cone, enabled: false } } } }
}

export function stage1(rules: Rules): Rules {
  const { tuning } = rules
  return {
    ...rules,
    tuning: {
      ...tuning,
      sex: { ...tuning.sex, enabled: false },
      bot: { ...tuning.bot, eatRate: 5, reproCooldown: 300, birthCost: 20 },
      traits: { ...tuning.traits, reproThreshold: 80 },
    },
  }
}
