import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { applyCommand } from '../src/sim/commands.ts'
import { shareFamilyKnowledge } from '../src/sim/family.ts'
import { stateHash } from '../src/sim/hash.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { step } from '../src/sim/step.ts'
import type { MemoryEntry, NodeKind, Preset, Rules, World } from '../src/sim/types.ts'
import { createWorld, makeNode } from '../src/sim/world.ts'
import { asexual } from './variants.ts'

// Family knowledge sharing (M10): a parent and its own child pass on what they remember, at birth
// and by exchange. These need the real numbers from src/content, so they live here and not next to
// src/sim. The exchange tests call `shareFamilyKnowledge` directly on a hand-built world.

const { tuning } = rules
const { shareEvery, shareRadius } = tuning.family

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', width: 40, height: 40, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

function withFamily(over: Partial<Rules['tuning']['family']>): Rules {
  return { ...rules, tuning: { ...tuning, family: { ...tuning.family, ...over } } }
}

/** Puts a node straight into the world and returns its id. */
function addNode(world: World, kind: NodeKind, x: number, y: number): number {
  const id = world.nextId
  world.nextId += 1
  world.nodes.push(makeNode(id, kind, x, y, rules.nodeDefs[kind]))
  return id
}

/** A memory entry for an existing node, as if the bot saw it itself at `seenTick`. */
function know(world: World, nodeId: number, seenTick: number, over: Partial<MemoryEntry> = {}): MemoryEntry {
  const node = world.nodes.find((n) => n.id === nodeId)!
  return {
    nodeId,
    kind: node.kind,
    x: node.x,
    y: node.y,
    radius: node.radius,
    seenTick,
    amount: node.amount,
    learnedFrom: null,
    ...over,
  }
}

/** A parent (id 1) and its child (id 2) side by side, and a tick on which they exchange. */
function family(): { world: World; parent: World['bots'][number]; child: World['bots'][number] } {
  const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }, { x: 21, y: 20 }] }), rules)
  const [parent, child] = world.bots
  child.parentId = parent.id
  world.tick = shareEvery * 5
  return { world, parent, child }
}

function byNode(memory: MemoryEntry[], nodeId: number): MemoryEntry | undefined {
  return memory.find((entry) => entry.nodeId === nodeId)
}

describe('at birth', () => {
  const shelterScene = scene({ nodes: [{ kind: 'shelter', x: 20, y: 20 }], bots: [{ x: 20, y: 20 }] })

  function birthWorld(r: Rules): World {
    const world = createWorld('a', shelterScene, r)
    const parent = world.bots[0]
    parent.energy = 90
    parent.age = tuning.bot.adultAge + 100
    const far = {
      resource: addNode(world, 'resource', 35, 35),
      water: addNode(world, 'water', 35, 5),
      danger: addNode(world, 'danger', 5, 35),
      ruin: addNode(world, 'ruin', 5, 5),
    }
    parent.memory = [
      know(world, far.resource, 5, { amount: 12 }),
      know(world, far.water, 7),
      know(world, far.danger, 9),
      know(world, far.ruin, 11),
      // A node that no longer exists: dropped by the parent's own turn, so the child never gets it.
      { nodeId: 9999, kind: 'resource', x: 1, y: 1, radius: 1, seenTick: 3, amount: 5, learnedFrom: null },
    ]
    return world
  }

  it('starts with copies of the shareable entries, learned from the parent, with seenTick unchanged', () => {
    const solo = asexual(rules)
    const world = birthWorld(solo)
    step(world, solo)
    expect(world.bots).toHaveLength(2)
    const [parent, child] = world.bots
    expect(child.parentId).toBe(parent.id)
    // The parent's memory is what it was at conception: its own turn had already run.
    const expected = parent.memory
      .filter((entry) => tuning.family.shareKinds.includes(entry.kind))
      .map((entry) => ({ ...entry, learnedFrom: parent.id }))
    expect(expected.length).toBeGreaterThanOrEqual(4) // resource, water, danger and the shelter it stands in
    expect(child.memory).toEqual(expected)
    expect(child.memory.some((entry) => entry.kind === 'ruin')).toBe(false)
    expect(parent.memory.some((entry) => entry.kind === 'ruin')).toBe(true)
    const resource = child.memory.find((entry) => entry.kind === 'resource')!
    expect(resource).toMatchObject({ seenTick: 5, amount: 12, learnedFrom: parent.id })
    // Copies, not shared objects: the parent's own entries still say it saw them itself.
    expect(parent.memory.every((entry) => entry.learnedFrom === null)).toBe(true)
    expect(world.familyLearned).toBe(child.memory.length)
  })

  it('starts empty when inheritance is off', () => {
    const off = asexual(withFamily({ inherit: false }))
    const world = birthWorld(off)
    step(world, off)
    expect(world.bots).toHaveLength(2)
    expect(world.bots[1].memory).toEqual([])
    expect(world.familyLearned).toBe(0)
  })
})

