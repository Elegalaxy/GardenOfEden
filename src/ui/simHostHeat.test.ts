import { describe, expect, it } from 'vitest'

import { SAVE_VERSION } from '../persist/save.ts'
import type { Save } from '../persist/save.ts'
import { stateHash } from '../sim/hash.ts'
import type { Command } from '../sim/types.ts'
import type { HeatSnapshot } from './heat.ts'
import type { FromWorker, ToWorker } from './protocol.ts'
import { createSimHost } from './simHost.ts'
import type { SimHost } from './simHost.ts'

// The host keeps the heat grid (heat.ts) beside the world and serves it through the `heat` message.

function clock(): { now: () => number; advanceBy: (ms: number) => void } {
  let t = 0
  return { now: () => t, advanceBy: (ms) => void (t += ms) }
}

function snapshots(messages: FromWorker[]): HeatSnapshot[] {
  return messages.flatMap((m) => (m.type === 'heatSnapshot' ? [m.heat] : []))
}

function advance(host: SimHost, ticks: number, slow = false): FromWorker[] {
  return host.handle({ type: 'advance', ticks, slow })
}

function command(host: SimHost, cmd: Command): FromWorker[] {
  return host.handle({ type: 'command', reqId: 1, cmd })
}

function exportSave(host: SimHost): Save {
  const message = host.handle({ type: 'exportSave', reqId: 1 }).find((m) => m.type === 'save')
  if (message?.type !== 'save') throw new Error('no save')
  return message.save
}

function finishLoad(host: SimHost): FromWorker[] {
  const out: FromWorker[] = []
  for (let guard = 0; guard < 100_000 && host.loading; guard += 1) out.push(...host.pumpLoad())
  return out
}

/** A run with a few commands, among them a meteor aimed at a living bot, long enough to cross several fade steps. */
function playRun(host: SimHost): void {
  advance(host, 60)
  command(host, { type: 'placeNode', kind: 'danger', x: 20.5, y: 20.5 })
  advance(host, 90)
  const bot = host.world.bots[0]!
  command(host, { type: 'triggerEvent', event: 'meteor', x: bot.x, y: bot.y })
  advance(host, 60)
  command(host, { type: 'placeBot', x: 30.5, y: 30.5 })
  advance(host, 250)
  command(host, { type: 'triggerEvent', event: 'plague', x: 48, y: 32 })
  advance(host, 140)
}

describe('the heat message', () => {
  it('sends nothing while no layer is on, whatever happens', () => {
    const host = createSimHost({ now: clock().now })
    expect(snapshots(advance(host, 30, true))).toEqual([])
    expect(snapshots(command(host, { type: 'placeBot', x: 5.5, y: 5.5 }))).toEqual([])
    expect(snapshots(host.handle({ type: 'reset', seed: 'q' }))).toEqual([])
    expect(host.handle({ type: 'heat', layer: null, range: 'all' })).toEqual([])
    expect(host.handle({ type: 'heat', layer: null, range: 'recent' })).toEqual([])
  })

  it('answers a request at once with one snapshot of that layer, its summary and the run id', () => {
    const host = createSimHost({ now: clock().now })
    advance(host, 80)
    const reply = host.handle({ type: 'heat', layer: 'traffic', range: 'all' })
    expect(reply.map((m) => m.type)).toEqual(['heatSnapshot'])
    const snap = snapshots(reply)[0]!
    expect(snap).toMatchObject({ runId: 0, layer: 'traffic', range: 'all', width: 96, height: 64, tick: 80 })
    expect(snap.cells).toBeInstanceOf(Float32Array)
    expect(snap.cells).toHaveLength(96 * 64)
    expect(snap.max).toBe(Math.max(...snap.cells))
    expect(snap.hottest).not.toBeNull()
    expect(snap.cells[snap.hottest!.y * 96 + snap.hottest!.x]).toBe(snap.max)
    // Each bot adds one per tick, so the cells sum to the bot-ticks (more than one tick's worth of founders).
    expect(snap.total).toBe(host.heat.total.traffic.reduce((a, b) => a + b, 0))
    expect(snap.total).toBeGreaterThanOrEqual(80 * 20)
  })

  it('serves the layer and the range that were asked for', () => {
    const host = createSimHost({ now: clock().now })
    advance(host, 450)
    const all = snapshots(host.handle({ type: 'heat', layer: 'deaths', range: 'all' }))[0]!
    const recent = snapshots(host.handle({ type: 'heat', layer: 'deaths', range: 'recent' }))[0]!
    const births = snapshots(host.handle({ type: 'heat', layer: 'births', range: 'all' }))[0]!
    expect(all).toMatchObject({ layer: 'deaths', range: 'all' })
    expect(recent).toMatchObject({ layer: 'deaths', range: 'recent' })
    expect(births).toMatchObject({ layer: 'births' })
    expect(all.total).toBe(Object.values(host.world.deathsByCause).reduce((a, b) => a + b, 0))
    expect(recent.total).toBeLessThanOrEqual(all.total)
    expect(births.total).toBe(host.world.totalBirths)
  })

  it('treats an unknown layer or range as "none" and "all time"', () => {
    const host = createSimHost({ now: clock().now })
    advance(host, 10)
    expect(host.handle({ type: 'heat', layer: 'nonsense' as never, range: 'all' })).toEqual([])
    const snap = snapshots(host.handle({ type: 'heat', layer: 'traffic', range: 7 as never }))[0]!
    expect(snap.range).toBe('all')
  })

  it('stays plain data that survives structured clone', () => {
    const host = createSimHost({ now: clock().now })
    advance(host, 20)
    const snap = snapshots(host.handle({ type: 'heat', layer: 'traffic', range: 'recent' }))[0]!
    expect(structuredClone(snap)).toEqual(snap)
  })

  it('turns off again with a null layer, and then sends nothing', () => {
    const host = createSimHost({ now: clock().now })
    host.handle({ type: 'heat', layer: 'traffic', range: 'all' })
    expect(host.handle({ type: 'heat', layer: null, range: 'all' })).toEqual([])
    expect(snapshots(advance(host, 5, true))).toEqual([])
  })
})

