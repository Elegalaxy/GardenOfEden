import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { checkCulture, isElder, isYoung, teachElders } from '../src/sim/culture.ts'
import { inheritMemory, mergeMemory } from '../src/sim/family.ts'
import { stateHash } from '../src/sim/hash.ts'
import { remember } from '../src/sim/perception.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { step } from '../src/sim/step.ts'
import type { MemoryEntry, Preset, Rules, World } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'
import { noCulture, withCulture } from './variants.ts'

// Culture (C1): elders teach non-child young bots the places they know. Mechanics only, switched off in the shipped numbers.

/** Eden seed a at 5,000 ticks and seed b at 20,000, measured on main before any C1 change (culture is off). */
const PIN_A_5000 = '731f770400f210aa'
const PIN_A_RNG = {
  world: { a: 3688263227, b: 3154447763, c: 1166763587, d: 3567969820 },
  ai: { a: 3770057721, b: 97827464, c: 51461658, d: 2412737640 },
  birth: { a: 380217656, b: 2732393019, c: 2193901339, d: 1463745650 },
  gene: { a: 3850647471, b: 3358185439, c: 2081543315, d: 3659276644 },
  predator: { a: 2349682960, b: 3235739550, c: 3616504036, d: 1357575783 },
}
const PIN_B_20000 = 'be462fac79aff2af'
const PIN_B_RNG = {
  world: { a: 2108544604, b: 724006586, c: 3541576535, d: 3500638388 },
  ai: { a: 1188429527, b: 703103133, c: 1122700521, d: 1383984525 },
  birth: { a: 125994490, b: 546493350, c: 1333955491, d: 3188211926 },
  gene: { a: 1092691059, b: 4225256307, c: 113804040, d: 4005965665 },
  predator: { a: 3978175041, b: 1841855835, c: 2416030862, d: 2899171380 },
}

const on = withCulture(rules)

/** Five nodes (ids 1 to 5): water, shelter, resource, water, shelter. Bots get the ids after them. */
function scene(spots: [number, number][]): Preset {
  return {
    id: 'test',
    label: 'Test scene',
    width: 60,
    height: 60,
    nodes: [
      { kind: 'water', x: 50, y: 50 },
      { kind: 'shelter', x: 52, y: 50 },
      { kind: 'resource', x: 54, y: 50 },
      { kind: 'water', x: 50, y: 54 },
      { kind: 'shelter', x: 52, y: 54 },
    ],
    scatter: [],
    bots: spots.map(([x, y]) => ({ x, y })),
    scatterBots: 0,
  }
}

const KINDS = ['water', 'shelter', 'resource', 'water', 'shelter'] as const

/** A memory entry for node `id` (1 to 5) seen at `seenTick`. */
function entry(id: number, seenTick: number, over: Partial<MemoryEntry> = {}): MemoryEntry {
  return { nodeId: id, kind: KINDS[id - 1]!, x: 50, y: 50, radius: 2, seenTick, amount: 100, learnedFrom: null, ...over }
}

/** A world on a lesson tick (tick 20) with bots at the given spots, each [x, y, age]; memories empty, longevity 1. */
function world(active: Rules, bots: [number, number, number][], tick = 20): World {
  const w = createWorld('a', scene(bots.map(([x, y]) => [x, y])), active)
  bots.forEach(([, , age], i) => {
    const bot = w.bots[i]!
    bot.age = age
    bot.traits.longevity = 1
    bot.memory = []
    bot.parentId = null
    bot.fatherId = null
  })
  w.tick = tick
  return w
}

function ids(memory: readonly MemoryEntry[]): number[] {
  return memory.map((e) => e.nodeId)
}

