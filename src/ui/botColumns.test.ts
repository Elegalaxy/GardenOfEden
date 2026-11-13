import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../content/index.ts'
import { step } from '../sim/step.ts'
import type { Bot, IntentKind, World } from '../sim/types.ts'
import { createWorld } from '../sim/world.ts'
import { F64_STRIDE, I32_STRIDE, INTENT_KINDS, packBots, packedBuffers, unpackBots } from './botColumns.ts'
import { createInlineClient } from './simClient.ts'
import { transferListOf } from './protocol.ts'
import type { Frame, FromWorker, PackedBots, ViewBot } from './protocol.ts'
import { buildFrame } from './simHost.ts'
import { applyFrame, cloneFrame, toViewWorld } from './viewWorld.ts'

/** What a bot looked like before frames were packed (the old `viewBot`). */
function oldViewBot(bot: Bot): ViewBot {
  const { memory, ...rest } = bot
  return { ...rest, memoryCount: memory.length, learnedCount: memory.filter((entry) => entry.learnedFrom !== null).length }
}

function busy(): World {
  const world = createWorld('cols', edenPreset, rules)
  for (let i = 0; i < 400; i += 1) step(world, rules)
  return world
}

function crowd(source: World, n: number): Bot[] {
  const out: Bot[] = []
  for (let i = 0; i < n; i += 1) {
    const bot = structuredClone(source.bots[i % source.bots.length]!)
    bot.id = i + 1
    bot.x = (i * 7.3) % 100
    bot.y = (i * 3.1) % 60
    out.push(bot)
  }
  return out
}

describe('packBots / unpackBots', () => {
  const world = busy()

  it('round-trips every bot exactly as the old ViewBot', () => {
    expect(world.bots.length).toBeGreaterThan(5)
    const packed = packBots(world.bots)
    expect(packed.count).toBe(world.bots.length)
    expect(packed.f64.length).toBe(packed.count * F64_STRIDE)
    expect(packed.i32.length).toBe(packed.count * I32_STRIDE)
    expect(unpackBots(packed)).toEqual(world.bots.map(oldViewBot))
  })

  it('encodes a missing parent, father and target as -1 and decodes them back to null, every intent kind', () => {
    const bots = crowd(world, INTENT_KINDS.length * 2)
    bots.forEach((bot, i) => {
      bot.intent = { kind: INTENT_KINDS[i % INTENT_KINDS.length] as IntentKind, targetId: i % 2 === 0 ? null : 12345 + i }
      bot.parentId = i % 3 === 0 ? null : i
      bot.fatherId = i % 4 === 0 ? null : i + 100
      bot.sex = i % 2 === 0 ? 'female' : 'male'
    })
    const packed = packBots(bots)
    for (let i = 0; i < bots.length; i += 1) {
      if (bots[i]!.parentId === null) expect(packed.i32[i * I32_STRIDE + 4]).toBe(-1)
      if (bots[i]!.intent.targetId === null) expect(packed.i32[i * I32_STRIDE + 6]).toBe(-1)
      if (bots[i]!.fatherId === null) expect(packed.i32[i * I32_STRIDE + 9]).toBe(-1)
      expect(packed.i32[i * I32_STRIDE + 10]).toBe(i % 2 === 0 ? 0 : 1)
    }
    expect(unpackBots(packed)).toEqual(bots.map(oldViewBot))
    expect(INTENT_KINDS).toHaveLength(7)
  })

  it('keeps large ids, ages and fractional floats exact', () => {
    const bots = crowd(world, 3)
    bots[0]!.id = 2_000_000_000
    bots[0]!.parentId = 1_999_999_999
    bots[0]!.age = 2_100_000_000
    bots[0]!.x = 0.1 + 0.2
    bots[0]!.py = 1 / 3
    bots[0]!.energy = 12.345678901234567
    bots[0]!.heading = -Math.PI
    const out = unpackBots(packBots(bots))
    expect(out[0]).toEqual(oldViewBot(bots[0]!))
    expect(out[0]!.x).toBe(0.1 + 0.2)
  })

  it('handles an empty list', () => {
    const packed = packBots([])
    expect(packed.count).toBe(0)
    expect(unpackBots(packed)).toEqual([])
    expect(packedBuffers(packed)).toHaveLength(2)
  })

  it('packs 2,000 bots', () => {
    const bots = crowd(world, 2000)
    const packed = packBots(bots)
    expect(packed.count).toBe(2000)
    const out = unpackBots(packed)
    expect(out).toHaveLength(2000)
    expect(out[1999]).toEqual(oldViewBot(bots[1999]!))
    expect(packed.f64.byteLength + packed.i32.byteLength).toBe(2000 * (F64_STRIDE * 8 + I32_STRIDE * 4))
  })
})

