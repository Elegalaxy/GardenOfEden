import { describe, expect, it } from 'vitest'

import { rules } from '../src/content/index.ts'
import { applyCommand, checkCommand } from '../src/sim/commands.ts'
import { shareFamilyKnowledge, inheritMemory } from '../src/sim/family.ts'
import { stateHash } from '../src/sim/hash.ts'
import { deathCause } from '../src/sim/metabolism.ts'
import { exposureAt } from '../src/sim/nodes.ts'
import type { Exposure } from '../src/sim/nodes.ts'
import { chooseFood, remember, trimMemory } from '../src/sim/perception.ts'
import { movePredators } from '../src/sim/predators.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { createRng, nextFloat } from '../src/sim/rng.ts'
import { step } from '../src/sim/step.ts'
import type { MemoryEntry, NodeKind, Preset, World, WorldNode } from '../src/sim/types.ts'
import { createWorld, placedNodeCount } from '../src/sim/world.ts'

// Predators (M21a): the hunter node, its movement, bites, kills and what bots remember of it. These need
// the real numbers from src/content, so they live here and not next to src/sim. Most tests call
// `movePredators` directly with the tick set by hand, so a bot can be held still.

const { tuning, nodeDefs } = rules
const pt = tuning.predator

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', width: 60, height: 60, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

const predatorsOf = (world: World): WorldNode[] => world.nodes.filter((node) => node.kind === 'predator')

/** One tick of just the predators. */
function tickPredators(world: World): void {
  world.tick += 1
  movePredators(world, rules)
}

function entry(nodeId: number, kind: NodeKind, x: number, y: number, seenTick: number, over: Partial<MemoryEntry> = {}): MemoryEntry {
  return { nodeId, kind, x, y, radius: nodeDefs[kind].radius, seenTick, amount: 0, learnedFrom: null, ...over }
}

const none: Exposure = { damage: 0, plague: 0, predator: 0, predatorId: null, heal: 0, drainMult: 1, shelterId: null }

describe('predator node', () => {
  it('is made with a hunt state at its own spot, and other kinds have none', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 12, y: 13 }, { kind: 'resource', x: 5, y: 5 }] }), rules)
    expect(world.nodes[0]!.hunt).toEqual({ px: 12, py: 13, heading: 0, homeX: 12, homeY: 13, targetId: null, chase: 0, restUntil: 0, kills: 0 })
    expect(world.nodes[1]!.hunt).toBeNull()
    expect(world.deathsByCause.predator).toBe(0)
  })

  it('is refused beyond predator.maxCount, does not count toward player.maxNodes, and can be removed', () => {
    const world = createWorld('a', scene({}), rules)
    for (let i = 0; i < pt.maxCount; i += 1) {
      expect(applyCommand(world, rules, { type: 'placeNode', kind: 'predator', x: 5 + 3 * i, y: 5 }).ok).toBe(true)
    }
    expect(predatorsOf(world)).toHaveLength(pt.maxCount)
    expect(placedNodeCount(world)).toBe(0)
    const refused = applyCommand(world, rules, { type: 'placeNode', kind: 'predator', x: 40, y: 40 })
    expect(refused).toEqual({ ok: false, reason: `Too many predators (${pt.maxCount}).` })
    expect(checkCommand(world, rules, { type: 'placeNode', kind: 'predator', x: 40, y: 40 })).toMatch(/Too many predators/)
    expect(applyCommand(world, rules, { type: 'removeNode', id: predatorsOf(world)[0]!.id }).ok).toBe(true)
    expect(applyCommand(world, rules, { type: 'placeNode', kind: 'predator', x: 40, y: 40 }).ok).toBe(true)
  })

  it('placed and removed by commands, replays to the live hash', () => {
    const preset = scene({ nodes: [{ kind: 'resource', x: 30, y: 30 }, { kind: 'shelter', x: 15, y: 15 }], bots: [{ x: 22, y: 20 }, { x: 40, y: 40 }] })
    const live = createWorld('r', preset, rules)
    for (let i = 0; i < 40; i += 1) step(live, rules)
    expect(applyCommand(live, rules, { type: 'placeNode', kind: 'predator', x: 25.5, y: 25.5 }).ok).toBe(true)
    for (let i = 0; i < 150; i += 1) step(live, rules)
    expect(applyCommand(live, rules, { type: 'removeNode', id: predatorsOf(live)[0]!.id }).ok).toBe(true)
    for (let i = 0; i < 40; i += 1) step(live, rules)
    expect(live.commands).toHaveLength(2)
    expect(stateHash(replayWorld('r', preset, rules, live.commands, live.tick))).toBe(stateHash(live))
  })
})

