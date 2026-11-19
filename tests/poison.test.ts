import { describe, expect, it } from 'vitest'

import { blankPreset, edenPreset, rules } from '../src/content/index.ts'
import { stateHash } from '../src/sim/hash.ts'
import { findRecord } from '../src/sim/lineage.ts'
import { deathCause } from '../src/sim/metabolism.ts'
import { inheritMemory, mergeMemory } from '../src/sim/family.ts'
import { checkPoison, learnToxic, markToxic } from '../src/sim/poison.ts'
import { chooseFood, remember } from '../src/sim/perception.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { step } from '../src/sim/step.ts'
import type { MemoryEntry, Preset, Rules } from '../src/sim/types.ts'
import { createWorld, makeBot, totalDeaths } from '../src/sim/world.ts'
import { noMateChoice, noPoison, withPoison } from './variants.ts'

// Toxic food (T1): mechanics, switched off in the shipped numbers. These need the real rules, so they live here.

/** Eden seed a at 5,000 ticks, taken from the shipped rules before any T1 change (poison is off, so it must not move). */
const PRE_T1_HASH_A_5000 = 'bf108e00ab1fdc98'
/** Eden seed b at 20,000 ticks, same origin. */
const PRE_T1_HASH_B_20000 = '34829c673e410693'

const { bot: botRules } = rules.tuning

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', width: 40, height: 40, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

/** One scattered food node and one bot, to be moved onto the node. */
const foodScene = scene({ scatter: [{ kind: 'resource', count: 1 }], bots: [{ x: 20, y: 20 }] })

/** The bot starts on the food, hungry and hurt (so regeneration is not capped); one tick is played. */
function bite(active: Rules, hardiness = 1, health = 50) {
  const world = createWorld('a', foodScene, active)
  const food = world.nodes[0]!
  const bot = world.bots[0]!
  bot.x = food.x
  bot.y = food.y
  bot.px = food.x
  bot.py = food.y
  bot.energy = 30
  bot.health = health
  bot.traits.hardiness = hardiness
  step(world, active)
  return { world, bot, food }
}

function entry(nodeId: number, over: Partial<MemoryEntry> = {}): MemoryEntry {
  return { nodeId, kind: 'resource', x: 5, y: 5, radius: 2, seenTick: 10, amount: 50, learnedFrom: null, ...over }
}

describe('pins with poison off', () => {
  it('leaves the shipped Eden runs bit-identical', () => {
    expect(rules.tuning.poison.enabled).toBe(false)
    const pinned = noMateChoice(rules) // the pins predate mate choice (G2)
    const a = createWorld('a', edenPreset, pinned)
    while (a.tick < 5000) step(a, pinned)
    expect(stateHash(a)).toBe(PRE_T1_HASH_A_5000)
    while (a.tick < 20000) step(a, pinned)
    // The 20,000-tick survey row of seed a (recorded before T1): final population 57, births 1,235.
    expect([a.bots.length, a.totalBirths]).toEqual([57, 1235])

    const b = createWorld('b', edenPreset, pinned)
    while (b.tick < 20000) step(b, pinned)
    expect(stateHash(b)).toBe(PRE_T1_HASH_B_20000)
  })

  it('adds none of the T1 keys to the world', () => {
    const world = createWorld('a', edenPreset, rules)
    for (let i = 0; i < 3000; i += 1) step(world, rules)
    const text = JSON.stringify(world)
    expect(text).not.toContain('toxin')
    expect(text).not.toContain('toxic')
    expect(text).not.toContain('poison')
    expect(world.eaten.toxic).toBeUndefined()
    expect(world.deathsByCause.poison).toBeUndefined()
    expect(noPoison(withPoison(rules)).tuning.poison.enabled).toBe(false)
  })
})

