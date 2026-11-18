import { describe, expect, it } from 'vitest'

import { tuning } from '../content/index.ts'
import type { Den, PredatorLife, PredatorState, Sample, WorldNode } from '../sim/types.ts'
import { denFor, originText, predatorCapNotice, predatorChange, predatorCounts, predatorLifeInfo, predatorSeries, predatorTraitRows, preyPressure, multiplierText, multiplierTrend } from './predatorInfo.ts'

const eco = tuning.predator.ecology

function hunt(life: Partial<PredatorLife> | undefined): PredatorState {
  return {
    px: 0,
    py: 0,
    heading: 0,
    homeX: 10,
    homeY: 10,
    targetId: null,
    chase: 0,
    restUntil: 0,
    kills: 0,
    ...(life === undefined ? {} : { life: { energy: 50, age: 100, born: 0, origin: 'founder', parentId: null, kidsKills: 0, ...life } }),
  }
}

function node(id: number, state: PredatorState | null, kind: WorldNode['kind'] = 'predator'): WorldNode {
  return { id, kind, x: 0, y: 0, radius: 1, amount: 0, capacity: 0, regen: 0, damage: 0, heal: 0, drainMult: 1, decay: 0, expires: 0, hunt: state } as WorldNode
}

describe('predatorLifeInfo', () => {
  it('is null without a life', () => {
    expect(predatorLifeInfo(hunt(undefined), tuning, 3, 1000)).toBeNull()
  })

  it('reports a hungry predator with no time to hungry and a time to starve', () => {
    const info = predatorLifeInfo(hunt({ energy: 50 }), tuning, 3, 1000)!
    expect(info).toMatchObject({ energy: 50, maxEnergy: eco.maxEnergy, huntBelow: eco.huntBelow, hungry: true, ticksToHungry: null, age: 100, maxAge: eco.maxAge, adult: false })
    expect(info.ticksToStarve).toBe(Math.ceil(50 / eco.drain))
  })

  it('counts the ticks until a fed predator is hungry again', () => {
    const info = predatorLifeInfo(hunt({ energy: 90 }), tuning, 3, 1000)!
    expect(info.hungry).toBe(false)
    expect(info.ticksToHungry).toBe(Math.ceil((90 - eco.huntBelow) / eco.drain))
  })

  it('has no countdowns when energy does not drain', () => {
    const still = { predator: { ...tuning.predator, ecology: { ...eco, drain: 0 } } }
    const info = predatorLifeInfo(hunt({ energy: 90 }), still, 3, 1000)!
    expect(info.ticksToHungry).toBeNull()
    expect(info.ticksToStarve).toBeNull()
  })

  it('names the first reason a cub is blocked, in the sim order', () => {
    const ready = { kidsKills: eco.killsPerCub, age: eco.adultAge, energy: eco.cubCost + eco.huntBelow }
    const room = tuning.predator.maxCount - 1
    expect(predatorLifeInfo(hunt(ready), tuning, room, 1000)!.cubBlock).toBeNull()
    expect(predatorLifeInfo(hunt({ ...ready, kidsKills: 1, age: 0, energy: 0 }), tuning, 99, 1000)!.cubBlock).toBe('kills')
    expect(predatorLifeInfo(hunt({ ...ready, age: 0, energy: 0 }), tuning, 99, 1000)!.cubBlock).toBe('age')
    expect(predatorLifeInfo(hunt({ ...ready, energy: 0 }), tuning, 99, 1000)!.cubBlock).toBe('energy')
    expect(predatorLifeInfo(hunt(ready), tuning, tuning.predator.maxCount, 1000)!.cubBlock).toBe('cap')
    expect(predatorLifeInfo(hunt(ready), tuning, room, 1000)!.adult).toBe(true)
  })
})