describe('hunting', () => {
  it('walks at the nearest bot, and the lower id wins a tie', () => {
    const near = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }], bots: [{ x: 27, y: 20 }, { x: 14, y: 20 }, { x: 24, y: 20 }] }), rules)
    tickPredators(near)
    const hunt = predatorsOf(near)[0]!.hunt!
    expect(hunt.targetId).toBe(near.bots[2]!.id)
    expect(hunt.px).toBe(20)
    expect(predatorsOf(near)[0]!.x).toBeCloseTo(20 + pt.speed, 9)
    expect(hunt.chase).toBe(1)

    const tie = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }], bots: [{ x: 26, y: 20 }, { x: 14, y: 20 }] }), rules)
    tickPredators(tie)
    expect(predatorsOf(tie)[0]!.hunt!.targetId).toBe(tie.bots[0]!.id)
    expect(predatorsOf(tie)[0]!.x).toBeGreaterThan(20)
  })

  it('ignores a bot farther than senseRadius or standing in a shelter', () => {
    const far = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }], bots: [{ x: 20 + pt.senseRadius + 1, y: 20 }] }), rules)
    tickPredators(far)
    expect(predatorsOf(far)[0]!.hunt!.targetId).toBeNull()

    const sheltered = createWorld(
      'a',
      scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }, { kind: 'shelter', x: 25, y: 20 }], bots: [{ x: 25, y: 20 }] }),
      rules,
    )
    tickPredators(sheltered)
    expect(predatorsOf(sheltered)[0]!.hunt!.targetId).toBeNull()
  })

  it('takes exactly one predator draw per predator per tick, resting, chasing or wandering', () => {
    const world = createWorld(
      'a',
      scene({
        nodes: [{ kind: 'predator', x: 10, y: 10 }, { kind: 'predator', x: 40, y: 40 }, { kind: 'predator', x: 40, y: 10 }],
        bots: [{ x: 14, y: 10 }],
      }),
      rules,
    )
    const [, , resting] = predatorsOf(world)
    resting!.hunt!.restUntil = 1_000_000
    const reference = structuredClone(world.rng.predator)
    const others = structuredClone(world.rng)
    for (let tick = 1; tick <= 5; tick += 1) {
      tickPredators(world)
      for (let i = 0; i < 3; i += 1) nextFloat(reference)
      expect(world.rng.predator).toEqual(reference)
    }
    // The other streams are untouched by predators.
    expect(world.rng.world).toEqual(others.world)
    expect(world.rng.ai).toEqual(others.ai)
    expect(world.rng.birth).toEqual(others.birth)
    expect(world.rng.gene).toEqual(others.gene)
  })

  it('takes no draws when there are no predators', () => {
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }, { x: 30, y: 30 }] }), rules)
    const before = structuredClone(world.rng.predator)
    expect(before).toEqual(createRng('a').predator)
    for (let i = 0; i < 50; i += 1) step(world, rules)
    expect(world.rng.predator).toEqual(before)
  })

  it('never enters a shelter radius while chasing a bot just behind it', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'shelter', x: 30, y: 20 }, { kind: 'predator', x: 26, y: 20 }], bots: [{ x: 33.5, y: 20 }] }), rules)
    const shelter = nodeDefs.shelter.radius
    const node = predatorsOf(world)[0]!
    let closest = Infinity
    for (let i = 0; i < 160; i += 1) {
      tickPredators(world)
      closest = Math.min(closest, Math.hypot(node.x - 30, node.y - 20))
    }
    expect(closest).toBeGreaterThan(shelter)
    expect(node.x).not.toBe(26)
  })

  it('can leave a shelter it was placed inside, but not walk deeper in', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'shelter', x: 30, y: 20 }, { kind: 'predator', x: 29, y: 20 }] }), rules)
    const node = predatorsOf(world)[0]!
    let before = Math.hypot(node.x - 30, node.y - 20)
    for (let i = 0; i < 60; i += 1) {
      tickPredators(world)
      const after = Math.hypot(node.x - 30, node.y - 20)
      if (before <= nodeDefs.shelter.radius) expect(after).toBeGreaterThanOrEqual(before - 1e-9)
      else expect(after).toBeGreaterThan(nodeDefs.shelter.radius)
      before = after
    }
    expect(before).toBeGreaterThan(nodeDefs.shelter.radius)
  })

  it('gives up after chaseTicks, rests giveUpRest, then hunts again', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 10, y: 30 }], bots: [{ x: 16, y: 30 }] }), rules)
    const node = predatorsOf(world)[0]!
    const bot = world.bots[0]!
    const keepAway = (): void => {
      bot.x = node.x + 6
      bot.y = 30
    }
    for (let i = 1; i < pt.chaseTicks; i += 1) {
      tickPredators(world)
      keepAway()
      expect(node.hunt!.targetId).toBe(bot.id)
    }
    expect(node.hunt!.chase).toBe(pt.chaseTicks - 1)
    tickPredators(world) // the chaseTicks-th tick of chasing
    keepAway()
    expect(world.tick).toBe(pt.chaseTicks)
    expect(node.hunt).toMatchObject({ targetId: null, chase: 0, restUntil: pt.chaseTicks + pt.giveUpRest })
    const stoodAt = node.x
    while (world.tick < pt.chaseTicks + pt.giveUpRest) {
      tickPredators(world)
      keepAway()
      expect(node.x).toBe(stoodAt)
    }
    tickPredators(world)
    expect(node.x).toBeGreaterThan(stoodAt)
    expect(node.hunt!.targetId).toBe(bot.id)
  })

  it('stays within homeRange (plus one step) of home while wandering', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 30, y: 30 }] }), rules)
    const node = predatorsOf(world)[0]!
    let farthest = 0
    for (let i = 0; i < 1500; i += 1) {
      tickPredators(world)
      farthest = Math.max(farthest, Math.hypot(node.x - 30, node.y - 30))
    }
    expect(farthest).toBeGreaterThan(3)
    expect(farthest).toBeLessThanOrEqual(pt.homeRange + pt.speed + 1e-9)
  })

  it('stays on the map', () => {
    const world = createWorld('a', scene({ width: 12, height: 12, nodes: [{ kind: 'predator', x: 0.5, y: 0.5 }] }), rules)
    const node = predatorsOf(world)[0]!
    for (let i = 0; i < 400; i += 1) {
      tickPredators(world)
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.x).toBeLessThanOrEqual(12)
      expect(node.y).toBeGreaterThanOrEqual(0)
      expect(node.y).toBeLessThanOrEqual(12)
    }
  })
})

