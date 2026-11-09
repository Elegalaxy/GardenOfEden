import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { desperateFraction, isDesperate } from '../src/sim/brain.ts'
import { applyCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { step } from '../src/sim/step.ts'
import type { Bot, Preset, Rules, World } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'

// How early a bot gets desperate depends on its caution (M12). These need the real numbers from
// src/content, so they live here and not next to src/sim.

const { tuning, nodeDefs } = rules
const { brain } = tuning

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', width: 40, height: 40, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

function botWith(caution: number): Bot {
  const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }] }), rules)
  const bot = world.bots[0]!
  bot.traits.caution = caution
  return bot
}

describe('desperateFraction', () => {
  it('is the plain desperateBelow for a bot with the founders caution', () => {
    expect(desperateFraction(botWith(tuning.traits.caution), tuning)).toBeCloseTo(brain.desperateBelow, 12)
  })

  it('is higher for a reckless bot and lower for a cautious one, in a straight line between the clamps', () => {
    const founder = desperateFraction(botWith(0.5), tuning)
    const reckless = desperateFraction(botWith(0.4), tuning)
    const cautious = desperateFraction(botWith(0.6), tuning)
    expect(reckless).toBeGreaterThan(founder)
    expect(cautious).toBeLessThan(founder)
    expect(reckless).toBeCloseTo(brain.desperateBelow * (1 + brain.cautionDesperate * 0.1), 12)
    expect(cautious).toBeCloseTo(brain.desperateBelow * (1 - brain.cautionDesperate * 0.1), 12)
  })

  it('is clamped into [minDesperate, maxDesperate]', () => {
    const bounds = tuning.mutation.bounds.caution
    expect(desperateFraction(botWith(bounds.min), tuning)).toBe(brain.maxDesperate)
    expect(desperateFraction(botWith(bounds.max), tuning)).toBe(brain.minDesperate)
    for (let caution = bounds.min; caution <= bounds.max; caution += 0.05) {
      const fraction = desperateFraction(botWith(caution), tuning)
      expect(fraction).toBeGreaterThanOrEqual(brain.minDesperate)
      expect(fraction).toBeLessThanOrEqual(brain.maxDesperate)
    }
  })

  it('is the same for every bot when cautionDesperate is 0', () => {
    const off: Rules = { ...rules, tuning: { ...tuning, brain: { ...brain, cautionDesperate: 0 } } }
    expect(desperateFraction(botWith(0.05), off.tuning)).toBeCloseTo(brain.desperateBelow, 12)
    expect(desperateFraction(botWith(1.5), off.tuning)).toBeCloseTo(brain.desperateBelow, 12)
  })

  it('decides isDesperate for both hunger and thirst, and only for a seeker', () => {
    const reckless = botWith(0.2)
    const cautious = botWith(1)
    const level = 0.25 * tuning.bot.maxEnergy // between the two thresholds
    for (const [kind, need] of [['seekFood', 'energy'], ['seekWater', 'thirst']] as const) {
      for (const bot of [reckless, cautious]) {
        bot.energy = tuning.bot.maxEnergy
        bot.thirst = tuning.bot.maxThirst
        bot[need] = level
        bot.intent = { kind, targetId: 1 }
      }
      expect(isDesperate(reckless, tuning)).toBe(true)
      expect(isDesperate(cautious, tuning)).toBe(false)
    }
    reckless.intent = { kind: 'wander', targetId: null }
    expect(isDesperate(reckless, tuning)).toBe(false)
  })
})

describe('a hungry bot and a grove', () => {
  // Food in the middle of a danger zone, 12 cells from the bot, which can sense it from the start.
  const grove = scene({
    nodes: [
      { kind: 'danger', x: 24, y: 20 },
      { kind: 'resource', x: 24, y: 20 },
    ],
    bots: [{ x: 12, y: 20 }],
  })

  /** Holds the bot at a fixed hunger and returns how close to the grove's centre it gets. */
  function approach(caution: number, energy: number): number {
    const world = createWorld('a', grove, rules)
    const bot = world.bots[0]!
    bot.traits.senseRadius = 12
    bot.traits.caution = caution
    let closest = Infinity
    for (let i = 0; i < 200; i += 1) {
      bot.energy = energy
      bot.thirst = tuning.bot.maxThirst
      bot.health = tuning.bot.maxHealth
      step(world, rules)
      closest = Math.min(closest, Math.hypot(bot.x - 24, bot.y - 20))
    }
    return closest
  }

  const moderate = 0.25 * tuning.bot.maxEnergy
  const safeDistance = nodeDefs.danger.radius + brain.avoidMargin - 1e-9

  it('is walked into by a reckless bot at moderate hunger but not by a cautious one', () => {
    expect(approach(0.2, moderate)).toBeLessThan(nodeDefs.danger.radius)
    expect(approach(1, moderate)).toBeGreaterThanOrEqual(safeDistance)
  })

  it('is walked into by a cautious bot once it is starving enough', () => {
    expect(approach(1, 0.03 * tuning.bot.maxEnergy)).toBeLessThan(nodeDefs.danger.radius)
  })

  it('does not tempt a founder-caution bot at 25% energy (the plain threshold is 20%)', () => {
    expect(approach(tuning.traits.caution, moderate)).toBeGreaterThanOrEqual(safeDistance)
  })
})

describe('determinism with the desperate rule', () => {
  function run(): World {
    const world = createWorld('c', edenPreset, rules)
    for (let i = 0; i < 1000; i += 1) step(world, rules)
    expect(applyCommand(world, rules, { type: 'placeNode', kind: 'resource', x: 30.5, y: 30.5 }).ok).toBe(true)
    for (let i = 0; i < 1000; i += 1) step(world, rules)
    return world
  }

  it('gives the same hash for the same seed and replays a run with commands to the live hash', { timeout: 60_000 }, () => {
    const live = run()
    expect(stateHash(run())).toBe(stateHash(live))
    const replayed = replayWorld('c', edenPreset, rules, live.commands, live.tick)
    expect(stateHash(replayed)).toBe(stateHash(live))
  })
})
