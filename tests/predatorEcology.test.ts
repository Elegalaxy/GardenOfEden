import { describe, expect, it } from 'vitest'

import { blankPreset, edenPreset, rules } from '../src/content/index.ts'
import { applyCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { exposureAt } from '../src/sim/nodes.ts'
import { checkEcology, creditKill, movePredators, predatorLife } from '../src/sim/predators.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { createRng, nextFloat } from '../src/sim/rng.ts'
import { step } from '../src/sim/step.ts'
import type { MemoryEntry, Preset, Rules, World, WorldNode } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'
import { createGapTracker, formatSurvey, surveySeed } from '../src/harness/survey.ts'
import { noCone, staticPredators, withEcology } from './variants.ts'

// Predator ecology (E1): hunger, kills, starving and ageing, cubs, dens and re-colonising, commands and determinism, and the
// harness columns. The shipped rules have it off; most tests switch it on with `withEcology` and call `predatorLife` or
// `movePredators` directly with the tick set by hand.

const eco = rules.tuning.predator.ecology
const pt = rules.tuning.predator

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', width: 60, height: 60, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

const predatorsOf = (world: World): WorldNode[] => world.nodes.filter((node) => node.kind === 'predator')
const lifeOf = (node: WorldNode) => node.hunt!.life!

/** One tick of the ecology phase only. */
function lifeTick(world: World, r: Rules): void {
  world.tick += 1
  predatorLife(world, r)
}

function withMaxCount(r: Rules, maxCount: number): Rules {
  return { ...r, tuning: { ...r.tuning, predator: { ...r.tuning.predator, maxCount } } }
}

/** Make the first predator ready to breed: enough kills, age and energy (with drain 0 the numbers do not move). */
function ready(node: WorldNode): void {
  const life = lifeOf(node)
  life.kidsKills = eco.killsPerCub
  life.age = eco.adultAge
  life.energy = eco.cubCost + eco.huntBelow
}

const BIG = { width: 200, height: 200 }

describe('ecology off equals before E1', () => {
  it('ships on with the E2 numbers', () => {
    expect(eco).toEqual({
      enabled: true,
      drain: 0.02,
      killEnergy: 60,
      maxEnergy: 100,
      huntBelow: 60,
      maxAge: 12000,
      adultAge: 1500,
      killsPerCub: 6,
      cubEnergy: 50,
      cubCost: 30,
      homeTries: 8,
      homeSpacing: 24,
      homeMargin: 4,
      denRadius: 4,
      recolonizeTicks: 3000,
    })
    expect(() => checkEcology(eco)).not.toThrow()
    expect(eco.cubEnergy).toBeLessThan(eco.huntBelow)
  })

  it('Eden seed a with a placed and a removed predator hashes as it did before E1, with no new keys', () => {
    // Fixed predators: the pin belongs to the world without ecology, whatever the shipped rules say.
    const off = noCone(staticPredators(rules)) // and all-round sensing: the pin predates the V2 vision cone
    const world = createWorld('a', edenPreset, off)
    let predatorDraws = 0
    for (let i = 0; i < 5000; i += 1) {
      if (world.tick === 1000) expect(applyCommand(world, off, { type: 'placeNode', kind: 'predator', x: 40.5, y: 30.5 }).ok).toBe(true)
      if (world.tick === 3000) {
        const placed = predatorsOf(world).slice(-1)[0]!
        expect(applyCommand(world, off, { type: 'removeNode', id: placed.id }).ok).toBe(true)
      }
      predatorDraws += predatorsOf(world).length
      step(world, off)
    }
    // Recorded on the untouched tree (before E1) with the same script.
    expect(stateHash(world)).toBe('a055e51d6b1c90a7')
    expect(world.ecology).toBeUndefined()
    expect('ecology' in world).toBe(false)
    expect(predatorsOf(world).every((node) => node.hunt !== null && !('life' in node.hunt))).toBe(true)
    expect(world.samples.every((sample) => !('predators' in sample))).toBe(true)
    expect(world.log.every((event) => event.type !== 'predator')).toBe(true)
    const reference = createRng('a').predator
    for (let i = 0; i < predatorDraws; i += 1) nextFloat(reference)
    expect(world.rng.predator).toEqual(reference)
  })

  it("Eden as shipped differs from staticPredators, and only the shipped world has 'ecology'", () => {
    const a = createWorld('b', edenPreset, rules)
    const off = staticPredators(rules)
    const b = createWorld('b', edenPreset, off)
    expect('ecology' in a).toBe(true)
    expect('ecology' in b).toBe(false)
    for (let i = 0; i < 300; i += 1) {
      step(a, rules)
      step(b, off)
    }
    expect(stateHash(a)).not.toBe(stateHash(b))
  })
})

describe('hunger and kills', () => {
  const r = withEcology(rules)

  it('a predator starts with cubEnergy and loses drain a tick', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }] }), r)
    expect(lifeOf(predatorsOf(world)[0]!)).toEqual({ energy: eco.cubEnergy, age: 0, born: 0, origin: 'founder', parentId: null, kidsKills: 0 })
    for (let i = 0; i < 10; i += 1) lifeTick(world, r)
    expect(lifeOf(predatorsOf(world)[0]!).energy).toBeCloseTo(eco.cubEnergy - 10 * eco.drain, 9)
    expect(lifeOf(predatorsOf(world)[0]!).age).toBe(10)
  })

  it('a kill adds killEnergy up to maxEnergy and counts toward the next cub', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }] }), r)
    const node = predatorsOf(world)[0]!
    lifeOf(node).energy = 20
    creditKill(world, node.id, 5, r.tuning)
    expect(lifeOf(node).energy).toBe(20 + eco.killEnergy)
    expect(lifeOf(node).kidsKills).toBe(1)
    expect(node.hunt!.kills).toBe(1)
    expect(node.hunt!.restUntil).toBe(5 + pt.digestTicks)
    lifeOf(node).energy = 90
    creditKill(world, node.id, 6, r.tuning)
    expect(lifeOf(node).energy).toBe(eco.maxEnergy)
  })

  it('a hungry predator targets and bites; a sated one does neither, and both take one draw', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }], bots: [{ x: 20.5, y: 20 }] }), r)
    const node = predatorsOf(world)[0]!
    world.tick = 1
    lifeOf(node).energy = eco.huntBelow - 1
    expect(exposureAt(world, 20.5, 20, r.tuning).predator).toBeGreaterThan(0)
    const reference = structuredClone(world.rng.predator)
    movePredators(world, r)
    nextFloat(reference)
    expect(node.hunt!.targetId).toBe(world.bots[0]!.id)
    expect(world.rng.predator).toEqual(reference)

    world.tick = 2
    node.hunt!.targetId = null
    lifeOf(node).energy = eco.huntBelow
    expect(exposureAt(world, node.x, node.y, r.tuning).predator).toBe(0)
    movePredators(world, r)
    nextFloat(reference)
    expect(node.hunt!.targetId).toBeNull()
    expect(world.rng.predator).toEqual(reference)
    // The same sated predator bites nobody in the shipped (ecology off) rules' sense: off means always hungry.
    expect(exposureAt(world, node.x, node.y, staticPredators(rules).tuning).predator).toBeGreaterThan(0)
  })
})

