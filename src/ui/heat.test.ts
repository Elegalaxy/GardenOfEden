import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../content/index.ts'
import { stateHash } from '../sim/hash.ts'
import { step } from '../sim/step.ts'
import { applyCommand } from '../sim/commands.ts'
import type { Bot, DeathCause, SimEvent, World } from '../sim/types.ts'
import { createWorld } from '../sim/world.ts'
import { globalEventForKey } from './eventInfo.ts'
import {
  HEAT_BIN_COUNT,
  HEAT_DECAY,
  HEAT_DECAY_EVERY,
  HEAT_HALF_LIFE_TICKS,
  HEAT_LAYERS,
  binUpper,
  createHeat,
  describeHeat,
  formatHeat,
  heatAt,
  heatBin,
  isHeatKey,
  legendBins,
  nextHeatLayer,
  observeWorld,
  scaleFor,
  snapshotHeat,
} from './heat.ts'
import type { Observable } from './heat.ts'
import { toolForKey } from './tools.ts'

/** A world-shaped value with just what `observeWorld` reads. */
function fake(tick: number, bots: { x: number; y: number }[], log: SimEvent[] = [], totalBirths = 0, deaths: Partial<World['deathsByCause']> = {}): Observable {
  return {
    tick,
    bots: bots as unknown as Bot[],
    log,
    totalBirths,
    deathsByCause: { starve: 0, thirst: 0, danger: 0, plague: 0, meteor: 0, age: 0, ...deaths },
  }
}

const birth = (tick: number, x: number, y: number): SimEvent => ({ tick, type: 'birth', botId: 1, x, y })
const death = (tick: number, x: number, y: number, cause: DeathCause = 'starve'): SimEvent => ({ tick, type: 'death', botId: 1, cause, x, y })

describe('traffic', () => {
  it('counts every living bot once per new tick, in the cell under its floor position', () => {
    const heat = createHeat(10, 6)
    observeWorld(heat, fake(1, [{ x: 2.9, y: 1.1 }, { x: 2.1, y: 1.9 }, { x: 9, y: 5 }]))
    observeWorld(heat, fake(2, [{ x: 2.5, y: 1.5 }]))
    const at = (x: number, y: number): number => heat.total.traffic[y * 10 + x]!
    expect(at(2, 1)).toBe(3)
    expect(at(9, 5)).toBe(1)
    expect(heat.total.traffic.reduce((a, b) => a + b, 0)).toBe(4)
    expect(heat.recent.traffic[1 * 10 + 2]).toBe(3)
  })

  it('does not count again when the tick has not moved (after a command)', () => {
    const heat = createHeat(10, 6)
    const world = fake(1, [{ x: 1, y: 1 }])
    observeWorld(heat, world)
    observeWorld(heat, world)
    observeWorld(heat, world)
    expect(heat.total.traffic[1 * 10 + 1]).toBe(1)
  })

  it('keeps a bot on the map edge inside the grid', () => {
    const heat = createHeat(10, 6)
    observeWorld(heat, fake(1, [{ x: 10, y: 6 }, { x: -0.2, y: 0 }]))
    expect(heat.total.traffic[5 * 10 + 9]).toBe(1)
    expect(heat.total.traffic[0]).toBe(1)
  })
})

