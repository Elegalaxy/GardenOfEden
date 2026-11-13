import { describe, expect, it } from 'vitest'

import { SIM_VERSION, edenPreset, rules } from '../content/index.ts'
import { SAVE_VERSION } from '../persist/save.ts'
import type { Save } from '../persist/save.ts'
import { stateHash } from '../sim/hash.ts'
import { familyView, founderLines } from '../sim/lineage.ts'
import { replayWorld } from '../sim/replay.ts'
import type { Command } from '../sim/types.ts'
import { unpackBots } from './botColumns.ts'
import type { FromWorker, Frame, ToWorker } from './protocol.ts'
import { LOADING_REASON, createHostRunner, createSimHost } from './simHost.ts'
import type { SimHost } from './simHost.ts'

// The host is driven directly here, with a clock the test controls.

function clock(): { now: () => number; advanceBy: (ms: number) => void } {
  let t = 0
  return { now: () => t, advanceBy: (ms) => void (t += ms) }
}

function makeHost(options: Parameters<typeof createSimHost>[0] = {}): SimHost {
  return createSimHost({ now: clock().now, ...options })
}

function framesOf(messages: FromWorker[]): Frame[] {
  return messages.flatMap((m) => (m.type === 'frame' ? [m.frame] : []))
}

function only<T extends FromWorker['type']>(messages: FromWorker[], type: T): Extract<FromWorker, { type: T }> {
  const found = messages.filter((m): m is Extract<FromWorker, { type: T }> => m.type === type)
  expect(found).toHaveLength(1)
  return found[0]!
}

function advance(host: SimHost, ticks: number, slow = false): Frame {
  return framesOf(host.handle({ type: 'advance', ticks, slow }))[0]!
}

function command(host: SimHost, cmd: Command, reqId = 1): { ok: boolean; reason?: string; id?: number } {
  const result = only(host.handle({ type: 'command', reqId, cmd }), 'commandResult').result
  return result
}

function exportSave(host: SimHost): Save {
  return only(host.handle({ type: 'exportSave', reqId: 1 }), 'save').save
}

/** Pumps a load to its end; returns every message it produced. */
function finishLoad(host: SimHost): FromWorker[] {
  const out: FromWorker[] = []
  for (let guard = 0; guard < 100_000 && host.loading; guard += 1) out.push(...host.pumpLoad())
  return out
}

function someRun(host: SimHost): void {
  advance(host, 40)
  command(host, { type: 'placeNode', kind: 'water', x: 10.5, y: 10.5 })
  advance(host, 25)
  command(host, { type: 'placeBot', x: 12.5, y: 12.5 })
  advance(host, 30)
  command(host, { type: 'triggerEvent', event: 'drought' })
  advance(host, 15)
}

