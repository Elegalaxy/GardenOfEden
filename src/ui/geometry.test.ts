import { describe, expect, it } from 'vitest'

import type { Bot, WorldNode } from '../sim/types.ts'
import { botAt, cellAtPixel, cellCenter, findBot, nodeAt, pickAt } from './geometry.ts'

const world = { width: 10, height: 8 }
const layout = { scale: 20, offsetX: 10, offsetY: 5 }

function node(id: number, kind: WorldNode['kind'], x: number, y: number, radius: number): WorldNode {
  return { id, kind, x, y, radius, amount: 0, capacity: 0, regen: 0, damage: 0, heal: 0, drainMult: 1, decay: 0 }
}

function bot(id: number, x: number, y: number, px = x, py = y): Bot {
  return {
    id, x, y, px, py, energy: 1, health: 1, thirst: 1, age: 0, cooldown: 0, generation: 0, parentId: null,
    traits: { senseRadius: 1, caution: 0, reproThreshold: 1, metabolism: 1 }, memory: [],
    intent: { kind: 'wander', targetId: null }, heading: 0,
  }
}

describe('cellAtPixel', () => {
  it('maps pixels to cells and back to the cell centre', () => {
    const cell = cellAtPixel(layout, world, 10 + 3 * 20 + 5, 5 + 2 * 20 + 19)
    expect(cell).toEqual({ cx: 3, cy: 2 })
    expect(cellCenter(cell!)).toEqual({ x: 3.5, y: 2.5 })
  })

  it('returns null outside the map, including the letterbox and the far edges', () => {
    expect(cellAtPixel(layout, world, 5, 50)).toBeNull()
    expect(cellAtPixel(layout, world, 50, 2)).toBeNull()
    expect(cellAtPixel(layout, world, 10 + 10 * 20, 50)).toBeNull()
    expect(cellAtPixel(layout, world, 50, 5 + 8 * 20)).toBeNull()
    expect(cellAtPixel(layout, world, 10, 5)).toEqual({ cx: 0, cy: 0 })
  })
})

describe('nodeAt', () => {
  it('prefers the smallest node, so a grove resource beats its danger', () => {
    const w = { nodes: [node(1, 'danger', 5, 5, 4), node(2, 'resource', 5, 5, 2)] }
    expect(nodeAt(w, 5.5, 5)?.id).toBe(2)
    expect(nodeAt(w, 8, 5)?.id).toBe(1)
    expect(nodeAt(w, 12, 5)).toBeUndefined()
  })

  it('prefers the newest among equal sizes', () => {
    const w = { nodes: [node(1, 'danger', 5, 5, 4), node(9, 'danger', 6, 5, 4)] }
    expect(nodeAt(w, 5.5, 5)?.id).toBe(9)
  })
})

describe('botAt and pickAt', () => {
  const w = { bots: [bot(3, 4, 4), bot(7, 4.5, 4)], nodes: [node(1, 'shelter', 4, 4, 3)] }

  it('picks the nearest bot within reach', () => {
    expect(botAt(w, 4.4, 4, 1, 1)?.id).toBe(7)
    expect(botAt(w, 9, 9, 1, 1)).toBeUndefined()
  })

  it('uses the blended position', () => {
    const moving = { bots: [bot(9, 6, 4, 2, 4)] }
    expect(botAt(moving, 2, 4, 0, 0.5)?.id).toBe(9)
    expect(botAt(moving, 6, 4, 1, 0.5)?.id).toBe(9)
  })

  it('selects a bot over a node, a node over nothing, and null when empty', () => {
    expect(pickAt(w, 4, 4, 1, 1)).toEqual({ kind: 'bot', id: 3 })
    expect(pickAt(w, 6, 4, 1, 0.2)).toEqual({ kind: 'node', id: 1 })
    expect(pickAt(w, 9, 9, 1, 1)).toBeNull()
  })
})

describe('findBot', () => {
  it('finds by id in an ascending list', () => {
    const w = { bots: [bot(2, 0, 0), bot(5, 0, 0), bot(9, 0, 0), bot(11, 0, 0)] }
    expect(findBot(w, 9)?.id).toBe(9)
    expect(findBot(w, 2)?.id).toBe(2)
    expect(findBot(w, 4)).toBeUndefined()
    expect(findBot({ bots: [] }, 1)).toBeUndefined()
  })
})
