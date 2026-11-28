import { describe, expect, it } from 'vitest'

import { blankPreset, edenPreset, FEATURES, featureRules, isFeatureList, presets, presetWithFeatures, rules, rulesWithFeatures } from '../src/content/index.ts'
import { applyCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { step } from '../src/sim/step.ts'
import { roughNodes } from '../src/sim/terrain.ts'
import type { Command, Preset, Rules, Tuning, World, WorldFeature } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'

// Experimental world rules (src/content/features.ts): an empty list changes nothing at all, each feature changes only its own
// block (terrain also the preset's discs), and a featured world runs and replays deterministically.

/** Eden seed a at 5,000 ticks on the shipped rules (the same pin as tests/terrain.test.ts). */
const PIN_A_5000 = '03cc23ee3c4d0701'

const IDS: WorldFeature[] = ['poison', 'terrain', 'culture', 'predatorSexes', 'resistance']

const DISCS = [
  { x: 75, y: 5, radius: 8.75 },
  { x: 76, y: 18, radius: 8.75 },
  { x: 74, y: 42, radius: 8.75 },
  { x: 75, y: 55, radius: 8.75 },
]

/** The tuning without one feature's block, to compare everything else. */
function without(tuning: Tuning, feature: WorldFeature): unknown {
  const copy = structuredClone(tuning) as unknown as Record<string, unknown> & { predator: Record<string, unknown> }
  if (feature === 'predatorSexes') delete copy.predator.sexes
  else delete copy[feature]
  return copy
}

describe('the feature list', () => {
  it('lists every feature once, in canonical order, and offers the ones with a UI', () => {
    expect(FEATURES.map((feature) => feature.id)).toEqual(IDS)
    for (const feature of FEATURES) {
      expect(feature.label.length).toBeGreaterThan(0)
      expect(feature.summary.length).toBeGreaterThan(0)
      expect(feature.caveat.length).toBeGreaterThan(0)
    }
    expect(FEATURES.filter((feature) => feature.pickable).map((feature) => feature.id)).toEqual(['poison', 'culture', 'resistance'])
  })

  it('accepts known features in canonical order and refuses unknown, repeated or out of order ones', () => {
    expect(isFeatureList([])).toBe(true)
    expect(isFeatureList(IDS)).toBe(true)
    expect(isFeatureList(['poison', 'culture'])).toBe(true)
    expect(isFeatureList(['disease'])).toBe(false)
    expect(isFeatureList(['poison', 'poison'])).toBe(false)
    expect(isFeatureList(['culture', 'poison'])).toBe(false)
    expect(isFeatureList([1])).toBe(false)
    expect(isFeatureList('poison')).toBe(false)
    expect(isFeatureList(undefined)).toBe(false)
  })
})

describe('with no feature', () => {
  it('hands back the very same rules and preset', () => {
    expect(rulesWithFeatures(rules, [])).toBe(rules)
    expect(featureRules([])).toBe(rules)
    for (const preset of presets) expect(presetWithFeatures(preset, [])).toBe(preset)
  })

  it('keeps the pinned Eden hash', () => {
    const active = featureRules([])
    const world = createWorld('a', presetWithFeatures(edenPreset, []), active)
    while (world.tick < 5000) step(world, active)
    expect(stateHash(world)).toBe(PIN_A_5000)
  })
})

describe('what a feature changes', () => {
  const before = JSON.stringify(rules)

  it.each(IDS)('%s changes only its own block and leaves the shipped rules alone', (id) => {
    const active = featureRules([id])
    expect(active).not.toBe(rules)
    expect(featureRules([id])).toBe(active)
    expect(active.nodeDefs).toEqual(rules.nodeDefs)
    expect(without(active.tuning, id)).toEqual(without(rules.tuning, id))
    expect(active.tuning).not.toEqual(rules.tuning)
    expect(JSON.stringify(rules)).toBe(before)
  })

  it('uses the agreed settings', () => {
    const { tuning } = featureRules(IDS)
    expect(tuning.poison).toEqual({ enabled: true, toxicCount: 2, damagePerUnit: 3 })
    expect(tuning.terrain).toEqual({ ...rules.tuning.terrain, enabled: true, botSpeedMult: 0.7, predatorSpeedMult: 0.7, wanderOnly: true, fleeExempt: false })
    expect(tuning.culture).toEqual({ ...rules.tuning.culture, enabled: true, perLesson: 3, teachEvery: 50, teachRadius: 3, teachKinds: ['water', 'shelter'], beyondSense: false })
    expect(tuning.predator.sexes).toEqual({ enabled: true, mateRange: 145, loneAfter: 1500, killsPerCub: 2, crossover: true })
    expect(tuning.resistance).toEqual({
      ...rules.tuning.resistance,
      enabled: true,
      founderMin: 1,
      founderMax: 1.4,
      catchWeight: 0,
      sickWeight: 0.5,
      damageWeight: 1,
      centred: true,
      upkeep: 0,
      mutation: { rate: 0.2, strength: 0.1 },
    })
  })

  it('replaces the preset discs only with terrain, on every preset', () => {
    for (const preset of presets) {
      expect(presetWithFeatures(preset, ['poison', 'culture', 'predatorSexes', 'resistance'])).toBe(preset)
      const rough = presetWithFeatures(preset, ['terrain'])
      expect(rough).toEqual({ ...preset, terrain: DISCS })
    }
    expect(edenPreset.terrain).not.toEqual(DISCS)
    expect(blankPreset.terrain).toBeUndefined()
    const world = createWorld('a', presetWithFeatures(blankPreset, ['terrain']), featureRules(['terrain']))
    expect(roughNodes(world).map((node) => ({ x: node.x, y: node.y, radius: node.radius }))).toEqual(DISCS)
  })
})

describe('a featured world', () => {
  const TICKS = 3000
  const outbreak: Command = { type: 'triggerEvent', event: 'outbreak', x: 18, y: 55 }

  function play(preset: Preset, active: Rules): World {
    const world = createWorld('a', preset, active)
    while (world.tick < 1000) step(world, active)
    expect(applyCommand(world, active, outbreak).ok).toBe(true)
    while (world.tick < TICKS) step(world, active)
    return world
  }

  it.each([...IDS.map((id) => [id]), IDS])('runs, repeats and replays with %s', (...features) => {
    const list = features.flat() as WorldFeature[]
    const preset = presetWithFeatures(edenPreset, list)
    const active = featureRules(list)
    const world = play(preset, active)
    expect(world.tick).toBe(TICKS)
    const hash = stateHash(world)
    expect(stateHash(play(preset, active))).toBe(hash)
    expect(stateHash(replayWorld('a', preset, active, world.commands, TICKS))).toBe(hash)
  })
})
