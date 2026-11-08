import { describe, expect, it } from 'vitest'

import { chooseFood, insideDanger, nearestKnown, perceive, remember } from './perception.ts'
import { createRng } from './rng.ts'
import type { Bot, MemoryEntry, Tuning, World, WorldNode } from './types.ts'

// Only the numbers perception reads are filled in.
const tuning = {
  bot: { eatRate: 5 },
  memory: { cap: 3, retryTicks: 300 },
  brain: { avoidMargin: 0.75 },
} as unknown as Tuning

function node(id: number, kind: WorldNode['kind'], x: number, over: Partial<WorldNode> = {}): WorldNode {
  return { id, kind, x, y: 10, radius: 2, amount: 100, capacity: 100, regen: 0, damage: 0, heal: 0, drainMult: 1, ...over }
}

function worldWith(nodes: WorldNode[], tick = 1): World {
  return {
    seed: 't',
    tick,
    width: 100,
    height: 20,
    nextId: 100,
    nodes,
    bots: [],
    rng: createRng('t'),
    samples: [],
    log: [],
    commands: [],
    deathsByCause: { starve: 0, danger: 0, age: 0 },
    totalBirths: 0,
  }
}

function botAt(x: number, memory: MemoryEntry[] = []): Bot {
  return {
    id: 1,
    x,
    y: 10,
    px: x,
    py: 10,
    energy: 50,
    health: 100,
    age: 0,
    cooldown: 0,
    generation: 0,
    parentId: null,
    traits: { senseRadius: 6, caution: 0.5, reproThreshold: 80, metabolism: 1 },
    memory,
    intent: { kind: 'wander', targetId: null },
    heading: 0,
  }
}

function entry(nodeId: number, kind: MemoryEntry['kind'], x: number, over: Partial<MemoryEntry> = {}): MemoryEntry {
  return { nodeId, kind, x, y: 10, radius: 2, seenTick: 1, amount: 100, ...over }
}

describe('perceive', () => {
  it('senses nodes whose edge is inside the sense radius, in id order', () => {
    const world = worldWith([node(1, 'resource', 28), node(2, 'resource', 5), node(3, 'danger', 17)])
    expect(perceive(world, botAt(10)).map((n) => n.id)).toEqual([2, 3]) // 3: edge at 15 - 10 = 5 <= 6
  })
})

describe('remember', () => {
  it('keeps at most the memory cap, forgetting the oldest sighting first', () => {
    const nodes = [node(1, 'resource', 10), node(2, 'resource', 11), node(3, 'resource', 12), node(4, 'resource', 13)]
    const world = worldWith(nodes, 10)
    const bot = botAt(10, [entry(1, 'resource', 10, { seenTick: 2 }), entry(9, 'resource', 90, { seenTick: 1 })])
    remember(world, bot, [nodes[1], nodes[2], nodes[3]], tuning, new Set([1, 2, 3, 4, 9]))
    expect(bot.memory).toHaveLength(3)
    expect(bot.memory.map((e) => e.nodeId).sort()).toEqual([2, 3, 4])
  })

  it('refreshes a known entry and drops removed nodes', () => {
    const food = node(1, 'resource', 10, { amount: 30 })
    const world = worldWith([food], 50)
    const bot = botAt(10, [entry(1, 'resource', 10, { seenTick: 5, amount: 100 }), entry(7, 'shelter', 12)])
    remember(world, bot, [food], tuning, new Set([1]))
    expect(bot.memory).toEqual([expect.objectContaining({ nodeId: 1, seenTick: 50, amount: 30, radius: 2 })])
  })
})

describe('chooseFood', () => {
  it('skips a remembered-empty resource until the retry delay has passed', () => {
    const empty = entry(1, 'resource', 12, { amount: 0, seenTick: 100 })
    const bot = botAt(10, [empty])
    expect(chooseFood(worldWith([], 150), bot, tuning, false)).toBeNull()
    expect(chooseFood(worldWith([], 400), bot, tuning, false)?.nodeId).toBe(1)
  })

  it('prefers the nearest resource and breaks ties by node id', () => {
    const bot = botAt(10, [entry(5, 'resource', 20), entry(3, 'resource', 16), entry(4, 'resource', 4)])
    expect(chooseFood(worldWith([], 2), bot, tuning, false)?.nodeId).toBe(3)
  })

  it('skips food inside a remembered danger unless the bot is brave', () => {
    const bot = botAt(10, [entry(1, 'resource', 16), entry(2, 'danger', 16, { radius: 4 }), entry(3, 'resource', 40)])
    expect(chooseFood(worldWith([], 2), bot, tuning, false)?.nodeId).toBe(3)
    expect(chooseFood(worldWith([], 2), bot, tuning, true)?.nodeId).toBe(1)
  })
})

describe('lookups', () => {
  it('finds the nearest remembered node of a kind', () => {
    const bot = botAt(10, [entry(1, 'shelter', 30), entry(2, 'shelter', 18), entry(3, 'danger', 11)])
    expect(nearestKnown(bot, 'shelter')?.nodeId).toBe(2)
    expect(nearestKnown(bot, 'resource')).toBeNull()
  })

  it('tests a point against remembered danger radii plus a margin', () => {
    const dangers = [entry(1, 'danger', 20, { radius: 4 })]
    expect(insideDanger(dangers, 16.5, 10, 0.75)).toBe(true)
    expect(insideDanger(dangers, 15, 10, 0.75)).toBe(false)
  })
})
