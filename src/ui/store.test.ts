import { beforeEach, describe, expect, it } from 'vitest'

import { tuning } from '../content/index.ts'
import { stateHash } from '../sim/hash.ts'
import type { Command } from '../sim/types.ts'
import type { FromWorker, ToWorker } from './protocol.ts'
import { MAX_BATCH } from './simHost.ts'
import { createInlineClient } from './simClient.ts'
import type { SimClient } from './simClient.ts'
import {
  MAX_PENDING_TICKS,
  advance,
  clickMap,
  dispatch,
  dispatchBatch,
  exportSave,
  getPulse,
  getSnapshot,
  isValidSeed,
  queryFamily,
  queryFounders,
  resetWorld,
  select,
  setPaused,
  setBotSex,
  setPlaceCount,
  setSimClient,
  setTool,
  settled,
  stepOnce,
} from './store.ts'

// The store holds one module-level mirror of the simulation, which runs behind a client (here the inline one,
// since the tests run without a Worker). Everything that changes the run is a message, so each test waits
// with `settled()` for the answers before it looks. Every test starts a fresh world.
beforeEach(async () => {
  setPaused(false)
  setTool('inspect')
  setPlaceCount(1)
  setBotSex(null)
  resetWorld('store-test')
  await settled()
})

describe('isValidSeed', () => {
  it('accepts 1-32 letters, digits and dashes only', () => {
    expect(isValidSeed('a')).toBe(true)
    expect(isValidSeed('Run-2')).toBe(true)
    expect(isValidSeed('')).toBe(false)
    expect(isValidSeed('has space')).toBe(false)
    expect(isValidSeed('x'.repeat(33))).toBe(false)
  })
})

describe('dispatch', () => {
  it('applies a command, records it and leaves a notice', async () => {
    const before = getSnapshot().commandCount
    const result = await dispatch({ type: 'placeNode', kind: 'predator', x: 5.5, y: 5.5 })
    expect(result.ok).toBe(true)
    const snap = getSnapshot()
    expect(snap.commandCount).toBe(before + 1)
    expect(snap.world.commands).toHaveLength(before + 1)
    expect(snap.notice).toMatchObject({ ok: true })
    expect(snap.notice?.text).toContain('predator')
  })

  it('reports a refused command without recording it', async () => {
    await dispatch({ type: 'placeNode', kind: 'predator', x: 5.5, y: 5.5 })
    const count = getSnapshot().commandCount
    const result = await dispatch({ type: 'placeNode', kind: 'predator', x: 5.5, y: 5.5 })
    expect(result.ok).toBe(false)
    expect(getSnapshot().commandCount).toBe(count)
    expect(getSnapshot().notice).toMatchObject({ ok: false })
  })

  it('names who the predators are when a placement hits the cap (E3)', async () => {
    const max = tuning.predator.maxCount
    let result = await dispatch({ type: 'placeNode', kind: 'predator', x: 5.5, y: 5.5 })
    for (let i = 1; i < max + 1 && result.ok; i += 1) {
      result = await dispatch({ type: 'placeNode', kind: 'predator', x: 5.5 + 15 * (i % 6), y: 5.5 + 20 * Math.floor(i / 6) })
    }
    expect(result.ok).toBe(false)
    const text = getSnapshot().notice?.text ?? ''
    expect(text.startsWith(`Predator cap reached (${max} / ${max}: `)).toBe(true)
    expect(text).toContain('founder')
    expect(text).toContain('placed')
    expect(text).toContain('Remove one to place another.')
  })

  it('adds the cap note to a bulk placement that hit the predator cap', async () => {
    const cmds: Command[] = Array.from({ length: tuning.predator.maxCount + 3 }, (_, i) => ({ type: 'placeNode', kind: 'predator', x: 5.5 + 15 * (i % 6), y: 5.5 + 20 * Math.floor(i / 6) }))
    const result = await dispatchBatch(cmds, 'predators')
    expect(result.refused).toBeGreaterThan(0)
    expect(getSnapshot().notice?.text).toContain('(cap reached). Predator cap reached (')
  })

  it('applies a command after the advance sent before it, so it is recorded at that tick', async () => {
    const run = advance(7, 1) // in flight when the command is sent: the command still waits behind it
    const first = dispatch({ type: 'placeNode', kind: 'water', x: 40.5, y: 40.5 })
    await Promise.all([run, first])
    await advance(5, 1)
    await dispatch({ type: 'placeBot', x: 41.5, y: 41.5 })
    expect(getSnapshot().world.commands.map((entry) => entry.tick)).toEqual([7, 12])
    expect(getSnapshot().tick).toBe(12)
  })
})