describe('starving and ageing', () => {
  const r = withEcology(rules)

  it('a predator at 0 energy starves: the node goes, a log event is written and the stat counts it', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }] }), r)
    const node = predatorsOf(world)[0]!
    lifeOf(node).energy = eco.drain
    lifeTick(world, r)
    expect(predatorsOf(world)).toHaveLength(0)
    expect(world.ecology!.stats.starved).toBe(1)
    expect(world.log.at(-1)).toEqual({ tick: 1, type: 'predator', nodeId: node.id, predatorEvent: 'starved', x: 20, y: 20 })
  })

  it('a predator dies of age at maxAge', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }] }), r)
    const node = predatorsOf(world)[0]!
    lifeOf(node).age = eco.maxAge - 2
    lifeTick(world, r)
    expect(predatorsOf(world)).toHaveLength(1)
    lifeTick(world, r)
    expect(predatorsOf(world)).toHaveLength(0)
    expect(world.ecology!.stats.aged).toBe(1)
    expect(world.log.at(-1)!.predatorEvent).toBe('aged')
  })

  it('a bot forgets a predator that died', () => {
    const quick = withEcology(rules, { maxAge: 1 })
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 5, y: 5 }], bots: [{ x: 55, y: 55 }] }), quick)
    const node = predatorsOf(world)[0]!
    const entry: MemoryEntry = { nodeId: node.id, kind: 'predator', x: 5, y: 5, radius: node.radius, seenTick: 0, amount: 0, learnedFrom: null }
    world.bots[0]!.memory.push(entry)
    step(world, quick)
    expect(predatorsOf(world)).toHaveLength(0)
    step(world, quick)
    expect(world.bots[0]!.memory.some((m) => m.nodeId === node.id)).toBe(false)
  })
})

