import { describe, expect, it } from 'vitest'

import { blankPreset, edenPreset, rules } from '../src/content/index.ts'
import { applyCommand, checkCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { perceive } from '../src/sim/perception.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { step } from '../src/sim/step.ts'
import { checkTerrain, onRough, roughNodes } from '../src/sim/terrain.ts'
import type { Command, Preset, Rules, World } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'
import { noCone, noTerrain, withCone, withTerrain } from './variants.ts'

// Rough ground (R1): mechanics, switched off in the shipped numbers. These need the real rules, so they live here.

/** Eden seed a at 5,000 ticks and seed b at 20,000, taken from the shipped rules before any R1 change (terrain is off, so they must not move). */
const PRE_R1_HASH_A_5000 = '03cc23ee3c4d0701'
const PRE_R1_HASH_B_20000 = 'a44d483eff987840'
const PRE_R1_RNG_A_5000 =
  '{"world":{"a":4041835896,"b":1899320074,"c":4088289150,"d":3567969942},"ai":{"a":321916596,"b":2610628031,"c":3134457327,"d":2412767411},"birth":{"a":1289067818,"b":779964505,"c":4112049781,"d":1463747834},"gene":{"a":3872702325,"b":2792906123,"c":2495194922,"d":3659276800},"predator":{"a":3274643797,"b":1042723523,"c":3442147681,"d":1357584517}}'
const PRE_R1_RNG_B_20000 =
  '{"world":{"a":1846205129,"b":4169043728,"c":2857540989,"d":3500638510},"ai":{"a":1309321463,"b":4173848300,"c":2551022459,"d":1384168370},"birth":{"a":322622143,"b":1613824137,"c":3343008496,"d":3188233374},"gene":{"a":2175261815,"b":4178708600,"c":1156174852,"d":4005967197},"predator":{"a":1664120539,"b":560783549,"c":2628320706,"d":2899233424}}'

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', width: 40, height: 40, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

const on = withTerrain(rules)

/** Distance a mover travelled during the one tick played. */
function moved(world: World, active: Rules, who: 'bot' | 'predator'): number {
  step(world, active)
  if (who === 'bot') {
    const bot = world.bots[0]!
    return Math.hypot(bot.x - bot.px, bot.y - bot.py)
  }
  const node = world.nodes.find((n) => n.kind === 'predator')!
  return Math.hypot(node.x - node.hunt!.px, node.y - node.hunt!.py)
}

describe('pins with terrain off', () => {
  it('leaves the shipped Eden runs bit-identical, rng streams included', () => {
    expect(rules.tuning.terrain.enabled).toBe(false)
    const a = createWorld('a', edenPreset, rules)
    while (a.tick < 5000) step(a, rules)
    expect(stateHash(a)).toBe(PRE_R1_HASH_A_5000)
    expect(JSON.stringify(a.rng)).toBe(PRE_R1_RNG_A_5000)
    expect(a.nodes.some((node) => node.kind === 'rough')).toBe(false)
    const b = createWorld('b', edenPreset, rules)
    while (b.tick < 20000) step(b, rules)
    expect(stateHash(b)).toBe(PRE_R1_HASH_B_20000)
    expect(JSON.stringify(b.rng)).toBe(PRE_R1_RNG_B_20000)
  })

  it('adds no key to a node or the world', () => {
    const world = createWorld('a', edenPreset, rules)
    for (let i = 0; i < 500; i += 1) step(world, rules)
    expect(JSON.stringify(world)).not.toContain('rough')
    expect(noTerrain(on).tuning.terrain.enabled).toBe(false)
  })
})

describe('creation with terrain on', () => {
  it('puts the rough nodes last and moves nothing else', () => {
    const off = createWorld('a', edenPreset, rules)
    const world = createWorld('a', edenPreset, on)
    const rough = roughNodes(world)
    expect(rough).toHaveLength(4)
    expect(world.nodes.slice(-4)).toEqual(rough)
    expect(rough.map((n) => [n.x, n.y, n.radius, n.expires])).toEqual(edenPreset.terrain!.map((t) => [t.x, t.y, t.radius, 0]))
    expect(world.nodes.slice(0, -4)).toEqual(off.nodes)
    expect(world.bots).toEqual(off.bots)
    expect(world.nextId).toBe(off.nextId + 4)
    expect(JSON.stringify(world.rng)).toBe(JSON.stringify(off.rng))
    // Same keys as any other node: nothing was added to WorldNode.
    expect(Object.keys(rough[0]!)).toEqual(Object.keys(off.nodes[0]!))
  })

  it('makes none in Blank, and rejects a disc outside the map', () => {
    expect(roughNodes(createWorld('a', blankPreset, on))).toHaveLength(0)
    expect(() => createWorld('a', scene({ terrain: [{ x: 50, y: 5, radius: 3 }] }), on)).toThrow(/preset terrain/)
  })

  it('keeps every Eden rough disc clear of the groves and fixed springs', () => {
    const fixed = edenPreset.nodes.filter((n) => n.kind === 'resource' || n.kind === 'water')
    for (const disc of edenPreset.terrain!) {
      for (const node of fixed) expect(Math.hypot(disc.x - node.x, disc.y - node.y)).toBeGreaterThan(disc.radius)
    }
  })
})

describe('onRough', () => {
  it('uses the squared distance, edge included', () => {
    const discs = [{ x: 10, y: 10, radius: 5 }]
    expect(onRough(discs, 15, 10)).toBe(true)
    expect(onRough(discs, 15.0001, 10)).toBe(false)
    expect(onRough([], 10, 10)).toBe(false)
  })
})

describe('speed on rough ground', () => {
  const botScene = (terrain: Preset['terrain'], extra: Partial<Preset> = {}): Preset => scene({ bots: [{ x: 20, y: 20 }], terrain, ...extra })

  it('slows a bot that starts its step on rough ground, and not one just outside', () => {
    const free = moved(createWorld('a', botScene([{ x: 20, y: 20, radius: 5 }]), noTerrain(on)), noTerrain(on), 'bot')
    expect(free).toBeGreaterThan(0)
    const slow = moved(createWorld('a', botScene([{ x: 20, y: 20, radius: 5 }]), on), on, 'bot')
    expect(slow).toBeCloseTo(free * on.tuning.terrain.botSpeedMult, 9)
    // Disc centred so the bot's start is just outside its edge, then exactly on it.
    const outside = moved(createWorld('a', botScene([{ x: 26.01, y: 20, radius: 6 }]), on), on, 'bot')
    expect(outside).toBe(free)
    const edge = moved(createWorld('a', botScene([{ x: 26, y: 20, radius: 6 }]), on), on, 'bot')
    expect(edge).toBeCloseTo(slow, 9)
  })

  it('does not compound overlapping discs', () => {
    const one = moved(createWorld('a', botScene([{ x: 20, y: 20, radius: 5 }]), on), on, 'bot')
    const two = moved(createWorld('a', botScene([{ x: 20, y: 20, radius: 5 }, { x: 21, y: 20, radius: 5 }, { x: 19, y: 19, radius: 3 }]), on), on, 'bot')
    expect(two).toBe(one)
  })

  it('uses the bot multiplier, whatever the predator one is', () => {
    const quarter = withTerrain(rules, { botSpeedMult: 0.25, predatorSpeedMult: 0.9 })
    const free = moved(createWorld('a', botScene([{ x: 20, y: 20, radius: 5 }]), noTerrain(quarter)), noTerrain(quarter), 'bot')
    const slow = moved(createWorld('a', botScene([{ x: 20, y: 20, radius: 5 }]), quarter), quarter, 'bot')
    expect(slow).toBeCloseTo(free * 0.25, 9)
  })

  it('slows a fleeing bot to speed x mult x sprint', () => {
    // A crater next to the bot makes it flee.
    const fleeScene = (): Preset => botScene([{ x: 20, y: 20, radius: 5 }], { nodes: [{ kind: 'danger', x: 22, y: 20 }] })
    const run = (active: Rules): { world: World; d: number } => {
      const world = createWorld('a', fleeScene(), active)
      world.bots[0]!.traits.sprint = 1.5
      const d = moved(world, active, 'bot')
      return { world, d }
    }
    const free = run(noTerrain(on))
    expect(free.world.bots[0]!.intent.kind).toBe('flee')
    const slow = run(on)
    expect(slow.world.bots[0]!.intent.kind).toBe('flee')
    expect(slow.d).toBeCloseTo(free.d * on.tuning.terrain.botSpeedMult, 9)
  })

  it('with fleeExempt a fleeing bot keeps speed x sprint on rough ground, while a wandering bot is still slowed', () => {
    const exempt = withTerrain(rules, { fleeExempt: true })
    const fleeScene = (): Preset => botScene([{ x: 20, y: 20, radius: 5 }], { nodes: [{ kind: 'danger', x: 22, y: 20 }] })
    const run = (active: Rules): { world: World; d: number } => {
      const world = createWorld('a', fleeScene(), active)
      world.bots[0]!.traits.sprint = 1.5
      const d = moved(world, active, 'bot')
      return { world, d }
    }
    const free = run(noTerrain(exempt))
    const fast = run(exempt)
    expect(fast.world.bots[0]!.intent.kind).toBe('flee')
    expect(fast.d).toBe(free.d)
    // A bot with no danger wanders and is still slowed.
    const wFree = moved(createWorld('a', botScene([{ x: 20, y: 20, radius: 5 }]), noTerrain(exempt)), noTerrain(exempt), 'bot')
    const wSlow = moved(createWorld('a', botScene([{ x: 20, y: 20, radius: 5 }]), exempt), exempt, 'bot')
    expect(wSlow).toBeCloseTo(wFree * exempt.tuning.terrain.botSpeedMult, 9)
  })

  it('leaves a predator on rough ground unchanged by fleeExempt', () => {
    const predScene = (): Preset => scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }], terrain: [{ x: 20, y: 20, radius: 5 }] })
    const a = withTerrain(rules, { predatorSpeedMult: 0.4, botSpeedMult: 0.9 })
    const b = withTerrain(rules, { predatorSpeedMult: 0.4, botSpeedMult: 0.9, fleeExempt: true })
    expect(moved(createWorld('a', predScene(), b), b, 'predator')).toBe(moved(createWorld('a', predScene(), a), a, 'predator'))
  })

  it('reads fleeExempt only with terrain on, and replays to the same hash with it on', () => {
    const exempt = withTerrain(rules, { fleeExempt: true })
    const offA = noTerrain(exempt)
    const w1 = createWorld('a', edenPreset, offA)
    const w2 = createWorld('a', edenPreset, noTerrain(rules))
    for (let i = 0; i < 800; i += 1) {
      step(w1, offA)
      step(w2, noTerrain(rules))
    }
    expect(stateHash(w1)).toBe(stateHash(w2))
    const live = createWorld('a', edenPreset, exempt)
    while (live.tick < 800) step(live, exempt)
    expect(stateHash(replayWorld('a', edenPreset, exempt, [], 800))).toBe(stateHash(live))
  })

  it('slows a predator that starts on rough ground by the predator multiplier', () => {
    const predScene = (): Preset => scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }], terrain: [{ x: 20, y: 20, radius: 5 }] })
    const active = withTerrain(rules, { predatorSpeedMult: 0.4, botSpeedMult: 0.9 })
    const free = moved(createWorld('a', predScene(), noTerrain(active)), noTerrain(active), 'predator')
    expect(free).toBeGreaterThan(0)
    const slow = moved(createWorld('a', predScene(), active), active, 'predator')
    expect(slow).toBeCloseTo(free * 0.4, 9)
  })

  it('takes the same random draws on and off rough ground', () => {
    const mk = (active: Rules): World => createWorld('a', botScene([{ x: 20, y: 20, radius: 5 }], { nodes: [{ kind: 'predator', x: 30, y: 30 }] }), active)
    const a = mk(on)
    const b = mk(noTerrain(on))
    for (let i = 0; i < 20; i += 1) {
      step(a, on)
      step(b, noTerrain(on))
    }
    expect(JSON.stringify(a.rng)).toBe(JSON.stringify(b.rng))
  })
})