describe('world events', () => {
  it('fires a global event at once, records it and says what it does', async () => {
    const before = getSnapshot().commandCount
    const result = await dispatch({ type: 'triggerEvent', event: 'drought' })
    expect(result.ok).toBe(true)
    const snap = getSnapshot()
    expect(snap.commandCount).toBe(before + 1)
    expect(snap.world.events).toHaveLength(1)
    expect(snap.notice).toMatchObject({ ok: true })
    expect(snap.notice?.text).toContain('Drought started')
  })

  it('refuses the same global event while it runs, without recording it', async () => {
    await dispatch({ type: 'triggerEvent', event: 'bounty' })
    const count = getSnapshot().commandCount
    expect((await dispatch({ type: 'triggerEvent', event: 'bounty' })).ok).toBe(false)
    expect(getSnapshot().commandCount).toBe(count)
    expect(getSnapshot().notice).toMatchObject({ ok: false })
    expect(getSnapshot().notice?.text).toContain('already active')
  })

  it('starts a plague at the clicked cell with the plague tool', async () => {
    setTool('plague')
    clickMap(20.4, 30.7, 1)
    await settled()
    const plague = getSnapshot().world.events[0]
    expect(plague).toMatchObject({ kind: 'plague', x: 20.5, y: 30.5 })
    expect(getSnapshot().notice?.text).toContain('Plague started')
  })

  it('starts a blight at the clicked cell with the blight tool', async () => {
    setTool('blight')
    clickMap(20.4, 30.7, 1)
    await settled()
    expect(getSnapshot().world.events[0]).toMatchObject({ kind: 'blight', x: 20.5, y: 30.5 })
    expect(getSnapshot().notice?.text).toContain('Blight started')
  })

  it('starts an outbreak at the clicked cell with the outbreak tool, makes a pulse and sickens the bots there', async () => {
    setTool('outbreak')
    const bot = getSnapshot().world.bots[0]!
    clickMap(bot.x, bot.y, 1)
    await settled()
    const snap = getSnapshot()
    expect(snap.notice?.text).toContain('Outbreak started')
    expect(snap.world.bots.some((other) => other.illnessStage === 'sick')).toBe(true)
    expect(snap.world.disease).toBeDefined()
    expect(getPulse()).toMatchObject({ tone: 'disease', radius: tuning.disease.outbreakRadius })
  })

  it('drops a meteor with the meteor tool and reports the bots it killed', async () => {
    setTool('meteor')
    const bot = getSnapshot().world.bots[0]!
    clickMap(bot.x, bot.y, 1)
    await settled()
    const snap = getSnapshot()
    expect(snap.world.nodes.some((node) => node.expires > 0)).toBe(true)
    expect(snap.notice?.text).toContain('Meteor struck')
    expect(snap.notice?.text).toMatch(/\d+ bots? killed/)
  })
})

