// Rule variants shared by tests (not a test file itself). `asexual` turns the two sexes off, so a single
// bot standing in a shelter breeds alone: tests of energy, cooldown and memory mechanics use it to keep
// one-bot scenes simple. `stage1` is the world as it was before M17 (asexual and the old numbers for
// eatRate, reproCooldown, birthCost and the founders' reproThreshold), used by the asexual control tests.

import type { Rules } from '../src/sim/types.ts'

export function asexual(rules: Rules): Rules {
  return { ...rules, tuning: { ...rules.tuning, sex: { ...rules.tuning.sex, enabled: false } } }
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