describe('advance and commands', () => {
  it('gives the same state hash as replaying the same seed and commands', () => {
    const host = makeHost()
    someRun(host)
    const save = exportSave(host)
    const replayed = replayWorld('a', edenPreset, rules, host.world.commands, host.world.tick)
    expect(save.hash).toBe(stateHash(replayed))
    expect(save.hash).toBe(stateHash(host.world))
    expect(save).toMatchObject({ version: SAVE_VERSION, seed: 'a', presetId: 'eden', sim: SIM_VERSION, tick: 110 })
    expect(save.commands).toHaveLength(3)
  })

  it('splits ticks across messages without changing the run', () => {
    const one = makeHost()
    advance(one, 120)
    const many = makeHost()
    for (let i = 0; i < 12; i += 1) advance(many, 10)
    expect(stateHash(many.world)).toBe(stateHash(one.world))
  })

  it('applies a command between ticks at the tick the advances before it reached', () => {
    const host = makeHost()
    advance(host, 7)
    expect(command(host, { type: 'placeNode', kind: 'danger', x: 3.5, y: 3.5 }).ok).toBe(true)
    advance(host, 5)
    expect(command(host, { type: 'placeBot', x: 4.5, y: 4.5 }).ok).toBe(true)
    expect(host.world.commands.map((entry) => entry.tick)).toEqual([7, 12])
    expect(host.world.tick).toBe(12)
  })

  it('does not record a refused command, and says why', () => {
    const host = makeHost()
    const refused = command(host, { type: 'placeNode', kind: 'danger', x: 9999, y: 1 })
    expect(refused).toMatchObject({ ok: false })
    expect(refused.reason).toContain('outside')
    expect(host.world.commands).toHaveLength(0)
    const messages = host.handle({ type: 'command', reqId: 2, cmd: { type: 'removeNode', id: 123456 } })
    expect(only(messages, 'commandResult').result.ok).toBe(false)
    expect(framesOf(messages)[0]!.fast.commandCount).toBe(0)
  })

  it('answers a command with the frame that shows it first, then the result', () => {
    const host = makeHost()
    const messages = host.handle({ type: 'command', reqId: 9, cmd: { type: 'placeBot', x: 2.5, y: 2.5 } })
    expect(messages.map((m) => m.type)).toEqual(['frame', 'commandResult'])
    const frame = framesOf(messages)[0]!
    expect(frame.fast.commandCount).toBe(1)
    expect(frame.slow?.commands).toHaveLength(1)
    expect(only(messages, 'commandResult')).toMatchObject({ reqId: 9, result: { ok: true } })
  })

  it('reports how many bots a meteor killed', () => {
    const host = makeHost()
    const bot = host.world.bots[0]!
    const message = only(host.handle({ type: 'command', reqId: 1, cmd: { type: 'triggerEvent', event: 'meteor', x: bot.x, y: bot.y } }), 'commandResult')
    expect(message.result.ok).toBe(true)
    expect(message.meteorKills).toBe(host.world.deathsByCause.meteor)
    expect(message.meteorKills).toBeGreaterThan(0)
  })
})

describe('frames', () => {
  it('carry the tick, nodes and bots (without memory) every time', () => {
    const host = makeHost()
    const frame = advance(host, 30)
    expect(frame.run).toMatchObject({ runId: 0, seed: 'a', presetId: 'eden', width: host.world.width, height: host.world.height })
    expect(frame.fast.tick).toBe(30)
    expect(frame.fast.nodes).toEqual(host.world.nodes)
    expect(frame.fast.bots.count).toBe(host.world.bots.length)
    expect(frame.fast.totalBirths).toBe(host.world.totalBirths)
    expect(frame.fast.deathsByCause).toEqual(host.world.deathsByCause)
    expect(frame.fast.lineageLength).toBe(host.world.lineage.length)
    unpackBots(frame.fast.bots).forEach((view, i) => {
      const bot = host.world.bots[i]!
      expect(view).not.toHaveProperty('memory')
      expect(view).toMatchObject({ id: bot.id, x: bot.x, y: bot.y, px: bot.px, py: bot.py, energy: bot.energy, parentId: bot.parentId })
      expect(view.memoryCount).toBe(bot.memory.length)
      expect(view.learnedCount).toBe(bot.memory.filter((entry) => entry.learnedFrom !== null).length)
    })
    expect(host.world.bots.some((bot) => bot.memory.length > 0)).toBe(true)
  })

  it('send the slow data about four times a second, when asked, and with the first frame', () => {
    const time = clock()
    const host = createSimHost({ now: time.now, slowIntervalMs: 250 })
    expect(advance(host, 1).slow).not.toBeNull() // nothing sent yet
    expect(advance(host, 1).slow).toBeNull()
    time.advanceBy(100)
    expect(advance(host, 1).slow).toBeNull()
    time.advanceBy(160)
    const late = advance(host, 1)
    expect(late.slow).not.toBeNull()
    expect(late.slow?.samples.length).toBeGreaterThan(0)
    expect(advance(host, 1).slow).toBeNull()
    expect(advance(host, 1, true).slow).not.toBeNull() // asked for (the page does while paused)
  })

  it('always carry the slow data after a command, a selection, a reset and a load', () => {
    const host = makeHost()
    advance(host, 1)
    expect(advance(host, 1).slow).toBeNull()
    expect(framesOf(host.handle({ type: 'select', id: null }))[0]!.slow).not.toBeNull()
    advance(host, 1)
    expect(framesOf(host.handle({ type: 'command', reqId: 1, cmd: { type: 'placeBot', x: 1.5, y: 1.5 } }))[0]!.slow).not.toBeNull()
    advance(host, 1)
    expect(framesOf(host.handle({ type: 'reset', seed: 'zz' }))[0]!.slow).not.toBeNull()
  })

  it('give the selected bot with its full memory in the slow data, while frames carry none', () => {
    const host = makeHost()
    advance(host, 60)
    const target = host.world.bots.find((bot) => bot.memory.length > 0)!
    const selectFrame = framesOf(host.handle({ type: 'select', id: target.id }))[0]!
    expect(selectFrame.slow?.selectedBot).toEqual(target)
    expect(selectFrame.slow?.selectedBot?.memory.length).toBeGreaterThan(0)
    // A later frame with slow data keeps it fresh; one without leaves it out.
    const slowFrame = advance(host, 1, true)
    expect(slowFrame.slow?.selectedBot?.id).toBe(target.id)
    expect(slowFrame.slow?.selectedBot).toEqual(host.world.bots.find((bot) => bot.id === target.id))
    const fast = advance(host, 1)
    expect(fast.slow).toBeNull()
    for (const view of unpackBots(fast.fast.bots)) expect(view).not.toHaveProperty('memory')
    // Deselecting, or selecting something that does not exist, gives null.
    expect(framesOf(host.handle({ type: 'select', id: null }))[0]!.slow?.selectedBot).toBeNull()
    expect(framesOf(host.handle({ type: 'select', id: 987654 }))[0]!.slow?.selectedBot).toBeNull()
  })

  it('mark the answer to an advance, and only that', () => {
    const host = makeHost()
    expect(only(host.handle({ type: 'advance', ticks: 1 }), 'frame').ack).toBe('advance')
    expect(only(host.handle({ type: 'select', id: null }), 'frame').ack).toBeUndefined()
  })

  it('stay plain data that survives structured clone', () => {
    const host = makeHost()
    const frame = advance(host, 20, true)
    expect(structuredClone(frame)).toEqual(frame)
  })
})