describe('pins with culture off', () => {
  it('leaves Eden seed a at 5,000 ticks bit-identical and adds no key', () => {
    const w = createWorld('a', edenPreset, rules)
    while (w.tick < 5000) step(w, rules)
    expect(stateHash(w)).toBe(PIN_A_5000)
    expect(w.rng).toEqual(PIN_A_RNG)
    expect(w.culture).toBeUndefined()
    expect(w.bots.some((bot) => bot.memory.some((e) => e.taught !== undefined))).toBe(false)
  })

  it('leaves Eden seed b at 20,000 ticks bit-identical', { timeout: 600_000 }, () => {
    const w = createWorld('b', edenPreset, rules)
    while (w.tick < 20000) step(w, rules)
    expect(stateHash(w)).toBe(PIN_B_20000)
    expect(w.rng).toEqual(PIN_B_RNG)
  })

  it('ships off with the C1 numbers', () => {
    expect(rules.tuning.culture).toEqual({ enabled: false, elderAge: 1800, youngAge: 600, teachRadius: 3, teachEvery: 20, perLesson: 2, teachKinds: ['water', 'shelter'] })
  })

  it('teachElders does nothing while culture is off, even when elders and pupils stand together', () => {
    const w = world(rules, [[10, 10, 2000], [11, 10, 100]])
    w.bots[0]!.memory = [entry(1, 5)]
    teachElders(w, rules.tuning)
    expect(w.bots[1]!.memory).toEqual([])
    expect(w.culture).toBeUndefined()
  })
})