describe('cubs', () => {
  const r = withEcology(rules, { drain: 0 })

  function breeder(extra: Partial<Preset> = {}, rr: Rules = r): World {
    const world = createWorld('a', scene({ ...BIG, nodes: [{ kind: 'predator', x: 100, y: 100 }], ...extra }), rr)
    ready(predatorsOf(world)[0]!)
    return world
  }

  it('a ready predator breeds into free territory: cub at the parent, own home, costs and ids', () => {
    const world = breeder({ nodes: [{ kind: 'predator', x: 100, y: 100 }, { kind: 'shelter', x: 118, y: 100 }] }, withEcology(rules, { drain: 0, homeTries: 200 }))
    const rr = withEcology(rules, { drain: 0, homeTries: 200 })
    const parent = predatorsOf(world)[0]!
    const nextId = world.nextId
    lifeTick(world, rr)
    const [, cub] = predatorsOf(world)
    expect(cub).toBeDefined()
    expect(cub!.id).toBe(nextId)
    expect(cub!.x).toBe(parent.x)
    expect(cub!.y).toBe(parent.y)
    expect(lifeOf(cub!)).toEqual({ energy: eco.cubEnergy, age: 0, born: 1, origin: 'cub', parentId: parent.id, kidsKills: 0 })
    const { homeX, homeY } = cub!.hunt!
    const d = Math.hypot(homeX - 100, homeY - 100)
    expect(d).toBeGreaterThanOrEqual(eco.homeSpacing - 1e-9)
    expect(d).toBeLessThanOrEqual(2 * eco.homeSpacing + 1e-9)
    expect(Math.hypot(homeX - 118, homeY - 100)).toBeGreaterThan(world.nodes.find((n) => n.kind === 'shelter')!.radius)
    expect(lifeOf(parent).energy).toBe(eco.cubCost + eco.huntBelow - eco.cubCost)
    expect(lifeOf(parent).kidsKills).toBe(0)
    expect(world.ecology!.stats.births).toBe(1)
    expect(world.log.at(-1)).toMatchObject({ type: 'predator', predatorEvent: 'born', nodeId: cub!.id })
    expect(world.ecology!.dens).toHaveLength(1)
  })

  it.each([
    ['kills', (n: WorldNode) => { lifeOf(n).kidsKills = eco.killsPerCub - 1 }],
    ['age', (n: WorldNode) => { lifeOf(n).age = eco.adultAge - 2 }],
    ['energy', (n: WorldNode) => { lifeOf(n).energy = eco.cubCost + eco.huntBelow - 0.5 }],
  ])('too few %s blocks a cub, and takes no draw', (_name, spoil) => {
    const rr = withEcology(rules, { drain: 0, homeTries: 200 })
    const world = breeder({}, rr)
    spoil(predatorsOf(world)[0]!)
    const before = structuredClone(world.rng.predator)
    lifeTick(world, rr)
    expect(predatorsOf(world)).toHaveLength(1)
    expect(world.rng.predator).toEqual(before)
  })

  it('a refused territory changes nothing, keeps kidsKills and takes exactly 2 x homeTries draws', () => {
    // A 30 x 30 map has no spot 18 cells from the parent that is also 4 inside the edge.
    const world = createWorld('a', scene({ width: 30, height: 30, nodes: [{ kind: 'predator', x: 15, y: 15 }] }), r)
    ready(predatorsOf(world)[0]!)
    const reference = structuredClone(world.rng.predator)
    lifeTick(world, r)
    for (let i = 0; i < 2 * eco.homeTries; i += 1) nextFloat(reference)
    expect(world.rng.predator).toEqual(reference)
    expect(predatorsOf(world)).toHaveLength(1)
    expect(lifeOf(predatorsOf(world)[0]!).kidsKills).toBe(eco.killsPerCub)
    expect(lifeOf(predatorsOf(world)[0]!).energy).toBe(eco.cubCost + eco.huntBelow)
    expect(world.ecology!.stats.births).toBe(0)
  })

  it('new homes keep their distance from each other and ids ascend with the parents', () => {
    const rr = withEcology(rules, { drain: 0, homeTries: 200 })
    const world = createWorld('a', scene({ ...BIG, nodes: [{ kind: 'predator', x: 60, y: 100 }, { kind: 'predator', x: 140, y: 100 }] }), rr)
    for (const node of predatorsOf(world)) ready(node)
    const nextId = world.nextId
    lifeTick(world, rr)
    const all = predatorsOf(world)
    expect(all).toHaveLength(4)
    expect(all.slice(2).map((n) => n.id)).toEqual([nextId, nextId + 1])
    expect(lifeOf(all[2]!).parentId).toBe(all[0]!.id)
    expect(lifeOf(all[3]!).parentId).toBe(all[1]!.id)
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        expect(Math.hypot(all[i]!.hunt!.homeX - all[j]!.hunt!.homeX, all[i]!.hunt!.homeY - all[j]!.hunt!.homeY)).toBeGreaterThanOrEqual(eco.homeSpacing - 1e-9)
      }
    }
  })

  it('no cub when the world already holds predator.maxCount', () => {
    const rr = withMaxCount(withEcology(rules, { drain: 0, homeTries: 200 }), 1)
    const world = breeder({}, rr)
    lifeTick(world, rr)
    expect(predatorsOf(world)).toHaveLength(1)
  })
})