describe('reset', () => {
  it('starts a new run with a new run id, and ignores an invalid seed or preset', () => {
    const host = makeHost()
    advance(host, 10)
    const before = stateHash(host.world)
    expect(framesOf(host.handle({ type: 'reset', seed: 'not valid!' }))[0]!.run.runId).toBe(0)
    expect(framesOf(host.handle({ type: 'reset', seed: 'ok', presetId: 'nowhere' }))[0]!.run.runId).toBe(0)
    expect(stateHash(host.world)).toBe(before)
    const frame = framesOf(host.handle({ type: 'reset', seed: 'other' }))[0]!
    expect(frame.run).toMatchObject({ runId: 1, seed: 'other', presetId: 'eden' })
    expect(frame.fast.tick).toBe(0)
    expect(host.world.seed).toBe('other')
  })
})

describe('queries', () => {
  it('answer a family query with the lineage view', () => {
    const host = makeHost()
    advance(host, 400)
    const child = host.world.lineage.find((record) => record.parentId !== null)!
    expect(child).toBeDefined()
    const message = only(host.handle({ type: 'query', reqId: 5, kind: 'family', id: child.id, up: 3, down: 2, maxNodes: 40 }), 'queryResult')
    expect(message).toMatchObject({ reqId: 5, kind: 'family' })
    if (message.kind !== 'family') throw new Error('expected a family answer')
    expect(message.view).toEqual(familyView(host.world, child.id, 3, 2, 40))
    expect(message.view?.ancestors.length).toBeGreaterThan(0)
  })

  it('answers null for a bot with no record, and lists the founder lines', () => {
    const host = makeHost()
    advance(host, 50)
    const missing = only(host.handle({ type: 'query', reqId: 1, kind: 'family', id: 99999, up: 1, down: 1, maxNodes: 5 }), 'queryResult')
    expect(missing).toMatchObject({ kind: 'family', view: null })
    const founders = only(host.handle({ type: 'query', reqId: 2, kind: 'founders' }), 'queryResult')
    if (founders.kind !== 'founders') throw new Error('expected founders')
    expect(founders.lines).toEqual(founderLines(host.world))
    expect(founders.lines.length).toBeGreaterThan(0)
  })

  it('limits how big an answer can be', () => {
    const host = makeHost()
    advance(host, 400)
    const id = host.world.lineage[0]!.id
    const message = only(host.handle({ type: 'query', reqId: 1, kind: 'family', id, up: 1e9, down: 1e9, maxNodes: 1e9, maxChildren: -4 }), 'queryResult')
    expect(message.kind).toBe('family')
  })
})