describe('a lesson', () => {
  it('lets an elder teach a stranger its water and shelter places, not a resource', () => {
    const w = world(on, [[10, 10, 2000], [11, 10, 100]])
    const [elder, pupil] = w.bots as [World['bots'][number], World['bots'][number]]
    elder.memory = [entry(3, 7), entry(1, 5), entry(2, 6)]
    expect(w.culture).toEqual({ taught: 0 })
    teachElders(w, on.tuning)
    expect(pupil.memory).toEqual([
      { nodeId: 2, kind: 'shelter', x: 50, y: 50, radius: 2, seenTick: 6, amount: 100, learnedFrom: elder.id, taught: true },
      { nodeId: 1, kind: 'water', x: 50, y: 50, radius: 2, seenTick: 5, amount: 100, learnedFrom: elder.id, taught: true },
    ])
    expect(Object.keys(pupil.memory[0]!).at(-1)).toBe('taught')
    expect(w.culture).toEqual({ taught: 2 })
    // The elder learns nothing.
    expect(elder.memory).toEqual([entry(3, 7), entry(1, 5), entry(2, 6)])
  })

  it('skips an elder that is the pupil\'s mother or father, but a grandparent or stranger may teach', () => {
    for (const field of ['parentId', 'fatherId'] as const) {
      const w = world(on, [[10, 10, 2000], [11, 10, 100]])
      w.bots[0]!.memory = [entry(1, 5)]
      w.bots[1]![field] = w.bots[0]!.id
      teachElders(w, on.tuning)
      expect(w.bots[1]!.memory).toEqual([])
      expect(w.culture!.taught).toBe(0)
    }
    // With the parent closest, the pupil gets nothing from a farther elder only if none is left in range; here a second elder is in range.
    const w = world(on, [[10, 10, 2000], [12, 10, 2000], [11, 10, 100]])
    w.bots[0]!.memory = [entry(1, 5)]
    w.bots[1]!.memory = [entry(2, 6)]
    w.bots[2]!.parentId = w.bots[0]!.id
    teachElders(w, on.tuning)
    expect(ids(w.bots[2]!.memory)).toEqual([2])
    expect(w.bots[2]!.memory[0]!.learnedFrom).toBe(w.bots[1]!.id)
  })

  it('caps a lesson at perLesson entries, freshest sighting first', () => {
    const full = [entry(1, 1), entry(2, 2), entry(4, 3), entry(5, 4)]
    const two = world(on, [[10, 10, 2000], [11, 10, 100]])
    two.bots[0]!.memory = full
    teachElders(two, on.tuning)
    expect(ids(two.bots[1]!.memory)).toEqual([5, 4])
    const one = world(withCulture(rules, { perLesson: 1 }), [[10, 10, 2000], [11, 10, 100]])
    one.bots[0]!.memory = full
    teachElders(one, withCulture(rules, { perLesson: 1 }).tuning)
    expect(ids(one.bots[1]!.memory)).toEqual([5])
  })

  it('never copies an older sighting over a newer one, and counts only real lessons', () => {
    const old = world(on, [[10, 10, 2000], [11, 10, 100]])
    old.bots[0]!.memory = [entry(1, 5, { amount: 7 })]
    old.bots[1]!.memory = [entry(1, 9, { amount: 1 })]
    teachElders(old, on.tuning)
    expect(old.bots[1]!.memory).toEqual([entry(1, 9, { amount: 1 })])
    expect(old.culture!.taught).toBe(0)

    const fresh = world(on, [[10, 10, 2000], [11, 10, 100]])
    fresh.bots[0]!.memory = [entry(1, 12, { amount: 7 })]
    fresh.bots[1]!.memory = [entry(1, 9, { amount: 1 })]
    teachElders(fresh, on.tuning)
    expect(fresh.bots[1]!.memory).toEqual([entry(1, 12, { amount: 7, learnedFrom: fresh.bots[0]!.id, taught: true })])
    expect(fresh.culture!.taught).toBe(1)
  })

  it('spends the perLesson slots on entries that would actually change the pupil', () => {
    const w = world(withCulture(rules, { perLesson: 1 }), [[10, 10, 2000], [11, 10, 100]])
    w.bots[0]!.memory = [entry(1, 9), entry(2, 5)]
    w.bots[1]!.memory = [entry(1, 9)]
    teachElders(w, withCulture(rules, { perLesson: 1 }).tuning)
    expect(ids(w.bots[1]!.memory)).toEqual([1, 2])
  })

  it('keeps the memory caps', () => {
    const tight: Rules = { ...on, tuning: { ...on.tuning, memory: { ...on.tuning.memory, cap: 1 } } }
    const w = world(tight, [[10, 10, 2000], [11, 10, 100]])
    w.bots[0]!.memory = [entry(2, 6)]
    w.bots[1]!.memory = [entry(3, 1)]
    teachElders(w, tight.tuning)
    // One slot for everything but water: the older resource sighting is forgotten, the taught shelter stays.
    expect(ids(w.bots[1]!.memory)).toEqual([2])
    expect(w.culture!.taught).toBe(1)
    // A taught entry that is itself the oldest is trimmed and not counted.
    const w2 = world(tight, [[10, 10, 2000], [11, 10, 100]])
    w2.bots[0]!.memory = [entry(2, 1)]
    w2.bots[1]!.memory = [entry(3, 8)]
    teachElders(w2, tight.tuning)
    expect(ids(w2.bots[1]!.memory)).toEqual([3])
    expect(w2.culture!.taught).toBe(0)
  })

  it('passes only the kinds in teachKinds', () => {
    const only = withCulture(rules, { teachKinds: ['resource'] })
    const w = world(only, [[10, 10, 2000], [11, 10, 100]])
    w.bots[0]!.memory = [entry(1, 5), entry(2, 6), entry(3, 7)]
    teachElders(w, only.tuning)
    expect(ids(w.bots[1]!.memory)).toEqual([3])
  })

  it('happens only on ticks that are a multiple of teachEvery', () => {
    for (const [tick, expected] of [[19, 0], [20, 1], [21, 0], [40, 1]] as const) {
      const w = world(on, [[10, 10, 2000], [11, 10, 100]], tick)
      w.bots[0]!.memory = [entry(1, 5)]
      teachElders(w, on.tuning)
      expect(w.bots[1]!.memory).toHaveLength(expected)
    }
  })

  it('teaches from the nearest elder within the radius, ties to the lowest id', () => {
    const near = world(on, [[8, 10, 2000], [11, 10, 2000], [10, 10, 100]])
    near.bots[0]!.memory = [entry(1, 5)]
    near.bots[1]!.memory = [entry(2, 6)]
    teachElders(near, on.tuning)
    expect(ids(near.bots[2]!.memory)).toEqual([2])

    const tie = world(on, [[11, 10, 2000], [9, 10, 2000], [10, 10, 100]])
    tie.bots[0]!.memory = [entry(1, 5)]
    tie.bots[1]!.memory = [entry(2, 6)]
    teachElders(tie, on.tuning)
    expect(ids(tie.bots[2]!.memory)).toEqual([1])
    expect(tie.bots[2]!.memory[0]!.learnedFrom).toBe(tie.bots[0]!.id)

    const edge = world(on, [[13, 10, 2000], [10, 10, 100]])
    edge.bots[0]!.memory = [entry(1, 5)]
    teachElders(edge, on.tuning)
    expect(edge.bots[1]!.memory).toHaveLength(1)
    const out = world(on, [[13.5, 10, 2000], [10, 10, 100]])
    out.bots[0]!.memory = [entry(1, 5)]
    teachElders(out, on.tuning)
    expect(out.bots[1]!.memory).toHaveLength(0)
  })

  it('leaves adults alone: only a young bot takes a lesson', () => {
    const w = world(on, [[10, 10, 1000], [11, 10, 700], [12, 10, 2000]])
    w.bots[0]!.memory = [entry(1, 5)]
    teachElders(w, on.tuning)
    // The first two are adults (not young, not elders); the elder at 2000 has no pupil in range of anything it knows.
    expect(w.bots[0]!.memory).toEqual([entry(1, 5)])
    expect(w.bots[1]!.memory).toEqual([])
  })

  it('scales the elder and young ages by longevity', () => {
    const t = on.tuning
    const bot = (age: number, longevity: number) => ({ age, traits: { longevity } }) as never
    expect(isElder(bot(1800, 1), t)).toBe(true)
    expect(isElder(bot(1799, 1), t)).toBe(false)
    expect(isElder(bot(2000, 2), t)).toBe(false)
    expect(isElder(bot(3600, 2), t)).toBe(true)
    expect(isYoung(bot(599, 1), t)).toBe(true)
    expect(isYoung(bot(600, 1), t)).toBe(false)
    expect(isYoung(bot(1000, 2), t)).toBe(true)
    expect(isYoung(bot(1200, 2), t)).toBe(false)

    const w = world(on, [[10, 10, 2000], [11, 10, 1000]])
    w.bots[0]!.memory = [entry(1, 5)]
    w.bots[0]!.traits.longevity = 2
    w.bots[1]!.traits.longevity = 2
    teachElders(w, on.tuning)
    // 2000 < 3600, so the first is no elder, though the second is young.
    expect(w.bots[1]!.memory).toEqual([])
  })
})