describe('births and deaths', () => {
  it('put each new event in its own cell, read from the newest log entries', () => {
    const heat = createHeat(10, 6)
    const log = [birth(1, 3.2, 4.8), death(1, 7.5, 0.5), death(1, 7.9, 0.1)]
    observeWorld(heat, fake(1, [], log, 1, { starve: 2 }))
    expect(heat.total.births[4 * 10 + 3]).toBe(1)
    expect(heat.total.deaths[7]).toBe(2)
    expect(heat.seenBirths).toBe(1)
    expect(heat.seenDeaths).toBe(2)
    expect(heat.unattributed).toBe(0)
    // A second look at the same world adds nothing.
    observeWorld(heat, fake(1, [], log, 1, { starve: 2 }))
    expect(heat.total.births.reduce((a, b) => a + b, 0)).toBe(1)
    expect(heat.total.deaths.reduce((a, b) => a + b, 0)).toBe(2)
  })

  it('count only what is new since the last look', () => {
    const heat = createHeat(10, 6)
    const log = [birth(1, 1, 1)]
    observeWorld(heat, fake(1, [], log, 1))
    log.push(birth(2, 5, 5), death(2, 6, 2))
    observeWorld(heat, fake(2, [], log, 2, { age: 1 }))
    expect(heat.total.births[1 * 10 + 1]).toBe(1)
    expect(heat.total.births[5 * 10 + 5]).toBe(1)
    expect(heat.total.deaths[2 * 10 + 6]).toBe(1)
  })

  it('count a meteor kill seen after a command at the same tick', () => {
    const heat = createHeat(10, 6)
    const log = [death(4, 2, 2)]
    observeWorld(heat, fake(4, [], log, 0, { starve: 1 }))
    log.push(death(4, 8, 3, 'meteor'), death(4, 8.5, 3.5, 'meteor'))
    observeWorld(heat, fake(4, [], log, 0, { starve: 1, meteor: 2 }))
    expect(heat.total.deaths[2 * 10 + 2]).toBe(1)
    expect(heat.total.deaths[3 * 10 + 8]).toBe(2)
    expect(heat.unattributed).toBe(0)
  })

  it('put what the ring dropped in `unattributed` and never count an older entry as new', () => {
    const heat = createHeat(10, 6)
    observeWorld(heat, fake(5, [], [birth(4, 1, 1)], 1))
    // Ten births happened by tick 20 but only three of them are still in the log. (The ring drops the oldest first, so the
    // old tick-4 birth is gone from a real log by then; it is put back here to show it is not counted a second time.)
    const log = [birth(4, 1, 1), birth(20, 4, 4), birth(20, 4, 4), birth(20, 5, 4)]
    observeWorld(heat, fake(20, [], log, 11))
    expect(heat.total.births[1 * 10 + 1]).toBe(1) // only the first look counted it
    expect(heat.total.births[4 * 10 + 4]).toBe(2)
    expect(heat.total.births[4 * 10 + 5]).toBe(1)
    expect(heat.unattributed).toBe(10 - 3)
  })

  it('degrade gracefully with an empty log', () => {
    const heat = createHeat(10, 6)
    observeWorld(heat, fake(3, [], [], 4, { starve: 2 }))
    expect(heat.unattributed).toBe(6)
    expect(heat.total.births.reduce((a, b) => a + b, 0)).toBe(0)
    expect(heat.seenBirths).toBe(4)
    expect(heat.seenDeaths).toBe(2)
  })

  it('see meteor kills on a real world observed after the command, and nowhere else', () => {
    const world = createWorld('heat-meteor', edenPreset, rules)
    const heat = createHeat(world.width, world.height)
    for (let i = 0; i < 20; i += 1) {
      step(world, rules)
      observeWorld(heat, world)
    }
    const target = world.bots[0]!
    const before = world.deathsByCause.meteor
    expect(applyCommand(world, rules, { type: 'triggerEvent', event: 'meteor', x: target.x, y: target.y }).ok).toBe(true)
    const killed = world.deathsByCause.meteor - before
    expect(killed).toBeGreaterThan(0)
    observeWorld(heat, world)
    const sum = (grid: Float64Array): number => grid.reduce((a, b) => a + b, 0)
    expect(sum(heat.total.deaths)).toBe(Object.values(world.deathsByCause).reduce((a, b) => a + b, 0))
    expect(heat.total.deaths[Math.floor(target.y) * world.width + Math.floor(target.x)]).toBeGreaterThan(0)
    expect(heat.unattributed).toBe(0)
  })
})

describe('recent heat', () => {
  it('fades by the decay factor on every 100th tick and not between', () => {
    const heat = createHeat(4, 4)
    observeWorld(heat, fake(1, [{ x: 0, y: 0 }]))
    expect(heat.recent.traffic[0]).toBe(1)
    for (let tick = 2; tick < HEAT_DECAY_EVERY; tick += 1) observeWorld(heat, fake(tick, []))
    expect(heat.recent.traffic[0]).toBe(1)
    observeWorld(heat, fake(HEAT_DECAY_EVERY, []))
    expect(heat.recent.traffic[0]).toBeCloseTo(HEAT_DECAY, 6)
    expect(heat.total.traffic[0]).toBe(1) // the all-time count never fades
  })

  it('halves in about 650 ticks', () => {
    expect(HEAT_HALF_LIFE_TICKS).toBeGreaterThan(640)
    expect(HEAT_HALF_LIFE_TICKS).toBeLessThan(670)
    const heat = createHeat(4, 4)
    observeWorld(heat, fake(1, [{ x: 0, y: 0 }]))
    for (let tick = 2; tick <= 1 + Math.round(HEAT_HALF_LIFE_TICKS / 100) * 100; tick += 1) observeWorld(heat, fake(tick, []))
    // 7 fades (700 ticks) leave 0.9^7 = 0.478 of it, 6 leave 0.531.
    expect(heat.recent.traffic[0]).toBeCloseTo(Math.pow(HEAT_DECAY, 7), 5)
  })

  it('fades a catch-up of several ticks by every 100th tick it crossed', () => {
    const heat = createHeat(4, 4)
    observeWorld(heat, fake(1, [{ x: 0, y: 0 }]))
    observeWorld(heat, fake(250, []))
    expect(heat.recent.traffic[0]).toBeCloseTo(HEAT_DECAY * HEAT_DECAY, 5)
  })

  it('drops a faded value to exactly zero rather than leaving a speck', () => {
    const heat = createHeat(4, 4)
    observeWorld(heat, fake(1, [{ x: 0, y: 0 }]))
    observeWorld(heat, fake(100 * 200, []))
    expect(heat.recent.traffic[0]).toBe(0)
  })
})

