import { describe, expect, it } from 'vitest'

import { chooseFood, chooseWater, insideDanger, nearestKnown, perceive, remember } from './perception.ts'
import { createRng } from './rng.ts'
import type { Bot, MemoryEntry, Tuning, World, WorldNode } from './types.ts'

// Only the numbers perception reads are filled in.
const tuning = {
  bot: { eatRate: 5 },
  memory: { cap: 3, waterCap: 2, retryTicks: 300 },
  brain: { avoidMargin: 0.75 },
} as unknown as Tuning

function node(id: number, kind: WorldNode['kind'], x: number, over: Partial<WorldNode> = {}): WorldNode {
  return { id, kind, x, y: 10, radius: 2, amount: 100, capacity: 100, regen: 0, damage: 0, heal: 0, drainMult: 1, decay: 0, ...over }
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
    deathsByCause: { starve: 0, thirst: 0, danger: 0, age: 0 },
    eaten: { resource: 0, ruin: 0 },
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
    thirst: 100,
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

  it('keeps water in its own slots, so food cannot push a spring out and springs cannot push food out', () => {
    const food = [node(1, 'resource', 10), node(2, 'resource', 11), node(3, 'resource', 12), node(4, 'resource', 13)]
    const springs = [node(5, 'water', 9), node(6, 'water', 8), node(7, 'water', 7)]
    const world = worldWith([...food, ...springs], 10)
    // The springs were seen long ago; the food is fresh. Plain "oldest first" would drop the springs.
    const bot = botAt(10, [entry(5, 'water', 9, { seenTick: 1 }), entry(6, 'water', 8, { seenTick: 2 })])
    remember(world, bot, [...food, springs[2]], tuning, new Set([1, 2, 3, 4, 5, 6, 7]))
    const water = bot.memory.filter((e) => e.kind === 'water').map((e) => e.nodeId)
    const others = bot.memory.filter((e) => e.kind !== 'water')
    expect(others).toHaveLength(3) // the food cap, with the oldest food (id 1, same tick: lowest id) forgotten
    expect(others.map((e) => e.nodeId).sort()).toEqual([2, 3, 4])
    expect(water.sort()).toEqual([6, 7]) // the water cap of 2 forgets the oldest spring (id 5)
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

  it('treats a ruin as food, but never retries an empty one (ruins do not regrow)', () => {
    const bot = botAt(10, [entry(1, 'ruin', 14, { amount: 20 }), entry(2, 'resource', 30)])
    expect(chooseFood(worldWith([], 2), bot, tuning, false)?.nodeId).toBe(1)
    const spent = botAt(10, [entry(1, 'ruin', 14, { amount: 2, seenTick: 1 })])
    expect(chooseFood(worldWith([], 1000), spent, tuning, false)).toBeNull()
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

describe('chooseWater', () => {
  it('picks the nearest remembered spring and breaks ties by node id', () => {
    const bot = botAt(10, [entry(5, 'water', 24), entry(3, 'water', 17), entry(4, 'resource', 11), entry(2, 'water', 1)])
    expect(chooseWater(bot, tuning, false)?.nodeId).toBe(3)
    const tied = botAt(10, [entry(9, 'water', 16), entry(8, 'water', 4)])
    expect(chooseWater(tied, tuning, false)?.nodeId).toBe(8)
  })

  it('is null when no spring is remembered', () => {
    expect(chooseWater(botAt(10, [entry(1, 'resource', 12)]), tuning, false)).toBeNull()
  })

  it('skips a spring inside a remembered danger unless the bot is brave', () => {
    const bot = botAt(10, [entry(1, 'water', 16), entry(2, 'danger', 16, { radius: 4 }), entry(3, 'water', 40)])
    expect(chooseWater(bot, tuning, false)?.nodeId).toBe(3)
    expect(chooseWater(bot, tuning, true)?.nodeId).toBe(1)
  })

  it('does not care how much a spring holds, since it never runs dry', () => {
    const bot = botAt(10, [entry(1, 'water', 16, { amount: 0 })])
    expect(chooseWater(bot, tuning, false)?.nodeId).toBe(1)
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