describe('dens', () => {
  const r = withEcology(rules, { drain: 0, recolonizeTicks: 5 })

  it('founders and placed predators make dens, one per spot, and cubs make none', () => {
    const world = createWorld('a', scene({ ...BIG, nodes: [{ kind: 'predator', x: 50, y: 50 }, { kind: 'predator', x: 51, y: 50 }, { kind: 'predator', x: 150, y: 150 }] }), r)
    expect(world.ecology!.dens).toEqual([{ x: 50, y: 50, vacantSince: null }, { x: 150, y: 150, vacantSince: null }])
    expect(applyCommand(world, r, { type: 'placeNode', kind: 'predator', x: 100, y: 20 }).ok).toBe(true)
    expect(world.ecology!.dens).toHaveLength(3)
    expect(lifeOf(predatorsOf(world).at(-1)!).origin).toBe('placed')
    const bred = withEcology(rules, { drain: 0, homeTries: 200 })
    const w2 = createWorld('a', scene({ ...BIG, nodes: [{ kind: 'predator', x: 100, y: 100 }] }), bred)
    ready(predatorsOf(w2)[0]!)
    lifeTick(w2, bred)
    expect(predatorsOf(w2)).toHaveLength(2)
    expect(w2.ecology!.dens).toHaveLength(1)
  })

  it('an empty den gets a newcomer at the nearest map edge after recolonizeTicks', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 10, y: 30 }] }), r)
    world.nodes = world.nodes.filter((n) => n.kind !== 'predator')
    lifeTick(world, r)
    expect(world.ecology!.dens[0]!.vacantSince).toBe(1)
    for (let i = 0; i < 4; i += 1) lifeTick(world, r)
    expect(predatorsOf(world)).toHaveLength(0)
    lifeTick(world, r)
    const [newcomer] = predatorsOf(world)
    expect(newcomer).toBeDefined()
    expect(newcomer!.x).toBe(0)
    expect(newcomer!.y).toBe(30)
    expect(newcomer!.hunt).toMatchObject({ homeX: 10, homeY: 30 })
    expect(lifeOf(newcomer!)).toMatchObject({ origin: 'arrived', parentId: null, age: 0, energy: eco.cubEnergy })
    expect(world.ecology!.stats.arrivals).toBe(1)
    expect(world.ecology!.dens[0]!.vacantSince).toBeNull()
    expect(world.log.at(-1)).toMatchObject({ type: 'predator', predatorEvent: 'arrived' })
    // The den is occupied again, so nothing more arrives.
    for (let i = 0; i < 20; i += 1) lifeTick(world, r)
    expect(predatorsOf(world)).toHaveLength(1)
  })

  it('a den at a corner-ish spot picks the edge in the order left, right, top, bottom on a tie', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 30, y: 30 }] }), r)
    world.nodes = world.nodes.filter((n) => n.kind !== 'predator')
    for (let i = 0; i < 6; i += 1) lifeTick(world, r)
    expect(predatorsOf(world)[0]!.x).toBe(0)
  })

  it('Blank never gets a newcomer', () => {
    const world = createWorld('a', blankPreset, r)
    expect(world.ecology!.dens).toEqual([])
    for (let i = 0; i < 100; i += 1) step(world, r)
    expect(predatorsOf(world)).toHaveLength(0)
  })
})