describe('snapshotHeat', () => {
  it('gives one layer with the largest cell, where it is (first in reading order) and the total', () => {
    const heat = createHeat(5, 3)
    heat.total.deaths[1 * 5 + 3] = 4
    heat.total.deaths[2 * 5 + 0] = 4
    heat.total.deaths[0] = 1
    heat.recent.deaths[0] = 0.5
    const all = snapshotHeat(heat, 'deaths', 'all', 7)
    expect(all).toMatchObject({ runId: 7, layer: 'deaths', range: 'all', width: 5, height: 3, max: 4, hottest: { x: 3, y: 1 }, total: 9 })
    expect(all.cells).toHaveLength(15)
    expect(heatAt(all, 3, 1)).toBe(4)
    expect(heatAt(all, 9, 9)).toBe(0)
    const recent = snapshotHeat(heat, 'deaths', 'recent', 7)
    expect(recent).toMatchObject({ range: 'recent', max: 0.5, hottest: { x: 0, y: 0 }, total: 0.5 })
  })

  it('has no hottest cell when everything is empty', () => {
    expect(snapshotHeat(createHeat(5, 3), 'births', 'all', 0)).toMatchObject({ max: 0, hottest: null, total: 0 })
  })
})

describe('bins and the legend', () => {
  it('use a square-root scale for traffic and a linear one for births and deaths', () => {
    expect(scaleFor('traffic')).toBe('sqrt')
    expect(scaleFor('births')).toBe('linear')
    expect(scaleFor('deaths')).toBe('linear')
  })

  it('leave an empty cell unbinned and put the largest in the last bin', () => {
    expect(heatBin(0, 10, 'linear')).toBe(0)
    expect(heatBin(5, 0, 'linear')).toBe(0)
    expect(heatBin(10, 10, 'linear')).toBe(HEAT_BIN_COUNT)
    expect(heatBin(0.0001, 10, 'sqrt')).toBe(1)
  })

  it('split a linear scale into equal fifths and a sqrt scale by squares', () => {
    expect([1, 2, 3, 4, 5].map((bin) => binUpper(bin, 100, 'linear'))).toEqual([20, 40, 60, 80, 100])
    expect([1, 2, 3, 4, 5].map((bin) => binUpper(bin, 100, 'sqrt'))).toEqual([4, 16, 36, 64, 100])
    expect([4, 5, 16, 17, 36, 37, 64, 65, 100].map((v) => heatBin(v, 100, 'sqrt'))).toEqual([1, 2, 2, 3, 3, 4, 4, 5, 5])
    expect([20, 21, 40, 41, 100].map((v) => heatBin(v, 100, 'linear'))).toEqual([1, 2, 2, 3, 5])
  })

  it('label whole-number bins with the integers they hold', () => {
    expect(legendBins(25, 'sqrt', true).map((bin) => bin.label)).toEqual(['1', '2–4', '5–9', '10–16', '17–25'])
    expect(legendBins(100, 'linear', true).map((bin) => bin.label)).toEqual(['1–20', '21–40', '41–60', '61–80', '81–100'])
  })

  it('mark a bin that no whole number can fall in (a small maximum)', () => {
    const bins = legendBins(3, 'linear', true)
    expect(bins.map((bin) => bin.empty)).toEqual([true, false, true, false, false])
    expect(bins.map((bin) => bin.label)).toEqual(['none', '1', 'none', '2', '3'])
  })

  it('agree with heatBin for every whole value, for every small maximum and both scales', () => {
    for (const scale of ['linear', 'sqrt'] as const) {
      for (let max = 1; max <= 80; max += 1) {
        const bins = legendBins(max, scale, true)
        for (let value = 1; value <= max; value += 1) {
          const bin = bins.find((entry) => !entry.empty && value >= entry.lo && value <= entry.hi)
          expect(bin?.bin, `${scale} max ${max} value ${value}`).toBe(heatBin(value, max, scale))
        }
      }
    }
  })

  it('label fractional bins with decimals, and have none for a map with no data', () => {
    const bins = legendBins(2.5, 'linear', false)
    expect(bins.map((bin) => bin.label)).toEqual(['up to 0.50', '0.50–1.0', '1.0–1.5', '1.5–2.0', '2.0–2.5'])
    expect(legendBins(0, 'linear', false)).toEqual([])
  })

  it('format counts and faded counts', () => {
    expect(formatHeat(1234, true)).toBe('1,234')
    expect(formatHeat(1234.4, false)).toBe('1,234')
    expect(formatHeat(12.34, false)).toBe('12')
    expect(formatHeat(3.456, false)).toBe('3.5')
    expect(formatHeat(0.456, false)).toBe('0.46')
    expect(describeHeat('deaths', 'all', 17)).toBe('17 deaths')
    expect(describeHeat('traffic', 'all', 1)).toBe('1 visit')
    expect(describeHeat('births', 'recent', 3.4)).toBe('3.4 births')
    expect(describeHeat('births', 'recent', 1)).toBe('1.0 births')
  })
})

