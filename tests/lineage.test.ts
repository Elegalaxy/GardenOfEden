import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { applyCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { addRecord, familyView, findRecord, founderLines, pruneLineage, recordDeath } from '../src/sim/lineage.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { step } from '../src/sim/step.ts'
import type { DeathCause, LineageRecord, Preset, Rules, World } from '../src/sim/types.ts'
import { createWorld, makeBot } from '../src/sim/world.ts'

// Lineage records (M11). They need the real numbers from src/content, so they live here and not
// next to src/sim. The family-tree queries and the pruning order are tested on hand-built records.

const { tuning } = rules
const SLOW = 120_000

function scene(over: Partial<Preset>): Preset {
  return { id: 'test', label: 'Test scene', width: 40, height: 40, nodes: [], scatter: [], bots: [], scatterBots: 0, ...over }
}

function withLineage(maxRecords: number, pruneTo: number): Rules {
  return { ...rules, tuning: { ...tuning, lineage: { maxRecords, pruneTo } } }
}

function foundersIn(preset: Preset): number {
  return preset.bots.length + preset.scatterBots
}

/** A hand-built record; `died` makes it a dead one. */
function rec(id: number, parentId: number | null, died: number | null = null): LineageRecord {
  return {
    id,
    parentId,
    generation: 0,
    born: 0,
    died,
    cause: died === null ? null : 'starve',
    children: 0,
    traits: { ...tuning.traits },
  }
}

/** A world with exactly these records and living bots (ids in `alive`). */
function handBuilt(records: LineageRecord[], alive: number[]): World {
  const world = createWorld('t', scene({}), rules)
  world.lineage = records
  for (const id of alive) {
    const bot = makeBot(id, 10, 10, 0, rules)
    bot.parentId = records.find((r) => r.id === id)?.parentId ?? null
    world.bots.push(bot)
  }
  return world
}

function ids(list: readonly LineageRecord[]): number[] {
  return list.map((r) => r.id)
}

/** Checks the invariants that must hold at any tick. */
function expectConsistent(world: World, everMade: number): void {
  const list = world.lineage
  for (let i = 1; i < list.length; i += 1) expect(list[i].id).toBeGreaterThan(list[i - 1].id)
  for (const bot of world.bots) {
    const record = findRecord(world, bot.id)
    expect(record, `record of living bot ${bot.id}`).toBeDefined()
    expect(record).toMatchObject({ parentId: bot.parentId, generation: bot.generation, died: null, cause: null })
  }
  expect(list.filter((r) => r.died === null)).toHaveLength(world.bots.length)
  expect(list.length + world.lineagePruned).toBe(everMade)
}

describe('records', () => {
  it('gives every founder a record with no parent, born at tick 0, holding its traits', () => {
    const world = createWorld('a', edenPreset, rules)
    expect(world.lineage).toHaveLength(foundersIn(edenPreset))
    for (const bot of world.bots) {
      expect(findRecord(world, bot.id)).toEqual({
        id: bot.id,
        parentId: null,
        generation: 0,
        born: 0,
        died: null,
        cause: null,
        children: 0,
        traits: tuning.traits,
      })
    }
    expect(world.lineagePruned).toBe(0)
  })

  it('gives a placed bot a record with no parent, born at the tick it was placed', () => {
    const world = createWorld('a', scene({}), rules)
    for (let i = 0; i < 7; i += 1) step(world, rules)
    const result = applyCommand(world, rules, { type: 'placeBot', x: 12, y: 8 })
    expect(result.ok).toBe(true)
    const id = result.ok ? result.id : -1
    expect(findRecord(world, id)).toMatchObject({ id, parentId: null, generation: 0, born: 7, died: null })
  })

  it('keeps a record that matches every living bot, and counts children right', () => {
    const world = createWorld('a', edenPreset, rules)
    for (let i = 0; i < 4000; i += 1) step(world, rules)
    expect(world.totalBirths).toBeGreaterThan(100)
    expect(world.lineagePruned).toBe(0)
    expectConsistent(world, foundersIn(edenPreset) + world.totalBirths)
    const counted = new Map<number, number>()
    for (const r of world.lineage) {
      if (r.parentId !== null) counted.set(r.parentId, (counted.get(r.parentId) ?? 0) + 1)
    }
    for (const r of world.lineage) expect(r.children).toBe(counted.get(r.id) ?? 0)
    // Dead records agree with the death counters, and a child is born after its parent and one generation down.
    const dead = world.lineage.filter((r) => r.died !== null)
    expect(dead).toHaveLength(Object.values(world.deathsByCause).reduce((a, b) => a + b, 0))
    for (const cause of Object.keys(world.deathsByCause) as DeathCause[]) {
      expect(dead.filter((r) => r.cause === cause)).toHaveLength(world.deathsByCause[cause])
    }
    for (const r of world.lineage) {
      if (r.parentId === null) continue
      const parent = findRecord(world, r.parentId)!
      expect(r.generation).toBe(parent.generation + 1)
      expect(r.born).toBeGreaterThan(parent.born)
    }
  })

  it('records the tick and cause of a thirst death', () => {
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }] }), rules)
    const id = world.bots[0].id
    const expected = Math.ceil(tuning.bot.maxThirst / tuning.bot.thirstDrain)
    while (world.tick < expected) {
      for (const bot of world.bots) bot.energy = tuning.bot.maxEnergy
      step(world, rules)
    }
    expect(world.bots).toHaveLength(0)
    expect(findRecord(world, id)).toMatchObject({ died: expected, cause: 'thirst' })
  })

  it('records a meteor death at the tick of the strike', () => {
    const world = createWorld('a', scene({ bots: [{ x: 20, y: 20 }, { x: 5, y: 5 }] }), rules)
    const [near, far] = world.bots.map((bot) => bot.id)
    for (let i = 0; i < 5; i += 1) step(world, rules)
    const bot = world.bots[0]
    const result = applyCommand(world, rules, { type: 'triggerEvent', event: 'meteor', x: bot.x, y: bot.y })
    expect(result.ok).toBe(true)
    expect(findRecord(world, near)).toMatchObject({ died: 5, cause: 'meteor' })
    expect(findRecord(world, far)).toMatchObject({ died: null, cause: null })
    expect(world.deathsByCause.meteor).toBe(1)
  })

  it('addRecord inserts an out-of-order id in place and ignores a repeated one', () => {
    const world = createWorld('a', scene({}), rules)
    addRecord(world, 5, null, 0, tuning.traits)
    addRecord(world, 9, 5, 1, tuning.traits)
    addRecord(world, 7, 5, 1, tuning.traits)
    const again = addRecord(world, 7, null, 0, tuning.traits)
    expect(ids(world.lineage)).toEqual([5, 7, 9])
    expect(again.parentId).toBe(5)
    recordDeath(world, 7, 'age')
    expect(findRecord(world, 7)).toMatchObject({ died: 0, cause: 'age' })
    recordDeath(world, 99, 'age')
    expect(findRecord(world, 99)).toBeUndefined()
  })
})