describe('perception', () => {
  for (const [label, active] of [['cone on', withCone(on)], ['cone off', noCone(on)]] as const) {
    it(`never senses or remembers rough ground (${label})`, () => {
      const world = createWorld(
        'a',
        scene({ bots: [{ x: 20, y: 20 }], terrain: [{ x: 20, y: 20, radius: 6 }, { x: 22, y: 20, radius: 6 }], nodes: [{ kind: 'resource', x: 24, y: 20 }] }),
        active,
      )
      const bot = world.bots[0]!
      bot.heading = 0
      const sensed = perceive(world, bot, active.tuning)
      expect(sensed.map((n) => n.kind)).toEqual(['resource'])
      for (let i = 0; i < 30; i += 1) step(world, active)
      for (const b of world.bots) expect(b.memory.some((entry) => entry.kind === 'rough')).toBe(false)
    })
  }
})

describe('checkTerrain', () => {
  const base = rules.tuning.terrain
  it('accepts the shipped numbers', () => {
    expect(() => checkTerrain(base)).not.toThrow()
    expect(() => checkTerrain({ ...base, botSpeedMult: 1, maxCount: 0 })).not.toThrow()
  })
  it('refuses a multiplier of 0, above 1 or not a number, and a fractional maxCount, naming the value', () => {
    expect(() => checkTerrain({ ...base, botSpeedMult: 0 })).toThrow(RangeError)
    expect(() => checkTerrain({ ...base, botSpeedMult: 1.5 })).toThrow(/1\.5/)
    expect(() => checkTerrain({ ...base, predatorSpeedMult: Number.NaN })).toThrow(/NaN/)
    expect(() => checkTerrain({ ...base, predatorSpeedMult: 0 })).toThrow(/predatorSpeedMult/)
    expect(() => checkTerrain({ ...base, fleeExempt: 1 as unknown as boolean })).toThrow(/fleeExempt/)
    expect(() => checkTerrain({ ...base, maxCount: 2.5 })).toThrow(/2\.5/)
    expect(() => checkTerrain({ ...base, maxCount: -1 })).toThrow(RangeError)
  })
  it('is checked by createWorld even with terrain off', () => {
    const bad: Rules = { ...rules, tuning: { ...rules.tuning, terrain: { ...base, botSpeedMult: 0 } } }
    expect(() => createWorld('a', blankPreset, bad)).toThrow(/botSpeedMult/)
  })
})

