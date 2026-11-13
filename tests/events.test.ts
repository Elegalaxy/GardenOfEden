import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { applyCommand, checkCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { deathCause } from '../src/sim/metabolism.ts'
import { exposureAt } from '../src/sim/nodes.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { step } from '../src/sim/step.ts'
import type { Command, Preset, Rules, World } from '../src/sim/types.ts'
import { createWorld, placedNodeCount } from '../src/sim/world.ts'
import { activeEntries } from '../src/sim/worldEvents.ts'
import { surveySeed } from '../src/harness/survey.ts'

// World events (M8): drought, bounty, plague, meteor. They need the real numbers
// from src/content, so the tests live here and not next to src/sim.

const { tuning } = rules
const ev = tuning.events

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', width: 40, height: 40, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

function advanceTo(world: World, tick: number): void {
  while (world.tick < tick) step(world, rules)
}

function trigger(world: World, event: 'drought' | 'bounty'): void
function trigger(world: World, event: 'plague' | 'meteor', x: number, y: number): void
function trigger(world: World, event: 'drought' | 'bounty' | 'plague' | 'meteor', x?: number, y?: number): void {
  const result = applyCommand(world, rules, { type: 'triggerEvent', event, x, y })
  expect(result.ok, JSON.stringify(result)).toBe(true)
}

/** Rules where a resource never fills up and regrows 1 per tick, so the multiplier can be read off exactly. */
const slowRules: Rules = {
  ...rules,
  nodeDefs: { ...rules.nodeDefs, resource: { ...rules.nodeDefs.resource, capacity: 1_000_000, regen: 1 } },
}

function emptyResourceWorld(): World {
  const world = createWorld('a', scene({ nodes: [{ kind: 'resource', x: 10, y: 10 }] }), slowRules)
  world.nodes[0].amount = 0
  return world
}

describe('drought and bounty', () => {
  it('a drought slows regrowth by its factor for its duration, then lets it return to normal', () => {
    const world = emptyResourceWorld()
    applyCommand(world, slowRules, { type: 'triggerEvent', event: 'drought' })
    const duration = ev.drought.duration
    expect(world.events).toHaveLength(1)
    for (let i = 0; i < duration + 40; i += 1) step(world, slowRules)
    // `duration` ticks at the drought's rate, then 40 at the normal one.
    expect(world.nodes[0].amount).toBeCloseTo(duration * ev.drought.regrowMult + 40, 6)
    expect(world.events).toHaveLength(0)
    expect(world.log.filter((e) => e.type === 'event')).toMatchObject([{ eventKind: 'drought', tick: duration }])
  })

  it('a bounty speeds regrowth up by its factor for its duration', () => {
    const world = emptyResourceWorld()
    applyCommand(world, slowRules, { type: 'triggerEvent', event: 'bounty' })
    const duration = ev.bounty.duration
    for (let i = 0; i < duration + 40; i += 1) step(world, slowRules)
    expect(world.nodes[0].amount).toBeCloseTo(duration * ev.bounty.regrowMult + 40, 6)
    expect(world.events).toHaveLength(0)
  })

  it('both at once multiply, and neither touches a spring or a ruin', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'resource', x: 10, y: 10 }, { kind: 'water', x: 20, y: 20 }] }), slowRules)
    world.nodes[0].amount = 0
    trigger(world, 'drought')
    trigger(world, 'bounty')
    step(world, slowRules)
    expect(world.nodes[0].amount).toBeCloseTo(ev.drought.regrowMult * ev.bounty.regrowMult, 9)
    expect(world.nodes[1].amount).toBe(0)
  })

  it('is in force on its last tick and gone straight after', () => {
    const world = emptyResourceWorld()
    trigger(world, 'drought')
    const last = ev.drought.duration
    advanceTo(world, last - 1)
    expect(world.events).toHaveLength(1)
    step(world, slowRules)
    expect(world.tick).toBe(last)
    expect(world.events).toHaveLength(0)
    // The last tick still ran at the drought's rate.
    expect(world.nodes[0].amount).toBeCloseTo(last * ev.drought.regrowMult, 6)
  })
})