describe('the taught flag', () => {
  it('is cleared when the bot sees the node itself', () => {
    const w = world(on, [[10, 10, 2000], [11, 10, 100]])
    w.bots[0]!.memory = [entry(1, 5)]
    teachElders(w, on.tuning)
    const pupil = w.bots[1]!
    expect(pupil.memory[0]!.taught).toBe(true)
    const live = new Set(w.nodes.map((n) => n.id))
    w.tick = 30
    remember(w, pupil, [w.nodes[0]!], on.tuning, live)
    expect(pupil.memory[0]).toEqual({ nodeId: 1, kind: 'water', x: 50, y: 50, radius: w.nodes[0]!.radius, seenTick: 30, amount: w.nodes[0]!.amount, learnedFrom: null })
    expect('taught' in pupil.memory[0]!).toBe(false)
  })

  it('is dropped from family copies (inheritance and exchange), and is never set by them', () => {
    const taught = entry(1, 5, { learnedFrom: 9, taught: true })
    const born = inheritMemory([taught], 7, rules.tuning)
    expect(born).toEqual([entry(1, 5, { learnedFrom: 7 })])
    expect('taught' in born[0]!).toBe(false)

    const live = new Set([1, 2])
    const fresh = { memory: [] as MemoryEntry[] }
    expect(mergeMemory(fresh, [taught], 7, rules.tuning, live)).toBe(1)
    expect('taught' in fresh.memory[0]!).toBe(false)
    const replaced = { memory: [entry(1, 2)] }
    mergeMemory(replaced, [taught], 7, rules.tuning, live)
    expect(replaced.memory[0]).toEqual(entry(1, 5, { learnedFrom: 7 }))
    expect('taught' in replaced.memory[0]!).toBe(false)
  })

  it('keeps a toxic flag across a lesson and keeps taught the last key', () => {
    const w = world(on, [[10, 10, 2000], [11, 10, 100]])
    w.bots[0]!.memory = [entry(1, 9, { toxic: true })]
    w.bots[1]!.memory = [entry(1, 5)]
    teachElders(w, on.tuning)
    const copy = w.bots[1]!.memory[0]!
    expect(copy.toxic).toBe(true)
    expect(Object.keys(copy).at(-1)).toBe('taught')
  })
})