describe('originText', () => {
  it('words every origin and keeps a cub parent as an id', () => {
    expect(originText({ origin: 'founder', born: 0, parentId: null })).toEqual({ text: 'Founder', parentId: null })
    expect(originText({ origin: 'placed', born: 1200, parentId: null })).toEqual({ text: 'Placed by you at tick 1,200', parentId: null })
    expect(originText({ origin: 'cub', born: 5000, parentId: 7 })).toEqual({ text: 'Cub of #7, born tick 5,000', parentId: 7 })
    expect(originText({ origin: 'arrived', born: 3100, parentId: null })).toEqual({ text: 'Arrived from the map edge at tick 3,100', parentId: null })
  })
})

describe('denFor', () => {
  const dens: Den[] = [
    { x: 10, y: 10, vacantSince: null },
    { x: 50, y: 50, vacantSince: 100 },
  ]
  it('finds the den within the radius, edge included, else null', () => {
    expect(denFor(dens, { homeX: 12, homeY: 10 }, 4)).toBe(dens[0])
    expect(denFor(dens, { homeX: 14, homeY: 10 }, 4)).toBe(dens[0])
    expect(denFor(dens, { homeX: 30, homeY: 30 }, 4)).toBeNull()
    expect(denFor([], { homeX: 0, homeY: 0 }, 4)).toBeNull()
  })
})

describe('predatorCounts and predatorCapNotice', () => {
  const nodes = [
    node(1, hunt({ origin: 'founder', energy: 50 })),
    node(2, hunt({ origin: 'founder', energy: 90 })),
    node(3, hunt({ origin: 'cub', energy: 50 })),
    node(4, hunt({ origin: 'placed', energy: 50 })),
    node(5, null, 'resource'),
  ]
  it('counts total, hungry and origins', () => {
    expect(predatorCounts(nodes, tuning)).toEqual({ total: 4, hungry: 3, byOrigin: { founder: 2, placed: 1, cub: 1, arrived: 0 } })
  })
  it('writes the cap notice listing only the origins present', () => {
    expect(predatorCapNotice(nodes, tuning)).toBe(`Predator cap reached (4 / ${tuning.predator.maxCount}: 2 founders, 1 cub, 1 placed). Remove one to place another.`)
    expect(predatorCapNotice([node(1, hunt({ origin: 'arrived' }))], tuning)).toContain('1 arrived')
  })
  it('writes just the count when no predator has a life', () => {
    expect(predatorCapNotice([node(1, hunt(undefined))], tuning)).toBe(`Predator cap reached (1 / ${tuning.predator.maxCount}). Remove one to place another.`)
  })
})

describe('predatorChange and predatorSeries', () => {
  const sample = (tick: number, predators?: number): Sample => ({ tick, pop: 10, births: 0, deaths: 0, food: 0, traits: null, ...(predators === undefined ? {} : { predators }) })
  const samples = [sample(0, 3), sample(100, 4), sample(200, 5)]
  it('gives the change over the window', () => {
    expect(predatorChange(samples, sample(200, 5), 100)).toEqual({ span: 100, delta: 1 })
    expect(predatorChange(samples, sample(200, 2), 500)).toEqual({ span: 200, delta: -1 })
  })
  it('is null with no history or no counts', () => {
    expect(predatorChange([], sample(0, 3), 100)).toBeNull()
    expect(predatorChange(samples, sample(0, 3), 100)).toBeNull()
    expect(predatorChange([sample(0), sample(100)], sample(200, 5), 300)).toBeNull()
    expect(predatorChange(samples, sample(200), 100)).toBeNull()
  })
  it('keeps only samples with a predator count', () => {
    expect(predatorSeries([sample(0), sample(100, 4), sample(200, 0)])).toEqual([{ tick: 100, count: 4 }, { tick: 200, count: 0 }])
    expect(predatorSeries([])).toEqual([])
  })
})