describe('plague', () => {
  it('hurts only bots inside the radius, for exactly its duration', () => {
    // A huge health pool and a whole-map plague, so the loss over time is exact and no bot dies.
    const big: Rules = {
      ...rules,
      tuning: { ...tuning, bot: { ...tuning.bot, maxHealth: 1e6 }, events: { ...ev, plague: { ...ev.plague, radius: 1000 } } },
    }
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }] }), big)
    const bot = world.bots[0]
    applyCommand(world, big, { type: 'triggerEvent', event: 'plague', x: 20, y: 20 })
    const duration = ev.plague.duration
    for (let i = 0; i < duration + 50; i += 1) {
      bot.energy = 100
      bot.thirst = 100
      step(world, big)
    }
    const lost = duration * (ev.plague.damage - tuning.bot.healthRegen)
    expect(bot.health).toBeCloseTo(1e6 - lost + 50 * tuning.bot.healthRegen, 6)
    expect(world.events).toHaveLength(0)
  })

  it('leaves a bot outside the radius unhurt and hurts one inside', () => {
    const world = createWorld('a', scene({ width: 100, height: 100, bots: [{ x: 10, y: 10 }, { x: 60, y: 60 }] }), rules)
    trigger(world, 'plague', 10, 10)
    for (let i = 0; i < 5; i += 1) {
      for (const bot of world.bots) {
        bot.energy = 100
        bot.thirst = 100
      }
      step(world, rules)
    }
    const [inside, outside] = world.bots
    expect(Math.hypot(inside.x - 10, inside.y - 10)).toBeLessThanOrEqual(ev.plague.radius)
    expect(inside.health).toBeLessThan(tuning.bot.maxHealth - 3)
    expect(outside.health).toBe(tuning.bot.maxHealth)
  })

  it('exposes the zone to exposureAt only while it lasts', () => {
    const world = createWorld('a', scene({}), rules)
    trigger(world, 'plague', 20, 20)
    expect(exposureAt(world, 20, 20).plague).toBe(ev.plague.damage)
    expect(exposureAt(world, 20 + ev.plague.radius + 1, 20).plague).toBe(0)
    advanceTo(world, ev.plague.duration)
    expect(exposureAt(world, 20, 20).plague).toBe(0)
  })

  it("kills with cause 'plague', logs it and leaves a ruin", () => {
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }] }), rules)
    world.bots[0].health = 0.5
    trigger(world, 'plague', 20, 20)
    step(world, rules)
    expect(world.bots).toHaveLength(0)
    expect(world.deathsByCause).toMatchObject({ plague: 1, danger: 0, meteor: 0 })
    expect(world.log.find((e) => e.type === 'death')).toMatchObject({ cause: 'plague' })
    expect(world.nodes.some((node) => node.kind === 'ruin')).toBe(true)
  })

  it('names the larger of the two damages as the cause, danger on a tie', () => {
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }] }), rules)
    const bot = world.bots[0]
    bot.health = 0
    const exposure = { damage: 1, plague: 1, heal: 0, drainMult: 1, shelterId: null }
    expect(deathCause(bot, exposure)).toBe('danger')
    expect(deathCause(bot, { ...exposure, plague: 1.5 })).toBe('plague')
    expect(deathCause(bot, { ...exposure, damage: 0, plague: 0 })).toBe('danger')
    bot.health = 5
    expect(deathCause(bot, { ...exposure, plague: 9 })).toBeNull()
  })
})