describe('placing rough ground', () => {
  const place = (x: number, y: number): Command => ({ type: 'placeNode', kind: 'rough', x, y })

  it('is refused while terrain is off', () => {
    const world = createWorld('a', blankPreset, rules)
    expect(checkCommand(world, rules, place(10, 10))).toBe('Rough ground is switched off.')
    expect(applyCommand(world, rules, place(10, 10)).ok).toBe(false)
  })

  it('is accepted on, refused too close to another and at the cap', () => {
    const active = withTerrain(rules, { maxCount: 2 })
    const world = createWorld('a', blankPreset, active)
    expect(applyCommand(world, active, place(10, 10)).ok).toBe(true)
    expect(checkCommand(world, active, place(10.5, 10))).toBe('Too close to another rough node.')
    expect(applyCommand(world, active, place(30, 10)).ok).toBe(true)
    expect(checkCommand(world, active, place(60, 40))).toBe('Too much rough ground (2).')
    expect(roughNodes(world)).toHaveLength(2)
  })

  it('counts preset rough ground toward the cap and the node limit', () => {
    const capped = withTerrain(rules, { maxCount: 4 })
    expect(checkCommand(createWorld('a', edenPreset, capped), capped, place(5, 5))).toBe('Too much rough ground (4).')
    const tight: Rules = { ...on, tuning: { ...on.tuning, player: { ...on.tuning.player, maxNodes: 1 } } }
    const world = createWorld('a', blankPreset, tight)
    expect(applyCommand(world, tight, place(10, 10)).ok).toBe(true)
    expect(checkCommand(world, tight, place(30, 30))).toMatch(/map is full/)
  })

  it('removes like any node, and a run that places and removes replays to the same hash', () => {
    const live = createWorld('a', edenPreset, on)
    let placedId = -1
    while (live.tick < 600) {
      if (live.tick === 100) {
        const result = applyCommand(live, on, place(30, 50))
        expect(result.ok).toBe(true)
        if (result.ok) placedId = result.id
      }
      if (live.tick === 300) expect(applyCommand(live, on, { type: 'removeNode', id: placedId }).ok).toBe(true)
      step(live, on)
    }
    expect(roughNodes(live)).toHaveLength(4)
    const replayed = replayWorld(
      'a',
      edenPreset,
      on,
      [
        { tick: 100, cmd: place(30, 50) },
        { tick: 300, cmd: { type: 'removeNode', id: placedId } },
      ],
      600,
    )
    expect(stateHash(replayed)).toBe(stateHash(live))
  })
})