describe('when snapshots are sent', () => {
  it('about four times a second while running, and every time the advance asks for slow data', () => {
    const time = clock()
    const host = createSimHost({ now: time.now })
    expect(snapshots(host.handle({ type: 'heat', layer: 'traffic', range: 'all' }))).toHaveLength(1) // the request itself
    expect(snapshots(advance(host, 3))).toHaveLength(0) // same instant: too soon for another
    time.advanceBy(250)
    expect(snapshots(advance(host, 3))).toHaveLength(1)
    time.advanceBy(100)
    expect(snapshots(advance(host, 3))).toHaveLength(0)
    time.advanceBy(100)
    expect(snapshots(advance(host, 3))).toHaveLength(0)
    time.advanceBy(60)
    expect(snapshots(advance(host, 3))).toHaveLength(1)
    // Paused (slow): always, so the picture matches the numbers.
    expect(snapshots(advance(host, 1, true))).toHaveLength(1)
    expect(snapshots(advance(host, 0, true))).toHaveLength(1)
  })

  it('sends the snapshot after the frame it belongs to', () => {
    const host = createSimHost({ now: clock().now })
    host.handle({ type: 'heat', layer: 'births', range: 'all' })
    expect(advance(host, 2, true).map((m) => m.type)).toEqual(['frame', 'heatSnapshot'])
  })

  it('right after a command, with the effect of a meteor already in it', () => {
    const host = createSimHost({ now: clock().now })
    advance(host, 30)
    host.handle({ type: 'heat', layer: 'deaths', range: 'all' })
    const before = snapshots(host.handle({ type: 'heat', layer: 'deaths', range: 'all' }))[0]!
    const bot = host.world.bots[0]!
    const messages = command(host, { type: 'triggerEvent', event: 'meteor', x: bot.x, y: bot.y })
    expect(messages.map((m) => m.type)).toEqual(['frame', 'commandResult', 'heatSnapshot'])
    const after = snapshots(messages)[0]!
    expect(host.world.deathsByCause.meteor).toBeGreaterThan(0)
    expect(after.total - before.total).toBe(host.world.deathsByCause.meteor)
    expect(after.cells[Math.floor(bot.y) * 96 + Math.floor(bot.x)]).toBeGreaterThan(0)
  })

  it('does not send one for a refused command, which changed nothing', () => {
    const host = createSimHost({ now: clock().now })
    host.handle({ type: 'heat', layer: 'deaths', range: 'all' })
    const messages = command(host, { type: 'placeNode', kind: 'danger', x: 9999, y: 1 })
    expect(messages.map((m) => m.type)).toEqual(['frame', 'commandResult', 'heatSnapshot'])
    expect(host.heat.seenDeaths).toBe(0)
  })
})

describe('reset', () => {
  it('starts a new, empty grid and sends it under the new run id', () => {
    const host = createSimHost({ now: clock().now })
    advance(host, 100)
    host.handle({ type: 'heat', layer: 'traffic', range: 'all' })
    const messages = host.handle({ type: 'reset', seed: 'fresh' })
    expect(messages.map((m) => m.type)).toEqual(['frame', 'heatSnapshot'])
    const snap = snapshots(messages)[0]!
    expect(snap).toMatchObject({ runId: 1, tick: 0, total: 0, max: 0, hottest: null })
    expect(host.heat.tick).toBe(0)
  })

  it('keeps the old grid when the reset is refused', () => {
    const host = createSimHost({ now: clock().now })
    advance(host, 40)
    const before = host.heat.total.traffic.slice()
    host.handle({ type: 'reset', seed: 'bad seed!' })
    expect(host.heat.total.traffic).toEqual(before)
  })
})