describe('bites and kills', () => {
  const biteScene = (extra: Preset['nodes'] = []): World => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'shelter', x: 30, y: 20 }, { kind: 'predator', x: 33.2, y: 20 }, ...extra] }), rules)
    world.tick = 1
    return world
  }

  it('bites a bot in range outside a shelter but not one inside it, and only without the tuning if asked', () => {
    const world = biteScene()
    const predator = predatorsOf(world)[0]!
    expect(exposureAt(world, 33.5, 20, tuning)).toMatchObject({ predator: nodeDefs.predator.damage, predatorId: predator.id })
    expect(exposureAt(world, 32.5, 20, tuning)).toMatchObject({ predator: 0, predatorId: null, shelterId: world.nodes[0]!.id })
    expect(exposureAt(world, 36, 20, tuning).predator).toBe(0)
    expect(exposureAt(world, 33.5, 20).predator).toBe(0)
  })

  it('does not bite while resting, and credits the lowest id of several', () => {
    const world = biteScene([{ kind: 'predator', x: 33.6, y: 20 }])
    const [first, second] = predatorsOf(world)
    const bites = exposureAt(world, 33.4, 20, tuning)
    expect(bites.predator).toBe(2 * nodeDefs.predator.damage)
    expect(bites.predatorId).toBe(first!.id)
    first!.hunt!.restUntil = world.tick
    expect(exposureAt(world, 33.4, 20, tuning)).toMatchObject({ predator: nodeDefs.predator.damage, predatorId: second!.id })
    second!.hunt!.restUntil = world.tick + 1
    expect(exposureAt(world, 33.4, 20, tuning).predator).toBe(0)
    world.tick += 2
    expect(exposureAt(world, 33.4, 20, tuning).predator).toBe(2 * nodeDefs.predator.damage)
  })

  it("kills with cause 'predator', leaves a ruin, credits the kill and rests digestTicks; a second bot is spared", () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }], bots: [{ x: 20.4, y: 20 }, { x: 20.6, y: 20 }] }), rules)
    const [victim, spared] = world.bots
    victim!.health = nodeDefs.predator.damage - 15
    step(world, rules)
    expect(world.bots.map((bot) => bot.id)).toEqual([spared!.id])
    expect(world.deathsByCause).toMatchObject({ predator: 1, danger: 0, starve: 0 })
    expect(world.log.find((event) => event.type === 'death')).toMatchObject({ botId: victim!.id, cause: 'predator' })
    expect(world.lineage.find((record) => record.id === victim!.id)).toMatchObject({ cause: 'predator' })
    expect(world.nodes.some((node) => node.kind === 'ruin')).toBe(true)
    const hunt = predatorsOf(world)[0]!.hunt!
    expect(hunt).toMatchObject({ kills: 1, targetId: null, chase: 0, restUntil: 1 + pt.digestTicks })
    expect(spared!.health).toBeGreaterThan(tuning.bot.maxHealth - 1)
  })

  it('names the cause by the larger damage: predator only when strictly larger than danger and plague', () => {
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }] }), rules)
    const bot = world.bots[0]!
    bot.health = 0
    expect(deathCause(bot, { ...none, predator: 35 })).toBe('predator')
    expect(deathCause(bot, { ...none, predator: 35, damage: 35 })).toBe('danger')
    expect(deathCause(bot, { ...none, predator: 35, plague: 35 })).toBe('plague')
    expect(deathCause(bot, { ...none, predator: 36, damage: 35, plague: 3 })).toBe('predator')
    expect(deathCause(bot, { ...none, predator: 35, plague: 40 })).toBe('plague')
    expect(deathCause(bot, none)).toBe('danger')
    bot.health = 5
    expect(deathCause(bot, { ...none, predator: 35 })).toBeNull()
  })
})

