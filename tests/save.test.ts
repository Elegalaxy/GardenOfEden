import { describe, expect, it } from 'vitest'

import { edenPreset, nodeDefs, rules, tuning } from '../src/content/index.ts'
import { EVENT_KINDS, PLACEABLE_KINDS, decodeSave, encodeSave, makeSave } from '../src/persist/save.ts'
import type { Save } from '../src/persist/save.ts'
import { decodeShare, encodeShare } from '../src/persist/share.ts'
import { applyCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { step } from '../src/sim/step.ts'
import type { Command, World } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'
import { createReplayJob } from '../src/ui/replayJob.ts'

// Save, link and chunked-replay tests need the real rules and preset, so they live here
// (src/persist may not import src/content).

type Timed = { tick: number; cmd: Command }

function advanceTo(world: World, tick: number): void {
  while (world.tick < tick) step(world, rules)
}

/** Plays a live run: steps to each command's tick, applies it, then steps on to `endTick`. */
function playRun(seed: string, plan: Timed[], endTick: number): World {
  const world = createWorld(seed, edenPreset, rules)
  for (const { tick, cmd } of plan) {
    advanceTo(world, tick)
    applyCommand(world, rules, cmd)
  }
  advanceTo(world, endTick)
  return world
}

const PLAN: Timed[] = [
  { tick: 0, cmd: { type: 'placeNode', kind: 'resource', x: 40.5, y: 30.5 } },
  { tick: 0, cmd: { type: 'placeNode', kind: 'water', x: 41.5, y: 33.5 } },
  { tick: 150, cmd: { type: 'placeBot', x: 40.5, y: 31.5 } },
  { tick: 150, cmd: { type: 'placeNode', kind: 'shelter', x: 44.5, y: 30.5 } },
  { tick: 300, cmd: { type: 'triggerEvent', event: 'drought' } },
  { tick: 500, cmd: { type: 'placeNode', kind: 'danger', x: 20.5, y: 20.5 } },
  { tick: 600, cmd: { type: 'triggerEvent', event: 'plague', x: 48.5, y: 32.5 } },
  { tick: 900, cmd: { type: 'triggerEvent', event: 'meteor', x: 48.5, y: 32.5 } },
  { tick: 1100, cmd: { type: 'triggerEvent', event: 'bounty' } },
  { tick: 1400, cmd: { type: 'removeNode', id: 1 } },
  { tick: 1800, cmd: { type: 'placeBot', x: 10.5, y: 10.5 } },
]
const END_TICK = 1800 // the last command sits exactly on the saved tick

function saveOf(world: World): Save {
  return makeSave(world, edenPreset.id, stateHash(world))
}

describe('save format and content', () => {
  it('lists the same placeable node kinds and event kinds as the content', () => {
    expect([...PLACEABLE_KINDS].sort()).toEqual(Object.keys(nodeDefs).filter((kind) => kind !== 'ruin').sort())
    expect([...EVENT_KINDS].sort()).toEqual(Object.keys(tuning.events).filter((key) => !['maxActive', 'maxCraters'].includes(key)).sort())
  })
})

describe('replaying a saved run', () => {
  it('the live run recorded every command in the plan', () => {
    const live = playRun('save-a', PLAN, END_TICK)
    expect(live.commands).toHaveLength(PLAN.length)
    expect(live.tick).toBe(END_TICK)
  })

  it('gives the same stateHash as the live run, through an encode and a decode', () => {
    const live = playRun('save-a', PLAN, END_TICK)
    const decoded = decodeSave(encodeSave(saveOf(live)))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    const replayed = replayWorld(decoded.save.seed, edenPreset, rules, decoded.save.commands, decoded.save.tick)
    expect(replayed.tick).toBe(END_TICK)
    expect(stateHash(replayed)).toBe(decoded.save.hash)
    expect(stateHash(replayed)).toBe(stateHash(live))
  })

  it('works for a run saved at tick 0 with no commands', () => {
    const live = createWorld('save-zero', edenPreset, rules)
    const decoded = decodeSave(encodeSave(saveOf(live)))
    if (!decoded.ok) throw new Error('decode failed')
    const replayed = replayWorld(decoded.save.seed, edenPreset, rules, decoded.save.commands, decoded.save.tick)
    expect(stateHash(replayed)).toBe(stateHash(live))
  })

  it('works for a run where everyone died', () => {
    const empty = { ...edenPreset, bots: [], scatterBots: 0 }
    const live = createWorld('save-extinct', empty, rules)
    applyCommand(live, rules, { type: 'placeBot', x: 5.5, y: 5.5 })
    advanceTo(live, 3000) // a lone founder with a poor map starves long before this
    const save = saveOf(live)
    const replayed = replayWorld(save.seed, empty, rules, save.commands, save.tick)
    expect(stateHash(replayed)).toBe(save.hash)
  })

  it('a link carries the run: the replay from a decoded link has the same hash', () => {
    // Short run, so it fits in a link.
    const live = playRun('save-link', PLAN.slice(0, 4), 400)
    const encoded = encodeShare(saveOf(live))
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const decoded = decodeShare(encoded.payload)
    if (!decoded.ok) throw new Error('decode failed')
    const replayed = replayWorld(decoded.save.seed, edenPreset, rules, decoded.save.commands, decoded.save.tick)
    expect(stateHash(replayed)).toBe(stateHash(live))
  })

  it('a different seed or a missing command gives a different hash (the check can fail)', () => {
    const live = playRun('save-a', PLAN, END_TICK)
    const save = saveOf(live)
    const missing = replayWorld(save.seed, edenPreset, rules, save.commands.slice(1), save.tick)
    expect(stateHash(missing)).not.toBe(save.hash)
  })
})

describe('chunked replay', () => {
  const live = playRun('save-chunk', PLAN, END_TICK)
  const save = saveOf(live)

  for (const chunk of [1, 7, 200, 1_000_000]) {
    it(`with ${chunk} ticks per slice equals the one-shot replay`, () => {
      const job = createReplayJob(save.seed, edenPreset, rules, save.commands, save.tick)
      let slices = 0
      while (!job.finished) {
        job.run(chunk)
        slices += 1
        expect(job.tick).toBeLessThanOrEqual(save.tick)
      }
      expect(job.tick).toBe(save.tick)
      expect(stateHash(job.world)).toBe(save.hash)
      if (chunk === 200) expect(slices).toBeGreaterThan(5)
    })
  }

  it('reports progress as it goes and does nothing once finished', () => {
    const job = createReplayJob(save.seed, edenPreset, rules, save.commands, save.tick)
    job.run(100)
    expect(job.tick).toBeGreaterThan(0)
    expect(job.tick).toBeLessThanOrEqual(100)
    expect(job.finished).toBe(false)
    job.run(1_000_000)
    const hash = stateHash(job.world)
    job.run(50)
    expect(stateHash(job.world)).toBe(hash)
  })

  it('throws when the replay refuses a command, instead of returning a half-built world', () => {
    const bad = [{ tick: 0, cmd: { type: 'placeNode', kind: 'resource', x: 5000, y: 5 } satisfies Command }]
    const job = createReplayJob('save-bad', edenPreset, rules, bad, 10)
    expect(() => job.run(100)).toThrow(/refused/)
  })

  it('throws when a command comes after the saved tick', () => {
    const late = [{ tick: 20, cmd: { type: 'placeBot', x: 5.5, y: 5.5 } satisfies Command }]
    const job = createReplayJob('save-late', edenPreset, rules, late, 10)
    expect(() => job.run(100)).toThrow(/after the saved tick/)
  })
})