describe('two parents (M17)', () => {
  const stand: Rules = { ...rules, tuning: { ...tuning, bot: { ...tuning.bot, speed: 0 } } }

  /** A mother (id 2), a father (id 3) in a shelter, ready to breed, each knowing different nodes. */
  function couple(): { world: World; mother: World['bots'][number]; father: World['bots'][number]; x: number; y: number; z: number } {
    const world = createWorld('a', scene({ nodes: [{ kind: 'shelter', x: 20, y: 20 }], bots: [{ x: 19, y: 20 }, { x: 21, y: 20 }] }), stand)
    const [mother, father] = world.bots
    mother.sex = 'female'
    father.sex = 'male'
    for (const bot of world.bots) {
      bot.energy = 90
      bot.age = tuning.bot.adultAge + 100
    }
    const x = addNode(world, 'resource', 35, 35)
    const y = addNode(world, 'water', 35, 5)
    const z = addNode(world, 'danger', 5, 35)
    // x: both know it, the father's sighting is newer. y: only the father. z: only the mother.
    mother.memory = [know(world, x, 5, { amount: 3 }), know(world, z, 8)]
    father.memory = [know(world, x, 9, { amount: 7 }), know(world, y, 6)]
    return { world, mother, father, x, y, z }
  }

  it('merges the father memory into the newborn: newer sighting wins, learnedFrom names the source', () => {
    const { world, mother, father, x, y, z } = couple()
    step(world, stand)
    expect(world.bots).toHaveLength(3)
    const child = world.bots[2]!
    expect(child).toMatchObject({ parentId: mother.id, fatherId: father.id })
    expect(byNode(child.memory, x)).toMatchObject({ seenTick: 9, amount: 7, learnedFrom: father.id })
    expect(byNode(child.memory, y)).toMatchObject({ learnedFrom: father.id })
    expect(byNode(child.memory, z)).toMatchObject({ seenTick: 8, learnedFrom: mother.id })
  })

  it('lets a child swap memory with its father as well as its mother, and the parents never swap with each other', () => {
    const { world, mother, father, x, y } = couple()
    // A mother and father side by side, no child: nothing is shared.
    world.tick = shareEvery * 5
    shareFamilyKnowledge(world, tuning)
    expect(byNode(mother.memory, y)).toBeUndefined()
    expect(world.familyLearned).toBe(0)
    // Now add a child of both, standing beside them, that knows something only it knows.
    const kid = { ...structuredClone(mother), id: world.nextId, parentId: mother.id, fatherId: father.id, sex: 'female' as const, memory: [] as MemoryEntry[] }
    world.nextId += 1
    world.bots.push(kid)
    kid.x = 20
    kid.y = 20
    shareFamilyKnowledge(world, tuning)
    expect(byNode(kid.memory, y)).toMatchObject({ learnedFrom: father.id })
    expect(byNode(kid.memory, x)).toBeDefined()
    expect(byNode(father.memory, x)?.seenTick).toBe(9)
  })
})