describe('clickMap', () => {
  it('places the active tool at the centre of the clicked cell', async () => {
    setTool('shelter')
    clickMap(10.9, 20.1, 1)
    await settled()
    const node = getSnapshot().world.nodes.at(-1)
    expect(node).toMatchObject({ kind: 'shelter', x: 10.5, y: 20.5 })
  })

  it('places water with the water tool, and the Remove tool takes it away again', async () => {
    setTool('water')
    clickMap(30.2, 40.8, 1)
    await settled()
    const node = getSnapshot().world.nodes.at(-1)
    expect(node).toMatchObject({ kind: 'water', x: 30.5, y: 40.5 })
    expect(getSnapshot().notice?.text).toContain('water')

    setTool('remove')
    clickMap(30.5, 40.5, 1)
    await settled()
    expect(getSnapshot().world.nodes.some((n) => n.id === node!.id)).toBe(false)
  })

  it('places a bot with the bot tool', async () => {
    const bots = getSnapshot().population
    setTool('bot')
    clickMap(1.2, 1.2, 1)
    await settled()
    expect(getSnapshot().population).toBe(bots + 1)
  })

  it('inspect selects what is under the click, and nothing on empty ground', async () => {
    setTool('resource')
    clickMap(0.5, 0.5, 1)
    await settled()
    const placed = getSnapshot().world.nodes.at(-1)!
    setTool('inspect')
    clickMap(0.5, 0.5, 1)
    expect(getSnapshot().selection).toEqual({ kind: 'node', id: placed.id })
    select(null)
    expect(getSnapshot().selection).toBeNull()
  })

  it('inspect on a bot selects it, and the worker then sends that bot with its memory', async () => {
    await advance(60, 1)
    await settled()
    const bot = getSnapshot().world.bots.find((b) => b.memoryCount > 0)!
    clickMap(bot.x, bot.y, 0.01)
    expect(getSnapshot().selection).toEqual({ kind: 'bot', id: bot.id })
    await settled()
    const selected = getSnapshot().world.selectedBot
    expect(selected?.id).toBe(bot.id)
    expect(selected?.memory).toHaveLength(bot.memoryCount)
    select(null)
    await settled()
    expect(getSnapshot().world.selectedBot).toBeNull()
  })

  it('remove deletes the node under the click, and says so when there is none', async () => {
    setTool('shelter')
    clickMap(90.5, 60.5, 1)
    await settled()
    const id = getSnapshot().world.nodes.at(-1)!.id
    setTool('remove')
    clickMap(90.5, 60.5, 1)
    await settled()
    expect(getSnapshot().world.nodes.some((node) => node.id === id)).toBe(false)
    clickMap(90.5, 60.5, 1)
    await settled()
    expect(getSnapshot().notice).toMatchObject({ ok: false })
  })
})

describe('resetWorld', () => {
  it('starts a new world, clears the selection and rejects an invalid seed', async () => {
    select({ kind: 'bot', id: 1 })
    expect(resetWorld('not valid!')).toBe(false)
    expect(getSnapshot().seed).toBe('store-test')
    expect(resetWorld('other')).toBe(true)
    expect(getSnapshot().selection).toBeNull()
    await settled()
    expect(getSnapshot().seed).toBe('other')
    expect(getSnapshot().selection).toBeNull()
    expect(getSnapshot().tick).toBe(0)
  })

  it('starts a blank world with no nodes or bots, which stays quiet when stepped', async () => {
    expect(resetWorld('plain', 'blank')).toBe(true)
    await settled()
    expect(getSnapshot().presetId).toBe('blank')
    expect(getSnapshot().world.nodes).toHaveLength(0)
    expect(getSnapshot().world.bots).toHaveLength(0)
    await advance(50, 1)
    expect(getSnapshot().tick).toBe(50)
    // Placing something still works in a blank world.
    await dispatch({ type: 'placeBot', x: 3.5, y: 3.5 })
    expect(getSnapshot().world.bots).toHaveLength(1)
  })

  it('changes the run id only when a different run replaces the current one', async () => {
    const first = getSnapshot().runId
    await advance(20, 1)
    await dispatch({ type: 'placeBot', x: 3.5, y: 3.5 })
    expect(getSnapshot().runId).toBe(first)
    resetWorld('again')
    await settled()
    expect(getSnapshot().runId).toBe(first + 1)
  })

  it('steps one tick only while paused', async () => {
    setPaused(false)
    await stepOnce()
    await settled()
    expect(getSnapshot().tick).toBe(0)
    setPaused(true)
    await stepOnce()
    expect(getSnapshot().tick).toBe(1)
    setPaused(false)
  })
})