describe('commands and determinism', () => {
  const r = withEcology(rules, { drain: 0 })

  it('removing a predator removes its den, unless another predator is still homed there', () => {
    const world = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }] }), r)
    expect(applyCommand(world, r, { type: 'placeNode', kind: 'predator', x: 40, y: 40 }).ok).toBe(true)
    expect(world.ecology!.dens).toHaveLength(2)
    const placed = predatorsOf(world)[1]!
    expect(applyCommand(world, r, { type: 'removeNode', id: placed.id }).ok).toBe(true)
    expect(world.ecology!.dens).toEqual([{ x: 20, y: 20, vacantSince: null }])
    expect(world.ecology!.stats.removed).toBe(1)

    // Two predators homed at one den: removing one keeps it.
    const second = createWorld('a', scene({ nodes: [{ kind: 'predator', x: 20, y: 20 }, { kind: 'predator', x: 22, y: 20 }] }), r)
    expect(second.ecology!.dens).toHaveLength(1)
    expect(applyCommand(second, r, { type: 'removeNode', id: predatorsOf(second)[1]!.id }).ok).toBe(true)
    expect(second.ecology!.dens).toHaveLength(1)
  })

  it('checkEcology refuses bad numbers, and createWorld checks them only when ecology is on', () => {
    expect(() => checkEcology(eco)).not.toThrow()
    expect(() => checkEcology({ ...eco, drain: 0 })).not.toThrow()
    expect(() => checkEcology({ ...eco, drain: -0.1 })).toThrow(RangeError)
    for (const name of ['killEnergy', 'maxEnergy', 'huntBelow', 'maxAge', 'adultAge', 'killsPerCub', 'cubEnergy', 'cubCost', 'homeTries', 'homeSpacing', 'homeMargin', 'denRadius', 'recolonizeTicks'] as const) {
      expect(() => checkEcology({ ...eco, [name]: 0 })).toThrow(RangeError)
      expect(() => checkEcology({ ...eco, [name]: Number.NaN })).toThrow(RangeError)
    }
    expect(() => checkEcology({ ...eco, huntBelow: eco.maxEnergy + 1 })).toThrow(RangeError)
    // A cub must be affordable after a kill: cubCost + huntBelow <= maxEnergy - drain.
    expect(() => checkEcology({ ...eco, drain: 0, cubCost: eco.maxEnergy - eco.huntBelow })).not.toThrow()
    expect(() => checkEcology({ ...eco, drain: 0.02, cubCost: eco.maxEnergy - eco.huntBelow })).toThrow(RangeError)
    expect(() => checkEcology({ ...eco, cubCost: eco.maxEnergy - eco.huntBelow - eco.drain - 1 })).not.toThrow()
    expect(() => createWorld('a', blankPreset, withEcology(rules, { homeTries: 0 }))).toThrow(RangeError)
    const bad = { ...rules, tuning: { ...rules.tuning, predator: { ...pt, ecology: { ...eco, enabled: false, homeTries: 0 } } } }
    expect(() => createWorld('a', blankPreset, bad)).not.toThrow()
  })

  it('a live run with ecology on and commands replays to the same hash, and a JSON copy steps the same', () => {
    // Fast numbers so deaths, cubs' conditions and arrivals all happen inside 3,000 ticks.
    const fast = withEcology(rules, { drain: 0.05, maxAge: 1200, recolonizeTicks: 100 })
    const live = createWorld('a', edenPreset, fast)
    for (let i = 0; i < 3000; i += 1) {
      if (live.tick === 500) expect(applyCommand(live, fast, { type: 'placeNode', kind: 'predator', x: 40.5, y: 30.5 }).ok).toBe(true)
      if (live.tick === 1500) expect(applyCommand(live, fast, { type: 'removeNode', id: predatorsOf(live).slice(-1)[0]!.id }).ok).toBe(true)
      step(live, fast)
    }
    expect(live.ecology!.stats.aged + live.ecology!.stats.starved).toBeGreaterThan(0)
    expect(live.ecology!.stats.arrivals).toBeGreaterThan(0)
    expect(stateHash(replayWorld('a', edenPreset, fast, live.commands, live.tick))).toBe(stateHash(live))

    const copy: World = JSON.parse(JSON.stringify(live)) as World
    for (let i = 0; i < 400; i += 1) {
      step(live, fast)
      step(copy, fast)
    }
    expect(stateHash(copy)).toBe(stateHash(live))
    expect(live.samples.at(-1)!.predators).toBe(predatorsOf(live).length)
  })
})