describe('the H key', () => {
  it('cycles none, traffic, births, deaths and back to none', () => {
    const seen: (string | null)[] = []
    let layer: ReturnType<typeof nextHeatLayer> = null
    for (let i = 0; i < 5; i += 1) {
      layer = nextHeatLayer(layer)
      seen.push(layer)
    }
    expect(seen).toEqual(['traffic', 'births', 'deaths', null, 'traffic'])
    expect(HEAT_LAYERS).toEqual(['traffic', 'births', 'deaths'])
  })

  const press = (key: string, extra: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...extra,
  })

  it('is H on its own only', () => {
    expect(isHeatKey(press('h'))).toBe(true)
    expect(isHeatKey(press('H'))).toBe(true)
    expect(isHeatKey(press('h', { ctrlKey: true }))).toBe(false)
    expect(isHeatKey(press('h', { shiftKey: true }))).toBe(false)
    expect(isHeatKey(press('h', { metaKey: true }))).toBe(false)
    expect(isHeatKey(press('h', { altKey: true }))).toBe(false)
    expect(isHeatKey(press('x'))).toBe(false)
  })

  it('does not clash with a tool key, Escape or a world-event key', () => {
    expect(toolForKey('h')).toBeNull()
    expect(toolForKey('H')).toBeNull()
    expect(globalEventForKey('h')).toBeNull()
    expect(globalEventForKey('H')).toBeNull()
  })
})

describe('the heat is outside the world', () => {
  it('leaves the state hash alone: the same run hashes the same with and without it', () => {
    const plain = createWorld('heat-hash', edenPreset, rules)
    const watched = createWorld('heat-hash', edenPreset, rules)
    const heat = createHeat(watched.width, watched.height)
    for (let i = 0; i < 300; i += 1) {
      step(plain, rules)
      step(watched, rules)
      observeWorld(heat, watched)
    }
    expect(stateHash(watched)).toBe(stateHash(plain))
    expect(heat.total.traffic.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
    expect(JSON.stringify(watched)).not.toContain('"recent"')
  })

  it('sums traffic to the bot-ticks that happened', () => {
    const world = createWorld('heat-sum', edenPreset, rules)
    const heat = createHeat(world.width, world.height)
    let botTicks = 0
    for (let i = 0; i < 200; i += 1) {
      step(world, rules)
      botTicks += world.bots.length
      observeWorld(heat, world)
    }
    expect(heat.total.traffic.reduce((a, b) => a + b, 0)).toBe(botTicks)
    const births = heat.total.births.reduce((a, b) => a + b, 0)
    const deaths = heat.total.deaths.reduce((a, b) => a + b, 0)
    expect(births).toBe(world.totalBirths)
    expect(deaths).toBe(Object.values(world.deathsByCause).reduce((a, b) => a + b, 0))
    expect(heat.unattributed).toBe(0)
  })
})