describe('meteor', () => {
  // Bots at 0, 2.5, 5 and 7 cells from the impact at (20, 20); the radius is 6 and the damage 200 at the centre.
  const bots = [
    { x: 20, y: 20 },
    { x: 22.5, y: 20 },
    { x: 20, y: 25 },
    { x: 27, y: 20 },
  ]

  it('kills at the centre, hurts toward the edge and spares what is outside the radius', () => {
    const world = createWorld('a', scene({ bots }), rules)
    const tick = world.tick
    trigger(world, 'meteor', 20, 20)
    expect(world.bots).toHaveLength(2)
    const [edge, far] = world.bots
    expect(edge.health).toBeCloseTo(tuning.bot.maxHealth - ev.meteor.damage * (1 - 5 / ev.meteor.radius), 9)
    expect(far.health).toBe(tuning.bot.maxHealth)
    expect(world.deathsByCause.meteor).toBe(2)
    const deaths = world.log.filter((e) => e.type === 'death')
    expect(deaths).toHaveLength(2)
    expect(deaths.every((e) => e.cause === 'meteor' && e.tick === tick)).toBe(true)
    // Two ruins, one for each of the bots that died.
    expect(world.nodes.filter((node) => node.kind === 'ruin')).toHaveLength(2)
  })

  it('leaves a danger crater that fades after its time, and is not counted against the node cap', () => {
    const world = createWorld('a', scene({}), rules)
    const before = placedNodeCount(world)
    const result = applyCommand(world, rules, { type: 'triggerEvent', event: 'meteor', x: 20, y: 20 })
    expect(result.ok).toBe(true)
    const crater = world.nodes.find((node) => node.kind === 'danger')
    expect(crater).toMatchObject({
      id: result.ok ? result.id : -1,
      x: 20,
      y: 20,
      radius: ev.meteor.craterRadius,
      damage: ev.meteor.craterDamage,
      expires: ev.meteor.craterTicks,
    })
    expect(placedNodeCount(world)).toBe(before)
    advanceTo(world, ev.meteor.craterTicks - 1)
    expect(world.nodes.some((node) => node.kind === 'danger')).toBe(true)
    step(world, rules)
    expect(world.nodes.some((node) => node.kind === 'danger')).toBe(false)
    expect(world.log.at(-1)).toMatchObject({ type: 'event', eventKind: 'meteor', nodeId: crater?.id })
  })

  it('shows up in the active list while it stands', () => {
    const world = createWorld('a', scene({}), rules)
    trigger(world, 'meteor', 20, 20)
    trigger(world, 'drought')
    const entries = activeEntries(world, tuning)
    expect(entries.map((entry) => entry.kind)).toEqual(['meteor', 'drought'])
    expect(entries[0]).toMatchObject({ endTick: ev.meteor.craterTicks, radius: ev.meteor.craterRadius })
  })

  it('makes bots that sense the crater steer around it', () => {
    const margin = tuning.brain.avoidMargin
    for (const seed of ['a', 'b', 'c']) {
      const world = createWorld(seed, scene({ bots: [{ x: 20, y: 27 }] }), rules)
      world.bots[0].heading = -Math.PI / 2 // straight at the crater
      trigger(world, 'meteor', 20, 20)
      expect(world.bots).toHaveLength(1)
      let closest = Infinity
      for (let i = 0; i < 300; i += 1) {
        world.bots[0].energy = 100
        world.bots[0].thirst = 100
        step(world, rules)
        const bot = world.bots[0]
        closest = Math.min(closest, Math.hypot(bot.x - 20, bot.y - 20))
      }
      expect(closest, `seed ${seed}`).toBeGreaterThanOrEqual(ev.meteor.craterRadius + margin - 1e-9)
    }
  })
})

