import { describe, expect, it } from 'vitest'

import { exposureAt, regrow, regrowthMultiplier } from './nodes.ts'
import { createRng } from './rng.ts'
import type { ActiveEvent, World, WorldNode } from './types.ts'

function node(id: number, kind: WorldNode['kind'], x: number, over: Partial<WorldNode> = {}): WorldNode {
  return { id, kind, x, y: 10, radius: 3, amount: 0, capacity: 0, regen: 0, damage: 0, heal: 0, drainMult: 1, decay: 0, expires: 0, ...over }
}

function worldWith(nodes: WorldNode[]): World {
  return {
    seed: 't',
    tick: 0,
    width: 50,
    height: 20,
    nextId: 100,
    nodes,
    bots: [],
    rng: createRng('t'),
    samples: [],
    log: [],
    commands: [],
    deathsByCause: { starve: 0, thirst: 0, danger: 0, plague: 0, meteor: 0, age: 0 },
    events: [],
    eaten: { resource: 0, ruin: 0 },
    totalBirths: 0,
  }
}

describe('exposureAt', () => {
  const world = worldWith([
    node(1, 'danger', 10, { damage: 2 }),
    node(2, 'danger', 12, { damage: 3 }),
    node(3, 'shelter', 30, { heal: 0.5, drainMult: 0.5 }),
  ])

  it('adds up danger damage where nodes overlap', () => {
    expect(exposureAt(world, 11, 10)).toMatchObject({ damage: 5, heal: 0, drainMult: 1, shelterId: null })
  })

  it('reports shelter heal, drain multiplier and id inside the radius only', () => {
    expect(exposureAt(world, 31, 10)).toMatchObject({ damage: 0, heal: 0.5, drainMult: 0.5, shelterId: 3 })
    expect(exposureAt(world, 34, 10).shelterId).toBeNull()
  })
})

describe('ruins', () => {
  it('neither heal nor hurt, and do not count as a shelter', () => {
    const world = worldWith([node(1, 'ruin', 10, { amount: 20, capacity: 60, decay: 0.05 })])
    expect(exposureAt(world, 10, 10)).toMatchObject({ damage: 0, heal: 0, drainMult: 1, shelterId: null })
  })
})

describe('regrow', () => {
  it('refills resources up to capacity and leaves other nodes alone', () => {
    const world = worldWith([
      node(1, 'resource', 5, { amount: 98, capacity: 100, regen: 0.5 }),
      node(2, 'resource', 15, { amount: 99.8, capacity: 100, regen: 0.5 }),
      node(3, 'danger', 25, { damage: 1 }),
      node(4, 'ruin', 35, { amount: 10, capacity: 60, decay: 0.05 }),
    ])
    regrow(world)
    expect(world.nodes[0].amount).toBe(98.5)
    expect(world.nodes[1].amount).toBe(100)
    expect(world.nodes[2].amount).toBe(0)
    expect(world.nodes[3].amount).toBe(10)
  })
})

function event(over: Partial<ActiveEvent>): ActiveEvent {
  return { kind: 'plague', startTick: 0, endTick: 100, x: 10, y: 10, radius: 5, magnitude: 0.8, ...over }
}

describe('world events in the node rules', () => {
  it('adds plague damage inside the radius only, apart from danger damage', () => {
    const world = worldWith([node(1, 'danger', 10, { damage: 2 })])
    world.events.push(event({}), event({ x: 12, magnitude: 0.5 }))
    expect(exposureAt(world, 10, 10)).toMatchObject({ damage: 2, plague: 1.3 })
    expect(exposureAt(world, 16, 10)).toMatchObject({ damage: 0, plague: 0.5 })
    expect(exposureAt(world, 30, 10).plague).toBe(0)
  })

  it('ignores global events in exposure, and plague in the regrowth multiplier', () => {
    const world = worldWith([])
    world.events.push(event({ kind: 'drought', x: 0, y: 0, radius: 0, magnitude: 0.25 }), event({}))
    expect(exposureAt(world, 0, 0).plague).toBe(0)
    expect(regrowthMultiplier(world)).toBe(0.25)
  })

  it('multiplies the regrowth of resources only, and a drought and a bounty together multiply', () => {
    const world = worldWith([
      node(1, 'resource', 5, { amount: 10, capacity: 100, regen: 0.5 }),
      node(2, 'ruin', 15, { amount: 10, capacity: 60, decay: 0.05 }),
      node(3, 'water', 25),
    ])
    expect(regrowthMultiplier(world)).toBe(1)
    world.events.push(event({ kind: 'drought', magnitude: 0.5 }), event({ kind: 'bounty', magnitude: 4 }))
    expect(regrowthMultiplier(world)).toBe(2)
    regrow(world)
    expect(world.nodes[0].amount).toBe(11)
    expect(world.nodes[1].amount).toBe(10)
    expect(world.nodes[2].amount).toBe(0)
  })
})
