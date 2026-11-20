import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { applyCommand, checkCommand } from '../src/sim/commands.ts'
import { spreadDisease, startOutbreak } from '../src/sim/disease.ts'
import { stateHash } from '../src/sim/hash.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { step } from '../src/sim/step.ts'
import type { Command, Preset, Rules, World } from '../src/sim/types.ts'
import { createWorld, makeBot } from '../src/sim/world.ts'
import { noDisease, withDisease } from './variants.ts'

// Disease with immunity (D1): mechanics, switched off in the shipped numbers. These need the real rules, so they live here.

/** Eden seed a at 5,000 ticks and seed b at 20,000, measured on main before any D1 change (disease is off and no outbreak is ever started). */
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

const on = withDisease(rules)
const d = on.tuning.disease
/** The outbreak numbers with a tiny radius, so it only takes the bot standing on the spot. */
const tiny = { disease: { ...d, outbreakRadius: 0.5 } }

function scene(over: Partial<Preset> = {}): Preset {
  return { id: 'test', label: 'Test scene', width: 60, height: 60, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

/** An empty world with bots at the given spots (ids in order), no nodes. */
function world(active: Rules, spots: [number, number][], seed = 'a'): World {
  return createWorld(seed, scene({ bots: spots.map(([x, y]) => ({ x, y })) }), active)
}

const OUTBREAK = (x: number, y: number): Command => ({ type: 'triggerEvent', event: 'outbreak', x, y })

/** One spreading tick, as step would run it. */
function tickSpread(w: World): void {
  w.tick += 1
  spreadDisease(w, on.tuning)
}

describe('pins with disease on and no outbreak', () => {
  it('leaves Eden seed a at 5,000 ticks bit-identical', () => {
    const w = createWorld('a', edenPreset, on)
    while (w.tick < 5000) step(w, on)
    expect(stateHash(w)).toBe(PIN_A_5000)
    expect(w.rng).toEqual(PIN_A_RNG)
    expect(w.disease).toBeUndefined()
  })

  it('leaves Eden seed b at 20,000 ticks bit-identical', { timeout: 600_000 }, () => {
    const w = createWorld('b', edenPreset, on)
    while (w.tick < 20000) step(w, on)
    expect(stateHash(w)).toBe(PIN_B_20000)
    expect(w.rng).toEqual(PIN_B_RNG)
  })

  it('ships off', () => {
    expect(rules.tuning.disease.enabled).toBe(false)
  })
})

describe('outbreak', () => {
  it('makes every bot within the radius sick and leaves the others alone', () => {
    const w = world(on, [[10, 10], [13, 10], [10, 16], [10, 16.5], [30, 30]])
    const count = startOutbreak(w, 10, 10, on.tuning)
    // radius 6: (10,10), (13,10) and (10,16) (exactly 6) are in; (10,16.5) and (30,30) are out.
    expect(count).toBe(3)
    expect(w.bots.map((b) => b.illness?.stage)).toEqual(['sick', 'sick', 'sick', undefined, undefined])
    expect(w.bots[0]!.illness).toEqual({ stage: 'sick', dose: 0, until: w.tick + d.sickTicks })
    expect(w.disease).toEqual({ infected: 3, recovered: 0 })
  })

  it('is refused while disease is off and outside the map, and is recorded and logged otherwise', () => {
    const offRules = noDisease(rules)
    const off = world(offRules, [[10, 10]])
    expect(checkCommand(off, offRules, OUTBREAK(10, 10))).toBe('Disease is switched off.')
    expect(applyCommand(off, offRules, OUTBREAK(10, 10)).ok).toBe(false)
    expect(off.commands).toHaveLength(0)
    expect(off.bots[0]!.illness).toBeUndefined()

    const w = world(on, [[10, 10]])
    expect(checkCommand(w, on, OUTBREAK(-1, 10))).toBe('That spot is outside the map.')
    expect(checkCommand(w, on, OUTBREAK(10, 61))).toBe('That spot is outside the map.')
    expect(checkCommand(w, on, { type: 'triggerEvent', event: 'outbreak' })).toBe('That spot is outside the map.')
    expect(applyCommand(w, on, OUTBREAK(10, 10)).ok).toBe(true)
    expect(w.commands).toHaveLength(1)
    expect(w.events).toHaveLength(0)
    expect(w.log.at(-1)).toMatchObject({ type: 'command', command: 'triggerEvent', eventKind: 'outbreak', x: 10, y: 10 })
    expect(w.bots[0]!.illness?.stage).toBe('sick')
  })

  it('replays to the same state hash', { timeout: 120_000 }, () => {
    const live = createWorld('a', edenPreset, on)
    while (live.tick < 400) step(live, on)
    const at = live.bots[0]!
    expect(applyCommand(live, on, OUTBREAK(at.x, at.y)).ok).toBe(true)
    while (live.tick < 1500) step(live, on)
    expect(live.disease?.infected).toBeGreaterThan(0)
    const replay = replayWorld('a', edenPreset, on, live.commands, 1500)
    expect(stateHash(replay)).toBe(stateHash(live))
  })
})

describe('contact', () => {
  /** A sick bot at (10,10), a healthy one 1.5 cells away (inside contactRadius 2) and one far away. */
  function pair(): World {
    const w = world(on, [[10, 10], [11.5, 10], [40, 40]])
    startOutbreak(w, 10, 10, tiny)
    return w
  }

  it('infects after exactly catchAfter ticks in contact, and not a tick sooner', () => {
    const w = pair()
    expect(w.bots.map((b) => b.illness?.stage)).toEqual(['sick', undefined, undefined])
    for (let i = 1; i < d.catchAfter; i += 1) {
      tickSpread(w)
      expect(w.bots[1]!.illness).toEqual({ stage: 'exposed', dose: i, until: 0 })
    }
    tickSpread(w)
    expect(w.bots[1]!.illness).toEqual({ stage: 'sick', dose: 0, until: w.tick + d.sickTicks })
    expect(w.bots[2]!.illness).toBeUndefined()
    expect(w.disease).toEqual({ infected: 2, recovered: 0 })
  })

  it('a bot that fell sick this tick does not spread it until the next tick', () => {
    // B is one tick from catching it from A; C touches only B.
    const w = world(on, [[10, 10], [11.5, 10], [13, 10]])
    startOutbreak(w, 10, 10, tiny)
    for (let i = 0; i < d.catchAfter; i += 1) tickSpread(w)
    expect(w.bots[1]!.illness?.stage).toBe('sick')
    expect(w.bots[2]!.illness).toBeUndefined()
    tickSpread(w)
    expect(w.bots[2]!.illness).toEqual({ stage: 'exposed', dose: 1, until: 0 })
  })

  it('a bot outside contactRadius is not touched', () => {
    const w = world(on, [[10, 10], [12.5, 10]])
    startOutbreak(w, 10, 10, tiny)
    tickSpread(w)
    expect(w.bots[1]!.illness).toBeUndefined()
  })

  it('the dose falls by one a tick without contact and the key goes at 0', () => {
    const w = pair()
    for (let i = 0; i < 5; i += 1) tickSpread(w)
    expect(w.bots[1]!.illness?.dose).toBe(5)
    w.bots[1]!.x = 30 // out of reach
    for (const expected of [4, 3, 2, 1]) {
      tickSpread(w)
      expect(w.bots[1]!.illness).toEqual({ stage: 'exposed', dose: expected, until: 0 })
    }
    tickSpread(w)
    expect(w.bots[1]!.illness).toBeUndefined()
    expect('illness' in w.bots[1]!).toBe(false)
  })

  it('does nothing before the first outbreak', () => {
    const w = world(on, [[10, 10], [11, 10]])
    spreadDisease(w, on.tuning)
    expect(w.disease).toBeUndefined()
    expect(w.bots.some((b) => 'illness' in b)).toBe(false)
  })
})

describe('recovery and immunity', () => {
  it('goes sick -> immune -> key absent, counts the recovery, and an immune bot is not infected again', () => {
    const w = world(on, [[10, 10], [11, 10]])
    startOutbreak(w, 10, 10, tiny)
    const start = w.tick
    while (w.tick < start + d.sickTicks - 1) tickSpread(w)
    expect(w.bots[0]!.illness?.stage).toBe('sick')
    tickSpread(w)
    expect(w.bots[0]!.illness).toEqual({ stage: 'immune', dose: 0, until: w.tick + d.immuneTicks })
    expect(w.disease!.recovered).toBe(1)
    // Bot 2 caught it at catchAfter, so it is still sick beside the immune bot 1, which stays immune and is not counted again.
    const infected = w.disease!.infected
    tickSpread(w)
    expect(w.bots[0]!.illness?.stage).toBe('immune')
    expect(w.disease!.infected).toBe(infected)
    const until = w.bots[0]!.illness!.until
    w.bots[1]!.x = 40 // move the sick bot away so nobody re-infects bot 1 later
    while (w.tick < until) tickSpread(w)
    expect(w.bots[0]!.illness).toBeUndefined()
    expect('illness' in w.bots[0]!).toBe(false)
  })
})

describe('damage', () => {
  it('a sick bot takes sickDrain health damage a tick, divided by hardiness', () => {
    for (const hardiness of [1, 2]) {
      const healthy = world(on, [[30, 30]])
      const sick = world(on, [[30, 30]])
      for (const w of [healthy, sick]) {
        w.bots[0]!.health = 50
        w.bots[0]!.traits.hardiness = hardiness
      }
      startOutbreak(sick, 30, 30, on.tuning)
      step(healthy, on)
      step(sick, on)
      expect(healthy.bots[0]!.health - sick.bots[0]!.health).toBeCloseTo(d.sickDrain / hardiness, 9)
      expect(sick.bots[0]!.x).toBe(healthy.bots[0]!.x) // the illness changes no behaviour
    }
  })

  it('records death cause disease when the sickness is the largest damage', () => {
    const w = world(on, [[30, 30]])
    w.bots[0]!.health = 0.01
    startOutbreak(w, 30, 30, on.tuning)
    step(w, on)
    expect(w.bots).toHaveLength(0)
    expect(w.deathsByCause.disease).toBe(1)
    expect(w.log.find((e) => e.type === 'death')).toMatchObject({ cause: 'disease' })
  })

  it('a healthy bot at the same health survives the same tick, and no disease key appears', () => {
    const w = world(on, [[30, 30]])
    w.bots[0]!.health = 0.01
    step(w, on)
    expect(w.bots).toHaveLength(1)
    expect(w.deathsByCause.disease).toBeUndefined()
  })
})

describe('who is touched', () => {
  it('newborns start healthy', () => {
    expect('illness' in makeBot(9999, 1, 1, 0, on)).toBe(false)
    const w = createWorld('a', edenPreset, on)
    applyCommand(w, on, OUTBREAK(48, 32))
    const sickAtStart = w.bots.filter((b) => b.illness !== undefined).length
    expect(sickAtStart).toBeGreaterThan(0)
    const founders = new Set(w.bots.map((b) => b.id))
    // Newborns in the first ticks: any child of a sick parent has no illness key until contact gives it one.
    let checked = 0
    while (w.tick < 1500 && checked < 5) {
      step(w, on)
      for (const bot of w.bots) {
        if (!founders.has(bot.id) && bot.age === 0 && bot.illness === undefined) checked += 1
      }
    }
    expect(w.bots.some((b) => !founders.has(b.id))).toBe(true)
    expect(w.bots.filter((b) => !founders.has(b.id) && b.age === 0).every((b) => b.illness === undefined)).toBe(true)
  })

  it('predators are unaffected', () => {
    const w = createWorld('a', edenPreset, on)
    const predators = w.nodes.filter((n) => n.kind === 'predator')
    expect(predators.length).toBeGreaterThan(0)
    const before = JSON.stringify(predators)
    startOutbreak(w, predators[0]!.x, predators[0]!.y, { disease: { ...d, outbreakRadius: 60 } })
    expect(JSON.stringify(w.nodes.filter((n) => n.kind === 'predator'))).toBe(before)
    expect(predators.some((n) => 'illness' in n)).toBe(false)
  })
})