describe('pruneLineage', () => {
  it('does nothing at or under maxRecords', () => {
    const world = handBuilt([rec(1, null, 5), rec(2, null, 6), rec(3, null)], [3])
    pruneLineage(world, withLineage(3, 1).tuning)
    expect(ids(world.lineage)).toEqual([1, 2, 3])
    expect(world.lineagePruned).toBe(0)
  })

  it('drops extinct branches first (earliest death, then lowest id), keeping every living bot ancestry', () => {
    const world = handBuilt(
      [
        rec(1, null, 50), // ancestor of living 3
        rec(2, 1, 60), // extinct
        rec(3, 1),
        rec(4, null, 10), // extinct, died first
        rec(5, 4, 70), // extinct
        rec(6, null),
        rec(7, 6, 20), // extinct
      ],
      [3, 6],
    )
    pruneLineage(world, withLineage(6, 4).tuning)
    // Seven records, target four: the three earliest-dead extinct ones (4 at 10, 7 at 20, 2 at 60) go.
    expect(ids(world.lineage)).toEqual([1, 3, 5, 6])
    expect(world.lineagePruned).toBe(3)
    expect(findRecord(world, 5)?.parentId).toBe(4) // an orphan is a valid state
  })

  it('breaks a death-tick tie by the lowest id', () => {
    const world = handBuilt([rec(1, null, 9), rec(2, null, 9), rec(3, null, 9), rec(4, null)], [4])
    pruneLineage(world, withLineage(3, 2).tuning)
    expect(ids(world.lineage)).toEqual([3, 4])
  })

  it('then drops the oldest dead ancestors of living bots, lowest id first', () => {
    const world = handBuilt([rec(1, null, 5), rec(2, 1, 6), rec(3, 2), rec(4, null)], [3, 4])
    pruneLineage(world, withLineage(3, 2).tuning)
    expect(ids(world.lineage)).toEqual([3, 4])
    expect(world.lineagePruned).toBe(2)
    const partial = handBuilt([rec(1, null, 5), rec(2, 1, 6), rec(3, 2), rec(4, null)], [3, 4])
    pruneLineage(partial, withLineage(3, 3).tuning)
    expect(ids(partial.lineage)).toEqual([2, 3, 4])
  })

  it('never drops the record of a living bot, even when the target cannot be reached', () => {
    const world = handBuilt([rec(1, null, 5), rec(2, 1), rec(3, null)], [2, 3])
    pruneLineage(world, withLineage(1, 0).tuning)
    expect(ids(world.lineage)).toEqual([2, 3])
  })

  it('still marks the ancestors of a living bot whose own record is gone', () => {
    const world = handBuilt([rec(1, null, 5), rec(2, 1, 6), rec(4, null, 7), rec(5, null, 8)], [])
    const orphan = makeBot(3, 10, 10, 0, rules)
    orphan.parentId = 2
    world.bots.push(orphan)
    pruneLineage(world, withLineage(3, 2).tuning)
    // 1 and 2 lead to the living bot 3 (record gone); 4 and 5 are extinct and go first.
    expect(ids(world.lineage)).toEqual([1, 2])
  })
})