describe('exchange', () => {
  it('copies newer entries both ways, keeping their sighting tick and amount', () => {
    const { world, parent, child } = family()
    const x = addNode(world, 'resource', 30, 30)
    const y = addNode(world, 'shelter', 10, 30)
    const z = addNode(world, 'danger', 30, 10)
    parent.memory = [know(world, x, 10, { amount: 3 }), know(world, z, 5)]
    child.memory = [know(world, y, 20), know(world, z, 30)]
    shareFamilyKnowledge(world, tuning)
    expect(byNode(child.memory, x)).toMatchObject({ seenTick: 10, amount: 3, learnedFrom: parent.id })
    expect(byNode(parent.memory, y)).toMatchObject({ seenTick: 20, learnedFrom: child.id })
    expect(byNode(parent.memory, z)).toMatchObject({ seenTick: 30, learnedFrom: child.id })
    expect(byNode(child.memory, z)).toMatchObject({ seenTick: 30, learnedFrom: null }) // the child's own, newer sighting stays
    expect(world.familyLearned).toBe(3)
  })

  it('never overwrites a newer sighting with an older one, nor changes an equal one', () => {
    const { world, parent, child } = family()
    const w = addNode(world, 'resource', 30, 30)
    const v = addNode(world, 'water', 30, 10)
    parent.memory = [know(world, w, 50, { amount: 1 }), know(world, v, 40, { amount: 0 })]
    child.memory = [know(world, w, 40, { amount: 9 }), know(world, v, 40, { amount: 5 })]
    shareFamilyKnowledge(world, tuning)
    expect(byNode(parent.memory, w)).toMatchObject({ seenTick: 50, amount: 1, learnedFrom: null })
    expect(byNode(child.memory, w)).toMatchObject({ seenTick: 50, amount: 1, learnedFrom: parent.id })
    expect(byNode(parent.memory, v)).toMatchObject({ seenTick: 40, amount: 0, learnedFrom: null })
    expect(byNode(child.memory, v)).toMatchObject({ seenTick: 40, amount: 5, learnedFrom: null })
    expect(world.familyLearned).toBe(1)
  })

  it('never passes ruins, and skips entries of nodes that no longer exist', () => {
    const { world, parent, child } = family()
    const ruin = addNode(world, 'ruin', 30, 30)
    const gone = addNode(world, 'resource', 10, 30)
    parent.memory = [know(world, ruin, 10), know(world, gone, 10)]
    world.nodes = world.nodes.filter((n) => n.id !== gone)
    shareFamilyKnowledge(world, tuning)
    expect(child.memory).toEqual([])
    expect(world.familyLearned).toBe(0)
  })

  it('does nothing beyond the share radius or on a tick that is not a share tick', () => {
    const near = family()
    const node = addNode(near.world, 'resource', 30, 30)
    near.parent.memory = [know(near.world, node, 10)]
    near.world.tick += 1
    shareFamilyKnowledge(near.world, tuning)
    expect(near.child.memory).toEqual([])

    const far = family()
    far.child.x = far.parent.x + shareRadius + 0.5
    const farNode = addNode(far.world, 'resource', 30, 30)
    far.parent.memory = [know(far.world, farNode, 10)]
    shareFamilyKnowledge(far.world, tuning)
    expect(far.child.memory).toEqual([])
    far.child.x = far.parent.x + shareRadius // exactly on the edge counts as in range
    shareFamilyKnowledge(far.world, tuning)
    expect(far.child.memory).toHaveLength(1)
  })

  it('is switched off by a radius of 0', () => {
    const off = withFamily({ shareRadius: 0 })
    const { world, parent, child } = family()
    const node = addNode(world, 'resource', 30, 30)
    parent.memory = [know(world, node, 10)]
    shareFamilyKnowledge(world, off.tuning)
    expect(child.memory).toEqual([])
  })

  it('never happens between strangers or siblings, however close they stand', () => {
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }, { x: 20.5, y: 20 }, { x: 21, y: 20 }, { x: 35, y: 35 }] }), rules)
    const [a, b, c, parent] = world.bots
    world.tick = shareEvery * 5
    // a is a stranger to b and c; b and c are siblings (their parent stands far away).
    b.parentId = parent.id
    c.parentId = parent.id
    const node = addNode(world, 'resource', 30, 30)
    a.memory = [know(world, node, 10)]
    shareFamilyKnowledge(world, tuning)
    expect(b.memory).toEqual([])
    expect(c.memory).toEqual([])
    b.memory = [know(world, node, 12)]
    shareFamilyKnowledge(world, tuning)
    expect(c.memory).toEqual([])
    expect(a.memory).toHaveLength(1)
    expect(world.familyLearned).toBe(0)
  })

  it('does nothing for a child whose parent is dead, and does not crash', () => {
    const { world, parent, child } = family()
    const node = addNode(world, 'resource', 30, 30)
    child.memory = [know(world, node, 10)]
    world.bots = world.bots.filter((bot) => bot.id !== parent.id)
    expect(() => shareFamilyKnowledge(world, tuning)).not.toThrow()
    expect(child.memory).toHaveLength(1)
    expect(child.memory[0].learnedFrom).toBeNull()
    expect(world.familyLearned).toBe(0)
  })

  it('survives a parent dying of old age next to its child in a full step', () => {
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }, { x: 21, y: 20 }] }), rules)
    world.bots[1].parentId = world.bots[0].id
    world.bots[0].age = tuning.bot.maxAge - 1
    world.tick = shareEvery - 1
    expect(() => step(world, rules)).not.toThrow()
    expect(world.bots).toHaveLength(1)
    expect(() => step(world, rules)).not.toThrow()
  })

  it('keeps the 8 + 2 memory caps, so shared entries only push out older ones', () => {
    const { world, parent, child } = family()
    const food = (n: number, tick: number): MemoryEntry => know(world, addNode(world, 'resource', 2 + n, 38), tick)
    const spring = (n: number, tick: number): MemoryEntry => know(world, addNode(world, 'water', 2 + n, 36), tick)
    const oldFood = [0, 1, 2, 3].map((n) => food(n, 50))
    const freshFood = [4, 5, 6, 7].map((n) => food(n, 200))
    parent.memory = [...oldFood, ...freshFood, spring(0, 300), spring(1, 300)]
    const childFood = [10, 11, 12, 13, 14, 15, 16, 17].map((n) => food(n, 100))
    child.memory = [...childFood, spring(10, 10), spring(11, 10)]
    shareFamilyKnowledge(world, tuning)

    const cap = tuning.memory.cap
    const nonWater = (memory: MemoryEntry[]) => memory.filter((entry) => entry.kind !== 'water')
    const water = (memory: MemoryEntry[]) => memory.filter((entry) => entry.kind === 'water')
    for (const bot of [parent, child]) {
      expect(nonWater(bot.memory)).toHaveLength(cap)
      expect(water(bot.memory)).toHaveLength(tuning.memory.waterCap)
    }
    // The child keeps all four fresh sightings from the parent and four of its own; the stale ones lose out.
    const childIds = new Set(child.memory.map((entry) => entry.nodeId))
    for (const entry of freshFood) expect(childIds.has(entry.nodeId)).toBe(true)
    for (const entry of oldFood) expect(childIds.has(entry.nodeId)).toBe(false)
    expect(water(child.memory).map((entry) => entry.seenTick)).toEqual([300, 300])
    // The parent loses nothing it saw more recently than what it was told.
    const parentIds = new Set(parent.memory.map((entry) => entry.nodeId))
    for (const entry of freshFood) expect(parentIds.has(entry.nodeId)).toBe(true)
    for (const entry of oldFood) expect(parentIds.has(entry.nodeId)).toBe(false)
    // Counted after the trim: the child kept 4 fresh foods and 2 springs; the parent kept 4 of the child's foods.
    expect(world.familyLearned).toBe(10)
  })

  it('is cleared when the bot sees the node itself', () => {
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }] }), rules)
    const bot = world.bots[0]
    const near = addNode(world, 'resource', 22, 20)
    bot.memory = [know(world, near, 0, { learnedFrom: 42, amount: 0 })]
    step(world, rules)
    expect(byNode(bot.memory, near)).toMatchObject({ learnedFrom: null, seenTick: 1 })
    expect(byNode(bot.memory, near)!.amount).toBeGreaterThan(0)
  })
})