describe('refusals', () => {
  it('refuses a second drought or bounty while one runs, saying how long is left', () => {
    const world = createWorld('a', scene({}), rules)
    trigger(world, 'drought')
    advanceTo(world, 100)
    const result = applyCommand(world, rules, { type: 'triggerEvent', event: 'drought' })
    expect(result).toMatchObject({ ok: false })
    expect(!result.ok && result.reason).toBe(`Drought is already active (${ev.drought.duration - 100} ticks left).`)
    trigger(world, 'bounty')
    expect(applyCommand(world, rules, { type: 'triggerEvent', event: 'bounty' }).ok).toBe(false)
  })

  it('allows the same global event again once it has ended', () => {
    const world = createWorld('a', scene({}), rules)
    trigger(world, 'bounty')
    advanceTo(world, ev.bounty.duration)
    expect(applyCommand(world, rules, { type: 'triggerEvent', event: 'bounty' }).ok).toBe(true)
  })

  it('caps the timed events in progress, plagues included', () => {
    const world = createWorld('a', scene({}), rules)
    trigger(world, 'drought')
    trigger(world, 'bounty')
    trigger(world, 'plague', 10, 10)
    expect(world.events).toHaveLength(ev.maxActive)
    const result = applyCommand(world, rules, { type: 'triggerEvent', event: 'plague', x: 30, y: 30 })
    expect(!result.ok && result.reason).toContain('Too many world events')
  })

  it('caps the craters but not by the timed-event cap', () => {
    const world = createWorld('a', scene({}), rules)
    for (let i = 0; i < ev.maxCraters; i += 1) trigger(world, 'meteor', 5 + i * 5, 20)
    const result = applyCommand(world, rules, { type: 'triggerEvent', event: 'meteor', x: 5, y: 5 })
    expect(!result.ok && result.reason).toContain('Too many meteor craters')
    expect(applyCommand(world, rules, { type: 'triggerEvent', event: 'drought' }).ok).toBe(true)
  })

  it('refuses area events without a place on the map, and unknown events, changing nothing', () => {
    const world = createWorld('a', scene({ bots: [{ x: 5, y: 5 }] }), rules)
    trigger(world, 'drought')
    const before = stateHash(world)
    const commands = world.commands.length
    const bad: Command[] = [
      { type: 'triggerEvent', event: 'plague' },
      { type: 'triggerEvent', event: 'meteor' },
      { type: 'triggerEvent', event: 'plague', x: -1, y: 5 },
      { type: 'triggerEvent', event: 'meteor', x: 5, y: 41 },
      { type: 'triggerEvent', event: 'meteor', x: Number.NaN, y: 5 },
      { type: 'triggerEvent', event: 'drought' },
      { type: 'triggerEvent', event: 'flood' as 'drought' },
    ]
    for (const cmd of bad) {
      expect(checkCommand(world, rules, cmd), JSON.stringify(cmd)).not.toBeNull()
      expect(applyCommand(world, rules, cmd).ok, JSON.stringify(cmd)).toBe(false)
    }
    expect(stateHash(world)).toBe(before)
    expect(world.commands).toHaveLength(commands)
  })

  it('records an accepted event with its tick, and logs it', () => {
    const world = createWorld('a', scene({}), rules)
    advanceTo(world, 30)
    trigger(world, 'plague', 12, 14)
    expect(world.commands).toEqual([{ tick: 30, cmd: { type: 'triggerEvent', event: 'plague', x: 12, y: 14 } }])
    expect(world.log.at(-1)).toMatchObject({ type: 'command', command: 'triggerEvent', eventKind: 'plague', x: 12, y: 14, tick: 30 })
  })
})