describe('utility messages', () => {
  it('answers sync after the messages before it', () => {
    const host = makeHost()
    expect(host.handle({ type: 'sync', reqId: 77 })).toEqual([{ type: 'synced', reqId: 77 }])
  })
})

describe('load', () => {
  function sourceSave(): Save {
    const source = makeHost()
    someRun(source)
    advance(source, 600) // long enough that a load takes several slices
    return exportSave(source)
  }

  it('rebuilds the run in slices, then swaps it in with its frame, a new run id and a matching hash', () => {
    const save = sourceSave()
    const host = makeHost({ loadSliceMs: 0 }) // a slice is one replay call, so there are several
    advance(host, 5)
    host.handle({ type: 'select', id: 1 })
    const started = host.handle({ type: 'load', save })
    expect(started).toEqual([{ type: 'loadProgress', tick: 0, target: save.tick }])
    expect(host.loading).toBe(true)

    const messages = finishLoad(host)
    const progress = messages.filter((m) => m.type === 'loadProgress')
    expect(progress.length).toBeGreaterThan(0)
    const ticks = progress.map((m) => (m.type === 'loadProgress' ? m.tick : -1))
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks)
    expect(messages.slice(-2).map((m) => m.type)).toEqual(['frame', 'loadDone'])
    const done = only(messages, 'loadDone')
    expect(done.outcome).toEqual({ status: 'loaded', hashMatches: true, seed: 'a', tick: save.tick, commandCount: 3 })
    const frame = framesOf(messages)[0]!
    expect(frame.run.runId).toBe(1)
    expect(frame.fast.tick).toBe(save.tick)
    expect(frame.slow?.selectedBot).toBeNull() // the selection does not carry over
    expect(host.loading).toBe(false)
    expect(exportSave(host)).toEqual(save)
  })

  it('warns, through hashMatches, when the hash differs, but still loads', () => {
    const host = makeHost()
    const messages = (host.handle({ type: 'load', save: { ...sourceSave(), hash: '0000000000000000' } }), finishLoad(host))
    expect(only(messages, 'loadDone').outcome).toMatchObject({ status: 'loaded', hashMatches: false })
  })

  it('keeps the old world when it is cancelled, part-way through', () => {
    const long: Save = { version: SAVE_VERSION, seed: 'long-run', presetId: 'eden', sim: 1, tick: 500_000, hash: '0000000000000000', commands: [] }
    const host = makeHost({ loadSliceMs: 0 })
    advance(host, 25)
    const before = stateHash(host.world)
    host.handle({ type: 'load', save: long })
    host.pumpLoad()
    host.pumpLoad()
    expect(host.loading).toBe(true)
    expect(host.handle({ type: 'cancelLoad' })).toEqual([{ type: 'loadDone', outcome: { status: 'cancelled' } }])
    expect(host.loading).toBe(false)
    expect(host.pumpLoad()).toEqual([])
    expect(stateHash(host.world)).toBe(before)
    expect(framesOf(host.handle({ type: 'select', id: null }))[0]!.run.runId).toBe(0)
    // Cancelling with nothing to cancel is silent.
    expect(host.handle({ type: 'cancelLoad' })).toEqual([])
  })

  it('keeps the old world, and says so, when a command in the save is refused', () => {
    const host = makeHost()
    advance(host, 40)
    const before = stateHash(host.world)
    const bad: Save = { ...sourceSave(), commands: [{ tick: 5, cmd: { type: 'placeNode', kind: 'resource', x: 9999, y: 1 } }] }
    host.handle({ type: 'load', save: bad })
    const outcome = only(finishLoad(host), 'loadDone').outcome
    expect(outcome.status).toBe('failed')
    if (outcome.status !== 'failed') return
    expect(outcome.message).toContain('could not be replayed')
    expect(outcome.message).toContain('Your current run was kept')
    expect(host.loading).toBe(false)
    expect(stateHash(host.world)).toBe(before)
    expect(framesOf(host.handle({ type: 'select', id: null }))[0]!.run.runId).toBe(0)
  })

  it('refuses an unknown preset, an invalid seed and a second load at once, keeping the run', () => {
    const save = sourceSave()
    const host = makeHost()
    advance(host, 10)
    const before = stateHash(host.world)
    for (const [bad, text] of [
      [{ ...save, presetId: 'nowhere' }, 'preset'],
      [{ ...save, seed: 'bad seed!' }, 'seed'],
    ] as const) {
      const outcome = only(host.handle({ type: 'load', save: bad }), 'loadDone').outcome
      expect(outcome).toMatchObject({ status: 'failed' })
      expect(JSON.stringify(outcome)).toContain(text)
      expect(JSON.stringify(outcome)).toContain('Your current run was kept')
      expect(host.loading).toBe(false)
    }
    host.handle({ type: 'load', save })
    const second = only(host.handle({ type: 'load', save }), 'loadDone').outcome
    expect(second).toMatchObject({ status: 'failed' })
    expect(host.loading).toBe(true) // the first is still running
    host.handle({ type: 'cancelLoad' })
    expect(stateHash(host.world)).toBe(before)
  })

  it('does not change the world while loading: advance does nothing, commands and resets are refused', () => {
    const save = sourceSave()
    const host = makeHost({ loadSliceMs: 0 })
    advance(host, 12)
    const before = stateHash(host.world)
    host.handle({ type: 'load', save })
    expect(advance(host, 50).fast.tick).toBe(12)
    const refused = only(host.handle({ type: 'command', reqId: 1, cmd: { type: 'placeBot', x: 5.5, y: 5.5 } }), 'commandResult').result
    expect(refused).toEqual({ ok: false, reason: LOADING_REASON })
    expect(framesOf(host.handle({ type: 'reset', seed: 'other' }))[0]!.run.runId).toBe(0)
    expect(stateHash(host.world)).toBe(before)
    // The old run can still be saved meanwhile.
    expect(exportSave(host).tick).toBe(12)
    expect(only(finishLoad(host), 'loadDone').outcome.status).toBe('loaded')
  })

  it('loads a run saved at tick 0 with no commands', () => {
    const host = makeHost()
    const zero = exportSave(host)
    advance(host, 30)
    host.handle({ type: 'load', save: zero })
    expect(only(finishLoad(host), 'loadDone').outcome).toMatchObject({ status: 'loaded', hashMatches: true, tick: 0, commandCount: 0 })
    expect(host.world.tick).toBe(0)
  })
})

