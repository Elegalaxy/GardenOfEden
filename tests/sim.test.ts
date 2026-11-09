import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { stateHash } from '../src/sim/hash.ts'
import { step } from '../src/sim/step.ts'
import type { Preset, World } from '../src/sim/types.ts'
import { createWorld, totalDeaths, totalFood } from '../src/sim/world.ts'

// Sim tests that need the real content (rules, presets) live here, because
// src/sim files may not import src/content.

const TICKS = 5000

function run(seed: string, preset: Preset, ticks: number): World {
  const world = createWorld(seed, preset, rules)
  for (let i = 0; i < ticks; i += 1) step(world, rules)
  return world
}

describe('determinism', () => {
  it('gives the same state hash for the same seed after 5000 ticks', () => {
    const first = stateHash(run('a', edenPreset, TICKS))
    const second = stateHash(run('a', edenPreset, TICKS))
    expect(second).toBe(first)
    expect(first).toMatch(/^[0-9a-f]{16}$/)
  }, 60_000)

  it('gives a different state for a different seed', () => {
    expect(stateHash(run('a', edenPreset, 200))).not.toBe(stateHash(run('b', edenPreset, 200)))
  })

  it('survives a JSON copy mid-run and continues identically', () => {
    const live = run('a', edenPreset, 300)
    const copy = JSON.parse(JSON.stringify(live)) as World
    for (let i = 0; i < 300; i += 1) {
      step(live, rules)
      step(copy, rules)
    }
    expect(stateHash(copy)).toBe(stateHash(live))
  })
})

describe('starvation', () => {
  const lone: Preset = {
    id: 'lone',
    label: 'Lone bot',
    width: 32,
    height: 32,
    nodes: [],
    scatter: [],
    bots: [{ x: 16, y: 16 }],
    scatterBots: 0,
  }

  it('starves a lone bot with no food on the expected tick', () => {
    const { startEnergy } = rules.tuning.bot
    const perTick = rules.tuning.bot.baseDrain + rules.tuning.bot.moveDrain
    const expected = Math.ceil(startEnergy / (perTick * rules.tuning.traits.metabolism))
    expect(expected).toBe(140)

    const world = createWorld('lone', lone, rules)
    for (let i = 0; i < expected - 1; i += 1) step(world, rules)
    expect(world.bots).toHaveLength(1)
    expect(world.deathsByCause.starve).toBe(0)

    step(world, rules)
    expect(world.tick).toBe(expected)
    expect(world.bots).toHaveLength(0)
    expect(world.deathsByCause.starve).toBe(1)
    const death = world.log.find((event) => event.type === 'death')
    expect(death).toMatchObject({ tick: expected, cause: 'starve' })
  })
})

describe('resources', () => {
  it('never exceed capacity and never go negative over 5000 ticks', () => {
    const world = createWorld('a', edenPreset, rules)
    for (let i = 0; i < TICKS; i += 1) {
      step(world, rules)
      for (const node of world.nodes) {
        expect(node.amount).toBeLessThanOrEqual(node.capacity)
        expect(node.amount).toBeGreaterThanOrEqual(0)
      }
    }
  }, 60_000)

  it('deplete when eaten and regrow afterwards', () => {
    const feast: Preset = {
      id: 'feast',
      label: 'One node, one bot',
      width: 32,
      height: 32,
      nodes: [{ kind: 'resource', x: 16, y: 16 }],
      scatter: [],
      bots: [{ x: 16, y: 16 }],
      scatterBots: 0,
    }
    const world = createWorld('feast', feast, rules)
    const full = totalFood(world)
    expect(full).toBe(rules.nodeDefs.resource.capacity)
    // The bot is not hungry at first, so it wanders off; shrink its energy to make it eat.
    world.bots[0].energy = 20
    let lowest = full
    for (let i = 0; i < 60; i += 1) {
      step(world, rules)
      lowest = Math.min(lowest, totalFood(world))
    }
    expect(lowest).toBeLessThan(full)
    // With the bot gone or sated, the node refills toward capacity.
    world.bots = []
    for (let i = 0; i < 400; i += 1) step(world, rules)
    expect(totalFood(world)).toBe(rules.nodeDefs.resource.capacity)
  })
})

describe('eden preset', () => {
  it('keeps a population alive with food around and accounts for every bot', () => {
    const world = run('a', edenPreset, TICKS)
    expect(world.bots.length).toBeGreaterThan(0)
    expect(totalDeaths(world) + world.bots.length).toBe(edenPreset.scatterBots + world.totalBirths)
    expect(world.samples.length).toBe(1 + TICKS / rules.tuning.stats.sampleEvery)
  })
})