describe('what bots remember of a predator', () => {
  it('senses a predator by its centre within the sense radius, not by its edge', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }, { kind: 'danger', x: 20, y: 20 }], bots: [{ x: 28, y: 20 }] }), rules)
    const bot = world.bots[0]!
    bot.traits.senseRadius = 7 // the predator's centre is 8 away, its threat edge 4 away; the danger's edge 4 away
    const sensed = world.nodes.filter((node) => {
      const d = Math.hypot(node.x - bot.x, node.y - bot.y)
      return (node.kind === 'predator' ? d : d - node.radius) <= bot.traits.senseRadius
    })
    expect(sensed.map((node) => node.kind)).toEqual(['danger'])
  })

  it('keeps a sighting for memoryTicks and then forgets it', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 50, y: 50 }], bots: [{ x: 5, y: 5 }] }), rules)
    const bot = world.bots[0]!
    const id = predatorsOf(world)[0]!.id
    bot.memory = [entry(id, 'predator', 30, 30, 100)]
    world.tick = 100 + pt.memoryTicks
    remember(world, bot, [], tuning, new Set([id]))
    expect(bot.memory).toHaveLength(1)
    world.tick += 1
    remember(world, bot, [], tuning, new Set([id]))
    expect(bot.memory).toHaveLength(0)
  })

  it('gives sightings their own slots, so they never push food out', () => {
    const memory: MemoryEntry[] = []
    for (let i = 0; i < tuning.memory.cap; i += 1) memory.push(entry(10 + i, 'resource', i, 0, 50 + i))
    for (let i = 0; i < 4; i += 1) memory.push(entry(30 + i, 'predator', i, 5, 10 + i))
    trimMemory(memory, tuning)
    expect(memory.filter((e) => e.kind === 'resource')).toHaveLength(tuning.memory.cap)
    expect(memory.filter((e) => e.kind === 'predator').map((e) => e.nodeId)).toEqual([32, 33])
  })

  it('makes a bot skip food inside the threat zone, until it forgets the sighting', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'resource', x: 30, y: 20 }, { kind: 'predator', x: 30, y: 20 }], bots: [{ x: 20, y: 20 }] }), rules)
    const bot = world.bots[0]!
    const [food, predator] = world.nodes
    bot.energy = 30
    world.tick = 10
    bot.memory = [entry(food!.id, 'resource', 30, 20, 10, { amount: 100 }), entry(predator!.id, 'predator', 30, 20, 10)]
    expect(chooseFood(world, bot, tuning, false)).toBeNull()
    expect(chooseFood(world, bot, tuning, true)?.nodeId).toBe(food!.id)
    world.tick = 10 + pt.memoryTicks + 1
    remember(world, bot, [], tuning, new Set([food!.id, predator!.id]))
    expect(bot.memory.map((e) => e.kind)).toEqual(['resource'])
    expect(chooseFood(world, bot, tuning, false)?.nodeId).toBe(food!.id)
  })

  it('is handed to a child at birth and swapped between parent and child', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 30, y: 30 }], bots: [{ x: 10, y: 10 }, { x: 11, y: 10 }] }), rules)
    const [parent, child] = world.bots
    const id = predatorsOf(world)[0]!.id
    child!.parentId = parent!.id
    parent!.memory = [entry(id, 'predator', 28, 28, 5)]
    expect(inheritMemory(parent!.memory, parent!.id, tuning)).toEqual([entry(id, 'predator', 28, 28, 5, { learnedFrom: parent!.id })])

    world.tick = tuning.family.shareEvery
    shareFamilyKnowledge(world, tuning)
    expect(child!.memory).toEqual([entry(id, 'predator', 28, 28, 5, { learnedFrom: parent!.id })])
    expect(world.familyLearned).toBe(1)

    // The other way round: the child saw it later, so the parent takes the newer sighting.
    child!.memory = [entry(id, 'predator', 31, 31, 9)]
    world.tick += tuning.family.shareEvery
    shareFamilyKnowledge(world, tuning)
    expect(parent!.memory[0]).toMatchObject({ x: 31, y: 31, seenTick: 9, learnedFrom: child!.id })
  })

  it('is ignored by a desperate bot, but a merely hungry one keeps out of the zone', () => {
    // Food in the middle of a resting predator's threat zone, 12 cells from the bot.
    const grove = scene({
      nodes: [{ kind: 'predator', x: 24, y: 20 }, { kind: 'resource', x: 24, y: 20 }],
      bots: [{ x: 12, y: 20 }],
    })
    function approach(caution: number, energy: number): number {
      const world = createWorld('a', grove, rules)
      predatorsOf(world)[0]!.hunt!.restUntil = 1_000_000
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
    const safe = nodeDefs.predator.radius + tuning.brain.avoidMargin - 1e-9
    expect(approach(1, 0.25 * tuning.bot.maxEnergy)).toBeGreaterThanOrEqual(safe)
    expect(approach(1, 0.03 * tuning.bot.maxEnergy)).toBeLessThan(nodeDefs.predator.radius)
  })
})