describe('familyView and founderLines', () => {
  //  1 (dead) ── 2 (dead) ── 4 (alive)
  //     │            └─────── 5 (dead) ── 8 (alive)
  //     └─ 3 (alive) ── 6 (dead)
  //              └───── 7 (alive)
  // 10 (alive, no children)
  function tree(): World {
    return handBuilt(
      [rec(1, null, 5), rec(2, 1, 6), rec(3, 1), rec(4, 2), rec(5, 2, 9), rec(6, 3, 8), rec(7, 3), rec(8, 5), rec(10, null)],
      [3, 4, 7, 8, 10],
    )
  }

  it('lists the founder lines with living and total descendants, living first', () => {
    const lines = founderLines(tree())
    expect(lines.map((l) => [l.record.id, l.living, l.total])).toEqual([
      [1, 4, 7],
      [10, 0, 0],
    ])
  })

  it('treats a record whose parent was pruned as the root of a line', () => {
    const world = tree()
    world.lineage = world.lineage.filter((r) => r.id !== 1 && r.id !== 2)
    const lines = founderLines(world)
    expect(lines.map((l) => [l.record.id, l.living, l.total])).toEqual([
      [3, 1, 2],
      [5, 1, 1],
      [4, 0, 0],
      [10, 0, 0],
    ])
  })

  it('returns the ancestors nearest first, and reports whether the walk was cut by the up limit', () => {
    const world = tree()
    const full = familyView(world, 8, 5, 0, 10)!
    expect(ids(full.ancestors)).toEqual([5, 2, 1])
    expect(full.ancestorsMissing).toBe(false)
    const cut = familyView(world, 8, 2, 0, 10)!
    expect(ids(cut.ancestors)).toEqual([5, 2])
    expect(cut.ancestorsMissing).toBe(false)
    expect(familyView(world, 99, 2, 2, 10)).toBeNull()
  })

  it('reports missing ancestors after pruning', () => {
    const world = tree()
    world.lineage = world.lineage.filter((r) => r.id !== 1)
    const view = familyView(world, 8, 5, 0, 10)!
    expect(ids(view.ancestors)).toEqual([5, 2])
    expect(view.ancestorsMissing).toBe(true)
    const founder = familyView(world, 10, 5, 0, 10)!
    expect(founder.ancestors).toEqual([])
    expect(founder.ancestorsMissing).toBe(false)
  })

  it('builds the descendant tree with counts', () => {
    const view = familyView(tree(), 1, 0, 5, 100)!
    expect(view.livingDescendants).toBe(4)
    expect(view.totalDescendants).toBe(7)
    expect(view.hiddenChildren).toBe(0)
    const shape = (nodes: typeof view.descendants): unknown[] => nodes.map((n) => [n.record.id, n.hiddenChildren, shape(n.children)])
    expect(shape(view.descendants)).toEqual([
      [2, 0, [[4, 0, []], [5, 0, [[8, 0, []]]]]],
      [3, 0, [[7, 0, []], [6, 0, []]]],
    ])
  })

  it('limits the depth, with hidden counts at the cut', () => {
    const view = familyView(tree(), 1, 0, 1, 100)!
    expect(ids(view.descendants.map((n) => n.record))).toEqual([2, 3])
    expect(view.descendants.map((n) => n.hiddenChildren)).toEqual([2, 2])
    expect(view.descendants.every((n) => n.children.length === 0)).toBe(true)
    const none = familyView(tree(), 1, 0, 0, 100)!
    expect(none.descendants).toEqual([])
    expect(none.hiddenChildren).toBe(2)
    expect(none.totalDescendants).toBe(7)
  })

  it('limits the children per node, showing the branches with the most living members first', () => {
    const view = familyView(tree(), 1, 0, 5, 100, 1)!
    expect(view.hiddenChildren).toBe(1)
    expect(ids(view.descendants.map((n) => n.record))).toEqual([2])
    // 2 has 4 (alive) and 5 (dead, with living 8 below): equal weight, lowest id first.
    expect(ids(view.descendants[0].children.map((n) => n.record))).toEqual([4])
    expect(view.descendants[0].hiddenChildren).toBe(1)
  })

  it('limits the total nodes, cutting the deepest level first', () => {
    const view = familyView(tree(), 1, 0, 5, 3)!
    let shown = 0
    const count = (nodes: typeof view.descendants): void => {
      for (const n of nodes) {
        shown += 1
        count(n.children)
      }
    }
    count(view.descendants)
    expect(shown).toBe(3)
    expect(ids(view.descendants.map((n) => n.record))).toEqual([2, 3])
    expect(view.totalDescendants).toBe(7)
    // Hidden counts are direct children only: 5 under node 2, and 6 and 7 under node 3.
    expect(view.descendants.map((n) => n.hiddenChildren)).toEqual([1, 2])
    expect(familyView(tree(), 1, 0, 5, 0)!.descendants).toEqual([])
  })
})