describe('the clock', () => {
  it('runs the ticks it is given and shows the progress of the frame that matches them', async () => {
    await advance(10, 0.25)
    expect(getSnapshot()).toMatchObject({ tick: 10, alpha: 0.25 })
    await advance(0, 0.5) // nothing due and nothing on the way: only the picture's progress changes
    expect(getSnapshot()).toMatchObject({ tick: 10, alpha: 0.5 })
  })

  it('keeps at most one advance in flight, piling up the ticks that fall due meanwhile (capped)', async () => {
    const inner = createInlineClient()
    const sent: ToWorker[] = []
    const answered: FromWorker[] = []
    const spy: SimClient = {
      get kind() {
        return inner.kind
      },
      post(msg) {
        sent.push(msg)
        inner.post(msg)
      },
      listen(handler) {
        inner.listen((msg) => {
          answered.push(msg)
          handler(msg)
        })
      },
      onFallback: (handler) => inner.onFallback(handler),
      terminate: () => inner.terminate(),
    }
    setSimClient(spy)
    try {
      const all = [advance(3, 0.1), advance(4, 0.2), advance(5, 0.3), advance(MAX_PENDING_TICKS * 3, 0.4)]
      const advances = (): number => sent.filter((m) => m.type === 'advance').length
      expect(advances()).toBe(1) // the others wait for its frame
      await Promise.all(all)
      const ticks = sent.flatMap((m) => (m.type === 'advance' ? [m.ticks] : []))
      expect(ticks).toEqual([3, MAX_PENDING_TICKS]) // 4 + 5 + 600 piled up, capped
      expect(answered.filter((m) => m.type === 'frame' && m.ack === 'advance')).toHaveLength(2)
      expect(getSnapshot().tick).toBe(3 + MAX_PENDING_TICKS)
      expect(getSnapshot().alpha).toBe(0.4) // the progress sent with the last batch
    } finally {
      setSimClient(createInlineClient())
    }
  })

  it('asks for the slow data when it pauses, so the lists are as fresh as the picture', async () => {
    await advance(30, 1)
    await dispatch({ type: 'placeBot', x: 3.5, y: 3.5 })
    await advance(30, 1)
    setPaused(true)
    await settled()
    const snap = getSnapshot()
    expect(snap).toMatchObject({ paused: true, alpha: 1 })
    expect(snap.world.log.at(-1)?.tick).toBeGreaterThan(0)
    expect(snap.world.samples.at(-1)?.tick).toBe(snap.tick - (snap.tick % tuning.stats.sampleEvery))
  })

  it('has a pile-up cap equal to the loop\'s per-frame cap', async () => {
    const { MAX_TICKS_PER_FRAME } = await import('./loop.ts')
    expect(MAX_PENDING_TICKS).toBe(MAX_TICKS_PER_FRAME)
  })
})

describe('the mirror', () => {
  it('follows the worker\'s world exactly, bots without their memory', async () => {
    const inner = createInlineClient()
    setSimClient(inner)
    try {
      await advance(150, 1)
      await dispatch({ type: 'placeNode', kind: 'shelter', x: 20.5, y: 20.5 })
      await advance(50, 1)
      setPaused(true)
      await settled()
      const { world } = getSnapshot()
      const live = inner.host.world
      expect(world.tick).toBe(live.tick)
      expect(world.nodes).toEqual(live.nodes)
      expect(world.events).toEqual(live.events)
      expect(world.log).toEqual(live.log)
      expect(world.commands).toEqual(live.commands)
      expect(world.samples).toEqual(live.samples)
      expect(world.bots.map((bot) => bot.id)).toEqual(live.bots.map((bot) => bot.id))
      expect(world.bots[0]).not.toHaveProperty('memory')
      expect(world.nodes).not.toBe(live.nodes) // a copy, not shared
      expect(stateHash(live)).toBe((await exportSave()).hash)
    } finally {
      setSimClient(createInlineClient())
    }
  })
})