describe('which nodes are toxic', () => {
  it('makes exactly the last toxicCount scattered resources toxic, without moving anything', () => {
    const off = createWorld('a', edenPreset, rules)
    const on = createWorld('a', edenPreset, withPoison(rules))
    const toxic = on.nodes.filter((node) => node.toxin !== undefined)
    expect(toxic).toHaveLength(6)
    const scattered = on.nodes.filter((node) => node.kind === 'resource' && node.id > edenPreset.nodes.length)
    expect(scattered).toHaveLength(34)
    expect(toxic.map((node) => node.id)).toEqual(scattered.slice(-6).map((node) => node.id))
    for (const node of toxic) expect(node.toxin).toBe(rules.tuning.poison.damagePerUnit)
    expect(on.nodes.map((node) => [node.id, node.kind, node.x, node.y])).toEqual(off.nodes.map((node) => [node.id, node.kind, node.x, node.y]))
    expect(on.nextId).toBe(off.nextId)
    expect(on.eaten.toxic).toBe(0)
    expect(on.deathsByCause.poison).toBe(0)
    // The new keys are the last of their objects.
    expect(Object.keys(on.eaten).at(-1)).toBe('toxic')
    expect(Object.keys(on.deathsByCause).at(-1)).toBe('poison')
    expect(Object.keys(toxic[0]!).at(-1)).toBe('toxin')
  })

  it('caps at the number of scattered food nodes, honours toxicCount, and leaves Blank clean', () => {
    const few = createWorld('a', edenPreset, withPoison(rules, { toxicCount: 3 }))
    expect(few.nodes.filter((node) => node.toxin !== undefined)).toHaveLength(3)
    const many = createWorld('a', edenPreset, withPoison(rules, { toxicCount: 500 }))
    expect(many.nodes.filter((node) => node.toxin !== undefined)).toHaveLength(34)
    expect(many.nodes.filter((node) => node.toxin !== undefined).every((node) => node.id > edenPreset.nodes.length)).toBe(true)
    const none = createWorld('a', edenPreset, withPoison(rules, { toxicCount: 0 }))
    expect(none.nodes.some((node) => node.toxin !== undefined)).toBe(false)
    const blank = createWorld('a', blankPreset, withPoison(rules))
    expect(blank.nodes).toHaveLength(0)
  })

  it('never marks fixed food, ruins or water', () => {
    const preset = scene({ nodes: [{ kind: 'resource', x: 5, y: 5 }, { kind: 'water', x: 9, y: 9 }], scatter: [{ kind: 'resource', count: 2 }, { kind: 'water', count: 1 }] })
    const world = createWorld('a', preset, withPoison(rules, { toxicCount: 5 }))
    expect(world.nodes.filter((node) => node.toxin !== undefined).map((node) => node.id)).toEqual([3, 4])
    const nodes = createWorld('a', preset, rules).nodes
    markToxic(nodes.slice(0, 1), withPoison(rules).tuning)
    expect(nodes[0]!.toxin).toBe(rules.tuning.poison.damagePerUnit)
  })
})

describe('eating toxic food', () => {
  it('costs health by take x damage per unit over hardiness, and gives the full energy', () => {
    const dirty = bite(withPoison(rules))
    const clean = bite(noPoison(rules))
    const take = dirty.world.eaten.toxic!
    expect(take).toBeGreaterThan(0)
    expect(dirty.world.eaten.resource).toBe(clean.world.eaten.resource)
    expect(dirty.bot.energy).toBe(clean.bot.energy)
    const dose = take * rules.tuning.poison.damagePerUnit
    expect(clean.bot.health).toBeCloseTo(50 + botRules.healthRegen, 10)
    expect(dirty.bot.health).toBeCloseTo(50 + botRules.healthRegen - dose, 10)

    const hardy = bite(withPoison(rules), 2)
    expect(hardy.bot.health).toBeCloseTo(50 + botRules.healthRegen - dose / 2, 10)
  })

  it('makes the bot remember the node as toxic, and keeps remembering', () => {
    const { world, bot, food } = bite(withPoison(rules))
    const remembered = bot.memory.find((e) => e.nodeId === food.id)
    expect(remembered?.toxic).toBe(true)
    // A refresh from a new sighting keeps the flag.
    const live = new Set(world.nodes.map((node) => node.id))
    remember(world, bot, [food], rules.tuning, live)
    expect(bot.memory.find((e) => e.nodeId === food.id)?.toxic).toBe(true)
    // Clean food leaves no flag.
    expect(bite(noPoison(rules)).bot.memory.every((e) => e.toxic === undefined)).toBe(true)
  })

  it('learnToxic does nothing for a node the bot has no entry for', () => {
    const bot = makeBot(1, 1, 1, 0, rules)
    learnToxic(bot, 9)
    expect(bot.memory).toEqual([])
  })

  it('kills a bot whose health runs out of the bite with cause poison, in the counters, the lineage and the log', () => {
    const { world, bot } = bite(withPoison(rules), 1, 1)
    expect(world.bots).toHaveLength(0)
    expect(world.deathsByCause.poison).toBe(1)
    expect(totalDeaths(world)).toBe(1)
    expect(findRecord(world, bot.id)?.cause).toBe('poison')
    expect(world.log.find((event) => event.type === 'death')?.cause).toBe('poison')
  })

  it('does not call a death poison when danger or a predator hurt more', () => {
    const active = withPoison(rules)
    const world = createWorld('a', foodScene, active)
    const bot = world.bots[0]!
    bot.health = 0
    // Same-size damage goes to the older causes: the poison dose must be strictly larger.
    const exposure = { damage: 20, plague: 0, predator: 0, predatorId: null, heal: 0, drainMult: 1, shelterId: null }
    expect(deathCause(bot, exposure, 20)).toBe('danger')
    expect(deathCause(bot, exposure, 21)).toBe('poison')
    expect(deathCause(bot, { ...exposure, damage: 0, predator: 30 }, 30)).toBe('predator')
    expect(deathCause(bot, { ...exposure, damage: 0, plague: 30 }, 25)).toBe('plague')
    expect(deathCause(bot, exposure, 0)).toBe('danger')
  })
})