describe('over a long run', () => {
  it.each(['a', 'b'])('seed %s keeps the store within maxRecords and never loses a living bot', (seed) => {
    const founders = foundersIn(edenPreset)
    const world = createWorld(seed, edenPreset, rules)
    for (let i = 0; i < 60_000; i += 1) {
      step(world, rules)
      expect(world.lineage.length).toBeLessThanOrEqual(tuning.lineage.maxRecords)
      if (world.tick % 1500 === 0) expectConsistent(world, founders + world.totalBirths)
    }
    expectConsistent(world, founders + world.totalBirths)
    expect(world.lineagePruned).toBeGreaterThan(0)
    // Extinct branches go before ancestry: what pruning keeps is mostly the recent past.
    const lines = founderLines(world)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.reduce((sum, l) => sum + 1 + l.total, 0)).toBe(world.lineage.length)
  }, SLOW)

  it('prunes in batches: a small store drops to pruneTo each time it passes maxRecords', () => {
    const small = withLineage(300, 240)
    const world = createWorld('a', edenPreset, small)
    const founders = foundersIn(edenPreset)
    let batches = 0
    let before = world.lineagePruned
    for (let i = 0; i < 20_000; i += 1) {
      step(world, small)
      expect(world.lineage.length).toBeLessThanOrEqual(300)
      if (world.lineagePruned !== before) {
        batches += 1
        // A batch lands on pruneTo (births in one tick are added before pruning, so exactly pruneTo).
        expect(world.lineage.length).toBe(240)
        before = world.lineagePruned
      }
    }
    expect(batches).toBeGreaterThan(5)
    expectConsistent(world, founders + world.totalBirths)
  }, SLOW)

  it('does not change anything the bots do: only the lineage fields differ between tunings', () => {
    const tight = withLineage(200, 150)
    const a = createWorld('c', edenPreset, rules)
    const b = createWorld('c', edenPreset, tight)
    for (let i = 0; i < 6000; i += 1) {
      step(a, rules)
      step(b, tight)
    }
    expect(b.lineagePruned).toBeGreaterThan(0)
    const strip = (w: World): string => JSON.stringify({ ...w, lineage: [], lineagePruned: 0 })
    expect(strip(b)).toBe(strip(a))
  }, SLOW)
})

describe('determinism', () => {
  const tight = withLineage(100, 80)

  it('gives the same hash for the same seed', () => {
    const run = (): string => {
      const world = createWorld('d', edenPreset, tight)
      for (let i = 0; i < 4000; i += 1) step(world, tight)
      return stateHash(world)
    }
    expect(run()).toBe(run())
  })

  it('replays from seed and commands to the same hash, lineage included', () => {
    const live = createWorld('e', edenPreset, tight)
    for (let i = 0; i < 1500; i += 1) step(live, tight)
    applyCommand(live, tight, { type: 'placeBot', x: 20, y: 20 })
    for (let i = 0; i < 1000; i += 1) step(live, tight)
    const hit = live.bots[0]
    expect(applyCommand(live, tight, { type: 'triggerEvent', event: 'meteor', x: hit.x, y: hit.y }).ok).toBe(true)
    for (let i = 0; i < 2500; i += 1) step(live, tight)
    expect(live.lineagePruned).toBeGreaterThan(0)
    expect(live.deathsByCause.meteor).toBeGreaterThan(0)
    const replayed = replayWorld('e', edenPreset, tight, live.commands, live.tick)
    expect(stateHash(replayed)).toBe(stateHash(live))
    expect(replayed.lineage).toEqual(live.lineage)
  }, SLOW)

  it('continues identically from a JSON copy taken mid-run', () => {
    const live = createWorld('f', edenPreset, tight)
    for (let i = 0; i < 3000; i += 1) step(live, tight)
    expect(live.lineagePruned).toBeGreaterThan(0)
    const copy = JSON.parse(JSON.stringify(live)) as World
    for (let i = 0; i < 1500; i += 1) {
      step(live, tight)
      step(copy, tight)
    }
    expect(stateHash(copy)).toBe(stateHash(live))
  }, SLOW)
})