describe('queries', () => {
  it('asks the worker for a bot\'s family and for the founder lines', async () => {
    for (let i = 0; i < 12; i += 1) await advance(200, 1)
    const child = getSnapshot().world.bots.find((bot) => bot.parentId !== null)!
    expect(child).toBeDefined()
    const view = await queryFamily(child.id, 3, 2, 40)
    expect(view?.focus.id).toBe(child.id)
    expect(view?.ancestors[0]?.id).toBe(child.parentId)
    expect(await queryFamily(987654, 1, 1, 5)).toBeNull()
    const lines = await queryFounders()
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]!.record.parentId).toBeNull()
  })
})

describe('dispatchBatch (bulk placing)', () => {
  it('places many bots with one notice and one answer, recorded as ordinary commands', async () => {
    const before = getSnapshot()
    const commands = Array.from({ length: 20 }, (_, i) => ({ type: 'placeBot' as const, x: 10.5 + i, y: 10.5 }))
    const result = await dispatchBatch(commands, 'bots')
    expect(result).toEqual({ total: 20, placed: 20, refused: 0, firstReason: null })
    const snap = getSnapshot()
    expect(snap.population).toBe(before.population + 20)
    expect(snap.commandCount).toBe(before.commandCount + 20)
    expect(snap.notice).toMatchObject({ ok: true, text: 'Placed 20 of 20 bots.' })
  })

  it('stops at the node cap and says so', async () => {
    const max = tuning.player.maxNodes
    const commands = Array.from({ length: max + 10 }, (_, i) => ({ type: 'placeNode' as const, kind: 'shelter' as const, x: (i % 90) + 0.5, y: Math.floor(i / 90) * 2 + 0.5 }))
    const result = await dispatchBatch(commands, 'shelter nodes')
    expect(result.placed + result.refused).toBe(max + 10)
    expect(result.placed).toBeGreaterThan(0)
    expect(result.refused).toBeGreaterThan(0)
    expect(getSnapshot().notice?.text).toContain('cap reached')
  })

  it('splits a list longer than one batch and still counts it all', async () => {
    const commands = Array.from({ length: MAX_BATCH + 100 }, (_, i) => ({ type: 'placeBot' as const, x: (i % 96) + 0.5, y: Math.floor(i / 96) + 0.5 }))
    const result = await dispatchBatch(commands, 'bots')
    expect(result.placed + result.refused).toBe(MAX_BATCH + 100)
    expect(getSnapshot().commandCount).toBe(result.placed)
  })

  it('a click with a count above 1 places that many, a count of 1 places one', async () => {
    setTool('bot')
    setPlaceCount(10)
    const before = getSnapshot().population
    clickMap(5.5, 5.5, 1)
    await settled()
    expect(getSnapshot().population).toBe(before + 10)
    setPlaceCount(1)
    clickMap(5.5, 5.5, 1)
    await settled()
    expect(getSnapshot().population).toBe(before + 11)
  })
})

describe('the Add bot sex picker', () => {
  it('places the chosen sex with one click and with a bulk click, and Auto sends no key', async () => {
    setTool('bot')
    setBotSex('male')
    clickMap(30.5, 30.5, 1)
    await settled()
    expect(getSnapshot().world.commands.at(-1)?.cmd).toEqual({ type: 'placeBot', x: 30.5, y: 30.5, sex: 'male' })
    setPlaceCount(10)
    clickMap(40.5, 40.5, 1)
    await settled()
    const placed = getSnapshot().world.commands.slice(-10).map((entry) => entry.cmd)
    expect(placed.every((cmd) => cmd.type === 'placeBot' && cmd.sex === 'male')).toBe(true)
    setBotSex(null)
    setPlaceCount(1)
    clickMap(20.5, 20.5, 1)
    await settled()
    expect(getSnapshot().world.commands.at(-1)?.cmd).toEqual({ type: 'placeBot', x: 20.5, y: 20.5 })
  })

  it('is kept across a new world', async () => {
    setBotSex('female')
    resetWorld('another')
    await settled()
    expect(getSnapshot().botSex).toBe('female')
  })
})