describe('createHostRunner', () => {
  it('posts the replies in order, and keeps pumping a load on the scheduler, so a cancel lands between slices', () => {
    const sent: FromWorker[] = []
    const queue: (() => void)[] = []
    const runner = createHostRunner((m) => void sent.push(m), { now: clock().now, loadSliceMs: 0, schedule: (run) => void queue.push(run) })
    const send = (msg: ToWorker): void => runner.receive(msg)

    send({ type: 'advance', ticks: 3 })
    expect(sent.map((m) => m.type)).toEqual(['frame'])
    expect(queue).toHaveLength(0)

    send({ type: 'load', save: { version: SAVE_VERSION, seed: 'r', presetId: 'eden', sim: 1, tick: 2000, hash: '0000000000000000', commands: [] } })
    expect(queue).toHaveLength(1) // one pump scheduled, not one per message
    queue.shift()!()
    queue.shift()!()
    expect(sent.filter((m) => m.type === 'loadProgress').length).toBeGreaterThan(1)
    send({ type: 'cancelLoad' })
    expect(sent.at(-1)).toEqual({ type: 'loadDone', outcome: { status: 'cancelled' } })
    const queued = queue.length
    for (const run of queue.splice(0)) run() // a pump already scheduled finds nothing to do
    expect(queued).toBeLessThanOrEqual(1)
    expect(runner.host.loading).toBe(false)
    expect(queue).toHaveLength(0)
  })

  it('answers a message that makes the host throw with an error message, and carries on', () => {
    const sent: FromWorker[] = []
    const runner = createHostRunner((m) => void sent.push(m), { now: clock().now })
    // A command whose body is not an object makes applyCommand throw.
    runner.receive({ type: 'command', reqId: 1, cmd: null as unknown as Command })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: 'error' })
    runner.receive({ type: 'sync', reqId: 2 })
    expect(sent.at(-1)).toEqual({ type: 'synced', reqId: 2 })
  })
})