describe('inside a whole run', () => {
  function runTo(seed: string, ticks: number, r: Rules = rules): World {
    const world = createWorld(seed, edenPreset, r)
    for (let i = 0; i < ticks; i += 1) step(world, r)
    return world
  }

  it('passes knowledge on: entries learned from a parent exist and are counted', () => {
    const world = runTo('c', 3000)
    expect(world.familyLearned).toBeGreaterThan(0)
    expect(world.bots.some((bot) => bot.memory.some((entry) => entry.learnedFrom !== null))).toBe(true)
    for (const bot of world.bots) {
      for (const entry of bot.memory) {
        if (entry.learnedFrom === null) continue
        // Only a direct parent or child can be the source.
        const source = world.bots.find((other) => other.id === entry.learnedFrom)
        if (source !== undefined) expect([bot.parentId, bot.fatherId].includes(source.id) || source.parentId === bot.id || source.fatherId === bot.id).toBe(true)
        expect(tuning.family.shareKinds).toContain(entry.kind)
      }
    }
  })

  it('shares nothing at all with inheritance and exchange off', () => {
    const off = withFamily({ inherit: false, shareRadius: 0 })
    const world = runTo('c', 3000, off)
    expect(world.familyLearned).toBe(0)
    expect(world.bots.every((bot) => bot.memory.every((entry) => entry.learnedFrom === null))).toBe(true)
  })

  it('gives the same hash for the same seed, and a JSON copy continues identically', () => {
    const one = runTo('d', 2500)
    expect(stateHash(runTo('d', 2500))).toBe(stateHash(one))
    const copy = JSON.parse(JSON.stringify(one)) as World
    expect(stateHash(copy)).toBe(stateHash(one))
    for (let i = 0; i < 500; i += 1) {
      step(one, rules)
      step(copy, rules)
    }
    expect(stateHash(copy)).toBe(stateHash(one))
  })

  it('replays a run with commands to the same hash as the live run', () => {
    const live = createWorld('e', edenPreset, rules)
    for (let i = 0; i < 1200; i += 1) step(live, rules)
    expect(applyCommand(live, rules, { type: 'placeNode', kind: 'resource', x: 50.5, y: 30.5 }).ok).toBe(true)
    for (let i = 0; i < 800; i += 1) step(live, rules)
    expect(applyCommand(live, rules, { type: 'placeBot', x: 20.5, y: 20.5 }).ok).toBe(true)
    for (let i = 0; i < 500; i += 1) step(live, rules)
    expect(live.familyLearned).toBeGreaterThan(0)
    const replayed = replayWorld('e', edenPreset, rules, live.commands, live.tick)
    expect(stateHash(replayed)).toBe(stateHash(live))
  })
})