describe('frames with packed bots', () => {
  const world = busy()
  const run = { runId: 0, seed: world.seed, presetId: 'eden', width: world.width, height: world.height }

  it('lists the packed buffers, and only for frames, in the transfer list', () => {
    const frame = buildFrame(world, run, null, false)
    const list = transferListOf({ type: 'frame', frame })
    expect(list).toEqual([frame.fast.bots.f64.buffer, frame.fast.bots.i32.buffer])
    expect(transferListOf({ type: 'ready' })).toEqual([])
    expect(transferListOf({ type: 'synced', reqId: 1 })).toEqual([])
  })

  it('transfers the buffers when cloned with the list (the sender loses them) and the copy is intact', () => {
    const frame = buildFrame(world, run, null, false)
    const expected = world.bots.map(oldViewBot)
    const copy = cloneFrame(frame)
    expect(frame.fast.bots.f64.byteLength).toBe(0) // detached
    expect(unpackBots(copy.fast.bots)).toEqual(expected)
  })

  it('does not share the packed buffers with the live world and builds new ones per frame', () => {
    const a = buildFrame(world, run, null, false).fast.bots
    const b = buildFrame(world, run, null, false).fast.bots
    expect(a.f64.buffer).not.toBe(b.f64.buffer)
    expect(a.f64).toEqual(b.f64)
  })

  it('gives an empty world an empty but valid frame', () => {
    const empty = createWorld('empty', { ...edenPreset, bots: [], scatterBots: 0 }, rules)
    expect(empty.bots).toHaveLength(0)
    const frame = cloneFrame(buildFrame(empty, run, null, true))
    expect(frame.fast.bots.count).toBe(0)
    expect(toViewWorld(empty, 'eden').bots).toEqual([])
  })

  it('applyFrame gives a fresh bots array each frame and keeps the view object', () => {
    const w = busy()
    const first = toViewWorld(w, 'eden')
    const before = first.bots
    step(w, rules)
    const next: Frame = cloneFrame(buildFrame(w, { ...run, seed: w.seed }, null, false))
    expect(applyFrame(first, next)).toBe(first)
    expect(first.bots).not.toBe(before)
    expect(first.bots).toEqual(w.bots.map(oldViewBot))
    expect(first.tick).toBe(w.tick)
  })

  it('the inline client delivers a frame whose bots survive the transfer', async () => {
    const client = createInlineClient()
    const got: FromWorker[] = []
    client.listen((msg) => got.push(msg))
    client.post({ type: 'advance', ticks: 20 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const msg = got.find((m): m is Extract<FromWorker, { type: 'frame' }> => m.type === 'frame')!
    const bots = msg.frame.fast.bots as PackedBots
    expect(bots.f64).toBeInstanceOf(Float64Array)
    expect(bots.f64.byteLength).toBe(bots.count * F64_STRIDE * 8)
    expect(unpackBots(bots).map((b) => b.id)).toEqual(client.host.world.bots.map((b) => b.id))
    client.terminate()
  })
})
