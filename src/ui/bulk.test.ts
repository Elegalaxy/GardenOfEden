import { describe, expect, it } from 'vitest'

import { batchNotice, bulkCommands, spreadPoints } from './bulk.ts'

// The pure side of bulk placing: random distinct cell centres and the notice wording.

function counter(): () => number {
  let state = 12345
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

describe('spreadPoints', () => {
  it('gives distinct cell centres inside the map', () => {
    const points = spreadPoints(200, 96, 64, counter())
    expect(points).toHaveLength(200)
    expect(new Set(points.map((p) => `${p.x},${p.y}`)).size).toBe(200)
    for (const p of points) {
      expect(p.x).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(96)
      expect(p.y).toBeGreaterThan(0)
      expect(p.y).toBeLessThan(64)
      expect(p.x % 1).toBe(0.5)
      expect(p.y % 1).toBe(0.5)
    }
  })

  it('never gives more spots than the map has cells', () => {
    expect(spreadPoints(50, 4, 3, counter())).toHaveLength(12)
  })
})

describe('bulkCommands', () => {
  it('builds ordinary placeBot or placeNode commands with explicit coordinates', () => {
    const bots = bulkCommands(null, 3, 96, 64, counter())
    expect(bots.map((c) => c.type)).toEqual(['placeBot', 'placeBot', 'placeBot'])
    const nodes = bulkCommands('water', 2, 96, 64, counter())
    expect(nodes[0]).toMatchObject({ type: 'placeNode', kind: 'water' })
  })
})

describe('batchNotice', () => {
  it('says all placed with no reason', () => {
    expect(batchNotice('bots', { total: 10, placed: 10, refused: 0, firstReason: null })).toBe('Placed 10 of 10 bots.')
  })

  it('names a cap, a crowded spot, or the raw reason', () => {
    expect(batchNotice('bots', { total: 50, placed: 37, refused: 13, firstReason: 'The population cap (2000) is reached.' })).toBe('Placed 37 of 50 bots (cap reached).')
    expect(batchNotice('danger nodes', { total: 50, placed: 40, refused: 10, firstReason: 'The map is full (400 nodes).' })).toBe('Placed 40 of 50 danger nodes (cap reached).')
    expect(batchNotice('water nodes', { total: 10, placed: 9, refused: 1, firstReason: 'Too close to another water node.' })).toBe('Placed 9 of 10 water nodes (some spots were too close).')
    expect(batchNotice('bots', { total: 5, placed: 0, refused: 5, firstReason: 'A saved run is loading. Wait for it or cancel it first.' })).toBe(
      'Placed 0 of 5 bots (A saved run is loading. Wait for it or cancel it first).',
    )
  })
})