describe('prey limit', () => {
  const ready = { kidsKills: 99, age: 99999, energy: 100 }
  it('blocks a cub when the count reaches the limit but not the cap', () => {
    const limit = tuning.predator.prey.perPredator * 3
    expect(predatorLifeInfo(hunt(ready), tuning, 3, limit)!.cubBlock).toBe('prey')
    expect(predatorLifeInfo(hunt(ready), tuning, 2, limit)!.cubBlock).toBeNull()
    expect(predatorLifeInfo(hunt(ready), tuning, tuning.predator.maxCount, limit)!.cubBlock).toBe('cap')
  })
  it('reports limit, over and the leave countdown', () => {
    const per = tuning.predator.prey.perPredator
    const leave = tuning.predator.prey.leaveAfter
    expect(preyPressure(undefined, per * 2, 2, 100, tuning)).toEqual({ limit: 2, over: false, leavesIn: null })
    const eco = { prey: { overSince: 100, left: 0 } }
    expect(preyPressure(eco, per * 2, 3, 300, tuning)).toEqual({ limit: 2, over: true, leavesIn: leave - 200 })
    expect(preyPressure(eco, per * 2, 3, 100 + leave + 50, tuning).leavesIn).toBe(0)
    expect(preyPressure({}, per * 2, 3, 300, tuning).leavesIn).toBeNull()
  })
  it('is inert with the prey rule off', () => {
    const off = { predator: { ...tuning.predator, prey: { ...tuning.predator.prey, enabled: false } } }
    expect(preyPressure({ prey: { overSince: 0, left: 0 } }, 0, 5, 10, off)).toEqual({ limit: tuning.predator.maxCount, over: false, leavesIn: null })
  })
})

describe('predatorTraitRows', () => {
  const base = hunt(undefined)
  it('is null without traits', () => {
    expect(predatorTraitRows(base, tuning)).toBeNull()
  })

  it('gives founders neutral rows in the shipped units', () => {
    const rows = predatorTraitRows({ ...base, traits: { sense: 1, speed: 1, stamina: 1 }, generation: 0 }, tuning)!
    expect(rows.map((r) => r.key)).toEqual(['sense', 'speed', 'stamina', 'generation'])
    expect(rows[0]!.value).toBe(`${tuning.predator.senseRadius.toFixed(1)} cells`)
    expect(rows[1]!.value).toBe(`${tuning.predator.speed.toFixed(2)} /tick`)
    expect(rows[2]!.value).toBe(`${tuning.predator.chaseTicks} ticks`)
    expect(rows.slice(0, 3).every((r) => r.multiplier === '×1.00' && r.trend === 'flat')).toBe(true)
    expect(rows[3]).toMatchObject({ value: '0', multiplier: null, trend: null })
  })

  it('scales each number by its trait and marks the direction', () => {
    const rows = predatorTraitRows({ ...base, traits: { sense: 1.15, speed: 1.08, stamina: 0.5 }, generation: 3 }, tuning)!
    expect(rows[0]).toMatchObject({ value: `${(tuning.predator.senseRadius * 1.15).toFixed(1)} cells`, multiplier: '×1.15', trend: 'up' })
    expect(rows[1]).toMatchObject({ value: `${(tuning.predator.speed * 1.08).toFixed(2)} /tick`, multiplier: '×1.08', trend: 'up' })
    expect(rows[1]!.note).toContain('1.08')
    expect(rows[2]).toMatchObject({ value: `${Math.round(tuning.predator.chaseTicks * 0.5)} ticks`, multiplier: '×0.50', trend: 'down' })
    expect(rows[3]!.value).toBe('3')
  })
})

describe('multiplier text', () => {
  it('rounds to two decimals and calls 1.004 flat', () => {
    expect(multiplierText(1.2345)).toBe('×1.23')
    expect(multiplierTrend(1.004)).toBe('flat')
    expect(multiplierTrend(1.02)).toBe('up')
    expect(multiplierTrend(0.98)).toBe('down')
  })
})
