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