describe('harness', () => {
  it('the gap tracker records the ticks between one predator\'s kills and skips its first', () => {
    const tracker = createGapTracker()
    const node = { kind: 'predator', id: 7, hunt: { kills: 0 } }
    const world = { tick: 10, nodes: [node] } as unknown as Pick<World, 'tick' | 'nodes'>
    expect(tracker.record(world)).toEqual([])
    ;(world as { tick: number }).tick = 20
    node.hunt.kills = 1
    expect(tracker.record(world)).toEqual([])
    ;(world as { tick: number }).tick = 50
    node.hunt.kills = 2
    expect(tracker.record(world)).toEqual([30])
    ;(world as { tick: number }).tick = 51
    expect(tracker.record(world)).toEqual([])
  })

  it('the survey table ends with the predator columns, one cell per heading', () => {
    const row = surveySeed('a', edenPreset, staticPredators(rules), 300, 100)
    expect(row.preds).toBe(3)
    expect(row.predMin).toBe(3)
    expect(row.predBorn + row.predArrived + row.predStarved + row.predAged).toBe(0)
    const [head, line] = formatSurvey([row]).split('\n') as [string, string]
    const headings = head.trim().split(/\s+/)
    expect(headings.slice(-11)).toEqual(['preds', 'pMin', 'pMax', 'pBorn', 'pArr', 'pStarve', 'pAged', 'huntGap', 'idle', 'pZero', 'pCap%'])
    expect(headings.slice(0, 27).at(-1)).toBe('inb')
    expect(line.trim().split(/\s+/)).toHaveLength(headings.length)
  })
})
