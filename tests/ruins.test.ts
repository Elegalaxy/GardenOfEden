import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { applyCommand, checkCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { ruinAmount } from '../src/sim/ruins.ts'
import { step } from '../src/sim/step.ts'
import type { Preset, Rules, World } from '../src/sim/types.ts'
import { createWorld, makeNode, placedNodeCount } from '../src/sim/world.ts'

// Ruins (M7a): what a dead bot leaves behind. These need the real numbers from
// src/content, so they live here and not next to src/sim.

const { tuning, nodeDefs } = rules

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', width: 40, height: 40, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

function ruinsOf(world: World) {
  return world.nodes.filter((node) => node.kind === 'ruin')
}

/** Puts a ruin straight into the world, as a death would. */
function addRuin(world: World, x: number, y: number, amount: number): number {
  const id = world.nextId
  world.nextId += 1
  const ruin = makeNode(id, 'ruin', x, y, nodeDefs.ruin)
  ruin.amount = amount
  world.nodes.push(ruin)
  return id
}

describe('a death leaves a ruin', () => {
  it('at the place of death, with the base amount for a bot that starved', () => {
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }] }), rules)
    const bot = world.bots[0]
    bot.energy = 0.2
    step(world, rules)
    expect(world.deathsByCause.starve).toBe(1)
    const ruins = ruinsOf(world)
    expect(ruins).toHaveLength(1)
    expect(ruins[0]).toMatchObject({ x: bot.x, y: bot.y, radius: nodeDefs.ruin.radius })
    // Starved at 0 energy or below: nothing but the base amount, less one tick of decay.
    expect(ruins[0].amount).toBeCloseTo(tuning.ruin.baseAmount - nodeDefs.ruin.decay, 9)
  })

  it('with more food for a bot that died with energy left (old age, danger)', () => {
    for (const cause of ['age', 'danger'] as const) {
      const preset = scene({
        bots: [{ x: 20, y: 20 }],
        nodes: cause === 'danger' ? [{ kind: 'danger', x: 20, y: 20 }] : [],
      })
      const world = createWorld('a', preset, rules)
      const bot = world.bots[0]
      bot.energy = 90
      if (cause === 'age') bot.age = tuning.bot.maxAge - 1
      else bot.health = 1
      step(world, rules)
      expect(world.deathsByCause[cause]).toBe(1)
      // A ruin made inside a danger zone decays dangerDecayMult times as fast, from its first tick.
      const decay = nodeDefs.ruin.decay * (cause === 'danger' ? tuning.ruin.dangerDecayMult : 1)
      const expected = ruinAmount(bot, tuning) - decay
      expect(expected).toBeGreaterThan(tuning.ruin.baseAmount + 20)
      expect(ruinsOf(world)[0].amount).toBeCloseTo(expected, 9)
    }
  })

  it('without logging an event or touching the world and birth streams', () => {
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }] }), rules)
    world.bots[0].energy = 0.2
    const before = JSON.parse(JSON.stringify(world.rng)) as World['rng']
    step(world, rules)
    expect(world.log.map((event) => event.type)).toEqual(['death'])
    expect(world.rng.world).toEqual(before.world)
    expect(world.rng.birth).toEqual(before.birth)
  })

  it('never logs a depleted event over a long eden run', () => {
    const world = createWorld('b', edenPreset, rules)
    for (let i = 0; i < 3000; i += 1) step(world, rules)
    expect(world.log.length).toBeGreaterThan(0)
    for (const event of world.log) expect(['birth', 'death', 'command']).toContain(event.type)
  })
})

describe('merging', () => {
  it('adds deaths close together into one ruin, capped at the capacity', () => {
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }, { x: 20.5, y: 20 }] }), rules)
    for (const bot of world.bots) bot.energy = 0.2
    step(world, rules)
    expect(ruinsOf(world)).toHaveLength(1)
    expect(ruinsOf(world)[0].amount).toBeCloseTo(2 * tuning.ruin.baseAmount - nodeDefs.ruin.decay, 9)

    const crowd = createWorld('a', scene({ bots: [{ x: 20, y: 20 }, { x: 20.2, y: 20 }, { x: 20.4, y: 20 }] }), rules)
    for (const bot of crowd.bots) bot.energy = 0.2
    step(crowd, rules)
    expect(ruinsOf(crowd)).toHaveLength(1)
    expect(ruinsOf(crowd)[0].amount).toBeCloseTo(nodeDefs.ruin.capacity - nodeDefs.ruin.decay, 9)
  })

  it('keeps deaths far apart as separate ruins', () => {
    const world = createWorld('a', scene({ bots: [{ x: 5, y: 5 }, { x: 30, y: 30 }] }), rules)
    for (const bot of world.bots) bot.energy = 0.2
    step(world, rules)
    expect(ruinsOf(world)).toHaveLength(2)
  })

  it('adds to the nearest ruin however far once the ruin cap is reached', () => {
    const capped: Rules = { ...rules, tuning: { ...tuning, ruin: { ...tuning.ruin, maxCount: 1 } } }
    const world = createWorld('a', scene({ bots: [{ x: 5, y: 5 }, { x: 30, y: 30 }] }), capped)
    for (const bot of world.bots) bot.energy = 0.2
    step(world, capped)
    expect(ruinsOf(world)).toHaveLength(1)
    expect(ruinsOf(world)[0].amount).toBeGreaterThan(tuning.ruin.baseAmount * 1.5)
  })
})