describe('determinism and replay', () => {
  const script: { tick: number; cmd: Command }[] = [
    { tick: 300, cmd: { type: 'triggerEvent', event: 'drought' } },
    { tick: 700, cmd: { type: 'triggerEvent', event: 'plague', x: 48, y: 32 } },
    { tick: 900, cmd: { type: 'triggerEvent', event: 'meteor', x: 30.5, y: 20.5 } },
    { tick: 1200, cmd: { type: 'triggerEvent', event: 'bounty' } },
    { tick: 1300, cmd: { type: 'placeNode', kind: 'shelter', x: 60.5, y: 30.5 } },
  ]

  function live(): World {
    const world = createWorld('a', edenPreset, rules)
    for (const { tick, cmd } of script) {
      advanceTo(world, tick)
      expect(applyCommand(world, rules, cmd).ok, JSON.stringify(cmd)).toBe(true)
    }
    advanceTo(world, 3000)
    return world
  }

  it('gives the same hash for the same seed and commands', () => {
    expect(stateHash(live())).toBe(stateHash(live()))
  })

  it('replays from seed + recorded commands to the same hash', () => {
    const world = live()
    expect(world.commands).toHaveLength(script.length)
    expect(stateHash(replayWorld('a', edenPreset, rules, world.commands, world.tick))).toBe(stateHash(world))
  })

  it('differs from a control run without the events', () => {
    const control = createWorld('a', edenPreset, rules)
    advanceTo(control, 3000)
    expect(stateHash(live())).not.toBe(stateHash(control))
  })

  it('makes no random draws when an event is applied', () => {
    const world = createWorld('a', edenPreset, rules)
    advanceTo(world, 500)
    const rng = JSON.stringify(world.rng)
    trigger(world, 'drought')
    trigger(world, 'plague', 20, 20)
    trigger(world, 'meteor', 60, 40)
    expect(JSON.stringify(world.rng)).toBe(rng)
  })

  it('survives a JSON copy of a world with events in progress', () => {
    const world = live()
    trigger(world, 'plague', 70, 10)
    const copy: World = JSON.parse(JSON.stringify(world))
    expect(stateHash(copy)).toBe(stateHash(world))
    advanceTo(copy, world.tick + 400)
    advanceTo(world, world.tick + 400)
    expect(stateHash(copy)).toBe(stateHash(world))
  })
})

// The eden preset must still be survivable with events. Each script is run on seeds a..e for 12,000 ticks;
// the population may dip, but must never reach the extinction floor the tuning test uses.
const SEEDS = ['a', 'b', 'c', 'd', 'e']
const TICKS = 12_000
const WARMUP = 1000
const MIN_ALIVE = 5

describe('eden survives scripted events', () => {
  const droughtThenPlague: { tick: number; cmd: Command }[] = [
    { tick: 3000, cmd: { type: 'triggerEvent', event: 'drought' } },
    { tick: 6000, cmd: { type: 'triggerEvent', event: 'plague', x: 48, y: 32 } },
  ]
  const everything: { tick: number; cmd: Command }[] = [
    { tick: 3000, cmd: { type: 'triggerEvent', event: 'drought' } },
    { tick: 3500, cmd: { type: 'triggerEvent', event: 'plague', x: 30, y: 30 } },
    { tick: 4500, cmd: { type: 'triggerEvent', event: 'meteor', x: 60, y: 20 } },
    { tick: 6000, cmd: { type: 'triggerEvent', event: 'bounty' } },
    { tick: 8000, cmd: { type: 'triggerEvent', event: 'plague', x: 70, y: 45 } },
    { tick: 8000, cmd: { type: 'triggerEvent', event: 'meteor', x: 20, y: 40 } },
  ]

  it.concurrent.each(SEEDS)('a drought at 3000 and a plague at 6000, seed %s', { timeout: 180_000 }, (seed) => {
    const result = surveySeed(seed, edenPreset, rules, TICKS, WARMUP, droughtThenPlague)
    expect(result.refused).toEqual([])
    expect(result.min).toBeGreaterThanOrEqual(MIN_ALIVE)
    expect(result.final).toBeGreaterThanOrEqual(MIN_ALIVE)
    expect(result.deaths.plague).toBeGreaterThanOrEqual(0)
  })

  it.concurrent.each(SEEDS)('all four events in a row, seed %s', { timeout: 180_000 }, (seed) => {
    const result = surveySeed(seed, edenPreset, rules, TICKS, WARMUP, everything)
    expect(result.refused).toEqual([])
    expect(result.min).toBeGreaterThanOrEqual(MIN_ALIVE)
    expect(result.final).toBeGreaterThanOrEqual(MIN_ALIVE)
    expect(result.max).toBeLessThan(rules.tuning.population.cap)
  })
})