describe('choosing food', () => {
  it('skips a known toxic node unless the bot is brave', () => {
    const world = createWorld('a', foodScene, rules)
    const bot = world.bots[0]!
    bot.memory = [entry(7, { toxic: true, x: 21, y: 20 })]
    expect(chooseFood(world, bot, rules.tuning, false)).toBeNull()
    expect(chooseFood(world, bot, rules.tuning, true)?.nodeId).toBe(7)
    bot.memory = [entry(7, { toxic: true, x: 21, y: 20 }), entry(8, { x: 30, y: 30 })]
    expect(chooseFood(world, bot, rules.tuning, false)?.nodeId).toBe(8)
    bot.memory = [entry(7, { x: 21, y: 20 }), entry(8, { x: 30, y: 30 })]
    expect(chooseFood(world, bot, rules.tuning, false)?.nodeId).toBe(7)
  })
})

describe('sharing what is toxic', () => {
  const live = new Set([1, 2, 3])
  const from = (memory: MemoryEntry[]) => ({ memory })

  it('inheritMemory copies the flag, and only when it is set', () => {
    const copy = inheritMemory([entry(1, { toxic: true }), entry(2)], 99, rules.tuning)
    expect(copy[0]).toEqual({ ...entry(1), toxic: true, learnedFrom: 99 })
    expect('toxic' in copy[1]!).toBe(false)
  })

  it('merges a toxic entry into an empty memory, learned from the sender', () => {
    const me = from([])
    expect(mergeMemory(me, [entry(1, { toxic: true })], 5, rules.tuning, live)).toBe(1)
    expect(me.memory[0]).toEqual({ ...entry(1), toxic: true, learnedFrom: 5 })
  })

  it('a newer clean sighting does not erase what the receiver knew', () => {
    const me = from([entry(1, { seenTick: 5, toxic: true })])
    expect(mergeMemory(me, [entry(1, { seenTick: 9 })], 5, rules.tuning, live)).toBe(1)
    expect(me.memory[0]).toEqual({ ...entry(1), seenTick: 9, toxic: true, learnedFrom: 5 })
    expect(Object.keys(me.memory[0]!).at(-1)).toBe('toxic')
  })

  it('a newer toxic sighting replaces a clean one with the flag', () => {
    const me = from([entry(1, { seenTick: 5 })])
    expect(mergeMemory(me, [entry(1, { seenTick: 9, toxic: true })], 5, rules.tuning, live)).toBe(1)
    expect(me.memory[0]?.toxic).toBe(true)
    expect(me.memory[0]?.seenTick).toBe(9)
  })

  it('an older toxic sighting still marks a newer clean entry, as a new object that is not counted', () => {
    const mine = entry(1, { seenTick: 9, amount: 7 })
    const me = from([mine])
    expect(mergeMemory(me, [entry(1, { seenTick: 5, toxic: true })], 5, rules.tuning, live)).toBe(0)
    expect(me.memory[0]).toEqual({ ...mine, toxic: true })
    expect(me.memory[0]).not.toBe(mine)
    expect('toxic' in mine).toBe(false)
  })

  it('leaves clean entries alone and never sets the key to false or undefined', () => {
    const mine = entry(1, { seenTick: 9 })
    const me = from([mine])
    expect(mergeMemory(me, [entry(1, { seenTick: 5 })], 5, rules.tuning, live)).toBe(0)
    expect(me.memory[0]).toBe(mine)
    expect('toxic' in me.memory[0]!).toBe(false)
  })
})

describe('whole runs with poison on', () => {
  it('is deterministic and a replay equals the live run', () => {
    const on = withPoison(rules)
    const live = createWorld('a', edenPreset, on)
    for (let i = 0; i < 3000; i += 1) step(live, on)
    const again = createWorld('a', edenPreset, on)
    for (let i = 0; i < 3000; i += 1) step(again, on)
    expect(stateHash(again)).toBe(stateHash(live))
    expect(stateHash(replayWorld('a', edenPreset, on, live.commands, live.tick))).toBe(stateHash(live))
    expect(live.eaten.toxic).toBeGreaterThan(0)
    expect(live.bots.some((bot) => bot.memory.some((e) => e.toxic === true))).toBe(true)
    expect(stateHash(live)).not.toBe(stateHash(createWorld('a', edenPreset, rules)))
  })
})

describe('checkPoison', () => {
  const ok = rules.tuning.poison
  it('accepts the shipped numbers and zero', () => {
    expect(() => checkPoison(ok)).not.toThrow()
    expect(() => checkPoison({ ...ok, toxicCount: 0, damagePerUnit: 0 })).not.toThrow()
  })

  it('refuses a toxicCount that is not a whole number from 0 and a damage that is not finite from 0', () => {
    for (const toxicCount of [-1, 1.5, Number.NaN, Infinity]) expect(() => checkPoison({ ...ok, toxicCount })).toThrow(RangeError)
    for (const damagePerUnit of [-1, Number.NaN, Infinity]) expect(() => checkPoison({ ...ok, damagePerUnit })).toThrow(RangeError)
  })

  it('createWorld refuses a bad config even with poison off', () => {
    const bad = { ...rules, tuning: { ...rules.tuning, poison: { ...ok, toxicCount: -2 } } }
    expect(() => createWorld('a', blankPreset, bad)).toThrow(RangeError)
  })
})