describe('load', () => {
  function sourceSave(): { save: Save; source: SimHost } {
    const source = createSimHost({ now: clock().now })
    playRun(source)
    return { save: exportSave(source), source }
  }

  it('rebuilds the grid bit for bit: heat after loading a save equals the heat of the live run', () => {
    const { save, source } = sourceSave()
    expect(source.heat.total.deaths.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
    const copy = createSimHost({ now: clock().now, loadSliceMs: 0 })
    copy.handle({ type: 'load', save })
    finishLoad(copy)
    expect(copy.world.tick).toBe(save.tick)
    expect(stateHash(copy.world)).toBe(save.hash)
    for (const layer of ['traffic', 'births', 'deaths'] as const) {
      expect(copy.heat.total[layer]).toEqual(source.heat.total[layer])
      expect(copy.heat.recent[layer]).toEqual(source.heat.recent[layer])
    }
    expect(copy.heat).toMatchObject({ seenBirths: source.heat.seenBirths, seenDeaths: source.heat.seenDeaths, tick: source.heat.tick, unattributed: 0 })
    expect(source.heat.unattributed).toBe(0)
  })

  it('also matches when the load is cut into many slices, and for the summary the page sees', () => {
    const { save, source } = sourceSave()
    const copy = createSimHost({ now: clock().now, loadSliceMs: 0 })
    source.handle({ type: 'heat', layer: 'deaths', range: 'recent' })
    copy.handle({ type: 'heat', layer: 'deaths', range: 'recent' })
    copy.handle({ type: 'load', save })
    const messages = finishLoad(copy)
    expect(messages.filter((m) => m.type === 'loadProgress').length).toBeGreaterThan(1)
    expect(messages.slice(-3).map((m) => m.type)).toEqual(['frame', 'heatSnapshot', 'loadDone'])
    const loaded = snapshots(messages)[0]!
    const live = snapshots(source.handle({ type: 'heat', layer: 'deaths', range: 'recent' }))[0]!
    expect(loaded).toEqual({ ...live, runId: loaded.runId })
    expect(loaded.runId).toBe(1)
  })

  it('serves the old grid and the old world until the load is complete', () => {
    const { save } = sourceSave()
    const host = createSimHost({ now: clock().now, loadSliceMs: 0 })
    advance(host, 30)
    host.handle({ type: 'heat', layer: 'traffic', range: 'all' })
    const before = host.heat.total.traffic.slice()
    host.handle({ type: 'load', save })
    host.pumpLoad()
    host.pumpLoad()
    expect(host.loading).toBe(true)
    expect(advance(host, 10).map((m) => m.type)).toEqual(['frame']) // nothing runs, and no heat while loading
    expect(host.heat.total.traffic).toEqual(before)
  })

  it('keeps the old grid when the load is cancelled', () => {
    const long: Save = { version: SAVE_VERSION, seed: 'long-run', presetId: 'eden', tick: 500_000, hash: '0000000000000000', commands: [] }
    const host = createSimHost({ now: clock().now, loadSliceMs: 0 })
    advance(host, 50)
    const before = { traffic: host.heat.total.traffic.slice(), recent: host.heat.recent.traffic.slice(), tick: host.heat.tick }
    host.handle({ type: 'load', save: long })
    host.pumpLoad()
    host.pumpLoad()
    host.handle({ type: 'cancelLoad' })
    expect(host.heat.total.traffic).toEqual(before.traffic)
    expect(host.heat.recent.traffic).toEqual(before.recent)
    expect(host.heat.tick).toBe(before.tick)
    // ...and the next tick still counts on it.
    advance(host, 1)
    expect(host.heat.tick).toBe(before.tick + 1)
  })

  it('keeps the old grid when a command in the save is refused', () => {
    const host = createSimHost({ now: clock().now })
    advance(host, 40)
    const before = host.heat.total.traffic.slice()
    const bad: Save = { version: SAVE_VERSION, seed: 'a', presetId: 'eden', tick: 50, hash: '0000000000000000', commands: [{ tick: 5, cmd: { type: 'placeNode', kind: 'resource', x: 9999, y: 1 } }] }
    host.handle({ type: 'load', save: bad })
    const outcome = finishLoad(host).find((m) => m.type === 'loadDone')
    expect(outcome?.type === 'loadDone' && outcome.outcome.status).toBe('failed')
    expect(host.heat.total.traffic).toEqual(before)
  })
})

describe('the heat does not change the run', () => {
  it('gives the same state hash whichever layer is on, or none', () => {
    const run = (messages: ToWorker[]): string => {
      const host = createSimHost({ now: clock().now })
      for (const message of messages) host.handle(message)
      playRun(host)
      return stateHash(host.world)
    }
    const none = run([])
    expect(run([{ type: 'heat', layer: 'traffic', range: 'all' }])).toBe(none)
    expect(run([{ type: 'heat', layer: 'deaths', range: 'recent' }])).toBe(none)
  })
})