describe('decay', () => {
  it('lowers a ruin by its decay each tick and removes it at zero, with no bots around', () => {
    const world = createWorld('a', scene({}), rules)
    const id = addRuin(world, 10, 10, 0.12)
    step(world, rules)
    expect(world.nodes.find((n) => n.id === id)?.amount).toBeCloseTo(0.12 - nodeDefs.ruin.decay, 9)
    step(world, rules)
    step(world, rules)
    expect(world.nodes.find((n) => n.id === id)).toBeUndefined()
  })

  it('is faster inside a danger zone, by the danger decay multiplier', () => {
    const mult = tuning.ruin.dangerDecayMult
    expect(mult).toBeGreaterThan(1)
    const world = createWorld('a', scene({ nodes: [{ kind: 'danger', x: 10, y: 10 }] }), rules)
    const inside = addRuin(world, 12, 10, 20)
    const edge = addRuin(world, 10 + nodeDefs.danger.radius, 10, 20)
    const outside = addRuin(world, 10 + nodeDefs.danger.radius + 0.5, 10, 20)
    const far = addRuin(world, 30, 30, 20)
    for (let i = 0; i < 10; i += 1) step(world, rules)
    const amountOf = (id: number) => world.nodes.find((n) => n.id === id)?.amount
    expect(amountOf(inside)).toBeCloseTo(20 - 10 * mult * nodeDefs.ruin.decay, 9)
    expect(amountOf(edge)).toBeCloseTo(20 - 10 * mult * nodeDefs.ruin.decay, 9)
    expect(amountOf(outside)).toBeCloseTo(20 - 10 * nodeDefs.ruin.decay, 9)
    expect(amountOf(far)).toBeCloseTo(20 - 10 * nodeDefs.ruin.decay, 9)
  })

  it('removes a ruin in a danger zone sooner than one outside', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'danger', x: 10, y: 10 }] }), rules)
    const inside = addRuin(world, 10, 10, 2)
    const outside = addRuin(world, 30, 30, 2)
    const gone = (id: number) => !world.nodes.some((n) => n.id === id)
    let insideGone = 0
    while (!gone(outside)) {
      step(world, rules)
      if (insideGone === 0 && gone(inside)) insideGone = world.tick
    }
    expect(insideGone).toBeGreaterThan(0)
    expect(world.tick / insideGone).toBeCloseTo(tuning.ruin.dangerDecayMult, 0)
  })

  it('counts a meteor crater as danger, and stops when the crater fades', () => {
    const world = createWorld('a', scene({}), rules)
    expect(applyCommand(world, rules, { type: 'triggerEvent', event: 'meteor', x: 20, y: 20 }).ok).toBe(true)
    const inCrater = addRuin(world, 21, 20, 20)
    const away = addRuin(world, 5, 5, 20)
    step(world, rules)
    const lost = (id: number) => 20 - (world.nodes.find((n) => n.id === id)?.amount ?? 0)
    expect(lost(inCrater)).toBeCloseTo(tuning.ruin.dangerDecayMult * nodeDefs.ruin.decay, 9)
    expect(lost(away)).toBeCloseTo(nodeDefs.ruin.decay, 9)
    while (world.nodes.some((n) => n.kind === 'danger')) step(world, rules)
    const later = addRuin(world, 21, 20, 20)
    step(world, rules)
    expect(lost(later)).toBeCloseTo(nodeDefs.ruin.decay, 9)
  })

  it('never regrows', () => {
    const world = createWorld('a', scene({}), rules)
    const id = addRuin(world, 10, 10, 10)
    for (let i = 0; i < 20; i += 1) step(world, rules)
    expect(world.nodes.find((n) => n.id === id)?.amount).toBeCloseTo(10 - 20 * nodeDefs.ruin.decay, 9)
  })
})