describe('checkCulture', () => {
  const ok = on.tuning.culture
  it('accepts the shipped numbers', () => {
    expect(() => checkCulture(ok)).not.toThrow()
  })
  it('refuses numbers that cannot work', () => {
    const bad = (over: Partial<typeof ok>) => () => checkCulture({ ...ok, ...over })
    expect(bad({ elderAge: 0 })).toThrow(/elderAge/)
    expect(bad({ elderAge: Infinity })).toThrow(/elderAge/)
    expect(bad({ youngAge: -1 })).toThrow(/youngAge/)
    expect(bad({ youngAge: NaN })).toThrow(/youngAge/)
    expect(bad({ elderAge: 600, youngAge: 600 })).toThrow(/above/)
    expect(bad({ elderAge: 100, youngAge: 600 })).toThrow(/above/)
    expect(bad({ teachRadius: 0 })).toThrow(/teachRadius/)
    expect(bad({ teachEvery: 0 })).toThrow(/teachEvery/)
    expect(bad({ perLesson: 0 })).toThrow(/perLesson/)
    expect(bad({ perLesson: 1.5 })).toThrow(/perLesson/)
    expect(bad({ teachKinds: [] })).toThrow(/non-empty/)
    expect(bad({ teachKinds: ['rough'] })).toThrow(/remember/)
    expect(bad({ teachKinds: ['moon' as never] })).toThrow(/remember/)
    expect(bad({ enabled: 'yes' as never })).toThrow(/enabled/)
  })
  it('is checked by createWorld even with culture off', () => {
    const broken: Rules = { ...rules, tuning: { ...rules.tuning, culture: { ...ok, perLesson: 0 } } }
    expect(() => createWorld('a', edenPreset, broken)).toThrow(/perLesson/)
  })
})

describe('a full run with culture on', () => {
  it('is deterministic, taught entries appear, and a replay gives the same hash', { timeout: 600_000 }, () => {
    const run = () => {
      const w = createWorld('a', edenPreset, on)
      while (w.tick < 4000) step(w, on)
      return w
    }
    const first = run()
    expect(first.culture!.taught).toBeGreaterThan(0)
    expect(stateHash(run())).toBe(stateHash(first))
    expect(stateHash(replayWorld('a', edenPreset, on, first.commands, 4000))).toBe(stateHash(first))
    // And switching it off again gives the pinned kind of world: no key, no flag.
    const off = createWorld('a', edenPreset, noCulture(on))
    while (off.tick < 4000) step(off, noCulture(on))
    expect(off.culture).toBeUndefined()
  })
})