describe('eating ruins', () => {
  const hungry = scene({ bots: [{ x: 20, y: 20 }] })

  it('keeps a hungry bot alive that would otherwise starve, and counts the intake', () => {
    const control = createWorld('a', hungry, rules)
    control.bots[0].energy = 30
    for (let i = 0; i < 150; i += 1) step(control, rules)
    expect(control.bots.length).toBe(0)

    const world = createWorld('a', hungry, rules)
    world.bots[0].energy = 30
    addRuin(world, 22, 20, 40)
    let fed = false
    for (let i = 0; i < 150; i += 1) {
      step(world, rules)
      if (world.bots[0] && world.bots[0].energy > 45) fed = true
    }
    expect(fed).toBe(true)
    expect(world.eaten.ruin).toBeGreaterThan(10)
    expect(world.eaten.resource).toBe(0)
  })

  it('is safe when the ruin a bot is heading for disappears', () => {
    const world = createWorld('a', hungry, rules)
    world.bots[0].energy = 30
    const id = addRuin(world, 26, 20, 40)
    step(world, rules)
    expect(world.bots[0].intent).toEqual({ kind: 'seekFood', targetId: id })
    expect(applyCommand(world, rules, { type: 'removeNode', id }).ok).toBe(true)
    expect(() => step(world, rules)).not.toThrow()
    expect(world.bots[0].intent.targetId).not.toBe(id)
    expect(world.bots[0].memory.some((entry) => entry.nodeId === id)).toBe(false)
    for (let i = 0; i < 20; i += 1) step(world, rules)
  })

  it('is safe when another bot empties the ruin first', () => {
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }, { x: 20.5, y: 20 }] }), rules)
    for (const bot of world.bots) bot.energy = 30
    addRuin(world, 20.2, 20, 3)
    expect(() => {
      for (let i = 0; i < 30; i += 1) step(world, rules)
    }).not.toThrow()
    expect(world.eaten.ruin).toBeLessThanOrEqual(3 + 1e-9)
  })

  it('does not make a bot walk to a ruin that held less than a bite', () => {
    const world = createWorld('a', hungry, rules)
    world.bots[0].energy = 30
    addRuin(world, 22, 20, tuning.bot.eatRate - 1)
    step(world, rules)
    expect(world.bots[0].intent.kind).not.toBe('seekFood')
  })
})

describe('ruins and the player', () => {
  it('cannot be placed, but can be removed', () => {
    const world = createWorld('a', scene({}), rules)
    expect(checkCommand(world, rules, { type: 'placeNode', kind: 'ruin', x: 5, y: 5 })).toMatch(/dead bots/)
    const id = addRuin(world, 5, 5, 10)
    expect(applyCommand(world, rules, { type: 'removeNode', id }).ok).toBe(true)
    expect(ruinsOf(world)).toHaveLength(0)
    expect(world.log.at(-1)).toMatchObject({ command: 'removeNode', nodeKind: 'ruin', nodeId: id })
  })

  it('do not count toward the placed-node cap or block placing', () => {
    const small: Rules = { ...rules, tuning: { ...tuning, player: { ...tuning.player, maxNodes: 2 } } }
    const world = createWorld('a', scene({}), small)
    for (let i = 0; i < 5; i += 1) addRuin(world, 2 + i * 6, 30, 10)
    expect(placedNodeCount(world)).toBe(0)
    expect(applyCommand(world, small, { type: 'placeNode', kind: 'resource', x: 5.5, y: 5.5 }).ok).toBe(true)
    expect(applyCommand(world, small, { type: 'placeNode', kind: 'resource', x: 9.5, y: 5.5 }).ok).toBe(true)
    expect(applyCommand(world, small, { type: 'placeNode', kind: 'resource', x: 13.5, y: 5.5 }).ok).toBe(false)
  })
})

describe('determinism', () => {
  function runTo(seed: string, ticks: number): World {
    const world = createWorld(seed, edenPreset, rules)
    for (let i = 0; i < ticks; i += 1) step(world, rules)
    return world
  }

  it('gives the same hash for the same seed, and survives a JSON round trip', () => {
    const one = runTo('c', 3500)
    expect(ruinsOf(one).length + one.eaten.ruin).toBeGreaterThan(0)
    expect(stateHash(runTo('c', 3500))).toBe(stateHash(one))
    expect(stateHash(JSON.parse(JSON.stringify(one)) as World)).toBe(stateHash(one))
  })

  it('replays a run that removed a ruin to the same hash', () => {
    const live = createWorld('a', edenPreset, rules)
    while (ruinsOf(live).length === 0 && live.tick < 6000) step(live, rules)
    const ruin = ruinsOf(live)[0]
    expect(ruin).toBeDefined()
    expect(applyCommand(live, rules, { type: 'removeNode', id: ruin.id }).ok).toBe(true)
    for (let i = 0; i < 500; i += 1) step(live, rules)
    const replayed = replayWorld('a', edenPreset, rules, live.commands, live.tick)
    expect(stateHash(replayed)).toBe(stateHash(live))
  })
})
